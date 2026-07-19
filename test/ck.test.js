import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newCK(n = 3, seed = 42) {
  return new Game(
    Array.from({ length: n }, (_, i) => ({ name: `玩家${i + 1}` })),
    seeded(seed),
    0,
    'ck',
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

// 直接把回合置为 main（绕开掷骰的随机性）
function forceMain(g, p = 0) {
  g.turn.player = p;
  g.turn.state = 'main';
  g.turn.rolled = true;
}

test('ck：第二轮初始放置的是城市，胜利目标 13 分', () => {
  const g = newCK(3);
  assert.equal(g.winGoal(), 13);
  doSetup(g);
  for (let i = 0; i < 3; i++) {
    const mine = Object.values(g.buildings).filter((b) => b.player === i);
    assert.deepEqual(mine.map((b) => b.type).sort(), ['city', 'settlement']);
    assert.equal(g.players[i].pieces.settlement, 4);
    assert.equal(g.players[i].pieces.city, 3);
    assert.equal(g.victoryPoints(i, true), 3);
  }
});

test('ck：手牌含商品，银行有商品存量', () => {
  const g = newCK(3);
  assert.deepEqual(Object.keys(g.players[0].hand).sort(),
    ['brick', 'cloth', 'coin', 'ore', 'paper', 'sheep', 'wheat', 'wood'].sort());
  assert.equal(g.bank.cloth, 12);
  assert.equal(g.bank.coin, 12);
  assert.equal(g.bank.paper, 12);
});

test('ck：城市在羊地产 1 羊毛 + 1 布匹', () => {
  const g = newCK(3);
  doSetup(g);
  const hex = g.board.hexes.find((h) => h.terrain === 'pasture' && h.number);
  // 在该板块找一个空顶点放玩家 0 的城市
  const v = g.board.vertices.find((vv) => vv.hexes.includes(hex.id) && !g.buildings[vv.id]);
  g.buildings[v.id] = { player: 0, type: 'city' };
  const before = { ...g.players[0].hand };
  g.distribute(hex.number);
  assert.ok(g.players[0].hand.sheep >= before.sheep + 1);
  assert.ok(g.players[0].hand.cloth >= before.cloth + 1);
});

test('ck：没有发展卡', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  g.players[0].hand.sheep = 1;
  g.players[0].hand.wheat = 1;
  g.players[0].hand.ore = 1;
  assert.throws(() => g.buyDev(0), /没有发展卡/);
});

test('ck：野蛮人来袭前掷 7 强盗不动', () => {
  const g = newCK(3);
  doSetup(g);
  g.turn.player = 0;
  g.finishRoll(7);
  assert.equal(g.turn.state, 'main');
  assert.equal(g.robber, g.board.robber);
});

test('ck：城墙提高弃牌上限', () => {
  const g = newCK(3);
  doSetup(g);
  const cityV = Number(Object.keys(g.buildings).find(
    (v) => g.buildings[v].player === 0 && g.buildings[v].type === 'city',
  ));
  g.walls[cityV] = 0;
  for (const pl of g.players) pl.hand = g.blankHand(); // 清掉初始资源
  g.players[0].hand.wood = 9; // 共 9 张，上限 7+2 不用弃
  g.players[1].hand.wood = 8; // 超过 7，弃 4
  g.turn.player = 0;
  g.finishRoll(7);
  assert.equal(g.turn.state, 'discard');
  assert.equal(g.turn.pendingDiscards[0], undefined);
  assert.equal(g.turn.pendingDiscards[1], 4);
});

test('ck：骑士建造/激活/行动限制', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  const spots = g.validKnightSpots(0);
  assert.ok(spots.length > 0);
  g.players[0].hand.sheep = 1;
  g.players[0].hand.ore = 1;
  const v = spots[0];
  g.buildKnight(0, v);
  assert.equal(g.knights[v].level, 1);
  assert.equal(g.knights[v].active, false);
  // 激活需要小麦
  assert.throws(() => g.activateKnight(0, v), /小麦/);
  g.players[0].hand.wheat = 1;
  g.activateKnight(0, v);
  assert.ok(g.knights[v].active);
  // 激活当回合不能行动
  const { moves } = g.knightMoveTargets(0, v);
  if (moves.length > 0) {
    assert.throws(() => g.moveKnight(0, v, moves[0]), /激活当回合不能行动/);
  }
  // 首次来袭前不能驱逐强盗
  assert.throws(() => g.chaseRobber(0, v), /激活当回合|野蛮人首次来袭前/);
  // 下一回合可以移动
  g.turn.count++;
  if (moves.length > 0) {
    g.moveKnight(0, v, moves[0]);
    assert.equal(g.knights[moves[0]].player, 0);
    assert.equal(g.knights[v], undefined);
  }
});

test('ck：升级骑士的限制（同回合招募不能升级、三级需政治 3）', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  const v = g.validKnightSpots(0)[0];
  g.players[0].hand.sheep = 3;
  g.players[0].hand.ore = 3;
  g.buildKnight(0, v);
  assert.throws(() => g.upgradeKnight(0, v), /本回合招募/);
  g.turn.count++;
  g.upgradeKnight(0, v);
  assert.equal(g.knights[v].level, 2);
  assert.throws(() => g.upgradeKnight(0, v), /每回合只能升级一次/);
  g.turn.count++;
  assert.throws(() => g.upgradeKnight(0, v), /政治/);
  g.players[0].improvements.politics = 3;
  g.upgradeKnight(0, v);
  assert.equal(g.knights[v].level, 3);
});

test('ck：野蛮人防御成功，独占最高者成为卡坦守护者', () => {
  const g = newCK(3);
  doSetup(g);
  const v = g.validKnightSpots(0)[0];
  g.knights[v] = {
    player: 0, level: 3, active: true,
    builtTurn: 0, promotedTurn: 0, activatedTurn: 0, actedTurn: 0,
  };
  // 兵力 = 3 座城市，防御 = 3 → 守住
  const paused = g.resolveBarbarianAttack(6);
  assert.equal(paused, false);
  assert.equal(g.players[0].defenderVP, 1);
  assert.equal(g.barbarians.attacks, 1);
  assert.equal(g.barbarians.pos, 0);
  assert.equal(g.knights[v].active, false); // 战后骑士休整
});

test('ck：野蛮人防御失败，出力最少者失去城市', () => {
  const g = newCK(3);
  doSetup(g);
  const paused = g.resolveBarbarianAttack(6);
  assert.equal(paused, false); // 每人只有一座城，自动结算
  // 无人防御：三人并列最少，全部失去城市
  for (let i = 0; i < 3; i++) {
    const mine = Object.values(g.buildings).filter((b) => b.player === i);
    assert.deepEqual(mine.map((b) => b.type), ['settlement', 'settlement']);
    assert.equal(g.players[i].pieces.city, 4);
  }
});

test('ck：大都会免疫野蛮人', () => {
  const g = newCK(3);
  doSetup(g);
  const cityOf = (p) => Number(Object.keys(g.buildings).find(
    (v) => g.buildings[v].player === p && g.buildings[v].type === 'city',
  ));
  g.metropolis.trade = { player: 0, vertex: cityOf(0) };
  g.resolveBarbarianAttack(6);
  // 玩家 0 的城市是大都会不可摧毁，1/2 的城市被毁
  assert.equal(g.buildings[g.metropolis.trade.vertex].type, 'city');
  assert.equal(Object.values(g.buildings).filter((b) => b.type === 'city').length, 1);
});

test('ck：城市升级消耗商品并解锁能力/大都会', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  g.players[0].hand.cloth = 10;
  for (let i = 0; i < 3; i++) g.buyImprovement(0, 'trade');
  assert.equal(g.players[0].improvements.trade, 3);
  assert.equal(g.players[0].hand.cloth, 10 - 1 - 2 - 3);
  // 贸易 3 级：商品 2:1
  assert.equal(g.bankRate(0, 'cloth'), 2);
  assert.equal(g.bankRate(0, 'coin'), 2);
  // 4 级：大都会 +2 分
  const vpBefore = g.victoryPoints(0, true);
  g.buyImprovement(0, 'trade');
  assert.equal(g.metropolis.trade.player, 0);
  assert.equal(g.victoryPoints(0, true), vpBefore + 2);
});

test('ck：5 级可从停留在 4 级的对手手中夺走大都会', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  const cityOf = (p) => Number(Object.keys(g.buildings).find(
    (v) => g.buildings[v].player === p && g.buildings[v].type === 'city',
  ));
  g.players[1].improvements.trade = 4;
  g.metropolis.trade = { player: 1, vertex: cityOf(1) };
  g.players[0].improvements.trade = 4;
  g.players[0].hand.cloth = 5;
  g.buyImprovement(0, 'trade');
  assert.equal(g.players[0].improvements.trade, 5);
  assert.equal(g.metropolis.trade.player, 0);
});

test('ck：事件骰城门按红骰发进步卡，分数卡立即亮出', () => {
  const g = newCK(3);
  doSetup(g);
  g.players[0].improvements.science = 5; // 红骰 1-6 都能拿
  g.turn.eventDie = 'science';
  g.turn.dice = [3, 1];
  g.distributeProgress();
  const pl = g.players[0];
  assert.equal(pl.progressCards.length + pl.progressVP, 1);
  // 等级不足的玩家拿不到
  assert.equal(g.players[1].progressCards.length, 0);
});

test('ck：掷出 7 时事件骰照常发进步卡（无产出、不触发引水渠）', () => {
  const g = newCK(3);
  doSetup(g);
  g.turn.player = 0;
  g.turn.state = 'preroll';
  g.players[0].improvements.science = 5; // 红骰 1-6 都能拿
  const before = g.players[0].progressCards.length + g.players[0].progressVP;
  g.roll(0, { d1: 3, d2: 4, eventDie: 'science' }); // 总点数 7 + 科学城门
  const pl = g.players[0];
  assert.equal(pl.progressCards.length + pl.progressVP, before + 1);
  assert.notEqual(g.turn.state, 'aqueduct'); // 掷 7 不触发引水渠
});

test('ck：回合外抽到第 5 张进步卡需立即弃到 4 张', () => {
  const g = newCK(3);
  doSetup(g);
  g.turn.player = 0;
  g.turn.state = 'preroll';
  g.players[1].improvements.politics = 5; // 红骰 1-6 都能拿
  g.players[1].progressCards = [
    { type: 'warlord', deck: 'politics' }, { type: 'spy', deck: 'politics' },
    { type: 'crane', deck: 'science' }, { type: 'smith', deck: 'science' },
  ];
  g.progressDecks.politics.push('deserter'); // 固定堆顶，避免抽到分数卡
  g.roll(0, { d1: 2, d2: 4, eventDie: 'politics' });
  assert.equal(g.turn.state, 'progressDiscard');
  assert.deepEqual(g.turn.pendingProgressDiscard, [1]);
  assert.equal(g.players[1].progressCards.length, 5);
  const before = g.progressDecks.politics.length;
  g.progressDiscardCard(1, 'warlord');
  assert.equal(g.players[1].progressCards.length, 4);
  assert.equal(g.progressDecks.politics.length, before + 1);
  assert.equal(g.progressDecks.politics[0], 'warlord'); // 放回牌堆底
  assert.equal(g.turn.state, 'main'); // 弃完继续掷骰结算
});

test('ck：自己回合内进步卡可暂超 4 张，结束回合时弃到 4 张', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  g.players[0].progressCards = [
    { type: 'warlord', deck: 'politics' }, { type: 'spy', deck: 'politics' },
    { type: 'crane', deck: 'science' }, { type: 'smith', deck: 'science' },
    { type: 'deserter', deck: 'politics' },
  ];
  g.endTurn(0);
  assert.equal(g.turn.state, 'progressDiscard'); // 不能直接结束
  assert.deepEqual(g.turn.pendingProgressDiscard, [0]);
  g.progressDiscardCard(0, 'spy');
  assert.equal(g.players[0].progressCards.length, 4);
  assert.equal(g.turn.player, 1); // 弃完自动完成结束回合
  assert.equal(g.turn.state, 'preroll');
});

test('ck：军阀免费激活所有骑士', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  const spots = g.validKnightSpots(0);
  g.knights[spots[0]] = {
    player: 0, level: 1, active: false,
    builtTurn: 0, promotedTurn: 0, activatedTurn: 0, actedTurn: 0,
  };
  g.players[0].progressCards.push({ type: 'warlord', deck: 'politics' });
  g.playProgress(0, 'warlord');
  assert.ok(g.knights[spots[0]].active);
  assert.equal(g.players[0].progressCards.length, 0);
});

test('ck：资源垄断每人最多收 2 张', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  g.players[1].hand.wheat = 3;
  g.players[2].hand.wheat = 1;
  g.players[0].progressCards.push({ type: 'resourceMonopoly', deck: 'trade' });
  const before = g.players[0].hand.wheat;
  g.playProgress(0, 'resourceMonopoly', { res: 'wheat' });
  assert.equal(g.players[0].hand.wheat, before + 3);
  assert.equal(g.players[1].hand.wheat, 1);
  assert.equal(g.players[2].hand.wheat, 0);
});

test('ck：炼金术士指定骰子点数', () => {
  const g = newCK(3);
  doSetup(g);
  g.turn.player = 0;
  g.turn.state = 'preroll';
  g.players[0].progressCards.push({ type: 'alchemist', deck: 'science' });
  g.playProgress(0, 'alchemist', { d1: 3, d2: 4 });
  assert.deepEqual(g.turn.dice, [3, 4]);
  assert.ok(g.turn.rolled);
});

test('ck：破坏者让分数不低于出牌者的玩家弃一半手牌', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  // 三人同分（3 分），全部受影响
  g.players[1].hand.wood = 4;
  g.players[0].progressCards.push({ type: 'saboteur', deck: 'politics' });
  g.playProgress(0, 'saboteur');
  assert.equal(g.turn.state, 'discard');
  assert.equal(g.turn.pendingDiscards[1], 2);
  g.discard(1, { wood: 2 });
  if (Object.keys(g.turn.pendingDiscards).length === 0) {
    assert.equal(g.turn.state, 'main'); // 弃完回到 main，不进强盗流程
  }
});

test('ck：医学卡用 2矿 1麦升级城市', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  const v = Number(Object.keys(g.buildings).find(
    (k) => g.buildings[k].player === 0 && g.buildings[k].type === 'settlement',
  ));
  g.players[0].hand.ore = 2;
  g.players[0].hand.wheat = 1;
  g.players[0].progressCards.push({ type: 'medicine', deck: 'science' });
  g.playProgress(0, 'medicine', { vertex: v });
  assert.equal(g.buildings[v].type, 'city');
  assert.equal(g.players[0].hand.ore, 0);
});

test('ck：引水渠在无产出时可任选资源', () => {
  const g = newCK(3);
  doSetup(g);
  g.players[0].improvements.science = 3;
  g.buildings = {}; // 清空建筑 → 无人有产出
  g.turn.player = 0;
  g.distribute(5);
  assert.deepEqual(g.turn.pendingAqueduct, [0]);
  g.turn.state = 'aqueduct';
  g.aqueductPick(0, 'ore');
  assert.equal(g.players[0].hand.ore, 1);
  assert.equal(g.turn.state, 'main');
});

test('ck：商人放置后 2:1 汇率与 +1 分', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  const hexes = g.board.hexes.filter((h) => ['forest', 'pasture', 'mountains', 'hills', 'fields'].includes(h.terrain)
    && g.board.vertices.some((v) => v.hexes.includes(h.id) && g.buildings[v.id]?.player === 0));
  assert.ok(hexes.length > 0);
  const vpBefore = g.victoryPoints(0, true);
  g.players[0].progressCards.push({ type: 'merchant', deck: 'trade' });
  g.playProgress(0, 'merchant', { hex: hexes[0].id });
  assert.equal(g.victoryPoints(0, true), vpBefore + 1);
  const res = { forest: 'wood', pasture: 'sheep', mountains: 'ore', hills: 'brick', fields: 'wheat' }[hexes[0].terrain];
  assert.equal(g.bankRate(0, res), 2);
});

test('ck：对手骑士截断最长道路', () => {
  const g = newCK(2, 9);
  doSetup(g);
  // 确定性构造：清空棋盘，沿邻接关系铺一条 5 段直路
  g.buildings = {};
  g.roads = {};
  const chainV = [0];
  const chainE = [];
  const usedV = new Set([0]);
  while (chainE.length < 5) {
    const v = chainV[chainV.length - 1];
    const eid = g.board.vertices[v].adjE.find((e) => {
      const edge = g.board.edges[e];
      const nv = edge.v1 === v ? edge.v2 : edge.v1;
      return !usedV.has(nv);
    });
    const edge = g.board.edges[eid];
    const nv = edge.v1 === chainV[chainV.length - 1] ? edge.v2 : edge.v1;
    chainE.push(eid);
    chainV.push(nv);
    usedV.add(nv);
  }
  for (const e of chainE) g.roads[e] = 0;
  g.updateLongestRoad();
  assert.equal(g.awards.longestRoad?.player, 0);
  // 玩家 1 的骑士放在链中点 → 两段都不足 5，奖励取消
  g.knights[chainV[2]] = {
    player: 1, level: 1, active: false,
    builtTurn: 0, promotedTurn: 0, activatedTurn: 0, actedTurn: 0,
  };
  g.updateLongestRoad();
  assert.equal(g.awards.longestRoad, null);
});

// 找一条 A-B-C 顶点链（均无建筑、两条边均无道路），用于构造骑士驱逐场景
function findChain(g) {
  for (const a of g.board.vertices) {
    if (g.buildings[a.id]) continue;
    for (const e1 of a.adjE) {
      if (g.roads[e1] !== undefined) continue;
      const ed1 = g.board.edges[e1];
      const b = ed1.v1 === a.id ? ed1.v2 : ed1.v1;
      if (g.buildings[b]) continue;
      for (const e2 of g.board.vertices[b].adjE) {
        if (e2 === e1 || g.roads[e2] !== undefined) continue;
        const ed2 = g.board.edges[e2];
        const c = ed2.v1 === b ? ed2.v2 : ed2.v1;
        if (c === a.id || g.buildings[c]) continue;
        return { a: a.id, b, c, e1, e2 };
      }
    }
  }
  throw new Error('找不到可用顶点链');
}

const mkKnight = (player, level, extra = {}) => ({
  player, level, active: false,
  builtTurn: 0, promotedTurn: 0, activatedTurn: 0, actedTurn: 0, ...extra,
});

test('ck：被驱逐骑士由主人沿自己路网重新安置', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  const { a, b, c, e1, e2 } = findChain(g);
  g.roads[e1] = 0;                       // 攻击方的路 A-B
  g.roads[e2] = 1;                       // 受害者的退路 B-C
  g.knights[a] = mkKnight(0, 2, { active: true });
  g.knights[b] = mkKnight(1, 1);
  g.moveKnight(0, a, b);
  assert.equal(g.turn.state, 'displace');
  assert.equal(g.turn.displace.owner, 1);
  assert.ok(g.turn.displace.options.includes(c));
  // 其他人不能代选，无效位置被拒绝
  assert.throws(() => g.placeDisplaced(2, c), /你不需要安置/);
  assert.throws(() => g.placeDisplaced(1, a), /无效的位置/);
  g.placeDisplaced(1, c);
  assert.equal(g.turn.state, 'main');
  assert.equal(g.knights[c].player, 1);
  assert.equal(g.knights[c].level, 1);
  assert.equal(g.knights[b].player, 0); // 攻击方骑士占据原位
});

test('ck：被驱逐骑士无处可放则移回补给区', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  const { a, b, e1 } = findChain(g);
  g.roads[e1] = 0;
  g.knights[a] = mkKnight(0, 2, { active: true });
  g.knights[b] = mkKnight(1, 1);         // 受害者没有自己的路
  g.moveKnight(0, a, b);
  assert.equal(g.turn.state, 'main');    // 不进入安置状态
  assert.equal(g.knights[b].player, 0);
  assert.equal(Object.values(g.knights).filter((k) => k.player === 1).length, 0);
});

test('ck：多座城市时大都会由玩家自选', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  // 给玩家 0 加第二座城市
  const spare = g.board.vertices.find((v) => !g.buildings[v.id]).id;
  g.buildings[spare] = { player: 0, type: 'city' };
  g.players[0].improvements.trade = 3;
  g.players[0].hand.cloth = 4;
  g.buyImprovement(0, 'trade');
  assert.equal(g.turn.state, 'metropolis');
  assert.equal(g.metropolis.trade, null);
  const opts = g.turn.metroChoice.options;
  assert.equal(opts.length, 2);
  const vpBefore = g.victoryPoints(0, true);
  g.chooseMetropolis(0, spare);
  assert.equal(g.turn.state, 'main');
  assert.equal(g.metropolis.trade.vertex, spare);
  assert.equal(g.victoryPoints(0, true), vpBefore + 2);
});

test('ck：商业大亨查看手牌并自选 2 张', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  g.players[1].defenderVP = 2; // 让对方分数更高
  g.players[1].hand = g.blankHand();
  g.players[1].hand.wood = 1;
  g.players[1].hand.cloth = 2;
  g.players[0].progressCards.push({ type: 'masterMerchant', deck: 'trade' });
  g.playProgress(0, 'masterMerchant', { target: 1 });
  assert.equal(g.turn.state, 'pickCards');
  assert.throws(() => g.pickCard(0, 'ore'), /对方没有这张牌/);
  g.pickCard(0, 'cloth');
  assert.equal(g.turn.state, 'pickCards');
  g.pickCard(0, 'wood');
  assert.equal(g.turn.state, 'main');
  assert.equal(g.players[1].hand.wood, 0);
  assert.equal(g.players[1].hand.cloth, 1);
});

test('ck：间谍查看并自选进步卡', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  g.players[1].progressCards.push({ type: 'warlord', deck: 'politics' }, { type: 'bishop', deck: 'politics' });
  g.players[0].progressCards.push({ type: 'spy', deck: 'politics' });
  g.playProgress(0, 'spy', { target: 1 });
  assert.equal(g.turn.state, 'pickProgress');
  g.pickProgressCard(0, 'bishop');
  assert.equal(g.turn.state, 'main');
  assert.deepEqual(g.players[0].progressCards.map((c) => c.type), ['bishop']);
  assert.deepEqual(g.players[1].progressCards.map((c) => c.type), ['warlord']);
});

test('ck：婚礼由送礼方自选上缴的牌', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  g.players[1].defenderVP = 2;
  g.players[2].defenderVP = 2;
  g.players[1].hand = g.blankHand();
  g.players[1].hand.ore = 3;
  g.players[2].hand = g.blankHand();
  g.players[2].hand.paper = 1; // 只有 1 张，交 1 张即完成
  g.players[0].hand = g.blankHand();
  g.players[0].progressCards.push({ type: 'wedding', deck: 'politics' });
  g.playProgress(0, 'wedding');
  assert.equal(g.turn.state, 'wedding');
  assert.deepEqual(g.turn.pendingGive, { 1: 2, 2: 1 });
  g.weddingGive(1, 'ore');
  g.weddingGive(1, 'ore');
  assert.equal(g.turn.pendingGive[1], undefined);
  g.weddingGive(2, 'paper');
  assert.equal(g.turn.state, 'main');
  assert.equal(g.players[0].hand.ore, 2);
  assert.equal(g.players[0].hand.paper, 1);
});

test('ck：商业港逐个交换（我选资源、对方选商品）', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  g.players[0].hand = g.blankHand();
  g.players[0].hand.wood = 2;
  g.players[1].hand = g.blankHand();
  g.players[1].hand.cloth = 1;
  g.players[2].hand = g.blankHand(); // 无商品，不进队列
  g.players[0].progressCards.push({ type: 'commercialHarbor', deck: 'trade' });
  g.playProgress(0, 'commercialHarbor');
  assert.equal(g.turn.state, 'harbor');
  assert.throws(() => g.harborTake(1, 'cloth'), /还没轮到你/);
  g.harborGive(0, 'wood');
  assert.throws(() => g.harborGive(0, 'wood'), /等待对方/);
  g.harborTake(1, 'cloth');
  assert.equal(g.turn.state, 'main'); // 队列只有玩家 1
  assert.equal(g.players[0].hand.cloth, 1);
  assert.equal(g.players[0].hand.wood, 1);
  assert.equal(g.players[1].hand.wood, 1);
  assert.equal(g.players[1].hand.cloth, 0);
});

test('ck：村庄棋子用完时被拆的城市直接移除', () => {
  const g = newCK(3);
  doSetup(g);
  const cityV = Number(Object.keys(g.buildings).find(
    (v) => g.buildings[v].player === 0 && g.buildings[v].type === 'city',
  ));
  g.players[0].pieces.settlement = 0;
  const citiesBefore = g.players[0].pieces.city;
  g.pillageCity(cityV);
  assert.equal(g.buildings[cityV], undefined);
  assert.equal(g.players[0].pieces.city, citiesBefore + 1);
});

test('ck：防御并列第一时各自选颜色抽进步卡', () => {
  const g = newCK(3);
  doSetup(g);
  // 兵力 = 3 座城市；0/1 各一名激活的 2 级骑士 → 防御 4，并列第一
  const v0 = g.validKnightSpots(0)[0];
  const v1 = g.validKnightSpots(1).find((v) => v !== v0);
  g.knights[v0] = mkKnight(0, 2, { active: true });
  g.knights[v1] = mkKnight(1, 2, { active: true });
  const paused = g.resolveBarbarianAttack(6);
  assert.equal(paused, true);
  assert.equal(g.turn.state, 'defenderPick');
  assert.deepEqual(g.turn.pendingDefenderPick, [0, 1]);
  assert.equal(g.players[0].defenderVP, 0); // 并列不发守护者分
  assert.throws(() => g.defenderPickDeck(2, 'trade'), /你不需要选择/);
  assert.throws(() => g.defenderPickDeck(0, 'wood'), /请选择一种进步卡/);
  const before = g.progressDecks.trade.length;
  g.defenderPickDeck(0, 'trade');
  assert.equal(g.progressDecks.trade.length, before - 1);
  assert.equal(g.turn.state, 'defenderPick'); // 还等玩家 1
  assert.throws(() => g.defenderPickDeck(0, 'trade'), /你不需要选择/); // 不能重复选
  g.progressDecks.politics = [];
  assert.throws(() => g.defenderPickDeck(1, 'politics'), /该牌堆已空/);
  g.defenderPickDeck(1, 'science');
  assert.equal(g.turn.state, 'main'); // 全部选完，掷骰结算继续
  assert.equal(g.turn.pendingDefenderPick.length, 0);
});

test('ck：用掉的进步卡放回牌堆底部', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  g.players[0].progressCards.push({ type: 'merchantFleet', deck: 'trade' });
  const len = g.progressDecks.trade.length;
  g.playProgress(0, 'merchantFleet', { res: 'wood' });
  assert.equal(g.players[0].progressCards.length, 0);
  assert.equal(g.progressDecks.trade.length, len + 1);
  assert.equal(g.progressDecks.trade[0], 'merchantFleet'); // 抽牌从末端 pop，index 0 即牌堆底
});

test('ck：逃兵由受害者选骑士，出牌者放置同级骑士', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  // 玩家 1 有两名骑士（1 级与 2 级）
  const v1 = g.validKnightSpots(1)[0];
  const v2 = g.validKnightSpots(1).find((v) => v !== v1);
  g.knights[v1] = mkKnight(1, 1);
  g.knights[v2] = mkKnight(1, 2);
  g.players[0].progressCards.push({ type: 'deserter', deck: 'politics' });
  assert.throws(() => g.playProgress(0, 'deserter', { target: 2 }), /该玩家没有骑士/);
  g.playProgress(0, 'deserter', { target: 1 });
  assert.equal(g.turn.state, 'deserterPick');
  assert.throws(() => g.deserterPick(0, v1), /你不需要选择/); // 出牌者不能替受害者选
  assert.throws(() => g.deserterPick(1, 999), /请选择你自己的骑士/);
  g.deserterPick(1, v2); // 受害者交出 2 级骑士
  assert.equal(g.knights[v2], undefined);
  // 出牌者进入放置状态，获得同级（2 级）骑士
  assert.equal(g.turn.state, 'displace');
  assert.equal(g.turn.displace.owner, 0);
  assert.equal(g.turn.displace.knight.level, 2);
  assert.equal(g.turn.displace.reason, 'deserter');
  const spot = g.turn.displace.options[0];
  g.placeDisplaced(0, spot);
  assert.equal(g.knights[spot].player, 0);
  assert.equal(g.knights[spot].level, 2);
  assert.equal(g.knights[spot].active, false);
  assert.equal(g.turn.state, 'main');
  // 本回合获得的骑士不能升级（builtTurn 生效）
  g.players[0].hand.sheep = 1; g.players[0].hand.ore = 1;
  assert.throws(() => g.upgradeKnight(0, spot), /本回合招募/);
});

test('ck：逃兵出牌者无可用棋子时受害者仍失去骑士', () => {
  const g = newCK(3);
  doSetup(g);
  forceMain(g);
  // 玩家 0 的 1 级骑士棋子占满（2 名），受害者交出 1 级骑士 → 无法获得
  const s0 = g.validKnightSpots(0);
  g.knights[s0[0]] = mkKnight(0, 1);
  g.knights[s0[1]] = mkKnight(0, 1);
  const v1 = g.validKnightSpots(1).find((v) => !g.knights[v]);
  g.knights[v1] = mkKnight(1, 1);
  g.players[0].progressCards.push({ type: 'deserter', deck: 'politics' });
  g.playProgress(0, 'deserter', { target: 1 });
  g.deserterPick(1, v1);
  assert.equal(g.knights[v1], undefined); // 受害者照样失去
  assert.equal(g.turn.state, 'main');     // 出牌者拿不到，直接回到 main
});

test('ck：客户端 PROG_META 覆盖全部进步卡类型（含分数卡）', async () => {
  const fs = await import('node:fs');
  const { PROGRESS_NAME } = await import('../server/ck.js');
  const src = fs.readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
  const m = src.match(/const PROG_META = \{([\s\S]*?)\n\};/);
  assert.ok(m, '找不到 PROG_META 定义');
  const clientTypes = new Set([...m[1].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]));
  for (const type of Object.keys(PROGRESS_NAME)) {
    assert.ok(clientTypes.has(type), `客户端 PROG_META 缺少 ${type}（${PROGRESS_NAME[type]}）`);
  }
});
