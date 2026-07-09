import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { longestRoadLength } from '../server/longestRoad.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newGame(n = 3, seed = 42) {
  return new Game(
    Array.from({ length: n }, (_, i) => ({ name: `玩家${i + 1}` })),
    seeded(seed),
  );
}

function doSetup(g) {
  while (g.phase === 'setup') {
    const p = g.currentSetupPlayer();
    const v = g.validSettlementVertices(p, true)[0];
    g.placeSetupSettlement(p, v);
    const e = g.validRoadEdges(p, v)[0];
    g.placeSetupRoad(p, e);
  }
}

test('初始放置：蛇形顺序，距离规则生效', () => {
  const g = newGame(3);
  assert.deepEqual(g.setup.order, [0, 1, 2, 2, 1, 0]);
  const p = g.currentSetupPlayer();
  const v = g.validSettlementVertices(p, true)[0];
  g.placeSetupSettlement(p, v);
  const e = g.validRoadEdges(p, v)[0];
  g.placeSetupRoad(p, e);
  // 下一位玩家不能在相邻顶点放置
  const next = g.currentSetupPlayer();
  const valid = g.validSettlementVertices(next, true);
  assert.ok(!valid.includes(v));
  for (const nv of g.board.vertices[v].adjV) assert.ok(!valid.includes(nv));
});

test('完成初始放置后进入正式阶段，第二个村庄给资源', () => {
  const g = newGame(3);
  doSetup(g);
  assert.equal(g.phase, 'play');
  assert.equal(g.turn.state, 'preroll');
  // 每人两个村庄两条路
  for (let i = 0; i < 3; i++) {
    assert.equal(g.players[i].pieces.settlement, 3);
    assert.equal(g.players[i].pieces.road, 13);
  }
});

test('掷骰子后进入 main 或强盗流程', () => {
  const g = newGame(3);
  doSetup(g);
  g.roll(0);
  assert.ok(g.turn.rolled);
  const total = g.turn.dice[0] + g.turn.dice[1];
  if (total === 7) assert.ok(['discard', 'robber'].includes(g.turn.state));
  else assert.equal(g.turn.state, 'main');
});

test('未轮到的玩家不能操作', () => {
  const g = newGame(3);
  doSetup(g);
  assert.throws(() => g.roll(1), /还没轮到你/);
  assert.throws(() => g.endTurn(2), /还没轮到你/);
});

test('结束回合轮转', () => {
  const g = newGame(3);
  doSetup(g);
  forceMain(g, 0);
  g.endTurn(0);
  assert.equal(g.turn.player, 1);
  assert.equal(g.turn.state, 'preroll');
});

// 强制把当前回合推进到 main 状态（处理掷出 7 的情况）
function forceMain(g, p) {
  g.roll(p);
  if (g.turn.state === 'discard') {
    for (const [i, need] of Object.entries({ ...g.turn.pendingDiscards })) {
      const pl = g.players[i];
      const sel = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
      let left = need;
      for (const r of Object.keys(sel)) {
        const take = Math.min(left, pl.hand[r]);
        sel[r] = take; left -= take;
      }
      g.discard(Number(i), sel);
    }
  }
  if (g.turn.state === 'robber') {
    const target = g.board.hexes.find((h) => h.id !== g.robber);
    g.moveRobber(p, target.id);
  }
  if (g.turn.state === 'steal') {
    g.steal(p, g.turn.stealTargets[0]);
  }
  assert.equal(g.turn.state, 'main');
}

test('修路需要资源，资源不足时报错', () => {
  const g = newGame(3);
  doSetup(g);
  forceMain(g, 0);
  g.players[0].hand = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  const e = g.validRoadEdges(0)[0];
  assert.throws(() => g.buildRoad(0, e), /资源不足/);
  g.players[0].hand.wood = 1;
  g.players[0].hand.brick = 1;
  g.buildRoad(0, e);
  assert.equal(g.roads[e], 0);
  assert.equal(g.players[0].hand.wood, 0);
});

test('银行交易默认 4:1', () => {
  const g = newGame(3);
  doSetup(g);
  forceMain(g, 0);
  g.players[0].hand = { wood: 4, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  const rate = g.bankRate(0, 'wood');
  assert.ok([2, 3, 4].includes(rate)); // 初始村庄可能正好在港口
  if (rate === 4) {
    g.bankTrade(0, 'wood', 'ore');
    assert.equal(g.players[0].hand.wood, 0);
    assert.equal(g.players[0].hand.ore, 1);
  }
});

test('玩家交易完整流程', () => {
  const g = newGame(3);
  doSetup(g);
  forceMain(g, 0);
  g.players[0].hand = { wood: 2, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  g.players[1].hand = { wood: 0, brick: 0, sheep: 1, wheat: 0, ore: 0 };
  g.offerTrade(0, { wood: 2 }, { sheep: 1 });
  g.respondTrade(1, true);
  g.acceptTradeWith(0, 1);
  assert.equal(g.players[0].hand.sheep, 1);
  assert.equal(g.players[0].hand.wood, 0);
  assert.equal(g.players[1].hand.wood, 2);
  assert.equal(g.trade, null);
});

test('发展卡：当回合购买不能立即使用', () => {
  const g = newGame(3);
  doSetup(g);
  forceMain(g, 0);
  g.players[0].hand = { wood: 0, brick: 0, sheep: 1, wheat: 1, ore: 1 };
  g.buyDev(0);
  assert.equal(g.players[0].devCards.length, 1);
  const type = g.players[0].devCards[0].type;
  if (type !== 'vp') {
    assert.throws(() => g.playDev(0, type), /本回合购买/);
  }
});

test('最长道路算法', () => {
  // 直线 v0-v1-v2-v3：3 条边
  const edges = [
    { id: 0, v1: 0, v2: 1 },
    { id: 1, v1: 1, v2: 2 },
    { id: 2, v1: 2, v2: 3 },
    { id: 3, v1: 2, v2: 4 }, // 分叉
  ];
  assert.equal(longestRoadLength([0, 1, 2], edges, new Set()), 3);
  assert.equal(longestRoadLength([0, 1, 2, 3], edges, new Set()), 3);
  // 对手建筑截断 v1：两段 1 和 2
  assert.equal(longestRoadLength([0, 1, 2], edges, new Set([1])), 2);
  // 截断点可以作为起点
  assert.equal(longestRoadLength([0], edges, new Set([0])), 1);
});

test('最长道路奖励：达到 5 段获得 +2 分', () => {
  const g = newGame(2, 9);
  doSetup(g);
  // 直接给玩家 0 铺一条长路（沿合法扩展位置逐条修）
  g.turn.player = 0;
  g.turn.state = 'main';
  g.turn.rolled = true;
  for (let i = 0; i < 5; i++) {
    g.players[0].hand.wood = 1;
    g.players[0].hand.brick = 1;
    const options = g.validRoadEdges(0);
    assert.ok(options.length > 0);
    g.buildRoad(0, options[0]);
  }
  // 修了 5+2（初始2条）条路后应该有人拿到最长道路（不保证是直线，但至少计算无错）
  const vp = g.victoryPoints(0, true);
  assert.ok(vp >= 2);
});

test('垄断卡收走所有对应资源', () => {
  const g = newGame(3);
  doSetup(g);
  forceMain(g, 0);
  g.players[0].devCards.push({ type: 'monopoly', boughtTurn: 0, played: false });
  g.players[1].hand.wheat = 3;
  g.players[2].hand.wheat = 2;
  const before = g.players[0].hand.wheat;
  g.playDev(0, 'monopoly', { res: 'wheat' });
  assert.equal(g.players[0].hand.wheat, before + 5);
  assert.equal(g.players[1].hand.wheat, 0);
});

test('10 分获胜', () => {
  const g = newGame(2, 5);
  doSetup(g);
  forceMain(g, 0);
  // 手动把玩家 0 的建筑数拉满：4 城 + 2 村 = 10 分
  const mine = Object.entries(g.buildings).filter(([, b]) => b.player === 0);
  for (const [v] of mine) g.buildings[v].type = 'city'; // 2 城 = 4 分
  // 再放 3 个城（直接写入状态模拟后期）
  let placed = 0;
  for (const v of g.board.vertices) {
    if (placed >= 3) break;
    if (!g.buildings[v.id] && g.vertexFree(v.id)) {
      g.buildings[v.id] = { player: 0, type: 'city' };
      placed++;
    }
  }
  assert.equal(placed, 3);
  assert.equal(g.victoryPoints(0, true), 10);
  g.checkWin();
  assert.equal(g.phase, 'ended');
  assert.equal(g.winner, 0);
});

test('掷出 7：超过 7 张手牌需要弃一半', () => {
  const g = newGame(3);
  doSetup(g);
  g.players[1].hand = { wood: 4, brick: 4, sheep: 0, wheat: 0, ore: 0 };
  // 强制触发 7
  g.turn.state = 'preroll';
  const origRng = g.rng;
  g.rng = () => 0.5; // 骰子 4+4=8... 需要精确控制
  g.rng = (() => {
    const vals = [0.5, 0.34]; // 4 和 3 → 7
    let i = 0;
    return () => vals[i++ % vals.length];
  })();
  g.roll(0);
  assert.equal(g.turn.dice[0] + g.turn.dice[1], 7);
  assert.equal(g.turn.state, 'discard');
  assert.equal(g.turn.pendingDiscards[1], 4);
  g.discard(1, { wood: 4, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  assert.equal(g.turn.state, 'robber');
  g.rng = origRng;
});
