// 5-6 人扩展：大地图、银行/牌库扩容、特别建设阶段
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

function newGame(n, mode = 'base', seed = 42) {
  return new Game(
    Array.from({ length: n }, (_, i) => ({ name: `玩家${i + 1}` })),
    seeded(seed),
    0,
    mode,
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

function forceMain(g, p = 0) {
  g.turn.player = p;
  g.turn.state = 'main';
  g.turn.rolled = true;
}

function clearHands(g) {
  for (const pl of g.players) for (const r of Object.keys(pl.hand)) pl.hand[r] = 0;
}

test('5-6 人：大地图 30 格 / 28 数字 / 11 港 / 双沙漠，银行与牌库扩容', () => {
  const g = newGame(5);
  assert.equal(g.board.hexes.length, 30);
  assert.equal(g.board.hexes.filter((h) => h.number !== null).length, 28);
  assert.equal(g.board.hexes.filter((h) => h.terrain === 'desert').length, 2);
  assert.equal(g.board.harbors.length, 11);
  assert.equal(g.bank.wood, 24);
  assert.equal(g.devDeck.length, 34);
  const ck = newGame(6, 'ck');
  assert.equal(ck.board.hexes.length, 30);
  assert.equal(ck.bank.cloth, 18);
  // 3-4 人不受影响
  const small = newGame(4);
  assert.equal(small.board.hexes.length, 19);
  assert.equal(small.bank.wood, 19);
  assert.equal(small.devDeck.length, 25);
});

test('特别建设阶段：有建设能力的玩家依次开窗，可建造不可交易', () => {
  const g = newGame(5);
  doSetup(g);
  forceMain(g, 0);
  clearHands(g);
  g.players[2].hand.wood = 1;
  g.players[2].hand.brick = 1;
  g.endTurn(0);
  assert.equal(g.turn.state, 'specialBuild');
  assert.deepEqual(g.turn.sb.queue, [2]); // 只有玩家 2 付得起建设
  const e = g.validRoadEdges(2)[0];
  g.buildRoad(2, e);
  assert.equal(g.roads[e], 2);
  assert.throws(() => g.bankTrade(2, { wood: 4 }, { ore: 1 })); // 建设窗口不能交易
  g.sbPass(2);
  assert.equal(g.turn.player, 1); // 建设完毕才轮到下家
  assert.equal(g.turn.state, 'preroll');
});

test('特别建设阶段：无人能建设时直接进入下家回合', () => {
  const g = newGame(5);
  doSetup(g);
  forceMain(g, 0);
  clearHands(g);
  g.endTurn(0);
  assert.equal(g.turn.state, 'preroll');
  assert.equal(g.turn.player, 1);
});

test('特别建设阶段（ck）：可激活骑士但不能骑士行动', () => {
  const g = newGame(5, 'ck');
  doSetup(g);
  forceMain(g, 0);
  clearHands(g);
  const spot = g.validKnightSpots(1)[0];
  g.knights[spot] = {
    player: 1, level: 1, active: false,
    builtTurn: 0, promotedTurn: 0, activatedTurn: 0, actedTurn: 0,
  };
  g.players[1].hand.wheat = 1;
  g.endTurn(0);
  assert.equal(g.turn.state, 'specialBuild');
  assert.deepEqual(g.turn.sb.queue, [1]);
  g.activateKnight(1, spot);
  assert.ok(g.knights[spot].active);
  assert.throws(() => g.moveKnight(1, spot, 0)); // 建设窗口不能进行骑士行动
  g.sbPass(1);
  assert.equal(g.turn.player, 1);
  assert.equal(g.turn.state, 'preroll');
});

test('2-4 人局没有特别建设阶段', () => {
  const g = newGame(4);
  doSetup(g);
  forceMain(g, 0);
  for (const pl of g.players) { pl.hand.wood = 5; pl.hand.brick = 5; }
  g.endTurn(0);
  assert.equal(g.turn.state, 'preroll');
  assert.equal(g.turn.player, 1);
});
