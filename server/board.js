// 棋盘生成：19 块陆地六边形（尖顶朝上），顶点/边去重，港口沿海岸放置。
import { TERRAIN_POOL, NUMBER_SPIRAL, HARBOR_POOL } from './constants.js';

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

export function generateBoard(rng = Math.random) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const board = tryGenerate(rng);
    if (board) return board;
  }
  throw new Error('board generation failed');
}

function tryGenerate(rng) {
  const coords = spiralHexCoords(rng);
  const terrains = shuffle(TERRAIN_POOL, rng);

  // 沿螺旋放数字，沙漠跳过
  const hexes = [];
  let ni = 0;
  coords.forEach(([q, r], i) => {
    const terrain = terrains[i];
    const number = terrain === 'desert' ? null : NUMBER_SPIRAL[ni++];
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
  const gaps = [3, 4, 3, 3, 4, 3, 3, 4, 3];
  const types = shuffle(HARBOR_POOL, rng);
  const startOffset = Math.floor(rng() * ring.length);
  const harbors = [];
  let idx = startOffset;
  for (let i = 0; i < 9; i++) {
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
