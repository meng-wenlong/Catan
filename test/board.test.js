import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard } from '../server/board.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('棋盘结构：19 格 / 54 顶点 / 72 边 / 9 港口', () => {
  for (let s = 1; s <= 30; s++) {
    const b = generateBoard(seeded(s));
    assert.equal(b.hexes.length, 19);
    assert.equal(b.vertices.length, 54);
    assert.equal(b.edges.length, 72);
    assert.equal(b.harbors.length, 9);
  }
});

test('地形与数字分布正确', () => {
  const b = generateBoard(seeded(7));
  const count = {};
  for (const h of b.hexes) count[h.terrain] = (count[h.terrain] || 0) + 1;
  assert.deepEqual(count, { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 });
  const nums = b.hexes.filter((h) => h.number !== null).map((h) => h.number).sort((a, b2) => a - b2);
  assert.deepEqual(nums, [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
  const desert = b.hexes.find((h) => h.terrain === 'desert');
  assert.equal(desert.number, null);
  assert.equal(b.robber, desert.id);
});

test('6 和 8 从不相邻', () => {
  for (let s = 1; s <= 50; s++) {
    const b = generateBoard(seeded(s));
    const red = new Set(b.hexes.filter((h) => h.number === 6 || h.number === 8).map((h) => h.id));
    for (const v of b.vertices) {
      const reds = v.hexes.filter((h) => red.has(h));
      assert.ok(reds.length <= 1, `seed ${s}: 6/8 相邻`);
    }
  }
});

test('港口类型：4 个 3:1 + 5 种资源港', () => {
  const b = generateBoard(seeded(3));
  const types = b.harbors.map((h) => h.type).sort();
  assert.deepEqual(types, ['any', 'any', 'any', 'any', 'brick', 'ore', 'sheep', 'wheat', 'wood']);
  // 每个港口的边都是海岸边
  for (const hb of b.harbors) {
    assert.equal(b.edges[hb.edgeId].hexes.length, 1);
  }
});

test('顶点邻接：每个顶点 2-3 条邻边', () => {
  const b = generateBoard(seeded(11));
  for (const v of b.vertices) {
    assert.ok(v.adjE.length >= 2 && v.adjE.length <= 3);
    assert.equal(v.adjE.length, v.adjV.length);
  }
});
