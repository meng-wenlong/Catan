// 卡坦岛核心规则（服务端权威）：基础版 + 「城市与骑士」扩展（mode: 'base' | 'ck'）
import {
  RESOURCES, TERRAIN_RESOURCE, COSTS, DEV_DECK, PIECE_LIMITS,
  BANK_PER_RESOURCE, WIN_VP, PLAYER_COLORS, COLOR_NAMES,
} from './constants.js';
import { generateBoard, shuffle } from './board.js';
import { longestRoadLength } from './longestRoad.js';
import {
  ckMethods, COMMODITIES, CITY_YIELD, CARD_NAME, TRACK_NAME,
  CK_WIN_VP, BARBARIAN_TRACK, IMPROVE_TRACKS,
} from './ck.js';

const RES_NAME = { wood: '木材', brick: '砖块', sheep: '羊毛', wheat: '小麦', ore: '矿石' };
const DEV_NAME = {
  knight: '骑士', vp: '分数卡', roadBuilding: '修路', yearOfPlenty: '丰收之年', monopoly: '垄断',
};

function handCount(hand) {
  return Object.values(hand).reduce((s, n) => s + n, 0);
}

export class Game {
  // first：起始玩家下标（初始放置与第一个回合都从他开始）
  constructor(playerInfos, rng = Math.random, first = 0, mode = 'base') {
    this.rng = rng;
    this.mode = mode === 'ck' ? 'ck' : 'base';
    this.ck = this.mode === 'ck';
    this.board = generateBoard(rng);
    this.robber = this.board.robber;
    this.buildings = {}; // vertexId -> {player, type}
    this.roads = {};     // edgeId -> playerIdx
    this.players = playerInfos.map((p, i) => ({
      name: p.name,
      color: p.color || PLAYER_COLORS[i],
      colorName: p.colorName || COLOR_NAMES[i],
      hand: this.blankHand(),
      devCards: [],
      knightsPlayed: 0,
      pieces: { ...PIECE_LIMITS },
      connected: true,
    }));
    this.bank = Object.fromEntries(RESOURCES.map((r) => [r, BANK_PER_RESOURCE]));
    this.devDeck = shuffle(DEV_DECK, rng);
    this.phase = 'setup';
    const n = this.players.length;
    const order = Array.from({ length: n }, (_, k) => (first + k) % n);
    this.setup = {
      order: [...order, ...order.slice().reverse()],
      pos: 0,
      awaiting: 'settlement',
      lastSettlement: null,
    };
    this.turn = {
      player: 0, count: 1, rolled: false, dice: null,
      devPlayed: false, state: 'setup', freeRoads: 0,
      pendingDiscards: {}, stealTargets: [], discardThen: 'robber',
      // 以下仅 ck 模式使用
      eventDie: null, fleet: null, crane: false,
      pendingAqueduct: [], pendingCityLoss: {}, postRollTotal: 0,
      pendingDefenderPick: [], // 防御并列第一：各自选颜色抽进步卡
      displace: null,    // 被驱逐骑士待安置 {owner, knight, options}
      metroChoice: null, // 大都会选城 {track, options, stolenFrom}
      pick: null,        // 商业大亨/间谍选牌 {type, from, count}
      pendingGive: {},   // 婚礼：playerIdx -> 还需上缴张数
      harbor: null,      // 商业港 {queue, idx, stage: 'give'|'take', give}
    };
    this.trade = null;
    this.awards = { longestRoad: null, largestArmy: null };
    this.winner = null;
    this.log = [];
    this.logSeq = 0;
    this.events = [];
    this.eventSeq = 0;
    if (this.ck) this.initCK();
    this.addLog(`游戏开始${this.ck ? '（城市与骑士）' : ''}！${this.players[this.setup.order[0]].name} 先放置。`);
  }

  // 本模式下的全部卡牌类型（ck 模式含商品）
  cardTypes() {
    return this.ck ? [...RESOURCES, ...COMMODITIES] : RESOURCES;
  }

  blankHand() {
    return Object.fromEntries(this.cardTypes().map((r) => [r, 0]));
  }

  cardName(r) {
    return CARD_NAME[r] || r;
  }

  // ---------- 工具 ----------
  // 日志带自增 seq：客户端按 seq 增量渲染（发送窗口只有最近 60 条，不能按下标对齐）
  addLog(msg) {
    this.log.push({ seq: ++this.logSeq, text: msg });
    if (this.log.length > 120) this.log.shift();
  }

  addEvent(type, data = {}) {
    this.events.push({ seq: ++this.eventSeq, type, ...data });
    if (this.events.length > 30) this.events.shift();
  }

  err(msg) {
    const e = new Error(msg);
    e.isGameError = true;
    throw e;
  }

  requireTurn(p) {
    if (this.phase === 'ended') this.err('游戏已结束');
    if (p !== this.turn.player) this.err('还没轮到你');
  }

  requireState(...states) {
    if (!states.includes(this.turn.state)) this.err('当前不能进行此操作');
  }

  canAfford(p, cost) {
    return Object.entries(cost).every(([r, n]) => this.players[p].hand[r] >= n);
  }

  pay(p, cost) {
    for (const [r, n] of Object.entries(cost)) {
      this.players[p].hand[r] -= n;
      this.bank[r] += n;
    }
  }

  gain(p, res, n) {
    const got = Math.min(n, this.bank[res]);
    this.players[p].hand[res] += got;
    this.bank[res] -= got;
    return got;
  }

  currentSetupPlayer() {
    return this.setup.order[this.setup.pos];
  }

  // ---------- 位置合法性 ----------
  vertexFree(v) {
    if (this.buildings[v]) return false;
    if (this.ck && this.knights[v]) return false; // 骑士占位
    // 距离规则：相邻顶点不能有建筑
    return this.board.vertices[v].adjV.every((nv) => !this.buildings[nv]);
  }

  validSettlementVertices(p, isSetup) {
    const res = [];
    for (const v of this.board.vertices) {
      if (!this.vertexFree(v.id)) continue;
      if (isSetup) { res.push(v.id); continue; }
      // 正式阶段：必须连接自己的道路
      if (v.adjE.some((e) => this.roads[e] === p)) res.push(v.id);
    }
    return res;
  }

  validRoadEdges(p, setupSettlement = null) {
    const res = [];
    for (const e of this.board.edges) {
      if (this.roads[e.id] !== undefined) continue;
      if (setupSettlement !== null) {
        if (e.v1 === setupSettlement || e.v2 === setupSettlement) res.push(e.id);
        continue;
      }
      // 任一端点：是自己的建筑，或（无对手建筑/骑士且连着自己的路）
      const ok = [e.v1, e.v2].some((v) => {
        const b = this.buildings[v];
        if (b) return b.player === p;
        if (this.ck && this.knights[v] && this.knights[v].player !== p) return false;
        return this.board.vertices[v].adjE.some((e2) => this.roads[e2] === p);
      });
      if (ok) res.push(e.id);
    }
    return res;
  }

  validCityVertices(p) {
    return Object.entries(this.buildings)
      .filter(([, b]) => b.player === p && b.type === 'settlement')
      .map(([v]) => Number(v));
  }

  // ---------- 初始放置 ----------
  placeSetupSettlement(p, v) {
    if (this.phase !== 'setup') this.err('不在初始放置阶段');
    if (p !== this.currentSetupPlayer()) this.err('还没轮到你');
    if (this.setup.awaiting !== 'settlement') this.err('请先放置道路');
    if (!Number.isInteger(v) || !this.board.vertices[v]) this.err('位置无效');
    if (!this.vertexFree(v)) this.err('该位置不可放置（距离规则）');

    // 城市与骑士：第二轮放的是城市
    const second = this.setup.pos >= this.players.length;
    const type = this.ck && second ? 'city' : 'settlement';
    this.buildings[v] = { player: p, type };
    this.players[p].pieces[type]--;
    this.setup.awaiting = 'road';
    this.setup.lastSettlement = v;
    this.addEvent('build', { player: p, kind: type, vertex: v });

    // 第二轮的建筑立即获得周围资源（每块地 1 张，不含商品）
    if (second) {
      const gained = [];
      for (const hid of this.board.vertices[v].hexes) {
        const hex = this.board.hexes[hid];
        const r = TERRAIN_RESOURCE[hex.terrain];
        if (r && this.gain(p, r, 1)) gained.push(RES_NAME[r]);
      }
      if (gained.length) this.addLog(`${this.players[p].name} 获得初始资源：${gained.join('、')}`);
    }
    this.addLog(`${this.players[p].name} 放置了${type === 'city' ? '城市' : '村庄'}`);
  }

  placeSetupRoad(p, e) {
    if (this.phase !== 'setup') this.err('不在初始放置阶段');
    if (p !== this.currentSetupPlayer()) this.err('还没轮到你');
    if (this.setup.awaiting !== 'road') this.err('请先放置村庄');
    const edge = this.board.edges[e];
    if (!edge || this.roads[e] !== undefined) this.err('位置无效');
    const s = this.setup.lastSettlement;
    if (edge.v1 !== s && edge.v2 !== s) this.err('道路必须连接刚放置的村庄');

    this.roads[e] = p;
    this.players[p].pieces.road--;
    this.addEvent('build', { player: p, kind: 'road', edge: e });
    this.addLog(`${this.players[p].name} 放置了道路`);

    this.setup.pos++;
    this.setup.awaiting = 'settlement';
    this.setup.lastSettlement = null;
    if (this.setup.pos >= this.setup.order.length) {
      this.phase = 'play';
      this.turn.state = 'preroll';
      this.turn.player = this.setup.order[0];
      this.addLog(`初始放置完成！轮到 ${this.players[this.turn.player].name} 掷骰子。`);
    } else {
      this.addLog(`轮到 ${this.players[this.currentSetupPlayer()].name} 放置。`);
    }
  }

  // ---------- 掷骰与资源 ----------
  // forced：炼金术士指定的两个骰子点数 {d1, d2}（事件骰仍随机）
  roll(p, forced = null) {
    this.requireTurn(p);
    this.requireState('preroll');
    const d1 = forced ? forced.d1 : 1 + Math.floor(this.rng() * 6);
    const d2 = forced ? forced.d2 : 1 + Math.floor(this.rng() * 6);
    const total = d1 + d2;
    this.turn.dice = [d1, d2];
    this.turn.rolled = true;
    let eventFace = null;
    if (this.ck) {
      const f = Math.floor(this.rng() * 6);
      eventFace = f < 3 ? 'ship' : IMPROVE_TRACKS[f - 3];
      this.turn.eventDie = eventFace;
    }
    this.addEvent('dice', { player: p, dice: [d1, d2], eventDie: eventFace });
    this.addLog(`${this.players[p].name} 掷出了 ${total}（${d1}+${d2}）`);

    if (eventFace === 'ship') {
      this.barbarians.pos++;
      this.addEvent('ship', { pos: this.barbarians.pos });
      if (this.barbarians.pos >= BARBARIAN_TRACK) {
        // 野蛮人先结算，再进行产出；若需玩家选城则暂停，选完后续跑 finishRoll
        if (this.resolveBarbarianAttack(total)) return;
      } else {
        this.addLog(`⛵ 野蛮人船前进一格（${this.barbarians.pos}/${BARBARIAN_TRACK}）`);
      }
    } else if (eventFace) {
      this.addLog(`事件骰：${TRACK_NAME[eventFace]}城门`);
    }
    this.finishRoll(total);
  }

  finishRoll(total) {
    if (total === 7) {
      const pending = {};
      this.players.forEach((pl, i) => {
        const c = handCount(pl.hand);
        const limit = this.ck ? 7 + 2 * this.wallCountOf(i) : 7;
        if (c > limit) pending[i] = Math.floor(c / 2);
      });
      this.turn.pendingDiscards = pending;
      // 城市与骑士：野蛮人首次来袭前强盗不动（弃牌照常）
      this.turn.discardThen = this.ck && this.barbarians.attacks === 0 ? 'main' : 'robber';
      if (Object.keys(pending).length > 0) {
        this.turn.state = 'discard';
        const names = Object.keys(pending).map((i) => this.players[i].name).join('、');
        this.addLog(`掷出 7！${names} 需要弃掉一半手牌。`);
      } else if (this.turn.discardThen === 'robber') {
        this.turn.state = 'robber';
        this.addLog('掷出 7！请移动强盗。');
      } else {
        this.turn.state = 'main';
        this.addLog('掷出 7！野蛮人首次来袭前，强盗仍留在沙漠。');
      }
      return;
    }

    this.distribute(total);
    if (this.ck) {
      this.distributeProgress();
      if (this.turn.pendingAqueduct.length > 0) {
        this.turn.state = 'aqueduct';
        const names = this.turn.pendingAqueduct.map((i) => this.players[i].name).join('、');
        this.addLog(`引水渠：${names} 可任选 1 张资源。`);
        return;
      }
    }
    this.turn.state = 'main';
    // ck：掷骰期间也可能得分（守护者 / 亮出的分数进步卡）
    if (this.ck) this.checkWin();
  }

  distribute(total) {
    // 统计每位玩家每种牌应得数量（沿有建筑的顶点查其相邻板块）
    const types = this.cardTypes();
    const demand = this.players.map(() => this.blankHand());
    for (const [vid, b] of Object.entries(this.buildings)) {
      for (const hid of this.board.vertices[vid].hexes) {
        const hex = this.board.hexes[hid];
        if (hex.number !== total || hid === this.robber) continue;
        const res = TERRAIN_RESOURCE[hex.terrain];
        if (!res) continue;
        if (b.type === 'settlement') {
          demand[b.player][res] += 1;
        } else if (!this.ck) {
          demand[b.player][res] += 2;
        } else {
          // ck 城市：羊/矿/木地形产 1 资源 + 1 商品，其余产 2 资源
          const y = CITY_YIELD[hex.terrain];
          demand[b.player][y.res] += y.com ? 1 : 2;
          if (y.com) demand[b.player][y.com] += 1;
        }
      }
    }
    // 银行不足：若多名玩家需要该牌则都不发，仅一名则发剩余
    const received = this.players.map(() => false);
    for (const res of types) {
      const claimants = demand.map((d, i) => [i, d[res]]).filter(([, n]) => n > 0);
      const totalNeed = claimants.reduce((s, [, n]) => s + n, 0);
      if (totalNeed === 0) continue;
      if (totalNeed > this.bank[res] && claimants.length > 1) {
        this.addLog(`银行的${this.cardName(res)}不足，本次无人获得。`);
        continue;
      }
      for (const [i, n] of claimants) {
        const got = this.gain(i, res, n);
        if (got > 0) {
          received[i] = true;
          this.addEvent('gain', { player: i, res, n: got });
          this.addLog(`${this.players[i].name} 获得 ${got} 张${this.cardName(res)}`);
        }
      }
    }
    // 引水渠（科学 3 级）：本轮没有任何产出的玩家可任选 1 张资源
    if (this.ck) {
      const bankHas = RESOURCES.some((r) => this.bank[r] > 0);
      this.turn.pendingAqueduct = !bankHas ? [] : this.players
        .map((pl, i) => (pl.improvements.science >= 3 && !received[i] ? i : -1))
        .filter((i) => i >= 0);
    }
  }

  // ---------- 强盗 ----------
  // 强盗流程结束后回到哪：骑士卡可在掷骰前打，此时要回到 preroll
  afterRobberState() {
    return this.turn.rolled ? 'main' : 'preroll';
  }

  discard(p, sel) {
    this.requireState('discard');
    const need = this.turn.pendingDiscards[p];
    if (!need) this.err('你不需要弃牌');
    const types = this.cardTypes();
    const total = types.reduce((s, r) => s + (sel[r] || 0), 0);
    if (total !== need) this.err(`需要弃掉 ${need} 张牌`);
    for (const r of types) {
      if ((sel[r] || 0) < 0 || (sel[r] || 0) > this.players[p].hand[r]) this.err('手牌不足');
    }
    for (const r of types) {
      this.players[p].hand[r] -= sel[r] || 0;
      this.bank[r] += sel[r] || 0;
    }
    delete this.turn.pendingDiscards[p];
    this.addLog(`${this.players[p].name} 弃掉了 ${need} 张牌`);
    if (Object.keys(this.turn.pendingDiscards).length === 0) {
      // discardThen：掷 7 后进强盗流程；破坏者卡/首次来袭前则直接回到 main
      if (this.turn.discardThen === 'main') {
        this.turn.state = this.afterRobberState();
      } else {
        this.turn.state = 'robber';
        this.addLog(`请 ${this.players[this.turn.player].name} 移动强盗。`);
      }
      this.turn.discardThen = 'robber';
    }
  }

  moveRobber(p, hexId) {
    this.requireTurn(p);
    this.requireState('robber');
    const hex = this.board.hexes[hexId];
    if (!hex) this.err('位置无效');
    if (hexId === this.robber) this.err('强盗必须移动到其他板块');
    this.robber = hexId;
    this.addEvent('robber', { hex: hexId });
    this.addLog(`${this.players[p].name} 将强盗移到了新板块`);

    // 可偷取对象：该板块相邻建筑的其他玩家且有手牌
    const targets = new Set();
    for (const v of this.board.vertices) {
      if (!v.hexes.includes(hexId)) continue;
      const b = this.buildings[v.id];
      if (b && b.player !== p && handCount(this.players[b.player].hand) > 0) targets.add(b.player);
    }
    const list = [...targets];
    if (list.length === 0) {
      this.turn.state = this.afterRobberState();
    } else if (list.length === 1) {
      this.stealFrom(p, list[0]);
      this.turn.state = this.afterRobberState();
    } else {
      this.turn.stealTargets = list;
      this.turn.state = 'steal';
    }
  }

  steal(p, target) {
    this.requireTurn(p);
    this.requireState('steal');
    if (!this.turn.stealTargets.includes(target)) this.err('不能偷取该玩家');
    this.stealFrom(p, target);
    this.turn.stealTargets = [];
    this.turn.state = this.afterRobberState();
  }

  stealFrom(p, target) {
    const hand = this.players[target].hand;
    const pool = [];
    for (const r of this.cardTypes()) for (let i = 0; i < hand[r]; i++) pool.push(r);
    if (pool.length === 0) return;
    const res = pool[Math.floor(this.rng() * pool.length)];
    hand[res]--;
    this.players[p].hand[res]++;
    this.addEvent('steal', { from: target, to: p });
    this.addLog(`${this.players[p].name} 从 ${this.players[target].name} 那里偷了一张牌`);
  }

  // ---------- 建造 ----------
  buildRoad(p, e) {
    this.requireTurn(p);
    if (this.turn.state === 'roadbuilding') return this.placeFreeRoad(p, e);
    this.requireState('main');
    if (!this.canAfford(p, COSTS.road)) this.err('资源不足（需要 1木材 1砖块）');
    if (this.players[p].pieces.road <= 0) this.err('道路棋子已用完');
    if (!this.validRoadEdges(p).includes(e)) this.err('该位置不能修路');
    this.pay(p, COSTS.road);
    this.roads[e] = p;
    this.players[p].pieces.road--;
    this.addEvent('build', { player: p, kind: 'road', edge: e });
    this.addLog(`${this.players[p].name} 修建了道路`);
    this.updateLongestRoad();
    this.checkWin();
  }

  placeFreeRoad(p, e) {
    if (!this.validRoadEdges(p).includes(e)) this.err('该位置不能修路');
    this.roads[e] = p;
    this.players[p].pieces.road--;
    this.turn.freeRoads--;
    this.addEvent('build', { player: p, kind: 'road', edge: e });
    this.addLog(`${this.players[p].name} 修建了道路（修路卡）`);
    if (this.turn.freeRoads <= 0 || this.players[p].pieces.road <= 0
        || this.validRoadEdges(p).length === 0) {
      this.turn.state = 'main';
      this.turn.freeRoads = 0;
    }
    this.updateLongestRoad();
    this.checkWin();
  }

  buildSettlement(p, v) {
    this.requireTurn(p);
    this.requireState('main');
    if (!this.canAfford(p, COSTS.settlement)) this.err('资源不足（需要 木材 砖块 羊毛 小麦 各1）');
    if (this.players[p].pieces.settlement <= 0) this.err('村庄棋子已用完');
    if (!this.validSettlementVertices(p, false).includes(v)) this.err('该位置不能建村庄');
    this.pay(p, COSTS.settlement);
    this.buildings[v] = { player: p, type: 'settlement' };
    this.players[p].pieces.settlement--;
    this.addEvent('build', { player: p, kind: 'settlement', vertex: v });
    this.addLog(`${this.players[p].name} 建造了村庄`);
    this.updateLongestRoad(); // 可能截断他人道路
    this.checkWin();
  }

  buildCity(p, v) {
    this.requireTurn(p);
    this.requireState('main');
    if (!this.canAfford(p, COSTS.city)) this.err('资源不足（需要 2小麦 3矿石）');
    if (this.players[p].pieces.city <= 0) this.err('城市棋子已用完');
    const b = this.buildings[v];
    if (!b || b.player !== p || b.type !== 'settlement') this.err('只能升级自己的村庄');
    this.pay(p, COSTS.city);
    b.type = 'city';
    this.players[p].pieces.city--;
    this.players[p].pieces.settlement++;
    this.addEvent('build', { player: p, kind: 'city', vertex: v });
    this.addLog(`${this.players[p].name} 将村庄升级为城市`);
    this.checkWin();
  }

  // ---------- 发展卡 ----------
  buyDev(p) {
    if (this.ck) this.err('城市与骑士模式没有发展卡');
    this.requireTurn(p);
    this.requireState('main');
    if (this.devDeck.length === 0) this.err('发展卡已抽完');
    if (!this.canAfford(p, COSTS.dev)) this.err('资源不足（需要 羊毛 小麦 矿石 各1）');
    this.pay(p, COSTS.dev);
    const type = this.devDeck.pop();
    this.players[p].devCards.push({ type, boughtTurn: this.turn.count, played: false });
    this.addEvent('buyDev', { player: p });
    this.addLog(`${this.players[p].name} 购买了一张发展卡`);
    this.checkWin(); // 分数卡可能直接获胜
  }

  playDev(p, type, payload = {}) {
    if (this.ck) this.err('城市与骑士模式没有发展卡');
    this.requireTurn(p);
    if (type === 'knight') this.requireState('preroll', 'main');
    else this.requireState('main');
    if (this.turn.devPlayed) this.err('每回合只能打出一张发展卡');
    const card = this.players[p].devCards.find(
      (c) => c.type === type && !c.played && c.boughtTurn < this.turn.count,
    );
    if (!card) this.err('没有可打出的这张发展卡（本回合购买的不能立即使用）');

    switch (type) {
      case 'knight': {
        card.played = true;
        this.turn.devPlayed = true;
        this.players[p].knightsPlayed++;
        this.addLog(`${this.players[p].name} 打出了骑士！`);
        this.updateLargestArmy();
        this.turn.state = 'robber';
        this.checkWin();
        break;
      }
      case 'roadBuilding': {
        const free = Math.min(2, this.players[p].pieces.road);
        if (free === 0 || this.validRoadEdges(p).length === 0) this.err('没有可修路的位置');
        card.played = true;
        this.turn.devPlayed = true;
        this.turn.freeRoads = free;
        this.turn.state = 'roadbuilding';
        this.addLog(`${this.players[p].name} 打出了修路卡，可免费修 ${free} 条路`);
        break;
      }
      case 'yearOfPlenty': {
        const { r1, r2 } = payload;
        if (!RESOURCES.includes(r1) || !RESOURCES.includes(r2)) this.err('请选择两种资源');
        const need = this.blankHand();
        need[r1]++; need[r2]++;
        for (const r of RESOURCES) if (need[r] > this.bank[r]) this.err(`银行的${RES_NAME[r]}不足`);
        card.played = true;
        this.turn.devPlayed = true;
        this.gain(p, r1, 1);
        this.gain(p, r2, 1);
        this.addLog(`${this.players[p].name} 打出丰收之年，获得${RES_NAME[r1]}和${RES_NAME[r2]}`);
        break;
      }
      case 'monopoly': {
        const { res } = payload;
        if (!RESOURCES.includes(res)) this.err('请选择一种资源');
        card.played = true;
        this.turn.devPlayed = true;
        let total = 0;
        this.players.forEach((pl, i) => {
          if (i === p) return;
          total += pl.hand[res];
          this.players[p].hand[res] += pl.hand[res];
          pl.hand[res] = 0;
        });
        this.addEvent('monopoly', { player: p, res, n: total });
        this.addLog(`${this.players[p].name} 打出垄断，收走所有${RES_NAME[res]}（共 ${total} 张）`);
        break;
      }
      default:
        this.err('无法打出该卡');
    }
  }

  // ---------- 交易 ----------
  bankRate(p, res) {
    let rate = 4;
    for (const h of this.board.harbors) {
      const owned = h.vertices.some((v) => this.buildings[v]?.player === p);
      if (!owned) continue;
      if (h.type === 'any') rate = Math.min(rate, 3);
      else if (h.type === res) rate = Math.min(rate, 2);
    }
    if (this.ck) {
      // 商栈（贸易 3 级）：商品 2:1；商人：所在板块资源 2:1；商船队：当回合指定牌 2:1
      if (COMMODITIES.includes(res) && this.players[p].improvements.trade >= 3) rate = Math.min(rate, 2);
      if (this.merchant?.player === p
          && TERRAIN_RESOURCE[this.board.hexes[this.merchant.hex].terrain] === res) rate = Math.min(rate, 2);
      if (this.turn.player === p && this.turn.fleet === res) rate = Math.min(rate, 2);
    }
    return rate;
  }

  bankTrade(p, give, get) {
    this.requireTurn(p);
    this.requireState('main');
    const types = this.cardTypes();
    if (!types.includes(give) || !types.includes(get) || give === get) this.err('交易无效');
    const rate = this.bankRate(p, give);
    if (this.players[p].hand[give] < rate) this.err(`需要 ${rate} 张${this.cardName(give)}`);
    if (this.bank[get] < 1) this.err(`银行的${this.cardName(get)}不足`);
    this.players[p].hand[give] -= rate;
    this.bank[give] += rate;
    this.gain(p, get, 1);
    this.addLog(`${this.players[p].name} 用 ${rate} 张${this.cardName(give)}和银行换了 1 张${this.cardName(get)}`);
  }

  offerTrade(p, give, get) {
    this.requireTurn(p);
    this.requireState('main');
    const types = this.cardTypes();
    const clean = (m) => {
      const out = this.blankHand();
      for (const r of types) out[r] = Math.max(0, Math.floor(m?.[r] || 0));
      return out;
    };
    give = clean(give); get = clean(get);
    if (handCount(give) === 0 || handCount(get) === 0) this.err('交易双方都要有资源');
    for (const r of types) {
      if (give[r] > this.players[p].hand[r]) this.err('你没有足够的资源');
      if (give[r] > 0 && get[r] > 0) this.err('不能用同种资源交换');
    }
    this.trade = { from: p, give, get, responses: {} };
    const fmt = (m) => types.filter((r) => m[r]).map((r) => `${m[r]}${this.cardName(r)}`).join('+');
    this.addLog(`${this.players[p].name} 发起交易：出 ${fmt(give)} 换 ${fmt(get)}`);
  }

  cancelTrade(p) {
    if (!this.trade || this.trade.from !== p) this.err('没有你发起的交易');
    this.trade = null;
    this.addLog(`${this.players[p].name} 取消了交易`);
  }

  respondTrade(p, accept) {
    if (!this.trade) this.err('当前没有交易');
    if (p === this.trade.from) this.err('不能回应自己的交易');
    if (accept) {
      for (const r of this.cardTypes()) {
        if (this.trade.get[r] > this.players[p].hand[r]) this.err('你的资源不足以接受该交易');
      }
    }
    this.trade.responses[p] = accept ? 'accept' : 'decline';
  }

  acceptTradeWith(p, target) {
    this.requireTurn(p);
    if (!this.trade || this.trade.from !== p) this.err('没有你发起的交易');
    if (this.trade.responses[target] !== 'accept') this.err('对方还没有同意交易');
    const { give, get } = this.trade;
    // 再次校验双方资源
    for (const r of this.cardTypes()) {
      if (give[r] > this.players[p].hand[r]) this.err('你的资源不足');
      if (get[r] > this.players[target].hand[r]) this.err('对方的资源不足');
    }
    for (const r of this.cardTypes()) {
      this.players[p].hand[r] += get[r] - give[r];
      this.players[target].hand[r] += give[r] - get[r];
    }
    this.addEvent('trade', { a: p, b: target });
    this.addLog(`${this.players[p].name} 与 ${this.players[target].name} 完成了交易`);
    this.trade = null;
  }

  // ---------- 回合结束与胜利 ----------
  endTurn(p) {
    this.requireTurn(p);
    this.requireState('main');
    this.trade = null;
    this.turn.player = (this.turn.player + 1) % this.players.length;
    this.turn.count++;
    this.turn.rolled = false;
    this.turn.dice = null;
    this.turn.devPlayed = false;
    this.turn.fleet = null;   // 商船队只在当回合有效
    this.turn.crane = false;  // 起重机未用则作废
    this.turn.state = 'preroll';
    this.addEvent('turnEnd', { from: p, to: this.turn.player });
    this.addLog(`轮到 ${this.players[this.turn.player].name} 的回合`);
    this.checkWin();
  }

  updateLongestRoad() {
    const lengths = this.players.map((_, i) => {
      const mine = Object.entries(this.roads).filter(([, o]) => o === i).map(([e]) => Number(e));
      const blocked = new Set(
        Object.entries(this.buildings)
          .filter(([, b]) => b.player !== i)
          .map(([v]) => Number(v)),
      );
      if (this.ck) {
        // 对手骑士同样截断道路
        for (const [v, k] of Object.entries(this.knights)) {
          if (k.player !== i) blocked.add(Number(v));
        }
      }
      return longestRoadLength(mine, this.board.edges, blocked);
    });
    const maxLen = Math.max(...lengths);
    const prev = this.awards.longestRoad;
    if (maxLen < 5) {
      if (prev) this.addLog(`${this.players[prev.player].name} 失去了最长道路`);
      this.awards.longestRoad = null;
      return;
    }
    const holders = lengths.map((l, i) => [i, l]).filter(([, l]) => l === maxLen).map(([i]) => i);
    if (prev && holders.includes(prev.player)) {
      this.awards.longestRoad = { player: prev.player, length: lengths[prev.player] };
    } else if (holders.length === 1) {
      if (!prev || prev.player !== holders[0]) {
        this.addLog(`${this.players[holders[0]].name} 获得最长道路（${maxLen} 段，+2 分）！`);
      }
      this.awards.longestRoad = { player: holders[0], length: maxLen };
    } else {
      // 持有者被截断且多人并列：奖励空置
      if (prev) this.addLog('最长道路并列，奖励暂时空置');
      this.awards.longestRoad = null;
    }
  }

  updateLargestArmy() {
    this.players.forEach((pl, i) => {
      if (pl.knightsPlayed < 3) return;
      const cur = this.awards.largestArmy;
      if (!cur) {
        this.awards.largestArmy = { player: i, count: pl.knightsPlayed };
        this.addLog(`${pl.name} 获得最大军队（${pl.knightsPlayed} 骑士，+2 分）！`);
      } else if (cur.player === i) {
        cur.count = pl.knightsPlayed;
      } else if (pl.knightsPlayed > cur.count) {
        this.awards.largestArmy = { player: i, count: pl.knightsPlayed };
        this.addLog(`${pl.name} 夺得最大军队（${pl.knightsPlayed} 骑士，+2 分）！`);
      }
    });
  }

  victoryPoints(p, includeHidden) {
    let vp = 0;
    for (const b of Object.values(this.buildings)) {
      if (b.player === p) vp += b.type === 'city' ? 2 : 1;
    }
    if (this.awards.longestRoad?.player === p) vp += 2;
    if (this.ck) {
      // ck 模式没有最大军队；额外分：大都会 +2、商人 +1、卡坦守护者、亮出的分数进步卡
      for (const t of IMPROVE_TRACKS) if (this.metropolis[t]?.player === p) vp += 2;
      if (this.merchant?.player === p) vp += 1;
      vp += this.players[p].defenderVP + this.players[p].progressVP;
    } else {
      if (this.awards.largestArmy?.player === p) vp += 2;
      if (includeHidden) {
        vp += this.players[p].devCards.filter((c) => c.type === 'vp').length;
      }
    }
    return vp;
  }

  winGoal() {
    return this.ck ? CK_WIN_VP : WIN_VP;
  }

  checkWin() {
    const p = this.turn.player;
    if (this.phase !== 'play') return;
    if (this.victoryPoints(p, true) >= this.winGoal()) {
      this.phase = 'ended';
      this.winner = p;
      this.turn.state = 'ended';
      this.addEvent('win', { player: p });
      this.addLog(`🎉 ${this.players[p].name} 达到 ${this.winGoal()} 分，获得胜利！`);
    }
  }

  // ---------- 序列化 ----------
  publicState() {
    return {
      phase: this.phase,
      mode: this.mode,
      winGoal: this.winGoal(),
      board: this.board,
      robber: this.robber,
      buildings: this.buildings,
      roads: this.roads,
      bank: { ...this.bank, devDeck: this.devDeck.length },
      turn: {
        player: this.turn.player,
        count: this.turn.count,
        state: this.turn.state,
        rolled: this.turn.rolled,
        dice: this.turn.dice,
        freeRoads: this.turn.freeRoads,
        pendingDiscards: { ...this.turn.pendingDiscards },
        stealTargets: this.turn.stealTargets,
      },
      ck: this.ck ? {
        barbarians: { ...this.barbarians, track: BARBARIAN_TRACK },
        knights: this.knights,
        walls: this.walls,
        merchant: this.merchant,
        metropolis: this.metropolis,
        eventDie: this.turn.eventDie,
        crane: this.turn.crane,
        decks: Object.fromEntries(IMPROVE_TRACKS.map((t) => [t, this.progressDecks[t].length])),
        pendingCityLoss: Object.keys(this.turn.pendingCityLoss).map(Number),
        pendingAqueduct: this.turn.pendingAqueduct,
        pendingDefenderPick: this.turn.pendingDefenderPick,
        displace: this.turn.displace
          ? { owner: this.turn.displace.owner, level: this.turn.displace.knight.level }
          : null,
        metroTrack: this.turn.metroChoice?.track ?? null,
        pick: this.turn.pick ? { type: this.turn.pick.type, from: this.turn.pick.from, count: this.turn.pick.count } : null,
        pendingGive: Object.fromEntries(Object.entries(this.turn.pendingGive)),
        harbor: this.turn.harbor
          ? { current: this.turn.harbor.queue[this.turn.harbor.idx], stage: this.turn.harbor.stage }
          : null,
      } : null,
      setup: this.phase === 'setup' ? {
        current: this.currentSetupPlayer(),
        awaiting: this.setup.awaiting,
        pos: this.setup.pos,
        total: this.setup.order.length,
        building: this.ck && this.setup.pos >= this.players.length ? 'city' : 'settlement',
      } : null,
      trade: this.trade,
      awards: this.awards,
      winner: this.winner,
      players: this.players.map((pl, i) => ({
        name: pl.name,
        color: pl.color,
        colorName: pl.colorName,
        handCount: handCount(pl.hand),
        devCount: this.ck ? pl.progressCards.length : pl.devCards.filter((c) => !c.played).length,
        knightsPlayed: pl.knightsPlayed,
        pieces: pl.pieces,
        vp: this.victoryPoints(i, this.phase === 'ended'),
        connected: pl.connected,
        ...(this.ck ? {
          improvements: pl.improvements,
          progressVP: pl.progressVP,
          defenderVP: pl.defenderVP,
        } : {}),
      })),
      log: this.log.slice(-60),
      events: this.events,
    };
  }

  privateState(p) {
    const pl = this.players[p];
    const isSetupTurn = this.phase === 'setup' && this.currentSetupPlayer() === p;
    const hints = {};
    if (isSetupTurn && this.setup.awaiting === 'settlement') {
      hints.settlements = this.validSettlementVertices(p, true);
    } else if (isSetupTurn && this.setup.awaiting === 'road') {
      hints.roads = this.validRoadEdges(p, this.setup.lastSettlement);
    } else if (this.phase === 'play' && this.turn.player === p) {
      if (this.turn.state === 'main' || this.turn.state === 'roadbuilding') {
        hints.roads = this.validRoadEdges(p);
      }
      if (this.turn.state === 'main') {
        hints.settlements = this.validSettlementVertices(p, false);
        hints.cities = this.validCityVertices(p);
      }
    }
    if (this.ck && this.phase === 'play') this.ckHints(p, hints);
    return {
      index: p,
      hand: pl.hand,
      devCards: pl.devCards.map((c) => ({
        type: c.type,
        playable: !c.played && c.boughtTurn < this.turn.count && c.type !== 'vp',
        played: c.played,
      })),
      progressCards: this.ck ? pl.progressCards : [],
      rates: Object.fromEntries(this.cardTypes().map((r) => [r, this.bankRate(p, r)])),
      hints,
      vpTotal: this.victoryPoints(p, true),
    };
  }
}

Object.assign(Game.prototype, ckMethods);

export { DEV_NAME, RES_NAME };
