// SVG 棋盘渲染：地形、数字、港口、棋子、强盗、可点击热点
const SVG_NS = 'http://www.w3.org/2000/svg';

// 地形板块用设计师插画（tile-*.webp）；渐变色块垫在图片下面作加载失败的兜底
const TERRAIN_GRAD = {
  forest: ['#4fae6e', '#2a8449'], hills: ['#dc9a6b', '#b96a3f'], pasture: ['#b6e380', '#84bd4d'],
  fields: ['#f5d76e', '#dcae33'], mountains: ['#b7c0c8', '#8493a0'], desert: ['#efe0b0', '#d8c081'],
};
// 尖顶六边形外接圆半径 1 时的宽度（板块图按此比例绘制：887×1024 ≈ √3:2）
const HEX_W = Math.sqrt(3);

let svg, board;
let vpG = null; // 包住全部内容的视口组：平移缩放改它的 transform，而不是 svg 的 viewBox
const layers = {};
const roadEls = new Map();
const buildingEls = new Map(); // vertexId -> {el, type}
let robberEl = null;
let isle = null;     // 岛屿几何 {cx, cy, hexR}，野蛮人航道定位用
let barbEls = null;  // 野蛮人航道的持久元素（船用 transform 过渡动画，不能每次重建）
let deckEls = null;  // 进步卡牌堆的持久元素 {pos, count, prev}（计数变化时播放 bump 动画）
let impEls = null;   // 城市升级面板的持久元素（左下角，点击打开升级弹窗）

// ---------- 缩放与平移 ----------
const MAX_ZOOM = 4;
let baseVB = null;   // 初始视野
let vb = null;       // 当前视野
let zoomBound = false;

// viewBox 保持 baseVB 不变，视野变化通过 viewport 组的 transform 表达。
// 不能每帧改 viewBox：Chrome 会因此丢弃整个 SVG 的绘制缓存并异步重解码 <image>，
// 放大后拖动时来不及重画就闪白（Safari 同步光栅化无此问题）。transform 走合成器，无闪烁。
function applyVB() {
  const s = baseVB.w / vb.w;
  vpG.setAttribute('transform',
    `translate(${baseVB.x - s * vb.x} ${baseVB.y - s * vb.y}) scale(${s})`);
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
  // 经 viewport 组反推，得到含当前平移缩放的棋盘坐标
  return pt.matrixTransform(vpG.getScreenCTM().inverse());
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

// 渐变定义：地形、沙滩、令牌面（token-face 同时供 CSS 里 .token-circle / .harbor-badge 引用）
function buildDefs() {
  const defs = el('defs', {}, svg);
  for (const [name, [c1, c2]] of Object.entries(TERRAIN_GRAD)) {
    const g = el('radialGradient', { id: `terra-${name}`, cx: '50%', cy: '40%', r: '78%' }, defs);
    el('stop', { offset: '0%', 'stop-color': c1 }, g);
    el('stop', { offset: '100%', 'stop-color': c2 }, g);
  }
  const sand = el('radialGradient', { id: 'island-sand' }, defs);
  el('stop', { offset: '72%', 'stop-color': '#f0e2b3' }, sand);
  el('stop', { offset: '92%', 'stop-color': '#e5cf95' }, sand);
  el('stop', { offset: '100%', 'stop-color': '#d5b878' }, sand);
  const tok = el('radialGradient', { id: 'token-face', cx: '50%', cy: '38%', r: '72%' }, defs);
  el('stop', { offset: '0%', 'stop-color': '#fdf7e4' }, tok);
  el('stop', { offset: '100%', 'stop-color': '#ebd9ab' }, tok);
}

// 不规则「岛屿轮廓」：圆周叠加几组正弦扰动，确定性生成（每局形状一致）
function blobPath(cx, cy, r0, amp, seed) {
  const pts = [];
  const N = 48;
  for (let i = 0; i < N; i++) {
    const t = (Math.PI * 2 * i) / N;
    const r = r0 + amp * (Math.sin(3 * t + seed) * 0.55
      + Math.sin(7 * t + seed * 2.3) * 0.3
      + Math.sin(11 * t + seed * 4.1) * 0.15);
    pts.push(`${(cx + Math.cos(t) * r).toFixed(3)} ${(cy + Math.sin(t) * r * 0.98).toFixed(3)}`);
  }
  return `M ${pts.join(' L ')} Z`;
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
  svg.setAttribute('viewBox', `${baseVB.x} ${baseVB.y} ${baseVB.w} ${baseVB.h}`);
  bindZoomControls();

  buildDefs();
  vpG = el('g', { id: 'viewport' }, svg);
  applyVB();
  for (const name of ['island', 'barb', 'decks', 'improve', 'hexes', 'harbors', 'roads', 'walls', 'buildings', 'knights', 'marks', 'robber', 'hotspots']) {
    layers[name] = el('g', { id: `layer-${name}` }, vpG);
  }
  barbEls = null;
  deckEls = null;
  impEls = null;

  // 岛屿底座：不规则浅滩 + 沙滩海岸线（blob 形状确定性生成），外围点缀漂浮的浪花
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const hexR = Math.max(...board.hexes.map((hx) => Math.hypot(hx.x - cx, hx.y - cy))) + 1;
  isle = { cx, cy, hexR };
  el('path', {
    d: blobPath(cx, cy, hexR + 0.62, 0.18, 1.3), fill: 'rgba(195,232,244,.32)',
    stroke: 'rgba(255,255,255,.45)', 'stroke-width': 0.035, 'stroke-dasharray': '.16 .12',
  }, layers.island);
  el('path', {
    d: blobPath(cx, cy, hexR + 0.22, 0.1, 2.6), fill: 'url(#island-sand)',
    stroke: 'rgba(150,120,60,.35)', 'stroke-width': 0.028,
  }, layers.island);
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI / 6) * i + 0.33;
    const wr = hexR + 0.85 + (i % 3) * 0.2;
    const wx = cx + Math.cos(a) * wr;
    const wy = cy + Math.sin(a) * wr * 0.9;
    const wave = el('path', { d: `M ${wx - 0.16} ${wy} q .08 -.09 .16 0 q .08 .09 .16 0`, class: 'sea-wave' }, layers.island);
    wave.style.animationDelay = `${(i % 5) * 0.9}s`;
  }

  for (const hex of board.hexes) {
    // 每块地一个组，自下而上：兜底色块 → 插画板块 → 闪光罩 → 数字令牌 → 透明点击热区
    // 热区放最上层，悬停描边才不会被板块图盖住；板块图自带羊皮纸边框和裁切好的留白
    const g = el('g', { class: 'hexgroup' }, layers.hexes);
    const pts = hexCornerString(hex, 0.965);
    el('polygon', { points: pts, class: 'hex-fallback', fill: `url(#terra-${hex.terrain})` }, g);
    el('image', {
      href: `/assets/opt/tile-${hex.terrain}.webp`,
      x: hex.x - HEX_W / 2, y: hex.y - 1, width: HEX_W, height: 2,
      class: 'hex-img',
    }, g);
    // 产出闪光罩：Safari 不支持对 SVG 子元素做 CSS filter 动画，改为叠白色罩闪 opacity
    el('polygon', { points: pts, class: 'hex-shine', 'data-hex': hex.id }, g);

    if (hex.number) {
      // 偏移一点的暗色圆充当阴影（不能用 filter 投影，Safari 不支持）
      el('circle', { cx: hex.x + 0.02, cy: hex.y + 0.035, r: 0.3, fill: 'rgba(70,45,10,.26)' }, g);
      el('circle', { cx: hex.x, cy: hex.y, r: 0.3, class: 'token-circle' }, g);
      el('circle', { cx: hex.x, cy: hex.y, r: 0.255, class: 'token-ring' }, g);
      const red = hex.number === 6 || hex.number === 8;
      const num = el('text', {
        x: hex.x, y: hex.y + 0.08, class: `token-num${red ? ' red' : ''}`,
      }, g);
      num.textContent = hex.number;
      const dots = 6 - Math.abs(7 - hex.number);
      for (let i = 0; i < dots; i++) {
        el('circle', {
          cx: hex.x + (i - (dots - 1) / 2) * 0.075,
          cy: hex.y + 0.17, r: 0.025,
          class: `token-dots${red ? ' red' : ''}`,
        }, g);
      }
    }

    // 透明点击热区（强盗目标高亮描边也画在这层，保证盖在板块图之上）
    el('polygon', { points: pts, class: 'hex', 'data-hex': hex.id }, g);
  }

  for (const hb of board.harbors) {
    const [v1, v2] = hb.vertices.map((v) => board.vertices[v]);
    el('path', {
      d: `M ${v1.x} ${v1.y} L ${hb.x} ${hb.y} L ${v2.x} ${v2.y}`,
      class: 'harbor-line',
    }, layers.harbors);
    // 插画徽章（绳圈圆牌）+ 底部比例小签
    el('circle', { cx: hb.x + 0.02, cy: hb.y + 0.035, r: 0.33, fill: 'rgba(70,45,10,.22)' }, layers.harbors);
    el('image', {
      href: `/assets/opt/harbor-${hb.type}.webp`,
      x: hb.x - 0.36, y: hb.y - 0.36, width: 0.72, height: 0.72,
      class: 'hex-img',
    }, layers.harbors);
    el('rect', {
      x: hb.x - 0.13, y: hb.y + 0.25, width: 0.26, height: 0.16, rx: 0.08,
      class: 'rate-pill',
    }, layers.harbors);
    const rate = el('text', { x: hb.x, y: hb.y + 0.365, class: 'harbor-text harbor-rate' }, layers.harbors);
    rate.textContent = hb.type === 'any' ? '3:1' : '2:1';
  }

  // 强盗棋子（插画雕像，g 的 transform 动画负责移动）
  // 底部接地点固定在 g 原点下方 0.2，放大时只往上长高，不遮住中心数字令牌
  robberEl = el('g', { id: 'robber-piece' }, layers.robber);
  el('image', {
    href: '/assets/opt/robber.webp',
    x: -0.24, y: -0.4, width: 0.48, height: 0.6,
    class: 'hex-img',
  }, robberEl);
}

function hexCornerString(hex, r = 1, dy = 0) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${hex.x + Math.cos(a) * r},${hex.y + Math.sin(a) * r + dy}`);
  }
  return pts.join(' ');
}

// 村庄 / 城市棋子的轮廓（正式棋子与悬停幽灵预览共用）
function settlementD(x, y) {
  return `M ${x - 0.17} ${y + 0.15} L ${x - 0.17} ${y - 0.05} L ${x} ${y - 0.21}
          L ${x + 0.17} ${y - 0.05} L ${x + 0.17} ${y + 0.15} Z`;
}
function cityD(x, y) {
  return `M ${x - 0.24} ${y + 0.17} L ${x - 0.24} ${y - 0.03} L ${x - 0.12} ${y - 0.03}
          L ${x - 0.12} ${y - 0.24} L ${x + 0.03} ${y - 0.24} L ${x + 0.03} ${y - 0.03}
          L ${x + 0.24} ${y - 0.03} L ${x + 0.24} ${y + 0.17} Z`;
}

export function updateRobber(hexId) {
  const hex = board.hexes[hexId];
  robberEl.style.transform = `translate(${hex.x - 0.42}px, ${hex.y - 0.32}px)`;
}

export function updatePieces(state, colors) {
  // 被移除的道路（外交官卡）
  for (const [eid, g] of [...roadEls]) {
    if (state.roads[eid] === undefined) {
      g.remove();
      roadEls.delete(eid);
    }
  }
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
      el('path', { d: settlementD(v.x, v.y), fill: colors[b.player], class: 'piece' }, g);
    } else {
      el('path', { d: cityD(v.x, v.y), fill: colors[b.player], class: 'piece' }, g);
      el('circle', { cx: v.x + 0.13, cy: v.y + 0.06, r: 0.04, fill: 'rgba(255,255,255,.7)' }, g);
    }
    buildingEls.set(vid, { el: g, type: b.type });
  }

  updateRobber(state.robber);
}

// ---------- 城市与骑士棋子（骑士/城墙/大都会/商人） ----------
// onKnightClick(vertexId, knight)：骑士被点击（自己的骑士菜单 / 进步卡选择目标）
export function updateCKPieces(state, colors, onKnightClick) {
  if (!state.ck) return;
  // 城墙：城市底下的一圈护环
  layers.walls.innerHTML = '';
  for (const [vid, owner] of Object.entries(state.ck.walls)) {
    const v = board.vertices[vid];
    el('circle', {
      cx: v.x, cy: v.y + 0.02, r: 0.3, class: 'wall-ring',
      stroke: colors[owner],
    }, layers.walls);
  }

  // 骑士：圆形棋子 + 等级数字；激活亮金边，未激活灰暗
  layers.knights.innerHTML = '';
  for (const [vid, k] of Object.entries(state.ck.knights)) {
    const v = board.vertices[vid];
    const g = el('g', { class: `knight-piece${k.active ? ' active' : ' idle'}` }, layers.knights);
    el('circle', { cx: v.x, cy: v.y + 0.02, r: 0.17, fill: 'rgba(0,0,0,.4)' }, g);
    el('circle', { cx: v.x, cy: v.y, r: 0.17, fill: colors[k.player], class: 'knight-body' }, g);
    el('circle', { cx: v.x, cy: v.y, r: 0.17, class: 'knight-ring' }, g);
    const t = el('text', { x: v.x, y: v.y + 0.062, class: 'knight-lv' }, g);
    t.textContent = k.level;
    if (onKnightClick) {
      g.style.cursor = 'pointer';
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onKnightClick(Number(vid), k);
      });
    }
  }

  // 大都会：城市上方的金星；商人：板块上的商栈标记
  layers.marks.innerHTML = '';
  for (const m of Object.values(state.ck.metropolis)) {
    if (!m) continue;
    const v = board.vertices[m.vertex];
    const t = el('text', { x: v.x, y: v.y - 0.28, class: 'metro-star' }, layers.marks);
    t.textContent = '★';
  }
  if (state.ck.merchant) {
    const hex = board.hexes[state.ck.merchant.hex];
    const g = el('g', { class: 'merchant-mark' }, layers.marks);
    el('circle', {
      cx: hex.x + 0.45, cy: hex.y - 0.45, r: 0.19, class: 'merchant-bg',
      stroke: colors[state.ck.merchant.player],
    }, g);
    const t = el('text', { x: hex.x + 0.45, y: hex.y - 0.38, class: 'merchant-ico' }, g);
    t.textContent = '⛺';
  }
}

// ---------- 野蛮人航道（画在海面上，随棋盘缩放平移） ----------
// ck 传 null 时清除；船的位置用 transform 过渡，元素持久化避免重建打断动画
export function updateBarbarianTrack(ck, strength, defense) {
  const layer = layers.barb;
  if (!layer) return;
  if (!ck) {
    layer.innerHTML = '';
    barbEls = null;
    return;
  }
  const { pos, track } = ck.barbarians;
  if (!barbEls) {
    layer.innerHTML = '';
    const { cx, cy, hexR } = isle;
    // 航线：从右下角外海出发，沿岛的东侧海带逆时针绕到东北岸登陆。
    // 参数化取点（角度 40° → -50°，半径由外海渐收到近岸），t ∈ [0,1]
    const pt = (t) => {
      const a = (Math.PI / 180) * (40 - 90 * t);
      const r = hexR + 1.3 - 1.0 * t;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.92 };
    };
    const samples = [];
    for (let i = 0; i <= 40; i++) samples.push(pt(i / 40));
    const d = `M ${samples.map((s) => `${s.x.toFixed(3)} ${s.y.toFixed(3)}`).join(' L ')}`;
    el('path', { d, class: 'barb-route' }, layer);
    const dots = [];
    for (let i = 1; i <= track; i++) {
      const s = pt(i / track);
      dots.push(el('circle', { cx: s.x, cy: s.y, r: 0.1, class: 'barb-step' }, layer));
    }
    // 🏰 vs ⚔️ 徽章挂在航线起点（右下角外海）下方
    const s0 = pt(0);
    const badge = el('g', {}, layer);
    el('rect', { x: s0.x - 1.0, y: s0.y + 0.42, width: 2.0, height: 0.56, rx: 0.28, class: 'barb-badge-bg' }, badge);
    const vs = el('text', { x: s0.x, y: s0.y + 0.81, class: 'barb-badge-text' }, badge);
    const ship = el('g', { class: 'barb-ship' }, layer);
    el('circle', { cx: 0, cy: 0.02, r: 0.27, class: 'barb-ship-bg' }, ship);
    const ico = el('text', { x: 0, y: 0.13, class: 'barb-ship-ico' }, ship);
    ico.textContent = '⛵';
    barbEls = { pt, dots, ship, vs };
  }
  barbEls.dots.forEach((d, i) => d.classList.toggle('passed', i + 1 <= pos));
  const s = barbEls.pt(pos / track);
  barbEls.ship.style.transform = `translate(${s.x}px, ${s.y}px)`;
  barbEls.vs.textContent = `🏰${strength} vs ⚔️${defense}`;
}

// ---------- 进步卡牌堆（画在棋盘左上角海面上，随棋盘缩放平移） ----------
const DECK_META = {
  trade: { name: '贸易', icon: '🧶', color: '#c9a227' },
  politics: { name: '政治', icon: '🪙', color: '#3a6ea5' },
  science: { name: '科学', icon: '📜', color: '#4a8c4a' },
};

// decks = { trade: n, politics: n, science: n }；传 null 时清除（基础版/初始放置阶段）
export function updateProgressDecks(decks) {
  const layer = layers.decks;
  if (!layer) return;
  if (!decks) {
    layer.innerHTML = '';
    deckEls = null;
    return;
  }
  if (!deckEls) {
    layer.innerHTML = '';
    // 左上角外海竖排三摞（野蛮人航道占了东侧，这里与之相对）
    const x0 = baseVB.x + 0.62;
    const y0 = baseVB.y + 0.78;
    deckEls = { pos: {}, count: {}, card: {}, prev: {} };
    Object.entries(DECK_META).forEach(([track, meta], i) => {
      const x = x0;
      const y = y0 + i * 1.0;
      deckEls.pos[track] = { x, y };
      const g = el('g', { class: 'pdeck' }, layer);
      // 两张错位垫底的“牌背”营造一摞的效果
      el('rect', {
        x: x - 0.24, y: y - 0.32, width: 0.48, height: 0.64, rx: 0.06,
        class: 'pdeck-back', fill: meta.color, transform: `rotate(-7 ${x} ${y})`,
      }, g);
      el('rect', {
        x: x - 0.24, y: y - 0.32, width: 0.48, height: 0.64, rx: 0.06,
        class: 'pdeck-back', fill: meta.color, transform: `rotate(4 ${x} ${y})`,
      }, g);
      const card = el('g', { class: 'pdeck-top' }, g);
      el('rect', {
        x: x - 0.24, y: y - 0.32, width: 0.48, height: 0.64, rx: 0.06,
        class: 'pdeck-card', fill: meta.color,
      }, card);
      el('rect', {
        x: x - 0.185, y: y - 0.265, width: 0.37, height: 0.53, rx: 0.04,
        class: 'pdeck-inner',
      }, card);
      const ico = el('text', { x, y: y - 0.03, class: 'pdeck-ico' }, card);
      ico.textContent = meta.icon;
      const cnt = el('text', { x, y: y + 0.215, class: 'pdeck-count' }, card);
      const title = el('title', {}, g);
      title.textContent = `${meta.name}进步卡牌堆`;
      deckEls.count[track] = cnt;
      deckEls.card[track] = card;
    });
  }
  for (const track of Object.keys(DECK_META)) {
    const n = decks[track] ?? 0;
    deckEls.count[track].textContent = `×${n}`;
    if (deckEls.prev[track] !== undefined && deckEls.prev[track] !== n) {
      const card = deckEls.card[track];
      card.classList.remove('bump');
      void card.getBoundingClientRect(); // 强制重算，重启动画
      card.classList.add('bump');
    }
    deckEls.prev[track] = n;
  }
}

// ---------- 城市升级面板（画在棋盘左下角海面上，点击打开升级弹窗） ----------
// data = { levels: {trade,politics,science}, metro: {track: 是否我的大都会} }；传 null 清除
export function updateImprovementPanel(data, onClick) {
  const layer = layers.improve;
  if (!layer) return;
  if (!data) {
    layer.innerHTML = '';
    impEls = null;
    return;
  }
  if (!impEls) {
    layer.innerHTML = '';
    const x0 = baseVB.x + 0.5;
    const yBot = baseVB.y + baseVB.h;
    const g = el('g', { class: 'imp-panel' }, layer);
    el('rect', {
      x: x0 - 0.16, y: yBot - 1.8, width: 2.06, height: 1.46, rx: 0.12,
      class: 'imp-panel-bg',
    }, g);
    impEls = { pips: {}, metro: {}, onClick: null };
    Object.entries(DECK_META).forEach(([track, meta], i) => {
      const y = yBot - 1.46 + i * 0.41;
      const ico = el('text', { x: x0 + 0.12, y: y + 0.075, class: 'imp-panel-ico' }, g);
      ico.textContent = meta.icon;
      impEls.pips[track] = [];
      for (let k = 0; k < 5; k++) {
        impEls.pips[track].push(el('rect', {
          x: x0 + 0.34 + k * 0.22, y: y - 0.085, width: 0.17, height: 0.17, rx: 0.03,
          class: 'imp-panel-pip',
        }, g));
      }
      const m = el('text', { x: x0 + 0.34 + 5 * 0.22 + 0.03, y: y + 0.07, class: 'imp-panel-metro' }, g);
      m.textContent = '🏛️';
      impEls.metro[track] = m;
    });
    const title = el('title', {}, g);
    title.textContent = '城市升级（点击查看/购买）';
    g.onclick = () => impEls?.onClick?.();
  }
  impEls.onClick = onClick;
  for (const [track, meta] of Object.entries(DECK_META)) {
    const lvl = data.levels[track] ?? 0;
    impEls.pips[track].forEach((r, k) => {
      r.style.fill = k < lvl ? meta.color : '';
    });
    impEls.metro[track].style.display = data.metro[track] ? '' : 'none';
  }
}

// 牌堆的屏幕坐标（抽牌/回牌飞行动画的起终点）
export function deckPixelPosition(track, svgElement) {
  if (!deckEls?.pos[track]) return null;
  const pt = svgElement.createSVGPoint();
  pt.x = deckEls.pos[track].x;
  pt.y = deckEls.pos[track].y;
  const ctm = layers.decks?.getScreenCTM();
  return ctm ? pt.matrixTransform(ctm) : null;
}

// ---------- 热点交互 ----------
export function clearHotspots() {
  layers.hotspots.innerHTML = '';
  // 强盗阶段挂在地块上的 onclick 也要清掉，否则之后点地块会发出非法的 moveRobber
  for (const p of layers.hexes.querySelectorAll('.hex')) {
    p.classList.remove('robber-target');
    p.onclick = null;
  }
}

// ghost = { kind: 'settlement' | 'city', color }：悬停热点时显示半透明的预览棋子
// （CSS 依赖 .ghost 紧跟 .hotspot 之后的兄弟选择器）
export function showVertexSpots(vertexIds, onClick, ghost) {
  clearHotspots();
  for (const vid of vertexIds) {
    const v = board.vertices[vid];
    el('circle', { cx: v.x, cy: v.y, r: 0.16, class: 'spot-ring' }, layers.hotspots);
    const spot = el('circle', {
      cx: v.x, cy: v.y, r: 0.2, class: 'hotspot vertex-spot',
    }, layers.hotspots);
    if (ghost) {
      el('path', {
        d: (ghost.kind === 'city' ? cityD : settlementD)(v.x, v.y),
        fill: ghost.color, class: 'ghost piece',
      }, layers.hotspots);
    }
    spot.addEventListener('click', () => onClick(vid));
  }
}

export function showEdgeSpots(edgeIds, onClick, ghost) {
  clearHotspots();
  for (const eid of edgeIds) {
    const e = board.edges[eid];
    const v1 = board.vertices[e.v1];
    const v2 = board.vertices[e.v2];
    const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
    el('circle', { cx: mx, cy: my, r: 0.13, class: 'spot-ring' }, layers.hotspots);
    const spot = el('circle', { cx: mx, cy: my, r: 0.17, class: 'hotspot' }, layers.hotspots);
    if (ghost) {
      const t1 = 0.18, t2 = 0.82;
      el('line', {
        x1: v1.x + (v2.x - v1.x) * t1, y1: v1.y + (v2.y - v1.y) * t1,
        x2: v1.x + (v2.x - v1.x) * t2, y2: v1.y + (v2.y - v1.y) * t2,
        stroke: ghost.color, class: 'ghost road-piece',
      }, layers.hotspots);
    }
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
      clearHotspots();
      onClick(hid);
    };
  }
}

// 指定板块列表可点击（商人放置 / 发明家换数字等）
export function showHexSpots(hexIds, onClick) {
  clearHotspots();
  const set = new Set(hexIds);
  for (const p of layers.hexes.querySelectorAll('.hex')) {
    const hid = Number(p.dataset.hex);
    if (!set.has(hid)) continue;
    p.classList.add('robber-target');
    p.onclick = () => {
      clearHotspots();
      onClick(hid);
    };
  }
}

// 高亮本轮产出资源的板块（被强盗占的不亮）：闪光罩闪烁 + 整块 tile 弹跳
export function highlightProducingHexes(total, robberHex) {
  for (const p of layers.hexes.querySelectorAll('.hex-shine')) {
    const hid = Number(p.dataset.hex);
    const hex = board.hexes[hid];
    if (hex.number === total && hid !== robberHex) {
      p.classList.remove('producing');
      void p.getBoundingClientRect(); // 重置动画
      p.classList.add('producing');
      setTimeout(() => p.classList.remove('producing'), 5400);
      const grp = p.parentNode;
      grp.classList.remove('hex-bounce');
      void grp.getBoundingClientRect();
      grp.classList.add('hex-bounce');
      setTimeout(() => grp.classList.remove('hex-bounce'), 1600);
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
