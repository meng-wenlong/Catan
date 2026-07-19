// 棋盘生成：19 块陆地六边形（尖顶朝上；5-6 人为 30 块加长六边形），顶点/边去重，港口沿海岸放置。
import {
  TERRAIN_POOL, NUMBER_SPIRAL, HARBOR_POOL,
  TERRAIN_POOL_56, NUMBER_SPIRAL_56, HARBOR_POOL_56,
} from './constants.js';

const SQRT3 = Math.sqrt(3);

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hexCenter(q, r) {
  return { x: SQRT3 * (q + r / 2), y: 1.5 * r };
}

// 尖顶六边形 6 个角（y 轴向下）
function hexCornerPoints(q, r) {
  const { x, y } = hexCenter(q, r);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push({ x: x + Math.cos(a), y: y + Math.sin(a) });
  }
  return pts;
}

const keyOf = (p) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

// 生成半径 2 的六边形地图坐标（19 格），按“从外圈螺旋向内”的顺序返回
function spiralHexCoords(rng) {
  const dirs = [
    [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1],
  ];
  const startDir = Math.floor(rng() * 6);
  const coords = [];
  for (let radius = 2; radius >= 1; radius--) {
    // 从某个角出发绕一圈
    let q = dirs[startDir][0] * radius;
    let r = dirs[startDir][1] * radius;
    for (let side = 0; side < 6; side++) {
      const d = dirs[(startDir + side + 2) % 6];
      for (let step = 0; step < radius; step++) {
        coords.push([q, r]);
        q += d[0];
        r += d[1];
      }
    }
  }
  coords.push([0, 0]);
  return coords;
}

// 5-6 人加长六边形：7 行 3-4-5-6-5-4-3 共 30 格（[r, qMin, qMax]）
const BIG_ROWS = [
  [-3, 0, 2], [-2, -1, 2], [-1, -2, 2], [0, -3, 2],
  [1, -3, 1], [2, -3, 0], [3, -3, -1],
];

// 大地图的外→内螺旋：逐层剥壳，把每层边界串成环（每层起点随机旋转）
function bigSpiralCoords(rng) {
  const all = [];
  for (const [r, q1, q2] of BIG_ROWS) for (let q = q1; q <= q2; q++) all.push([q, r]);
  const dirs = [
    [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1],
  ];
  const key = (q, r) => `${q},${r}`;
  const left = new Set(all.map(([q, r]) => key(q, r)));
  const out = [];
  while (left.size > 0) {
    const boundary = all.filter(([q, r]) => left.has(key(q, r))
      && dirs.some(([dq, dr]) => !left.has(key(q + dq, r + dr))));
    const visited = new Set();
    const ring = [];
    let cur = boundary[0];
    while (cur) {
      ring.push(cur);
      visited.add(key(cur[0], cur[1]));
      const [cq, cr] = cur;
      cur = boundary.find(([q, r]) => !visited.has(key(q, r))
        && dirs.some(([dq, dr]) => cq + dq === q && cr + dr === r));
    }
    for (const c of boundary) if (!visited.has(key(c[0], c[1]))) ring.push(c);
    const off = Math.floor(rng() * ring.length);
    for (const c of ring.slice(off).concat(ring.slice(0, off))) {
      out.push(c);
      left.delete(key(c[0], c[1]));
    }
  }
  return out;
}

export function generateBoard(rng = Math.random, big = false) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const board = tryGenerate(rng, big);
    if (board) return board;
  }
  throw new Error('board generation failed');
}

function tryGenerate(rng, big) {
  const coords = big ? bigSpiralCoords(rng) : spiralHexCoords(rng);
  const terrains = shuffle(big ? TERRAIN_POOL_56 : TERRAIN_POOL, rng);
  const numberSpiral = big ? NUMBER_SPIRAL_56 : NUMBER_SPIRAL;

  // 沿螺旋放数字，沙漠跳过
  const hexes = [];
  let ni = 0;
  coords.forEach(([q, r], i) => {
    const terrain = terrains[i];
    const number = terrain === 'desert' ? null : numberSpiral[ni++];
    const { x, y } = hexCenter(q, r);
    hexes.push({ id: i, q, r, x, y, terrain, number });
  });

  // 顶点、边去重
  const vertexByKey = new Map();
  const vertices = [];
  const edgeByKey = new Map();
  const edges = [];

  for (const hex of hexes) {
    const corners = hexCornerPoints(hex.q, hex.r);
    const vids = corners.map((p) => {
      const k = keyOf(p);
      if (!vertexByKey.has(k)) {
        vertexByKey.set(k, vertices.length);
        vertices.push({ id: vertices.length, x: p.x, y: p.y, hexes: [], adjV: [], adjE: [] });
      }
      const vid = vertexByKey.get(k);
      vertices[vid].hexes.push(hex.id);
      return vid;
    });
    for (let i = 0; i < 6; i++) {
      const a = vids[i];
      const b = vids[(i + 1) % 6];
      const ek = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!edgeByKey.has(ek)) {
        edgeByKey.set(ek, edges.length);
        edges.push({ id: edges.length, v1: Math.min(a, b), v2: Math.max(a, b), hexes: [] });
      }
      edges[edgeByKey.get(ek)].hexes.push(hex.id);
    }
  }

  for (const e of edges) {
    vertices[e.v1].adjV.push(e.v2);
    vertices[e.v2].adjV.push(e.v1);
    vertices[e.v1].adjE.push(e.id);
    vertices[e.v2].adjE.push(e.id);
  }

  // 校验：6 和 8 不相邻（共享顶点的两块地不同时为红色数字）
  const red = new Set(hexes.filter((h) => h.number === 6 || h.number === 8).map((h) => h.id));
  for (const v of vertices) {
    const reds = v.hexes.filter((h) => red.has(h));
    if (reds.length > 1) return null;
  }

  // 海岸边环：只属于一块陆地的边，按顺序连成环后放置港口
  const coastal = edges.filter((e) => e.hexes.length === 1);
  const ring = orderCoastalRing(coastal, vertices);
  // 港口间距沿海岸环分布：基础版海岸 30 边放 9 港，大地图 38 边放 11 港
  const gaps = big ? [3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3] : [3, 4, 3, 3, 4, 3, 3, 4, 3];
  const types = shuffle(big ? HARBOR_POOL_56 : HARBOR_POOL, rng);
  const startOffset = Math.floor(rng() * ring.length);
  const harbors = [];
  let idx = startOffset;
  for (let i = 0; i < types.length; i++) {
    const e = ring[idx % ring.length];
    const hex = hexes[e.hexes[0]];
    const mx = (vertices[e.v1].x + vertices[e.v2].x) / 2;
    const my = (vertices[e.v1].y + vertices[e.v2].y) / 2;
    // 港口图标放在边中点向海一侧
    const dx = mx - hex.x;
    const dy = my - hex.y;
    const len = Math.hypot(dx, dy) || 1;
    harbors.push({
      edgeId: e.id,
      type: types[i],
      x: mx + (dx / len) * 0.65,
      y: my + (dy / len) * 0.65,
      vertices: [e.v1, e.v2],
    });
    idx += gaps[i];
  }

  const desert = hexes.find((h) => h.terrain === 'desert');
  return { hexes, vertices, edges, harbors, robber: desert.id };
}

function orderCoastalRing(coastal, vertices) {
  const remaining = new Set(coastal.map((e) => e.id));
  const byId = new Map(coastal.map((e) => [e.id, e]));
  const byVertex = new Map();
  for (const e of coastal) {
    for (const v of [e.v1, e.v2]) {
      if (!byVertex.has(v)) byVertex.set(v, []);
      byVertex.get(v).push(e.id);
    }
  }
  const ring = [];
  let cur = coastal[0];
  let joint = cur.v1;
  while (remaining.size > 0) {
    ring.push(cur);
    remaining.delete(cur.id);
    joint = cur.v1 === joint ? cur.v2 : cur.v1;
    const next = (byVertex.get(joint) || []).find((id) => remaining.has(id));
    if (next === undefined) break;
    cur = byId.get(next);
  }
  return ring;
}
