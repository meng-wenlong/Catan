// SVG 棋盘渲染：地形、数字、港口、棋子、强盗、可点击热点
const SVG_NS = 'http://www.w3.org/2000/svg';

const TERRAIN_COLOR = {
  forest: '#2d8a4e', hills: '#c2693e', pasture: '#8fce5a',
  fields: '#e9c548', mountains: '#97a1a8', desert: '#e3d3a3',
};
const TERRAIN_ICON = {
  forest: '🌲', hills: '🧱', pasture: '🐑', fields: '🌾', mountains: '⛰️', desert: '🏜️',
};
const HARBOR_LABEL = {
  any: '3:1', wood: '2:1🌲', brick: '2:1🧱', sheep: '2:1🐑', wheat: '2:1🌾', ore: '2:1🪨',
};

let svg, board;
const layers = {};
const roadEls = new Map();
const buildingEls = new Map(); // vertexId -> {el, type}
let robberEl = null;

// ---------- 缩放与平移 ----------
const MAX_ZOOM = 4;
let baseVB = null;   // 初始视野
let vb = null;       // 当前视野
let zoomBound = false;

function applyVB() {
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
}

function clampVB() {
  const minW = baseVB.w / MAX_ZOOM;
  vb.w = Math.min(baseVB.w, Math.max(minW, vb.w));
  vb.h = vb.w * (baseVB.h / baseVB.w);
  vb.x = Math.min(baseVB.x + baseVB.w - vb.w, Math.max(baseVB.x, vb.x));
  vb.y = Math.min(baseVB.y + baseVB.h - vb.h, Math.max(baseVB.y, vb.y));
}

function svgPoint(clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

let vbAnim = 0;
function animateVBTo(target, ms = 360) {
  cancelAnimationFrame(vbAnim);
  // 页面不可见时 rAF 会暂停，直接跳到目标视野
  if (document.hidden) {
    vb = { ...target };
    applyVB();
    return;
  }
  const start = { ...vb };
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - (1 - k) ** 3; // ease-out
    vb = {
      x: start.x + (target.x - start.x) * e,
      y: start.y + (target.y - start.y) * e,
      w: start.w + (target.w - start.w) * e,
      h: start.h + (target.h - start.h) * e,
    };
    applyVB();
    if (k < 1) vbAnim = requestAnimationFrame(step);
  };
  vbAnim = requestAnimationFrame(step);
}

// factor > 1 放大；(px, py) 为保持不动的棋盘坐标点；smooth 为按钮触发的平滑缩放
export function zoomAt(factor, px, py, smooth = px === undefined) {
  if (px === undefined) { px = vb.x + vb.w / 2; py = vb.y + vb.h / 2; }
  const target = {
    x: px - (px - vb.x) / factor,
    y: py - (py - vb.y) / factor,
    w: vb.w / factor,
    h: vb.h / factor,
  };
  const saved = vb;
  vb = target;
  clampVB();
  const clamped = vb;
  vb = saved;
  if (smooth) {
    animateVBTo(clamped);
  } else {
    cancelAnimationFrame(vbAnim);
    vb = clamped;
    applyVB();
  }
}

export function resetZoom() {
  animateVBTo({ ...baseVB });
}

function bindZoomControls() {
  if (zoomBound) return;
  zoomBound = true;

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = svgPoint(e.clientX, e.clientY);
    zoomAt(Math.exp(-e.deltaY * 0.0022), p.x, p.y);
  }, { passive: false });

  // 拖拽平移（支持双指捏合缩放）
  const pointers = new Map();
  let dragged = false;
  let pinchDist = 0;

  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    // 注意：不能在这里 setPointerCapture，否则 click 会被重定向到 svg 根元素，
    // 热点（放置点/强盗板块）就收不到点击了。仅在确认拖拽后才捕获。
    if (pointers.size === 1) dragged = false;
  });

  svg.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (pointers.size === 1) {
      const p0 = svgPoint(prev.x, prev.y);
      const p1 = svgPoint(e.clientX, e.clientY);
      if (!dragged && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 4) {
        dragged = true;
        svg.setPointerCapture(e.pointerId); // 拖出棋盘外也能继续平移
      }
      if (dragged) {
        vb.x -= p1.x - p0.x;
        vb.y -= p1.y - p0.y;
        clampVB();
        applyVB();
        svg.style.cursor = 'grabbing';
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0 && d > 0) {
        const mid = svgPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomAt(d / pinchDist, mid.x, mid.y);
        dragged = true;
      }
      pinchDist = d;
    }
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    pinchDist = 0;
    svg.style.cursor = '';
    // click 事件在 pointerup 之后同步触发，setTimeout 保证在其后重置，
    // 防止 click 未触发时 dragged 卡住吞掉下一次点击
    if (pointers.size === 0) setTimeout(() => { dragged = false; }, 0);
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  // 拖拽后抑制误触发的点击（捕获阶段先于热点的监听器执行）
  svg.addEventListener('click', (e) => {
    if (dragged) {
      e.stopPropagation();
      e.preventDefault();
      dragged = false;
    }
  }, true);

  svg.addEventListener('dblclick', (e) => {
    e.preventDefault();
    resetZoom();
  });
}

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

export function initBoard(svgElement, boardData) {
  svg = svgElement;
  board = boardData;
  svg.innerHTML = '';
  roadEls.clear();
  buildingEls.clear();

  const xs = board.vertices.map((v) => v.x);
  const ys = board.vertices.map((v) => v.y);
  const pad = 1.35;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - minX + pad;
  const h = Math.max(...ys) - minY + pad;
  baseVB = { x: minX, y: minY, w, h };
  vb = { ...baseVB };
  applyVB();
  bindZoomControls();

  for (const name of ['island', 'hexes', 'harbors', 'roads', 'buildings', 'robber', 'hotspots']) {
    layers[name] = el('g', { id: `layer-${name}` }, svg);
  }

  // 岛屿底座（沙滩色描边）
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  el('circle', { cx, cy, r: Math.max(w, h) / 2 + 0.1, fill: 'rgba(240,225,180,.25)' }, layers.island);

  for (const hex of board.hexes) {
    const pts = hexCornerString(hex);
    el('polygon', {
      points: pts, class: 'hex', fill: TERRAIN_COLOR[hex.terrain],
      'data-hex': hex.id,
    }, layers.hexes);
    const icon = el('text', {
      x: hex.x, y: hex.y - (hex.number ? 0.28 : 0.05),
      class: 'hex-icon', 'text-anchor': 'middle', 'dominant-baseline': 'middle',
    }, layers.hexes);
    icon.textContent = TERRAIN_ICON[hex.terrain];

    if (hex.number) {
      const g = el('g', {}, layers.hexes);
      el('circle', { cx: hex.x, cy: hex.y + 0.3, r: 0.3, class: 'token-circle' }, g);
      const red = hex.number === 6 || hex.number === 8;
      const num = el('text', {
        x: hex.x, y: hex.y + 0.38, class: `token-num${red ? ' red' : ''}`,
      }, g);
      num.textContent = hex.number;
      const dots = 6 - Math.abs(7 - hex.number);
      for (let i = 0; i < dots; i++) {
        el('circle', {
          cx: hex.x + (i - (dots - 1) / 2) * 0.075,
          cy: hex.y + 0.47, r: 0.025,
          class: `token-dots${red ? ' red' : ''}`,
        }, g);
      }
    }
  }

  for (const hb of board.harbors) {
    const [v1, v2] = hb.vertices.map((v) => board.vertices[v]);
    el('path', {
      d: `M ${v1.x} ${v1.y} L ${hb.x} ${hb.y} L ${v2.x} ${v2.y}`,
      class: 'harbor-line',
    }, layers.harbors);
    el('circle', { cx: hb.x, cy: hb.y, r: 0.26, class: 'harbor-badge' }, layers.harbors);
    const t = el('text', {
      x: hb.x, y: hb.y + (hb.type === 'any' ? 0.1 : 0.08),
      class: 'harbor-text',
    }, layers.harbors);
    if (hb.type === 'any') {
      t.textContent = '3:1';
    } else {
      t.setAttribute('font-size', '0.22');
      t.textContent = HARBOR_LABEL[hb.type];
    }
  }

  // 强盗棋子
  robberEl = el('g', { id: 'robber-piece' }, layers.robber);
  el('ellipse', { cx: 0, cy: 0.06, rx: 0.13, ry: 0.16, fill: '#3b3b46', class: 'piece' }, robberEl);
  el('circle', { cx: 0, cy: -0.14, r: 0.09, fill: '#3b3b46', class: 'piece' }, robberEl);
  el('ellipse', { cx: 0, cy: 0.2, rx: 0.17, ry: 0.05, fill: '#3b3b46', class: 'piece' }, robberEl);
}

function hexCornerString(hex) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${hex.x + Math.cos(a)},${hex.y + Math.sin(a)}`);
  }
  return pts.join(' ');
}

export function updateRobber(hexId) {
  const hex = board.hexes[hexId];
  robberEl.style.transform = `translate(${hex.x - 0.42}px, ${hex.y - 0.32}px)`;
}

export function updatePieces(state, colors) {
  // 道路
  for (const [eid, player] of Object.entries(state.roads)) {
    if (roadEls.has(eid)) continue;
    const e = board.edges[eid];
    const v1 = board.vertices[e.v1];
    const v2 = board.vertices[e.v2];
    const t1 = 0.18, t2 = 0.82;
    const x1 = v1.x + (v2.x - v1.x) * t1, y1 = v1.y + (v2.y - v1.y) * t1;
    const x2 = v1.x + (v2.x - v1.x) * t2, y2 = v1.y + (v2.y - v1.y) * t2;
    const g = el('g', { class: 'road-pop' }, layers.roads);
    el('line', { x1, y1, x2, y2, class: 'road-piece', stroke: 'rgba(0,0,0,.4)', 'stroke-width': '0.2' }, g);
    el('line', { x1, y1, x2, y2, class: 'road-piece', stroke: colors[player] }, g);
    roadEls.set(eid, g);
  }

  // 建筑
  for (const [vid, b] of Object.entries(state.buildings)) {
    const existing = buildingEls.get(vid);
    if (existing && existing.type === b.type) continue;
    if (existing) existing.el.remove();
    const v = board.vertices[vid];
    const g = el('g', { class: 'piece-pop' }, layers.buildings);
    if (b.type === 'settlement') {
      el('path', {
        d: `M ${v.x - 0.17} ${v.y + 0.15} L ${v.x - 0.17} ${v.y - 0.05} L ${v.x} ${v.y - 0.21}
            L ${v.x + 0.17} ${v.y - 0.05} L ${v.x + 0.17} ${v.y + 0.15} Z`,
        fill: colors[b.player], class: 'piece',
      }, g);
    } else {
      el('path', {
        d: `M ${v.x - 0.24} ${v.y + 0.17} L ${v.x - 0.24} ${v.y - 0.03} L ${v.x - 0.12} ${v.y - 0.03}
            L ${v.x - 0.12} ${v.y - 0.24} L ${v.x + 0.03} ${v.y - 0.24} L ${v.x + 0.03} ${v.y - 0.03}
            L ${v.x + 0.24} ${v.y - 0.03} L ${v.x + 0.24} ${v.y + 0.17} Z`,
        fill: colors[b.player], class: 'piece',
      }, g);
      el('circle', { cx: v.x + 0.13, cy: v.y + 0.06, r: 0.04, fill: 'rgba(255,255,255,.7)' }, g);
    }
    buildingEls.set(vid, { el: g, type: b.type });
  }

  updateRobber(state.robber);
}

// ---------- 热点交互 ----------
export function clearHotspots() {
  layers.hotspots.innerHTML = '';
  for (const p of layers.hexes.querySelectorAll('.hex')) p.classList.remove('robber-target');
}

export function showVertexSpots(vertexIds, onClick) {
  clearHotspots();
  for (const vid of vertexIds) {
    const v = board.vertices[vid];
    el('circle', { cx: v.x, cy: v.y, r: 0.16, class: 'spot-ring' }, layers.hotspots);
    const spot = el('circle', {
      cx: v.x, cy: v.y, r: 0.2, class: 'hotspot vertex-spot',
    }, layers.hotspots);
    spot.addEventListener('click', () => onClick(vid));
  }
}

export function showEdgeSpots(edgeIds, onClick) {
  clearHotspots();
  for (const eid of edgeIds) {
    const e = board.edges[eid];
    const v1 = board.vertices[e.v1];
    const v2 = board.vertices[e.v2];
    const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
    el('circle', { cx: mx, cy: my, r: 0.13, class: 'spot-ring' }, layers.hotspots);
    const spot = el('circle', { cx: mx, cy: my, r: 0.17, class: 'hotspot' }, layers.hotspots);
    spot.addEventListener('click', () => onClick(eid));
  }
}

export function showRobberSpots(currentRobber, onClick) {
  clearHotspots();
  for (const p of layers.hexes.querySelectorAll('.hex')) {
    const hid = Number(p.dataset.hex);
    if (hid === currentRobber) continue;
    p.classList.add('robber-target');
    p.onclick = () => {
      onClick(hid);
      for (const q of layers.hexes.querySelectorAll('.hex')) {
        q.classList.remove('robber-target');
        q.onclick = null;
      }
    };
  }
}

// 高亮本轮产出资源的板块（被强盗占的不亮）
export function highlightProducingHexes(total, robberHex) {
  for (const p of layers.hexes.querySelectorAll('.hex')) {
    const hid = Number(p.dataset.hex);
    const hex = board.hexes[hid];
    if (hex.number === total && hid !== robberHex) {
      p.classList.remove('producing');
      void p.getBoundingClientRect(); // 重置动画
      p.classList.add('producing');
      setTimeout(() => p.classList.remove('producing'), 5400);
    }
  }
}

export function hexPixelPosition(hexId, svgElement) {
  // 将棋盘坐标换算为屏幕坐标（用于飘字动画）
  const hex = board.hexes[hexId];
  const pt = svgElement.createSVGPoint();
  pt.x = hex.x; pt.y = hex.y;
  const ctm = svgElement.querySelector('#layer-hexes')?.getScreenCTM();
  if (!ctm) return null;
  return pt.matrixTransform(ctm);
}
