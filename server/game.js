// 卡坦岛基础版核心规则（服务端权威）
import {
  RESOURCES, TERRAIN_RESOURCE, COSTS, DEV_DECK, PIECE_LIMITS,
  BANK_PER_RESOURCE, WIN_VP, PLAYER_COLORS, COLOR_NAMES,
} from './constants.js';
import { generateBoard, shuffle } from './board.js';
import { longestRoadLength } from './longestRoad.js';

const RES_NAME = { wood: '木材', brick: '砖块', sheep: '羊毛', wheat: '小麦', ore: '矿石' };
const DEV_NAME = {
  knight: '骑士', vp: '分数卡', roadBuilding: '修路', yearOfPlenty: '丰收之年', monopoly: '垄断',
};

function emptyHand() {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}
function handCount(hand) {
  return RESOURCES.reduce((s, r) => s + hand[r], 0);
}

export class Game {
  constructor(playerInfos, rng = Math.random) {
    this.rng = rng;
    this.board = generateBoard(rng);
    this.robber = this.board.robber;
    this.buildings = {}; // vertexId -> {player, type}
    this.roads = {};     // edgeId -> playerIdx
    this.players = playerInfos.map((p, i) => ({
      name: p.name,
      color: PLAYER_COLORS[i],
      colorName: COLOR_NAMES[i],
      hand: emptyHand(),
      devCards: [],
      knightsPlayed: 0,
      pieces: { ...PIECE_LIMITS },
      connected: true,
    }));
    this.bank = Object.fromEntries(RESOURCES.map((r) => [r, BANK_PER_RESOURCE]));
    this.devDeck = shuffle(DEV_DECK, rng);
    this.phase = 'setup';
    const n = this.players.length;
    const order = [...Array(n).keys()];
    this.setup = {
      order: [...order, ...order.slice().reverse()],
      pos: 0,
      awaiting: 'settlement',
      lastSettlement: null,
    };
    this.turn = {
      player: 0, count: 1, rolled: false, dice: null,
      devPlayed: false, state: 'setup', freeRoads: 0,
      pendingDiscards: {}, stealTargets: [], returnState: 'main',
    };
    this.trade = null;
    this.awards = { longestRoad: null, largestArmy: null };
    this.winner = null;
    this.log = [];
    this.events = [];
    this.eventSeq = 0;
    this.addLog(`游戏开始！${this.players[0].name} 先放置。`);
  }

  // ---------- 工具 ----------
  addLog(msg) {
    this.log.push(msg);
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
      // 任一端点：是自己的建筑，或（无对手建筑且连着自己的路）
      const ok = [e.v1, e.v2].some((v) => {
        const b = this.buildings[v];
        if (b) return b.player === p;
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

    this.buildings[v] = { player: p, type: 'settlement' };
    this.players[p].pieces.settlement--;
    this.setup.awaiting = 'road';
    this.setup.lastSettlement = v;
    this.addEvent('build', { player: p, kind: 'settlement', vertex: v });

    // 第二轮的村庄立即获得周围资源
    if (this.setup.pos >= this.players.length) {
      const gained = [];
      for (const hid of this.board.vertices[v].hexes) {
        const hex = this.board.hexes[hid];
        const r = TERRAIN_RESOURCE[hex.terrain];
        if (r && this.gain(p, r, 1)) gained.push(RES_NAME[r]);
      }
      if (gained.length) this.addLog(`${this.players[p].name} 获得初始资源：${gained.join('、')}`);
    }
    this.addLog(`${this.players[p].name} 放置了村庄`);
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
      this.turn.player = 0;
      this.addLog(`初始放置完成！轮到 ${this.players[0].name} 掷骰子。`);
    } else {
      this.addLog(`轮到 ${this.players[this.currentSetupPlayer()].name} 放置。`);
    }
  }

  // ---------- 掷骰与资源 ----------
  roll(p) {
    this.requireTurn(p);
    this.requireState('preroll');
    const d1 = 1 + Math.floor(this.rng() * 6);
    const d2 = 1 + Math.floor(this.rng() * 6);
    const total = d1 + d2;
    this.turn.dice = [d1, d2];
    this.turn.rolled = true;
    this.addEvent('dice', { player: p, dice: [d1, d2] });
    this.addLog(`${this.players[p].name} 掷出了 ${total}（${d1}+${d2}）`);

    if (total === 7) {
      const pending = {};
      this.players.forEach((pl, i) => {
        const c = handCount(pl.hand);
        if (c > 7) pending[i] = Math.floor(c / 2);
      });
      this.turn.pendingDiscards = pending;
      this.turn.returnState = 'main';
      if (Object.keys(pending).length > 0) {
        this.turn.state = 'discard';
        const names = Object.keys(pending).map((i) => this.players[i].name).join('、');
        this.addLog(`掷出 7！${names} 需要弃掉一半手牌。`);
      } else {
        this.turn.state = 'robber';
        this.addLog('掷出 7！请移动强盗。');
      }
      return;
    }

    this.distribute(total);
    this.turn.state = 'main';
  }

  distribute(total) {
    // 统计每位玩家每种资源应得数量
    const demand = this.players.map(() => emptyHand());
    for (const hex of this.board.hexes) {
      if (hex.number !== total || hex.id === this.robber) continue;
      const res = TERRAIN_RESOURCE[hex.terrain];
      if (!res) continue;
      for (const v of this.board.vertices) {
        if (!v.hexes.includes(hex.id)) continue;
        const b = this.buildings[v.id];
        if (b) demand[b.player][res] += b.type === 'city' ? 2 : 1;
      }
    }
    // 银行不足：若多名玩家需要该资源则都不发，仅一名则发剩余
    for (const res of RESOURCES) {
      const claimants = demand.map((d, i) => [i, d[res]]).filter(([, n]) => n > 0);
      const totalNeed = claimants.reduce((s, [, n]) => s + n, 0);
      if (totalNeed === 0) continue;
      if (totalNeed > this.bank[res] && claimants.length > 1) {
        this.addLog(`银行的${RES_NAME[res]}不足，本次无人获得。`);
        continue;
      }
      for (const [i, n] of claimants) {
        const got = this.gain(i, res, n);
        if (got > 0) {
          this.addEvent('gain', { player: i, res, n: got });
          this.addLog(`${this.players[i].name} 获得 ${got} 张${RES_NAME[res]}`);
        }
      }
    }
  }

  // ---------- 强盗 ----------
  discard(p, sel) {
    this.requireState('discard');
    const need = this.turn.pendingDiscards[p];
    if (!need) this.err('你不需要弃牌');
    const total = RESOURCES.reduce((s, r) => s + (sel[r] || 0), 0);
    if (total !== need) this.err(`需要弃掉 ${need} 张牌`);
    for (const r of RESOURCES) {
      if ((sel[r] || 0) < 0 || (sel[r] || 0) > this.players[p].hand[r]) this.err('手牌不足');
    }
    for (const r of RESOURCES) {
      this.players[p].hand[r] -= sel[r] || 0;
      this.bank[r] += sel[r] || 0;
    }
    delete this.turn.pendingDiscards[p];
    this.addLog(`${this.players[p].name} 弃掉了 ${need} 张牌`);
    if (Object.keys(this.turn.pendingDiscards).length === 0) {
      this.turn.state = 'robber';
      this.addLog(`请 ${this.players[this.turn.player].name} 移动强盗。`);
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
      this.turn.state = this.turn.rolled ? 'main' : 'preroll';
    } else if (list.length === 1) {
      this.stealFrom(p, list[0]);
      this.turn.state = this.turn.rolled ? 'main' : 'preroll';
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
    this.turn.state = this.turn.rolled ? 'main' : 'preroll';
  }

  stealFrom(p, target) {
    const hand = this.players[target].hand;
    const pool = [];
    for (const r of RESOURCES) for (let i = 0; i < hand[r]; i++) pool.push(r);
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
        this.turn.returnState = this.turn.rolled ? 'main' : 'preroll';
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
        const need = emptyHand();
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
    return rate;
  }

  bankTrade(p, give, get) {
    this.requireTurn(p);
    this.requireState('main');
    if (!RESOURCES.includes(give) || !RESOURCES.includes(get) || give === get) this.err('交易无效');
    const rate = this.bankRate(p, give);
    if (this.players[p].hand[give] < rate) this.err(`需要 ${rate} 张${RES_NAME[give]}`);
    if (this.bank[get] < 1) this.err(`银行的${RES_NAME[get]}不足`);
    this.players[p].hand[give] -= rate;
    this.bank[give] += rate;
    this.gain(p, get, 1);
    this.addLog(`${this.players[p].name} 用 ${rate} 张${RES_NAME[give]}和银行换了 1 张${RES_NAME[get]}`);
  }

  offerTrade(p, give, get) {
    this.requireTurn(p);
    this.requireState('main');
    const clean = (m) => {
      const out = emptyHand();
      for (const r of RESOURCES) out[r] = Math.max(0, Math.floor(m?.[r] || 0));
      return out;
    };
    give = clean(give); get = clean(get);
    if (handCount(give) === 0 || handCount(get) === 0) this.err('交易双方都要有资源');
    for (const r of RESOURCES) {
      if (give[r] > this.players[p].hand[r]) this.err('你没有足够的资源');
      if (give[r] > 0 && get[r] > 0) this.err('不能用同种资源交换');
    }
    this.trade = { from: p, give, get, responses: {} };
    const fmt = (m) => RESOURCES.filter((r) => m[r]).map((r) => `${m[r]}${RES_NAME[r]}`).join('+');
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
      for (const r of RESOURCES) {
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
    for (const r of RESOURCES) {
      if (give[r] > this.players[p].hand[r]) this.err('你的资源不足');
      if (get[r] > this.players[target].hand[r]) this.err('对方的资源不足');
    }
    for (const r of RESOURCES) {
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
    if (this.awards.largestArmy?.player === p) vp += 2;
    if (includeHidden) {
      vp += this.players[p].devCards.filter((c) => c.type === 'vp').length;
    }
    return vp;
  }

  checkWin() {
    const p = this.turn.player;
    if (this.phase !== 'play') return;
    if (this.victoryPoints(p, true) >= WIN_VP) {
      this.phase = 'ended';
      this.winner = p;
      this.turn.state = 'ended';
      this.addEvent('win', { player: p });
      this.addLog(`🎉 ${this.players[p].name} 达到 ${WIN_VP} 分，获得胜利！`);
    }
  }

  // ---------- 序列化 ----------
  publicState() {
    return {
      phase: this.phase,
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
        pendingDiscards: Object.fromEntries(
          Object.entries(this.turn.pendingDiscards).map(([i, n]) => [i, n]),
        ),
        stealTargets: this.turn.stealTargets,
      },
      setup: this.phase === 'setup' ? {
        current: this.currentSetupPlayer(),
        awaiting: this.setup.awaiting,
        pos: this.setup.pos,
        total: this.setup.order.length,
      } : null,
      trade: this.trade,
      awards: this.awards,
      winner: this.winner,
      players: this.players.map((pl, i) => ({
        name: pl.name,
        color: pl.color,
        colorName: pl.colorName,
        handCount: handCount(pl.hand),
        devCount: pl.devCards.filter((c) => !c.played).length,
        knightsPlayed: pl.knightsPlayed,
        pieces: pl.pieces,
        vp: this.victoryPoints(i, this.phase === 'ended'),
        connected: pl.connected,
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
    return {
      index: p,
      hand: pl.hand,
      devCards: pl.devCards.map((c) => ({
        type: c.type,
        playable: !c.played && c.boughtTurn < this.turn.count && c.type !== 'vp',
        played: c.played,
      })),
      rates: Object.fromEntries(RESOURCES.map((r) => [r, this.bankRate(p, r)])),
      hints,
      vpTotal: this.victoryPoints(p, true),
    };
  }
}

export { DEV_NAME, RES_NAME };
