// 「城市与骑士」扩展：常量 + Game 原型方法（由 game.js 挂载）
// 简化说明：
// - 逃兵替换的骑士直接移回补给区（官方由受害者选择哪个骑士叛逃）抽取
import { RESOURCES, TERRAIN_RESOURCE } from './constants.js';
import { shuffle } from './board.js';

export const COMMODITIES = ['cloth', 'coin', 'paper'];
export const CARD_NAME = {
  wood: '木材', brick: '砖块', sheep: '羊毛', wheat: '小麦', ore: '矿石',
  cloth: '布匹', coin: '铸币', paper: '纸张',
};
// 城市产出：羊/矿/木地形产 1 资源 + 1 商品，砖/麦地形产 2 资源
export const CITY_YIELD = {
  forest: { res: 'wood', com: 'paper' },
  pasture: { res: 'sheep', com: 'cloth' },
  mountains: { res: 'ore', com: 'coin' },
  hills: { res: 'brick' },
  fields: { res: 'wheat' },
};
export const IMPROVE_TRACKS = ['trade', 'politics', 'science'];
export const TRACK_COM = { trade: 'cloth', politics: 'coin', science: 'paper' };
export const TRACK_NAME = { trade: '贸易', politics: '政治', science: '科学' };
export const KNIGHT_COST = { sheep: 1, ore: 1 };
export const ACTIVATE_COST = { wheat: 1 };
export const WALL_COST = { brick: 2 };
export const CK_WIN_VP = 13;
export const BARBARIAN_TRACK = 7;   // 船走 7 格登陆
export const COM_BANK = 12;         // 每种商品的银行存量
export const KNIGHT_PER_LEVEL = 2;  // 每级骑士棋子数
export const MAX_WALLS = 3;
export const MAX_PROGRESS_HAND = 4;

// 进步卡牌堆（官方配比，每堆 18 张）
export const PROGRESS_DECKS = {
  trade: [
    ...Array(6).fill('merchant'),
    ...Array(2).fill('merchantFleet'),
    ...Array(2).fill('commercialHarbor'),
    ...Array(2).fill('masterMerchant'),
    ...Array(4).fill('resourceMonopoly'),
    ...Array(2).fill('tradeMonopoly'),
  ],
  politics: [
    ...Array(2).fill('bishop'),
    'constitution',
    ...Array(2).fill('deserter'),
    ...Array(2).fill('diplomat'),
    ...Array(2).fill('intrigue'),
    ...Array(2).fill('saboteur'),
    ...Array(3).fill('spy'),
    ...Array(2).fill('warlord'),
    ...Array(2).fill('wedding'),
  ],
  science: [
    ...Array(2).fill('alchemist'),
    ...Array(2).fill('crane'),
    'engineer',
    ...Array(2).fill('inventor'),
    ...Array(2).fill('irrigation'),
    ...Array(2).fill('medicine'),
    ...Array(2).fill('mining'),
    'printer',
    ...Array(2).fill('roadBuilding'),
    ...Array(2).fill('smith'),
  ],
};
export const PROGRESS_VP_CARDS = ['constitution', 'printer'];
export const PROGRESS_NAME = {
  merchant: '商人', merchantFleet: '商船队', commercialHarbor: '商业港',
  masterMerchant: '商业大亨', resourceMonopoly: '资源垄断', tradeMonopoly: '商品垄断',
  bishop: '主教', constitution: '宪法', deserter: '逃兵', diplomat: '外交官',
  intrigue: '阴谋', saboteur: '破坏者', spy: '间谍', warlord: '军阀', wedding: '婚礼',
  alchemist: '炼金术士', crane: '起重机', engineer: '工程师', inventor: '发明家',
  irrigation: '灌溉', medicine: '医学', mining: '采矿', printer: '印刷机',
  roadBuilding: '修路', smith: '铁匠',
};
// 发明家不能交换的数字
const INVENTOR_FORBIDDEN = [2, 6, 8, 12];

function cardsOf(hand, types) {
  const pool = [];
  for (const r of types) for (let i = 0; i < (hand[r] || 0); i++) pool.push(r);
  return pool;
}

export const ckMethods = {
  // ---------- 初始化 ----------
  initCK() {
    this.knights = {};     // vertexId -> {player, level, active, builtTurn, promotedTurn, activatedTurn, actedTurn}
    this.walls = {};       // vertexId(城市) -> playerIdx
    this.merchant = null;  // {hex, player}
    this.metropolis = { trade: null, politics: null, science: null }; // {player, vertex}
    this.barbarians = { pos: 0, attacks: 0 };
    this.progressDecks = Object.fromEntries(
      Object.entries(PROGRESS_DECKS).map(([k, deck]) => [k, shuffle(deck, this.rng)]),
    );
    for (const c of COMMODITIES) this.bank[c] = COM_BANK;
    for (const pl of this.players) {
      pl.improvements = { trade: 0, politics: 0, science: 0 };
      pl.progressCards = []; // {type, deck}
      pl.progressVP = 0;     // 已亮出的分数进步卡（宪法/印刷机）
      pl.defenderVP = 0;     // 「卡坦守护者」分数
    }
  },

  // ---------- 工具 ----------
  wallCountOf(p) {
    return Object.values(this.walls).filter((o) => o === p).length;
  },

  metropolisVertices() {
    return new Set(IMPROVE_TRACKS.map((t) => this.metropolis[t]?.vertex).filter((v) => v !== undefined));
  },

  knightCountAtLevel(p, level) {
    return Object.values(this.knights).filter((k) => k.player === p && k.level === level).length;
  },

  ownCityVertices(p, { pillageable = false } = {}) {
    const metro = this.metropolisVertices();
    return Object.entries(this.buildings)
      .filter(([v, b]) => b.player === p && b.type === 'city' && (!pillageable || !metro.has(Number(v))))
      .map(([v]) => Number(v));
  },

  // ---------- 骑士 ----------
  validKnightSpots(p) {
    const res = [];
    for (const v of this.board.vertices) {
      if (this.buildings[v.id] || this.knights[v.id]) continue;
      if (v.adjE.some((e) => this.roads[e] === p)) res.push(v.id);
    }
    return res;
  },

  // 沿自己的道路网可到达的顶点：{moves: 空位, displaces: 可驱逐的低级敌方骑士位}
  knightMoveTargets(p, from) {
    const mover = this.knights[from];
    const visited = new Set([from]);
    const moves = [];
    const displaces = [];
    const queue = [from];
    while (queue.length) {
      const v = queue.shift();
      for (const eid of this.board.vertices[v].adjE) {
        if (this.roads[eid] !== p) continue;
        const e = this.board.edges[eid];
        const nv = e.v1 === v ? e.v2 : e.v1;
        if (visited.has(nv)) continue;
        visited.add(nv);
        const b = this.buildings[nv];
        const k = this.knights[nv];
        if (!b && !k) { moves.push(nv); queue.push(nv); continue; }
        if (b && b.player === p) { queue.push(nv); continue; }     // 自己建筑可通过
        if (k && k.player === p) { queue.push(nv); continue; }     // 自己骑士可通过
        if (k && k.player !== p && k.level < mover.level) displaces.push(nv); // 驱逐后停下
        // 敌方建筑 / 等级不低于自己的敌方骑士：阻断
      }
    }
    return { moves, displaces };
  },

  requireCK() {
    if (!this.ck) this.err('当前不是「城市与骑士」模式');
  },

  buildKnight(p, v) {
    this.requireTurn(p);
    this.requireCK();
    this.requireState('main');
    if (!this.canAfford(p, KNIGHT_COST)) this.err('资源不足（需要 1羊毛 1矿石）');
    if (this.knightCountAtLevel(p, 1) >= KNIGHT_PER_LEVEL) this.err('一级骑士棋子已用完');
    if (!this.validKnightSpots(p).includes(v)) this.err('该位置不能放置骑士');
    this.pay(p, KNIGHT_COST);
    this.knights[v] = {
      player: p, level: 1, active: false,
      builtTurn: this.turn.count, promotedTurn: 0, activatedTurn: 0, actedTurn: 0,
    };
    this.addEvent('build', { player: p, kind: 'knight', vertex: v });
    this.addLog(`${this.players[p].name} 招募了一名骑士`);
    this.updateLongestRoad(); // 骑士会截断对手道路
  },

  // 升级校验（不含费用）；simCounts 供铁匠连续升级时模拟棋子占用
  canPromoteKnight(p, v, simCounts = null) {
    const k = this.knights[v];
    if (!k || k.player !== p) return '只能升级自己的骑士';
    if (k.level >= 3) return '骑士已是最高级';
    if (k.builtTurn === this.turn.count) return '本回合招募的骑士不能立即升级';
    if (k.promotedTurn === this.turn.count) return '每个骑士每回合只能升级一次';
    if (k.level === 2 && this.players[p].improvements.politics < 3)
      return '升级三级骑士需要政治升级达到 3 级（城堡）';
    const target = k.level + 1;
    const used = simCounts ? simCounts[target] : this.knightCountAtLevel(p, target);
    if (used >= KNIGHT_PER_LEVEL) return `${target} 级骑士棋子已用完`;
    return null;
  },

  upgradeKnight(p, v) {
    this.requireTurn(p);
    this.requireCK();
    this.requireState('main');
    const why = this.canPromoteKnight(p, v);
    if (why) this.err(why);
    if (!this.canAfford(p, KNIGHT_COST)) this.err('资源不足（需要 1羊毛 1矿石）');
    this.pay(p, KNIGHT_COST);
    const k = this.knights[v];
    k.level++;
    k.promotedTurn = this.turn.count;
    this.addEvent('build', { player: p, kind: 'knight', vertex: v });
    this.addLog(`${this.players[p].name} 将骑士升到 ${k.level} 级`);
  },

  activateKnight(p, v) {
    this.requireTurn(p);
    this.requireCK();
    this.requireState('main');
    const k = this.knights[v];
    if (!k || k.player !== p) this.err('只能激活自己的骑士');
    if (k.active) this.err('该骑士已激活');
    if (!this.canAfford(p, ACTIVATE_COST)) this.err('资源不足（激活需要 1小麦）');
    this.pay(p, ACTIVATE_COST);
    k.active = true;
    k.activatedTurn = this.turn.count;
    this.addEvent('build', { player: p, kind: 'knight', vertex: v });
    this.addLog(`${this.players[p].name} 激活了骑士`);
  },

  // 骑士行动通用校验：激活当回合不能行动，每回合限一次行动
  knightCanAct(p, v) {
    const k = this.knights[v];
    if (!k || k.player !== p) return '不是你的骑士';
    if (!k.active) return '骑士未激活';
    if (k.activatedTurn === this.turn.count) return '激活当回合不能行动';
    if (k.actedTurn === this.turn.count) return '该骑士本回合已行动过';
    return null;
  },

  moveKnight(p, from, to) {
    this.requireTurn(p);
    this.requireCK();
    this.requireState('main');
    const why = this.knightCanAct(p, from);
    if (why) this.err(why);
    const { moves, displaces } = this.knightMoveTargets(p, from);
    const displacing = displaces.includes(to);
    if (!moves.includes(to) && !displacing) this.err('骑士无法移动到该位置');
    const k = this.knights[from];
    const victim = displacing ? this.knights[to] : null;
    delete this.knights[from];
    // 先算受害者沿自己路网可去的空位（此时攻击者已离开原位）
    const victimSpots = displacing ? this.knightMoveTargets(victim.player, to).moves : null;
    if (displacing) delete this.knights[to];
    this.knights[to] = k;
    k.active = false; // 行动后骑士休整
    k.actedTurn = this.turn.count;
    this.addEvent('knightMove', { player: p, from, to });
    this.addLog(`${this.players[p].name} 移动了骑士`);
    if (displacing) {
      this.startDisplace(victim, victimSpots, `${this.players[p].name} 的骑士驱逐了 ${this.players[victim.player].name} 的 ${victim.level} 级骑士`);
    }
    this.updateLongestRoad();
  },

  // 骑士被驱逐：有空位则由其主人安置（displace 状态），否则移回补给区
  startDisplace(knight, spots, prefix) {
    if (spots.length === 0) {
      this.addLog(`${prefix}——无处安置，移回补给区`);
      return;
    }
    this.turn.displace = { owner: knight.player, knight, options: spots };
    this.turn.state = 'displace';
    this.addLog(`${prefix}，等待 ${this.players[knight.player].name} 重新安置`);
  },

  placeDisplaced(p, v) {
    this.requireCK();
    this.requireState('displace');
    const d = this.turn.displace;
    if (!d || d.owner !== p) this.err('你不需要安置骑士');
    if (!d.options.includes(v)) this.err('无效的位置');
    this.knights[v] = d.knight;
    this.turn.displace = null;
    this.turn.state = 'main';
    this.addEvent('build', { player: p, kind: 'knight', vertex: v });
    this.addLog(`${this.players[p].name} 重新安置了被驱逐的骑士`);
    this.updateLongestRoad();
  },

  chaseRobber(p, v) {
    this.requireTurn(p);
    this.requireCK();
    this.requireState('main');
    const why = this.knightCanAct(p, v);
    if (why) this.err(why);
    if (this.barbarians.attacks === 0) this.err('野蛮人首次来袭前强盗不能移动');
    if (!this.board.vertices[v].hexes.includes(this.robber)) this.err('骑士不与强盗所在板块相邻');
    const k = this.knights[v];
    k.active = false; // 驱逐强盗会使骑士休整
    k.actedTurn = this.turn.count;
    this.addLog(`${this.players[p].name} 的骑士驱逐了强盗！请移动强盗。`);
    this.turn.state = 'robber';
  },

  // ---------- 城墙 ----------
  buildWall(p, v) {
    this.requireTurn(p);
    this.requireCK();
    this.requireState('main');
    if (!this.canAfford(p, WALL_COST)) this.err('资源不足（城墙需要 2砖块）');
    if (this.wallCountOf(p) >= MAX_WALLS) this.err(`每人最多 ${MAX_WALLS} 座城墙`);
    const b = this.buildings[v];
    if (!b || b.player !== p || b.type !== 'city') this.err('城墙只能建在自己的城市下');
    if (this.walls[v] !== undefined) this.err('该城市已有城墙');
    this.pay(p, WALL_COST);
    this.walls[v] = p;
    this.addEvent('build', { player: p, kind: 'wall', vertex: v });
    this.addLog(`${this.players[p].name} 修建了城墙（手牌上限 +2）`);
  },

  // ---------- 城市升级（贸易/政治/科学） ----------
  buyImprovement(p, track) {
    this.requireTurn(p);
    this.requireCK();
    this.requireState('main');
    if (!IMPROVE_TRACKS.includes(track)) this.err('无效的升级路线');
    const pl = this.players[p];
    const lvl = pl.improvements[track];
    if (lvl >= 5) this.err('已达最高等级');
    if (!Object.values(this.buildings).some((b) => b.player === p && b.type === 'city')) {
      this.err('需要至少拥有一座城市');
    }
    const com = TRACK_COM[track];
    let cost = lvl + 1;
    if (this.turn.crane) cost = Math.max(0, cost - 1);
    if (pl.hand[com] < cost) this.err(`需要 ${cost} 张${CARD_NAME[com]}`);
    pl.hand[com] -= cost;
    this.bank[com] += cost;
    if (this.turn.crane) this.turn.crane = false;
    const newLvl = lvl + 1;
    pl.improvements[track] = newLvl;
    this.addEvent('improve', { player: p, track, level: newLvl });
    this.addLog(`${pl.name} 的${TRACK_NAME[track]}升级达到 ${newLvl} 级`);
    if (newLvl === 3) {
      const perk = { trade: '商栈：商品可 2:1 与银行交易', politics: '城堡：可升级三级骑士', science: '引水渠：无产出时可任选 1 张资源' }[track];
      this.addLog(`✨ ${pl.name} 解锁：${perk}`);
    }
    if (newLvl >= 4) this.checkMetropolis(track, p, newLvl);
    this.checkWin();
  },

  checkMetropolis(track, p, newLvl) {
    const m = this.metropolis[track];
    if (m && m.player === p) return;
    if (m) {
      // 抢夺：需达到 5 级且现持有者停留在 4 级
      if (newLvl < 5 || this.players[m.player].improvements[track] >= 5) return;
    }
    const metro = this.metropolisVertices();
    const options = this.ownCityVertices(p).filter((cv) => !metro.has(cv));
    if (options.length === 0) {
      this.addLog(`${this.players[p].name} 没有可用城市，无法建立${TRACK_NAME[track]}大都会`);
      return;
    }
    if (options.length === 1) {
      this.placeMetropolis(track, p, options[0]);
      return;
    }
    this.turn.metroChoice = { track, options };
    this.turn.state = 'metropolis';
    this.addLog(`${this.players[p].name} 请选择建立${TRACK_NAME[track]}大都会的城市`);
  },

  placeMetropolis(track, p, v) {
    const m = this.metropolis[track];
    if (m) this.addLog(`${this.players[p].name} 从 ${this.players[m.player].name} 手中夺走了${TRACK_NAME[track]}大都会！`);
    else this.addLog(`🏛️ ${this.players[p].name} 建立了${TRACK_NAME[track]}大都会（+2 分）！`);
    this.metropolis[track] = { player: p, vertex: v };
    this.addEvent('metropolis', { player: p, track, vertex: v });
  },

  chooseMetropolis(p, v) {
    this.requireTurn(p);
    this.requireCK();
    this.requireState('metropolis');
    const c = this.turn.metroChoice;
    if (!c.options.includes(v)) this.err('无效的城市');
    this.turn.metroChoice = null;
    this.turn.state = 'main';
    this.placeMetropolis(c.track, p, v);
    this.checkWin();
  },

  // ---------- 野蛮人 ----------
  // 返回 true 表示需等待玩家选择被摧毁的城市（掷骰结算暂停）
  resolveBarbarianAttack(total) {
    const strength = Object.values(this.buildings).filter((b) => b.type === 'city').length;
    const pts = this.players.map((_, i) => Object.values(this.knights)
      .filter((k) => k.player === i && k.active)
      .reduce((s, k) => s + k.level, 0));
    const defense = pts.reduce((s, n) => s + n, 0);
    const win = defense >= strength;
    this.barbarians.attacks++;
    this.barbarians.pos = 0;
    this.addEvent('barbarian', { strength, defense, win });
    this.addLog(`⚔️ 野蛮人来袭！兵力 ${strength} vs 骑士防御 ${defense}`);

    let pending = {};
    let defenderPickers = [];
    if (win) {
      this.addLog('🛡️ 卡坦岛守住了！');
      const max = Math.max(...pts);
      if (max > 0) {
        const holders = pts.map((n, i) => [i, n]).filter(([, n]) => n === max).map(([i]) => i);
        if (holders.length === 1) {
          this.players[holders[0]].defenderVP++;
          this.addEvent('defender', { player: holders[0] });
          this.addLog(`🏅 ${this.players[holders[0]].name} 成为「卡坦守护者」（+1 分）！`);
        } else if (IMPROVE_TRACKS.some((t) => this.progressDecks[t].length > 0)) {
          // 并列：各自选一种颜色抽一张进步卡
          defenderPickers = holders;
          const names = holders.map((i) => this.players[i].name).join('、');
          this.addLog(`${names} 防御并列第一，各自选一种进步卡`);
        }
      }
    } else {
      this.addLog('🔥 防御失败！出力最少的玩家将失去一座城市…');
      const candidates = this.players
        .map((_, i) => i)
        .filter((i) => this.ownCityVertices(i, { pillageable: true }).length > 0);
      if (candidates.length > 0) {
        const min = Math.min(...candidates.map((i) => pts[i]));
        for (const i of candidates.filter((c) => pts[c] === min)) {
          const cities = this.ownCityVertices(i, { pillageable: true });
          if (cities.length === 1) this.pillageCity(cities[0]);
          else pending[i] = cities;
        }
      } else {
        this.addLog('无人拥有可摧毁的城市，本次无事发生。');
      }
    }
    // 战斗结束后所有骑士休整
    for (const k of Object.values(this.knights)) k.active = false;

    if (Object.keys(pending).length > 0) {
      this.turn.pendingCityLoss = pending;
      this.turn.postRollTotal = total;
      this.turn.state = 'barbarianLoss';
      const names = Object.keys(pending).map((i) => this.players[i].name).join('、');
      this.addLog(`等待 ${names} 选择被摧毁的城市。`);
      return true;
    }
    if (defenderPickers.length > 0) {
      this.turn.pendingDefenderPick = defenderPickers;
      this.turn.postRollTotal = total;
      this.turn.state = 'defenderPick';
      return true;
    }
    return false;
  },

  defenderPickDeck(p, deckName) {
    this.requireCK();
    this.requireState('defenderPick');
    if (!this.turn.pendingDefenderPick.includes(p)) this.err('你不需要选择');
    if (!IMPROVE_TRACKS.includes(deckName)) this.err('请选择一种进步卡');
    if (this.progressDecks[deckName].length === 0) this.err('该牌堆已空');
    this.drawProgress(p, deckName);
    this.turn.pendingDefenderPick = this.turn.pendingDefenderPick.filter((i) => i !== p);
    // 牌堆全部抽空时剩余玩家无从选择，直接跳过
    if (this.turn.pendingDefenderPick.length > 0
      && IMPROVE_TRACKS.every((t) => this.progressDecks[t].length === 0)) {
      this.addLog('进步卡牌堆已全部抽空，其余玩家无法再抽。');
      this.turn.pendingDefenderPick = [];
    }
    if (this.turn.pendingDefenderPick.length === 0) {
      this.finishRoll(this.turn.postRollTotal);
    }
  },

  pillageCity(v) {
    const b = this.buildings[v];
    if (this.walls[v] !== undefined) {
      delete this.walls[v];
      this.addLog(`${this.players[b.player].name} 的城墙随城市一同被摧毁`);
    }
    this.players[b.player].pieces.city++;
    if (this.players[b.player].pieces.settlement > 0) {
      b.type = 'settlement';
      this.players[b.player].pieces.settlement--;
      this.addLog(`💥 ${this.players[b.player].name} 的城市被野蛮人摧毁，降级为村庄`);
    } else {
      // 村庄棋子用完：城市整个被移除
      delete this.buildings[v];
      this.addLog(`💥 ${this.players[b.player].name} 的城市被野蛮人夷平（没有村庄棋子可降级）`);
      this.updateLongestRoad(); // 建筑消失可能重新连通对手道路
    }
    this.addEvent('pillage', { player: b.player, vertex: v });
  },

  chooseCityLoss(p, v) {
    this.requireCK();
    this.requireState('barbarianLoss');
    const list = this.turn.pendingCityLoss[p];
    if (!list) this.err('你不需要选择');
    if (!list.includes(v)) this.err('无效的城市');
    this.pillageCity(v);
    delete this.turn.pendingCityLoss[p];
    if (Object.keys(this.turn.pendingCityLoss).length === 0) {
      this.finishRoll(this.turn.postRollTotal);
    }
  },

  // ---------- 进步卡 ----------
  distributeProgress() {
    const face = this.turn.eventDie;
    if (!IMPROVE_TRACKS.includes(face)) return;
    const red = this.turn.dice[0];
    this.players.forEach((pl, i) => {
      const lvl = pl.improvements[face];
      if (lvl >= 1 && red <= lvl + 1) this.drawProgress(i, face);
    });
  },

  drawProgress(p, deckName) {
    const deck = this.progressDecks[deckName];
    if (deck.length === 0) return;
    const pl = this.players[p];
    const type = deck.pop();
    if (PROGRESS_VP_CARDS.includes(type)) {
      pl.progressVP++;
      this.addEvent('progressVP', { player: p, card: type });
      this.addLog(`📜 ${pl.name} 抽到「${PROGRESS_NAME[type]}」，立即亮出（+1 分）！`);
      return;
    }
    if (pl.progressCards.length >= MAX_PROGRESS_HAND) {
      deck.unshift(type);
      this.addLog(`${pl.name} 的进步卡已满（${MAX_PROGRESS_HAND} 张），本次放回牌堆`);
      return;
    }
    pl.progressCards.push({ type, deck: deckName });
    this.addEvent('progress', { player: p, deck: deckName });
    this.addLog(`${pl.name} 抽到一张${TRACK_NAME[deckName]}进步卡`);
  },

  aqueductPick(p, res) {
    this.requireCK();
    this.requireState('aqueduct');
    if (!this.turn.pendingAqueduct.includes(p)) this.err('你不需要选择');
    if (!RESOURCES.includes(res)) this.err('请选择一种资源');
    if (this.bank[res] <= 0) this.err(`银行的${CARD_NAME[res]}不足`);
    this.gain(p, res, 1);
    this.addEvent('gain', { player: p, res, n: 1 });
    this.addLog(`${this.players[p].name} 通过引水渠获得 1 张${CARD_NAME[res]}`);
    this.turn.pendingAqueduct = this.turn.pendingAqueduct.filter((i) => i !== p);
    if (this.turn.pendingAqueduct.length === 0) this.turn.state = 'main';
  },

  // ---------- 交互式选牌（商业大亨/间谍/婚礼/商业港） ----------
  // 商业大亨：当前玩家从目标手牌中逐张拿取
  pickCard(p, card) {
    this.requireTurn(p);
    this.requireCK();
    this.requireState('pickCards');
    const pick = this.turn.pick;
    const from = this.players[pick.from];
    if (!this.cardTypes().includes(card) || from.hand[card] <= 0) this.err('对方没有这张牌');
    from.hand[card]--;
    this.players[p].hand[card]++;
    pick.count--;
    this.addEvent('steal', { from: pick.from, to: p });
    if (pick.count <= 0 || cardsOf(from.hand, this.cardTypes()).length === 0) {
      this.addLog(`${this.players[p].name} 拿走了 ${from.name} 的牌`);
      this.turn.pick = null;
      this.turn.state = 'main';
    }
  },

  // 间谍：当前玩家从目标的进步卡中选一张偷走
  pickProgressCard(p, card) {
    this.requireTurn(p);
    this.requireCK();
    this.requireState('pickProgress');
    const pick = this.turn.pick;
    const cards = this.players[pick.from].progressCards;
    const idx = cards.findIndex((c) => c.type === card);
    if (idx < 0) this.err('对方没有这张进步卡');
    this.players[p].progressCards.push(cards.splice(idx, 1)[0]);
    this.addEvent('steal', { from: pick.from, to: p });
    this.addLog(`${this.players[p].name} 偷走了 ${this.players[pick.from].name} 的一张进步卡`);
    this.turn.pick = null;
    this.turn.state = 'main';
  },

  // 婚礼：被影响玩家逐张选择上缴的牌
  weddingGive(p, card) {
    this.requireCK();
    this.requireState('wedding');
    const need = this.turn.pendingGive[p];
    if (!need) this.err('你不需要送礼');
    const pl = this.players[p];
    if (!this.cardTypes().includes(card) || pl.hand[card] <= 0) this.err('你没有这张牌');
    pl.hand[card]--;
    this.players[this.turn.player].hand[card]++;
    this.addEvent('steal', { from: p, to: this.turn.player });
    const left = need - 1;
    if (left <= 0 || cardsOf(pl.hand, this.cardTypes()).length === 0) {
      delete this.turn.pendingGive[p];
      this.addLog(`${pl.name} 献上贺礼`);
    } else {
      this.turn.pendingGive[p] = left;
    }
    if (Object.keys(this.turn.pendingGive).length === 0) this.turn.state = 'main';
  },

  // 商业港：当前玩家选给出的资源
  harborGive(p, res) {
    this.requireTurn(p);
    this.requireCK();
    this.requireState('harbor');
    const h = this.turn.harbor;
    if (h.stage !== 'give') this.err('等待对方选择商品');
    if (!RESOURCES.includes(res) || this.players[p].hand[res] <= 0) this.err('你没有这张资源');
    h.give = res;
    h.stage = 'take';
    this.addLog(`${this.players[p].name} 选好了要交给 ${this.players[h.queue[h.idx]].name} 的资源`);
  },

  // 商业港：被交换的对手选返还的商品，随后推进队列
  harborTake(p, com) {
    this.requireCK();
    this.requireState('harbor');
    const h = this.turn.harbor;
    if (h.stage !== 'take' || h.queue[h.idx] !== p) this.err('还没轮到你选择');
    const op = this.players[p];
    if (!COMMODITIES.includes(com) || op.hand[com] <= 0) this.err('你没有这张商品');
    const me = this.players[this.turn.player];
    me.hand[h.give]--; op.hand[h.give]++;
    op.hand[com]--; me.hand[com]++;
    this.addLog(`${me.name} 用 1 张${CARD_NAME[h.give]}换得 ${op.name} 的 1 张${CARD_NAME[com]}`);
    h.give = null;
    h.stage = 'give';
    h.idx++;
    // 跳过已无商品的对手；自己没资源了则提前结束
    while (h.idx < h.queue.length
      && cardsOf(this.players[h.queue[h.idx]].hand, COMMODITIES).length === 0) h.idx++;
    if (h.idx >= h.queue.length || cardsOf(me.hand, RESOURCES).length === 0) {
      this.turn.harbor = null;
      this.turn.state = 'main';
    }
  },

  // 随机从 from 拿一张牌（资源+商品）给 to；返回牌名或 null
  moveRandomCard(from, to) {
    const pool = cardsOf(this.players[from].hand, this.cardTypes());
    if (pool.length === 0) return null;
    const res = pool[Math.floor(this.rng() * pool.length)];
    this.players[from].hand[res]--;
    this.players[to].hand[res]++;
    return res;
  },

  playProgress(p, type, payload = {}) {
    this.requireTurn(p);
    this.requireCK();
    if (type === 'alchemist') this.requireState('preroll');
    else this.requireState('main');
    const pl = this.players[p];
    const idx = pl.progressCards.findIndex((c) => c.type === type);
    if (idx < 0) this.err('你没有这张进步卡');
    // 各分支先完成校验再调用 spend()，保证失败时卡不丢
    const spend = () => {
      pl.progressCards.splice(idx, 1);
      this.addEvent('playProgress', { player: p, card: type });
      this.addLog(`${pl.name} 打出进步卡「${PROGRESS_NAME[type]}」`);
    };

    switch (type) {
      // ===== 贸易（黄） =====
      case 'merchant': {
        const hex = this.board.hexes[payload.hex];
        if (!hex || !TERRAIN_RESOURCE[hex.terrain]) this.err('请选择一块产资源的板块');
        const near = this.board.vertices.some(
          (v) => v.hexes.includes(hex.id) && this.buildings[v.id]?.player === p,
        );
        if (!near) this.err('商人只能放在自己建筑相邻的板块');
        spend();
        this.merchant = { hex: hex.id, player: p };
        this.addEvent('merchant', { player: p, hex: hex.id });
        this.addLog(`${pl.name} 放置了商人：${CARD_NAME[TERRAIN_RESOURCE[hex.terrain]]}可 2:1 交易（+1 分）`);
        break;
      }
      case 'merchantFleet': {
        if (!this.cardTypes().includes(payload.res)) this.err('请选择一种资源或商品');
        spend();
        this.turn.fleet = payload.res;
        this.addLog(`本回合${CARD_NAME[payload.res]}可 2:1 与银行交易`);
        break;
      }
      case 'commercialHarbor': {
        if (cardsOf(pl.hand, RESOURCES).length === 0) this.err('你没有资源牌可交换');
        // 按座位顺序与每位持有商品的对手交换：我选给出的资源，对方选返还的商品
        const queue = [];
        for (let j = 1; j < this.players.length; j++) {
          const i = (p + j) % this.players.length;
          if (cardsOf(this.players[i].hand, COMMODITIES).length > 0) queue.push(i);
        }
        if (queue.length === 0) this.err('没有持有商品的对手');
        spend();
        this.turn.harbor = { queue, idx: 0, stage: 'give', give: null };
        this.turn.state = 'harbor';
        this.addLog(`商业港：${pl.name} 将与 ${queue.map((i) => this.players[i].name).join('、')} 依次交换（资源换商品）`);
        break;
      }
      case 'masterMerchant': {
        const t = payload.target;
        if (!Number.isInteger(t) || t === p || !this.players[t]) this.err('请选择一名对手');
        if (this.victoryPoints(t, true) <= this.victoryPoints(p, true)) this.err('只能选择分数比你高的玩家');
        const theirs = cardsOf(this.players[t].hand, this.cardTypes()).length;
        if (theirs === 0) this.err('对方没有手牌');
        spend();
        this.turn.pick = { type: 'masterMerchant', from: t, count: Math.min(2, theirs) };
        this.turn.state = 'pickCards';
        this.addLog(`${pl.name} 查看 ${this.players[t].name} 的手牌并拿走 ${this.turn.pick.count} 张`);
        break;
      }
      case 'resourceMonopoly': {
        if (!RESOURCES.includes(payload.res)) this.err('请选择一种资源');
        spend();
        let total = 0;
        this.players.forEach((op, i) => {
          if (i === p) return;
          const n = Math.min(2, op.hand[payload.res]);
          op.hand[payload.res] -= n;
          pl.hand[payload.res] += n;
          total += n;
        });
        this.addEvent('monopoly', { player: p, res: payload.res, n: total });
        this.addLog(`${pl.name} 发动资源垄断：每人最多上缴 2 张${CARD_NAME[payload.res]}（共 ${total} 张）`);
        break;
      }
      case 'tradeMonopoly': {
        if (!COMMODITIES.includes(payload.res)) this.err('请选择一种商品');
        spend();
        let total = 0;
        this.players.forEach((op, i) => {
          if (i === p) return;
          const n = Math.min(1, op.hand[payload.res]);
          op.hand[payload.res] -= n;
          pl.hand[payload.res] += n;
          total += n;
        });
        this.addEvent('monopoly', { player: p, res: payload.res, n: total });
        this.addLog(`${pl.name} 发动商品垄断：每人上缴 1 张${CARD_NAME[payload.res]}（共 ${total} 张）`);
        break;
      }

      // ===== 政治（蓝） =====
      case 'bishop': {
        if (this.barbarians.attacks === 0) this.err('野蛮人首次来袭前强盗不能移动');
        const hex = this.board.hexes[payload.hex];
        if (!hex || hex.id === this.robber) this.err('请选择强盗的新位置');
        spend();
        this.robber = hex.id;
        this.addEvent('robber', { hex: hex.id });
        const targets = new Set();
        for (const v of this.board.vertices) {
          if (!v.hexes.includes(hex.id)) continue;
          const b = this.buildings[v.id];
          if (b && b.player !== p) targets.add(b.player);
        }
        for (const t of targets) {
          const got = this.moveRandomCard(t, p);
          if (got) {
            this.addEvent('steal', { from: t, to: p });
            this.addLog(`${pl.name} 从 ${this.players[t].name} 那里偷了一张牌`);
          }
        }
        break;
      }
      case 'deserter': {
        const kv = payload.knight;
        const k = this.knights[kv];
        if (!k || k.player === p) this.err('请选择一名对手的骑士');
        const spots = this.validKnightSpots(p);
        if (!spots.includes(payload.place)) this.err('没有可放置骑士的位置');
        // 尽量放同级骑士；棋子不足或未解锁三级则依次降级
        let level = k.level;
        while (level > 0) {
          if (level === 3 && this.players[p].improvements.politics < 3) { level--; continue; }
          if (this.knightCountAtLevel(p, level) >= KNIGHT_PER_LEVEL) { level--; continue; }
          break;
        }
        if (level === 0) this.err('你没有可用的骑士棋子');
        spend();
        this.addLog(`${this.players[k.player].name} 的 ${k.level} 级骑士叛逃了！`);
        delete this.knights[kv];
        this.knights[payload.place] = {
          player: p, level, active: false,
          builtTurn: this.turn.count, promotedTurn: 0, activatedTurn: 0, actedTurn: 0,
        };
        this.addEvent('build', { player: p, kind: 'knight', vertex: payload.place });
        this.addLog(`${pl.name} 获得一名 ${level} 级骑士`);
        this.updateLongestRoad();
        break;
      }
      case 'diplomat': {
        const e = this.board.edges[payload.edge];
        const owner = e && this.roads[e.id];
        if (owner === undefined) this.err('该位置没有道路');
        const freeEnd = (v) => {
          if (this.buildings[v]?.player === owner) return false;
          if (this.knights[v]?.player === owner) return false;
          return !this.board.vertices[v].adjE.some((e2) => e2 !== e.id && this.roads[e2] === owner);
        };
        if (!freeEnd(e.v1) && !freeEnd(e.v2)) this.err('只能移除两端未延伸的「开放道路」');
        spend();
        delete this.roads[e.id];
        this.players[owner].pieces.road++;
        this.addEvent('roadRemove', { edge: e.id });
        if (owner === p) {
          this.addLog(`${pl.name} 收回了自己的一条道路，可立即重新放置`);
          if (this.validRoadEdges(p).length > 0) {
            this.turn.freeRoads = 1;
            this.turn.state = 'roadbuilding';
          }
        } else {
          this.addLog(`${pl.name} 移除了 ${this.players[owner].name} 的一条开放道路`);
        }
        this.updateLongestRoad();
        break;
      }
      case 'intrigue': {
        const k = this.knights[payload.vertex];
        if (!k || k.player === p) this.err('请选择一名对手的骑士');
        const onMyRoad = this.board.vertices[payload.vertex].adjE.some((e2) => this.roads[e2] === p);
        if (!onMyRoad) this.err('只能驱逐位于你道路上的骑士');
        spend();
        const spots = this.knightMoveTargets(k.player, payload.vertex).moves;
        delete this.knights[payload.vertex];
        this.startDisplace(k, spots, `${pl.name} 用阴谋驱逐了 ${this.players[k.player].name} 的骑士`);
        this.updateLongestRoad();
        break;
      }
      case 'saboteur': {
        spend();
        const myVp = this.victoryPoints(p, true);
        const pending = {};
        this.players.forEach((op, i) => {
          if (i === p) return;
          if (this.victoryPoints(i, true) < myVp) return;
          const c = Object.values(op.hand).reduce((s, n) => s + n, 0);
          if (c >= 2) pending[i] = Math.floor(c / 2);
        });
        if (Object.keys(pending).length === 0) {
          this.addLog('没有玩家受到破坏者影响');
        } else {
          this.turn.pendingDiscards = pending;
          this.turn.discardThen = 'main';
          this.turn.state = 'discard';
          const names = Object.keys(pending).map((i) => this.players[i].name).join('、');
          this.addLog(`破坏者！${names} 需要弃掉一半手牌。`);
        }
        break;
      }
      case 'spy': {
        const t = payload.target;
        if (!Number.isInteger(t) || t === p || !this.players[t]) this.err('请选择一名对手');
        const cards = this.players[t].progressCards;
        if (cards.length === 0) this.err('对方没有进步卡');
        if (pl.progressCards.length >= MAX_PROGRESS_HAND) this.err(`你的进步卡已满（${MAX_PROGRESS_HAND} 张）`);
        spend();
        this.turn.pick = { type: 'spy', from: t, count: 1 };
        this.turn.state = 'pickProgress';
        this.addLog(`${pl.name} 用间谍查看 ${this.players[t].name} 的进步卡`);
        break;
      }
      case 'warlord': {
        const idle = Object.values(this.knights).filter((k) => k.player === p && !k.active);
        if (idle.length === 0) this.err('没有可激活的骑士');
        spend();
        for (const k of idle) {
          k.active = true;
          k.activatedTurn = this.turn.count;
        }
        this.addLog(`${pl.name} 免费激活了 ${idle.length} 名骑士`);
        break;
      }
      case 'wedding': {
        spend();
        const myVp = this.victoryPoints(p, true);
        const pending = {};
        this.players.forEach((op, i) => {
          if (i === p || this.victoryPoints(i, true) <= myVp) return;
          const n = Math.min(2, cardsOf(op.hand, this.cardTypes()).length);
          if (n > 0) pending[i] = n;
        });
        if (Object.keys(pending).length === 0) {
          this.addLog('没有分数更高的玩家，婚礼无人送礼');
        } else {
          this.turn.pendingGive = pending;
          this.turn.state = 'wedding';
          const names = Object.keys(pending).map((i) => this.players[i].name).join('、');
          this.addLog(`婚礼！${names} 需各自选择 2 张牌作为贺礼。`);
        }
        break;
      }

      // ===== 科学（绿） =====
      case 'alchemist': {
        const { d1, d2 } = payload;
        const ok = (n) => Number.isInteger(n) && n >= 1 && n <= 6;
        if (!ok(d1) || !ok(d2)) this.err('请指定两个骰子的点数（1-6）');
        spend();
        this.addLog(`${pl.name} 用炼金术士将骰子定为 ${d1}+${d2}`);
        this.roll(p, { d1, d2 });
        break;
      }
      case 'crane': {
        spend();
        this.turn.crane = true;
        this.addLog('本回合下一次城市升级少付 1 张商品');
        break;
      }
      case 'engineer': {
        const b = this.buildings[payload.vertex];
        if (!b || b.player !== p || b.type !== 'city') this.err('请选择自己的城市');
        if (this.walls[payload.vertex] !== undefined) this.err('该城市已有城墙');
        if (this.wallCountOf(p) >= MAX_WALLS) this.err(`每人最多 ${MAX_WALLS} 座城墙`);
        spend();
        this.walls[payload.vertex] = p;
        this.addEvent('build', { player: p, kind: 'wall', vertex: payload.vertex });
        this.addLog(`${pl.name} 免费修建了一座城墙`);
        break;
      }
      case 'inventor': {
        const h1 = this.board.hexes[payload.h1];
        const h2 = this.board.hexes[payload.h2];
        const ok = (h) => h && h.number && !INVENTOR_FORBIDDEN.includes(h.number);
        if (!ok(h1) || !ok(h2) || h1.id === h2.id) this.err('请选择两块数字为 3/4/5/9/10/11 的板块');
        spend();
        [h1.number, h2.number] = [h2.number, h1.number];
        this.addEvent('inventor', { h1: h1.id, h2: h2.id });
        this.addLog(`${pl.name} 交换了两块板块的数字（${h1.number} ↔ ${h2.number}）`);
        break;
      }
      case 'irrigation':
      case 'mining': {
        const terrain = type === 'irrigation' ? 'fields' : 'mountains';
        const res = type === 'irrigation' ? 'wheat' : 'ore';
        const hexes = new Set();
        for (const [vid, b] of Object.entries(this.buildings)) {
          if (b.player !== p) continue;
          for (const hid of this.board.vertices[vid].hexes) {
            if (this.board.hexes[hid].terrain === terrain) hexes.add(hid);
          }
        }
        if (hexes.size === 0) this.err(`你的建筑不与任何${type === 'irrigation' ? '麦田' : '矿山'}相邻`);
        spend();
        const got = this.gain(p, res, hexes.size * 2);
        this.addEvent('gain', { player: p, res, n: got });
        this.addLog(`${pl.name} 获得 ${got} 张${CARD_NAME[res]}`);
        break;
      }
      case 'medicine': {
        const b = this.buildings[payload.vertex];
        if (!b || b.player !== p || b.type !== 'settlement') this.err('请选择自己的村庄');
        if (this.players[p].pieces.city <= 0) this.err('城市棋子已用完');
        const cost = { ore: 2, wheat: 1 };
        if (!this.canAfford(p, cost)) this.err('资源不足（医学升城需要 2矿石 1小麦）');
        spend();
        this.pay(p, cost);
        b.type = 'city';
        this.players[p].pieces.city--;
        this.players[p].pieces.settlement++;
        this.addEvent('build', { player: p, kind: 'city', vertex: payload.vertex });
        this.addLog(`${pl.name} 用医学卡廉价升级了城市`);
        break;
      }
      case 'roadBuilding': {
        const free = Math.min(2, this.players[p].pieces.road);
        if (free === 0 || this.validRoadEdges(p).length === 0) this.err('没有可修路的位置');
        spend();
        this.turn.freeRoads = free;
        this.turn.state = 'roadbuilding';
        this.addLog(`${pl.name} 可免费修 ${free} 条路`);
        break;
      }
      case 'smith': {
        const vs = Array.isArray(payload.vertices) ? [...new Set(payload.vertices)] : [];
        if (vs.length < 1 || vs.length > 2) this.err('请选择 1-2 名骑士');
        // 预校验（模拟各级棋子占用，两次升级可能互相影响）
        const sim = { 1: 0, 2: 0, 3: 0 };
        for (const lv of [1, 2, 3]) sim[lv] = this.knightCountAtLevel(p, lv);
        for (const v of vs) {
          const why = this.canPromoteKnight(p, v, sim);
          if (why) this.err(why);
          const k = this.knights[v];
          sim[k.level]--;
          sim[k.level + 1]++;
        }
        spend();
        for (const v of vs) {
          const k = this.knights[v];
          k.level++;
          k.promotedTurn = this.turn.count;
          this.addEvent('build', { player: p, kind: 'knight', vertex: Number(v) });
        }
        this.addLog(`${pl.name} 用铁匠免费升级了 ${vs.length} 名骑士`);
        break;
      }
      default:
        this.err('无法打出该卡');
    }
    this.checkWin();
  },

  // ---------- 提示（privateState） ----------
  ckHints(p, hints) {
    if (this.turn.state === 'barbarianLoss' && this.turn.pendingCityLoss[p]) {
      hints.cityLoss = this.turn.pendingCityLoss[p];
      return;
    }
    if (this.turn.state === 'defenderPick' && this.turn.pendingDefenderPick.includes(p)) {
      hints.defenderPick = true;
      return;
    }
    if (this.turn.state === 'displace' && this.turn.displace?.owner === p) {
      hints.displaceSpots = this.turn.displace.options;
      return;
    }
    if (this.turn.state === 'wedding' && this.turn.pendingGive[p]) {
      hints.weddingGive = this.turn.pendingGive[p];
      return;
    }
    if (this.turn.state === 'harbor' && this.turn.harbor?.stage === 'take'
      && this.turn.harbor.queue[this.turn.harbor.idx] === p) {
      hints.harborTake = true;
      return;
    }
    if (this.turn.player === p) {
      if (this.turn.state === 'metropolis') { hints.metroSpots = this.turn.metroChoice.options; return; }
      if (this.turn.state === 'pickCards') { hints.pickHand = { ...this.players[this.turn.pick.from].hand }; return; }
      if (this.turn.state === 'pickProgress') { hints.pickList = this.players[this.turn.pick.from].progressCards.map((c) => c.type); return; }
      if (this.turn.state === 'harbor' && this.turn.harbor.stage === 'give') { hints.harborGive = true; return; }
    }
    if (this.turn.player !== p || this.turn.state !== 'main') return;
    hints.knightSpots = this.validKnightSpots(p);
    hints.wallSpots = this.wallCountOf(p) >= MAX_WALLS ? []
      : this.ownCityVertices(p).filter((v) => this.walls[v] === undefined);
    hints.merchantHexes = this.board.hexes
      .filter((h) => TERRAIN_RESOURCE[h.terrain] && this.board.vertices
        .some((v) => v.hexes.includes(h.id) && this.buildings[v.id]?.player === p))
      .map((h) => h.id);
    hints.intrigueKnights = Object.entries(this.knights)
      .filter(([v, k]) => k.player !== p
        && this.board.vertices[v].adjE.some((e) => this.roads[e] === p))
      .map(([v]) => Number(v));
    hints.openRoads = Object.keys(this.roads).map(Number).filter((eid) => {
      const owner = this.roads[eid];
      const e = this.board.edges[eid];
      const freeEnd = (v) => {
        if (this.buildings[v]?.player === owner) return false;
        if (this.knights[v]?.player === owner) return false;
        return !this.board.vertices[v].adjE.some((e2) => e2 !== eid && this.roads[e2] === owner);
      };
      return freeEnd(e.v1) || freeEnd(e.v2);
    });
    hints.myKnights = {};
    for (const [v, k] of Object.entries(this.knights)) {
      if (k.player !== p) continue;
      const canAct = !this.knightCanAct(p, Number(v));
      const targets = canAct ? this.knightMoveTargets(p, Number(v)) : { moves: [], displaces: [] };
      hints.myKnights[v] = {
        activate: !k.active,
        upgrade: !this.canPromoteKnight(p, Number(v)),
        moves: targets.moves,
        displaces: targets.displaces,
        chase: canAct && this.barbarians.attacks > 0
          && this.board.vertices[v].hexes.includes(this.robber),
      };
    }
  },
};
