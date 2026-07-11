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
let curState = null, curColors = null; // 放大镜取当前状态/配色的快照
// 各建筑白模「可视底部」在图内的纵向占比（模型底部留白不同，用于把底座精确落到顶点）
const BASE_FRAC = { settlement: 0.85, city: 0.93, 'city-walled': 0.93, metropolis: 0.96, 'metropolis-walled': 0.96 };

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

const CK_PANEL_W = 3.6; // ck 模式：左侧额外扩出的海面宽度（放进步卡牌堆 + 升级面板）

export function initBoard(svgElement, boardData, ck = false) {
  svg = svgElement;
  board = boardData;
  svg.innerHTML = '';
  roadEls.clear();
  buildingEls.clear();

  const xs = board.vertices.map((v) => v.x);
  const ys = board.vertices.map((v) => v.y);
  const pad = 1.35;
  const minX = Math.min(...xs) - pad - (ck ? CK_PANEL_W : 0);
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - minX + pad;
  const h = Math.max(...ys) - minY + pad;
  baseVB = { x: minX, y: minY, w, h };
  vb = { ...baseVB };
  svg.setAttribute('viewBox', `${baseVB.x} ${baseVB.y} ${baseVB.w} ${baseVB.h}`);
  bindZoomControls();
  initInspector();
  hideLoupe();

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
    attachInspect(g, { kind: 'hex', hex });
  }

  board.harbors.forEach((hb, idx) => {
    const [v1, v2] = hb.vertices.map((v) => board.vertices[v]);
    const hg = el('g', {}, layers.harbors);
    el('path', {
      d: `M ${v1.x} ${v1.y} L ${hb.x} ${hb.y} L ${v2.x} ${v2.y}`,
      class: 'harbor-line',
    }, hg);
    // 插画徽章（绳圈圆牌）+ 底部比例小签
    el('circle', { cx: hb.x + 0.02, cy: hb.y + 0.035, r: 0.33, fill: 'rgba(70,45,10,.22)' }, hg);
    el('image', {
      href: `/assets/opt/harbor-${hb.type}.webp`,
      x: hb.x - 0.36, y: hb.y - 0.36, width: 0.72, height: 0.72,
      class: 'hex-img',
    }, hg);
    el('rect', {
      x: hb.x - 0.13, y: hb.y + 0.25, width: 0.26, height: 0.16, rx: 0.08,
      class: 'rate-pill',
    }, hg);
    const rate = el('text', { x: hb.x, y: hb.y + 0.365, class: 'harbor-text harbor-rate' }, hg);
    rate.textContent = hb.type === 'any' ? '3:1' : '2:1';
    attachInspect(hg, { kind: 'harbor', idx });
  });

  // 强盗棋子（插画雕像，g 的 transform 动画负责移动）
  // 底部接地点固定在 g 原点下方 0.2，放大时只往上长高，不遮住中心数字令牌
  robberEl = el('g', { id: 'robber-piece' }, layers.robber);
  el('image', {
    href: '/assets/opt/robber.webp',
    x: -0.24, y: -0.4, width: 0.48, height: 0.6,
    class: 'hex-img',
  }, robberEl);
  attachInspect(robberEl, { kind: 'robber' });
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

// ---------- 放大镜（桌面：悬停停留 1.2s 升起；纯视觉、点得穿；覆盖棋盘元素与手牌卡） ----------
const DWELL_MS = 1200;       // 棋盘元素停留时长
const CARD_DWELL_MS = 500;   // 手牌卡停留时长（更快，像卡牌预览）
let loupeEl = null;
let cardPreviewEl = null;
let dwellTimer = 0;
let dwellTarget = null;
let inspectBound = false;

// 地形 → [中文名, 产出资源]；港口类型 → 资源中文名
const TERRAIN_INFO = {
  forest: ['森林', '木材'], hills: ['丘陵', '砖块'], pasture: ['牧场', '羊毛'],
  fields: ['农田', '小麦'], mountains: ['山地', '矿石'], desert: ['沙漠', null],
};
const HARBOR_NAME = { wood: '木材', brick: '砖块', sheep: '羊毛', wheat: '小麦', ore: '矿石' };
let barbInfo = null; // 野蛮人航道快照 {strength, defense, pos, track, x, y}

function initInspector() {
  if (inspectBound) return;
  inspectBound = true;
  // 平移/缩放/点击/滚动时收起放大镜，避免位置漂移或挡住操作
  svg.addEventListener('pointerdown', hideLoupe);
  svg.addEventListener('wheel', hideLoupe, { passive: true });
  window.addEventListener('scroll', hideLoupe, true);
}

function ensureLoupe() {
  if (loupeEl) return loupeEl;
  loupeEl = document.createElement('div');
  loupeEl.id = 'piece-loupe';
  loupeEl.innerHTML = '<div class="loupe-lens"></div>'
    + '<div class="loupe-name"><span class="loupe-dot"></span><span class="loupe-txt"></span></div>';
  document.body.appendChild(loupeEl);
  return loupeEl;
}

// 由当前状态推出板面元素的展示信息：{ label, color, cx, cy, R }
function describe(desc) {
  const st = curState, cols = curColors;
  if (desc.kind === 'building') {
    if (!st) return null;
    const b = st.buildings[desc.vid];
    if (!b) return null;
    const v = board.vertices[desc.vid];
    let type = b.type === 'city' ? '城市' : '村庄';
    if (b.type === 'city' && st.ck && st.ck.metropolis) {
      for (const m of Object.values(st.ck.metropolis)) {
        if (m && m.vertex === desc.vid) { type = '大都会'; break; }
      }
    }
    if (st.ck && st.ck.walls && st.ck.walls[desc.vid] !== undefined) type += '（含城墙，上限+2）';
    return { label: `${st.players[b.player].name}的${type}`, color: cols[b.player], cx: v.x, cy: v.y - 0.12, R: 0.4 };
  }
  if (desc.kind === 'road') {
    if (!st) return null;
    const p = st.roads[desc.eid];
    if (p === undefined) return null;
    const e = board.edges[desc.eid];
    const v1 = board.vertices[e.v1], v2 = board.vertices[e.v2];
    return { label: `${st.players[p].name}的道路`, color: cols[p], cx: (v1.x + v2.x) / 2, cy: (v1.y + v2.y) / 2, R: 0.55 };
  }
  if (desc.kind === 'knight') {
    const k = st && st.ck && st.ck.knights[desc.vid];
    if (!k) return null;
    const v = board.vertices[desc.vid];
    return {
      label: `${st.players[k.player].name}的${k.level}级骑士（${k.active ? '已激活' : '未激活'}）`,
      color: cols[k.player], cx: v.x, cy: v.y - 0.18, R: 0.42,
    };
  }
  if (desc.kind === 'hex') {
    const hx = desc.hex;
    const [tname, res] = TERRAIN_INFO[hx.terrain] || [hx.terrain, null];
    const grad = TERRAIN_GRAD[hx.terrain];
    let label;
    if (!res) label = `${tname} · 不产出`;
    else if (!hx.number) label = `${tname} · 产${res}`;
    else label = `${tname} · 产${res} · 骰${hx.number}（${6 - Math.abs(7 - hx.number)}/36）`;
    // 城市与骑士：城市在部分地形上另产商品
    if (st && st.ck && res) {
      const com = { forest: '纸张', pasture: '布匹', mountains: '铸币' }[hx.terrain];
      if (com) label += ` · 城市另产${com}`;
    }
    return { label, color: grad ? grad[1] : null, cx: hx.x, cy: hx.y, R: 1.02 };
  }
  if (desc.kind === 'robber') {
    if (!st) return null;
    const hx = board.hexes[st.robber];
    return { label: '强盗 · 封锁此地块产出', color: '#4a4a4a', cx: hx.x - 0.42, cy: hx.y - 0.32, R: 0.46 };
  }
  if (desc.kind === 'merchant') {
    const m = st && st.ck && st.ck.merchant;
    if (!m) return null;
    const hx = board.hexes[m.hex];
    return { label: `${st.players[m.player].name}的商人 · 该地资源 2:1`, color: cols[m.player], cx: hx.x + 0.45, cy: hx.y - 0.45, R: 0.3 };
  }
  if (desc.kind === 'harbor') {
    const hb = board.harbors[desc.idx];
    const label = hb.type === 'any' ? '港口 · 任意资源 3:1' : `${HARBOR_NAME[hb.type] || hb.type}港 · 2:1`;
    return { label, color: '#3a6ea5', cx: hb.x, cy: hb.y, R: 0.5 };
  }
  if (desc.kind === 'barbarian') {
    if (!barbInfo) return null;
    const left = Math.max(0, barbInfo.track - barbInfo.pos);
    return {
      label: `野蛮人 · 强度 ${barbInfo.strength} vs 防御 ${barbInfo.defense} · 还差 ${left} 步登陆`,
      color: '#c0392b', cx: barbInfo.x, cy: barbInfo.y, R: 0.42,
    };
  }
  return null;
}

// 板面元素：克隆当前 SVG 作镜片 —— 复用现有视觉，新素材到货自动升级
function producePiece(target, desc) {
  const d = describe(desc);
  if (!d) return null;
  const clone = target.cloneNode(true);
  clone.classList.remove('piece-pop', 'road-pop', 'inspecting'); // 去掉入场/悬停动画，保留定位用的 inline transform
  clone.removeAttribute('id'); // 避免与原元素（如 #robber-piece）重复 id
  return { label: d.label, color: d.color, svgClone: clone, viewBox: `${d.cx - d.R} ${d.cy - d.R} ${d.R * 2} ${d.R * 2}` };
}

function fillLens(loupe, c) {
  const lens = loupe.querySelector('.loupe-lens');
  if (c.svgClone) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('class', 'loupe-svg');
    s.setAttribute('viewBox', c.viewBox);
    s.appendChild(c.svgClone);
    lens.replaceChildren(s);
  } else if (c.img) {
    const im = document.createElement('img');
    im.className = 'loupe-img';
    im.src = c.img;
    lens.replaceChildren(im);
  } else if (c.emoji) {
    const sp = document.createElement('span');
    sp.className = 'loupe-emoji';
    sp.textContent = c.emoji;
    lens.replaceChildren(sp);
  } else {
    lens.replaceChildren();
  }
}

function showLoupe(target, produce) {
  const c = produce();
  if (!c) return;
  const loupe = ensureLoupe();
  fillLens(loupe, c);
  const dot = loupe.querySelector('.loupe-dot');
  dot.style.background = c.color || 'transparent';
  dot.style.display = c.color ? '' : 'none';
  loupe.querySelector('.loupe-txt').textContent = c.label;
  positionLoupe(loupe, target);
  loupe.classList.add('show');
}

// position:fixed，按视口坐标定位：默认贴目标右侧升起，放不下翻到左侧，纵向夹在视口内
function positionLoupe(loupe, target) {
  const pr = target.getBoundingClientRect();
  const LW = loupe.offsetWidth || 140;
  const LH = loupe.offsetHeight || 160;
  const gap = 14;
  let left = pr.right + gap;
  if (left + LW > window.innerWidth - 6) left = pr.left - gap - LW;
  left = Math.max(6, Math.min(left, window.innerWidth - LW - 6));
  const top = Math.max(6, Math.min(pr.top + pr.height / 2 - LH / 2, window.innerHeight - LH - 6));
  loupe.style.left = `${left}px`;
  loupe.style.top = `${top}px`;
}

// ---------- 完整卡浮层（手牌=图+下方文字；发展/进步卡=带框卡，文字叠进卡面文字框） ----------
function ensureCardPreview() {
  if (cardPreviewEl) return cardPreviewEl;
  cardPreviewEl = document.createElement('div');
  cardPreviewEl.id = 'card-preview';
  document.body.appendChild(cardPreviewEl);
  return cardPreviewEl;
}

// resolve() 返回 { img, name, sub, desc, boxed }
function showCardPreview(target, resolve) {
  const c = resolve();
  if (!c) return;
  const cp = ensureCardPreview();
  cp.classList.toggle('boxed', !!c.boxed);
  if (c.boxed) {
    // 卡面自带边框与空文字框：整卡铺满，名称/说明叠进底部文字框
    cp.innerHTML = '<div class="cp-frame"><img class="cp-img" alt=""><div class="cp-overlay"><div class="cp-name"></div><div class="cp-desc"></div></div></div>';
    cp.querySelector('.cp-name').textContent = c.name || '';
    cp.querySelector('.cp-desc').textContent = c.desc || c.sub || '';
  } else {
    cp.innerHTML = '<div class="cp-art"><img class="cp-img" alt=""></div>'
      + '<div class="cp-body"><div class="cp-name"></div><div class="cp-sub"></div><div class="cp-desc"></div></div>';
    cp.querySelector('.cp-name').textContent = c.name || '';
    const sub = cp.querySelector('.cp-sub');
    sub.textContent = c.sub || ''; sub.style.display = c.sub ? '' : 'none';
    const desc = cp.querySelector('.cp-desc');
    desc.textContent = c.desc || ''; desc.style.display = c.desc ? '' : 'none';
  }
  const img = cp.querySelector('.cp-img');
  img.src = c.img || '';
  positionCardPreview(cp, target);
  // 首次图片未加载完时高度未知，加载后再定位一次
  if (!img.complete) img.addEventListener('load', () => positionCardPreview(cp, target), { once: true });
  cp.classList.add('show');
}

// 锚在被悬停卡的正上方；上方放不下则落到下方；左右夹在视口内
function positionCardPreview(cp, target) {
  const pr = target.getBoundingClientRect();
  const W = cp.offsetWidth || 172;
  const H = cp.offsetHeight || 240;
  let left = pr.left + pr.width / 2 - W / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - W - 6));
  let top = pr.top - H - 10;
  if (top < 6) top = Math.min(pr.bottom + 10, window.innerHeight - H - 6);
  cp.style.left = `${left}px`;
  cp.style.top = `${top}px`;
}

function hideLoupe() { // 收起全部浮层（放大镜 + 完整卡）
  clearTimeout(dwellTimer);
  dwellTimer = 0;
  if (loupeEl) loupeEl.classList.remove('show');
  if (cardPreviewEl) cardPreviewEl.classList.remove('show');
}

function beginDwell(target, show, delay) {
  target.classList.add('inspecting');
  hideLoupe();
  dwellTarget = target;
  dwellTimer = setTimeout(() => { if (dwellTarget === target) show(); }, delay);
}

function endDwell(target) {
  target.classList.remove('inspecting');
  if (dwellTarget === target) { hideLoupe(); dwellTarget = null; }
}

// 棋盘元素：挂「悬停即时高亮 + 停留放大镜」（镜片=克隆当前 SVG）
function attachInspect(target, desc) {
  target.classList.add('inspectable');
  const show = () => showLoupe(target, () => producePiece(target, desc));
  target.addEventListener('pointerenter', () => beginDwell(target, show, DWELL_MS));
  target.addEventListener('pointerleave', () => endDwell(target));
}

// HTML 卡（手牌/发展卡/进步卡）：resolve() 返回 { img, name, sub, desc }，升起完整卡浮层
export function attachCardInspect(target, resolve) {
  target.classList.add('inspectable');
  const show = () => showCardPreview(target, resolve);
  target.addEventListener('pointerenter', () => beginDwell(target, show, CARD_DWELL_MS));
  target.addEventListener('pointerleave', () => endDwell(target));
}

export function updateRobber(hexId) {
  const hex = board.hexes[hexId];
  robberEl.style.transform = `translate(${hex.x - 0.42}px, ${hex.y - 0.32}px)`;
}

export function updatePieces(state, colors) {
  curState = state;
  curColors = colors;
  lastPiecesArgs = { state, colors };
  onTintReady = rerenderTinted;
  hideLoupe();
  // 被移除的道路（外交官卡）
  for (const [eid, r] of [...roadEls]) {
    if (state.roads[eid] === undefined) {
      r.el.remove();
      roadEls.delete(eid);
    }
  }
  // 道路：细长矩形（方头），沿边填色，像把地图上那条"路槽"填上玩家色
  for (const [eid, player] of Object.entries(state.roads)) {
    if (roadEls.has(eid)) continue;
    const e = board.edges[eid];
    const v1 = board.vertices[e.v1], v2 = board.vertices[e.v2];
    const t1 = 0.01, t2 = 0.99;
    const x1 = v1.x + (v2.x - v1.x) * t1, y1 = v1.y + (v2.y - v1.y) * t1;
    const x2 = v1.x + (v2.x - v1.x) * t2, y2 = v1.y + (v2.y - v1.y) * t2;
    const g = el('g', { class: 'road-pop' }, layers.roads);
    el('line', { x1, y1, x2, y2, class: 'road-piece', stroke: 'rgba(0,0,0,.4)', style: 'stroke-linecap: butt; stroke-width: 0.08' }, g);
    el('line', { x1, y1, x2, y2, class: 'road-piece', stroke: colors[player], style: 'stroke-linecap: butt; stroke-width: 0.08' }, g);
    attachInspect(g, { kind: 'road', eid: Number(eid) });
    roadEls.set(eid, { el: g, pending: false });
  }

  // 建筑：村庄/城市/大都会染色白模；城墙用独立石色层叠加（不参与染色，便于区分）
  for (const [vid, b] of Object.entries(state.buildings)) {
    let variant = 'settlement';
    if (b.type === 'city') {
      const walled = state.ck && state.ck.walls && state.ck.walls[vid] !== undefined;
      const metro = state.ck && state.ck.metropolis
        && Object.values(state.ck.metropolis).some((m) => m && m.vertex === Number(vid));
      variant = (metro ? 'metropolis' : 'city') + (walled ? '-walled' : '');
    }
    const existing = buildingEls.get(vid);
    if (existing && existing.variant === variant && !existing.pending) continue;
    if (existing) existing.el.remove();
    const v = board.vertices[vid];
    const g = el('g', { class: 'piece-pop' }, layers.buildings);
    const walled = variant.endsWith('-walled');
    const base = walled ? variant.slice(0, -7) : variant; // settlement / city / metropolis
    const tinted = tintedPiece(`/assets/opt/piece-${base}-white.webp`, colors[b.player]);
    let pending = false;
    if (tinted) {
      const w = base === 'metropolis' ? 0.66 : base === 'settlement' ? 0.65 : 0.56;
      // 按模型底部内容占比把可视底座落到顶点（不作阴影、不悬空）
      const x = v.x - w / 2, y = v.y + 0.02 - w * BASE_FRAC[base];
      el('image', { href: tinted, x, y, width: w, height: w, class: 'piece-img' }, g);
      if (walled) { // 城墙独立石色层：同位置同尺寸叠上去，不染色
        el('image', { href: `/assets/opt/piece-${base}-wall.webp`, x, y: y + 0.1, width: w, height: w, class: 'piece-img' }, g);
      }
    } else {
      el('path', { d: (b.type === 'city' ? cityD : settlementD)(v.x, v.y), fill: colors[b.player], class: 'piece' }, g);
      pending = true;
    }
    attachInspect(g, { kind: 'building', vid: Number(vid) });
    buildingEls.set(vid, { el: g, variant, pending });
  }

  updateRobber(state.robber);
}

// ---------- 城市与骑士棋子（骑士/城墙/大都会/商人） ----------
// onKnightClick(vertexId, knight)：骑士被点击（自己的骑士菜单 / 进步卡选择目标）
// ---------- 白模棋子实时染色（canvas multiply：白模 × 玩家色，结果缓存） ----------
const tintCache = new Map(); // 'src|color' -> dataURL
const tintImgs = new Map();  // src -> Image
let onTintReady = null;      // 某张白模异步加载完成后触发重渲染
let lastCKArgs = null;
let lastPiecesArgs = null;

// 白模异步加载完成后，重渲染棋子（基础棋子 + 骑士）
function rerenderTinted() {
  if (lastPiecesArgs) updatePieces(lastPiecesArgs.state, lastPiecesArgs.colors);
  if (lastCKArgs) updateCKPieces(lastCKArgs.state, lastCKArgs.colors, lastCKArgs.onKnightClick);
}

// 高亮选中的骑士（铁匠等多选进步卡用）
export function highlightKnights(vertexIds) {
  if (!layers.knights) return;
  const set = new Set((vertexIds || []).map(Number));
  for (const g of layers.knights.children) {
    g.classList.toggle('knight-selected', set.has(Number(g.getAttribute('data-vid'))));
  }
}

// keepBelow>0：底部该占比以下保持白（城墙留白，便于区分带城墙的城市）
function tintedPiece(src, color, keepBelow = 0) {
  const key = `${src}|${color}|${keepBelow}`;
  if (tintCache.has(key)) return tintCache.get(key);
  let img = tintImgs.get(src);
  if (!img) { img = new Image(); img.src = src; tintImgs.set(src, img); }
  if (!img.complete || !img.naturalWidth) {
    img.addEventListener('load', () => onTintReady && onTintReady(), { once: true });
    return null;
  }
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'multiply'; // 白身→玩家色，深色描边/阴影保持
  if (keepBelow > 0) {
    // 纵向渐变：下部乘白＝不染，城墙保持白色
    const grad = ctx.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, color);
    grad.addColorStop(Math.max(0, keepBelow - 0.06), color);
    grad.addColorStop(keepBelow, '#ffffff');
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = color;
  }
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in'; // 恢复白模的透明区
  ctx.drawImage(img, 0, 0);
  const url = c.toDataURL('image/png');
  tintCache.set(key, url);
  return url;
}
// 预加载全部白模，降低首次染色的等待
for (const name of ['settlement', 'city', 'metropolis', 'knight1', 'knight2', 'knight3']) {
  const s = `/assets/opt/piece-${name}-white.webp`;
  const i = new Image(); i.src = s; tintImgs.set(s, i);
}
for (const w of ['city-wall', 'metropolis-wall']) { new Image().src = `/assets/opt/piece-${w}.webp`; }

export function updateCKPieces(state, colors, onKnightClick) {
  if (!state.ck) return;
  curState = state;
  curColors = colors;
  lastCKArgs = { state, colors, onKnightClick };
  onTintReady = rerenderTinted;
  // 城墙已并入城市白模（piece-city-walled-white 等），不再单独画护环
  layers.walls.innerHTML = '';

  // 骑士：染色白模；激活亮金光，未激活灰暗
  layers.knights.innerHTML = '';
  for (const [vid, k] of Object.entries(state.ck.knights)) {
    const v = board.vertices[vid];
    const g = el('g', { class: `knight-piece${k.active ? ' active' : ' idle'}`, 'data-vid': vid }, layers.knights);
    el('ellipse', { cx: v.x, cy: v.y + 0.13, rx: 0.24, ry: 0.09, class: 'knight-glow' }, g); // 激活时脚下金光（不作阴影）
    const tinted = tintedPiece(`/assets/opt/piece-knight${k.level}-white.webp`, colors[k.player]);
    if (tinted) {
      el('image', { href: tinted, x: v.x - 0.27, y: v.y - 0.58, width: 0.54, height: 0.74, class: 'knight-img' }, g);
    } else {
      el('circle', { cx: v.x, cy: v.y - 0.06, r: 0.2, fill: colors[k.player] }, g); // 染色未就绪的兜底
    }
    attachInspect(g, { kind: 'knight', vid: Number(vid) });
    if (onKnightClick) {
      g.style.cursor = 'pointer';
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onKnightClick(Number(vid), k);
      });
    }
  }

  // 大都会已并入建筑白模（piece-metropolis-white 等）；此处只画商人标记
  layers.marks.innerHTML = '';
  if (state.ck.merchant) {
    const hex = board.hexes[state.ck.merchant.hex];
    const g = el('g', { class: 'merchant-mark' }, layers.marks);
    el('circle', {
      cx: hex.x + 0.45, cy: hex.y - 0.45, r: 0.19, class: 'merchant-bg',
      stroke: colors[state.ck.merchant.player],
    }, g);
    el('image', {
      href: '/assets/opt/merchant.webp',
      x: hex.x + 0.30, y: hex.y - 0.60, width: 0.3, height: 0.3, class: 'hex-img',
    }, g);
    attachInspect(g, { kind: 'merchant' });
  }
}

// ---------- 野蛮人航道（画在海面上，随棋盘缩放平移） ----------
// ck 传 null 时清除；船的位置用 transform 过渡，元素持久化避免重建打断动画
export function updateBarbarianTrack(ck, strength, defense, detail) {
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
    const badge = el('g', { style: 'cursor: help' }, layer);
    el('rect', { x: s0.x - 1.0, y: s0.y + 0.42, width: 2.0, height: 0.56, rx: 0.28, class: 'barb-badge-bg' }, badge);
    const vs = el('text', { x: s0.x, y: s0.y + 0.81, class: 'barb-badge-text' }, badge);
    const badgeTitle = el('title', {}, badge); // 悬浮显示各玩家城市/防御明细
    const ship = el('g', { class: 'barb-ship' }, layer);
    el('image', {
      href: '/assets/opt/barbarian-ship.webp',
      x: -0.36, y: -0.22, width: 0.72, height: 0.48, class: 'hex-img',
    }, ship);
    attachInspect(ship, { kind: 'barbarian' });
    barbEls = { pt, dots, ship, vs, badgeTitle };
  }
  barbEls.dots.forEach((d, i) => d.classList.toggle('passed', i + 1 <= pos));
  const s = barbEls.pt(pos / track);
  barbEls.ship.style.transform = `translate(${s.x}px, ${s.y}px)`;
  barbEls.vs.textContent = `🏰${strength} vs ⚔️${defense}`;
  if (detail && barbEls.badgeTitle) barbEls.badgeTitle.textContent = detail;
  barbInfo = { strength, defense, pos, track, x: s.x, y: s.y };
}

// ---------- 左列面板：进步卡牌堆（上排）+ 城市升级轨道（下方三列） ----------
const DECK_META = {
  trade: { name: '贸易', icon: '🧶', com: '布匹', color: '#c9a227', perk3: '🏪', perk3Name: '商栈：商品可 2:1 与银行交易' },
  politics: { name: '政治', icon: '🪙', com: '铸币', color: '#3a6ea5', perk3: '🏰', perk3Name: '城堡：可将骑士升到 3 级' },
  science: { name: '科学', icon: '📜', com: '纸张', color: '#4a8c4a', perk3: '🚰', perk3Name: '引水渠：无产出时任选 1 张资源' },
};
// 三列的中心 x 与竖向锚点（ck 模式 initBoard 向左多扩了 CK_PANEL_W 的海面）
const colX = (i) => baseVB.x + 0.85 + i * 1.3;

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
    const y = isle.cy - 2.72; // 牌堆一排横放在升级轨道上方
    deckEls = { pos: {}, count: {}, card: {}, prev: {} };
    Object.entries(DECK_META).forEach(([track, meta], i) => {
      const x = colX(i);
      deckEls.pos[track] = { x, y };
      const g = el('g', { class: 'pdeck' }, layer);
      // 两张错位垫底的“牌背”营造一摞的效果
      el('rect', {
        x: x - 0.36, y: y - 0.48, width: 0.72, height: 0.96, rx: 0.08,
        class: 'pdeck-back', fill: meta.color, transform: `rotate(-6 ${x} ${y})`,
      }, g);
      el('rect', {
        x: x - 0.36, y: y - 0.48, width: 0.72, height: 0.96, rx: 0.08,
        class: 'pdeck-back', fill: meta.color, transform: `rotate(3.5 ${x} ${y})`,
      }, g);
      const card = el('g', { class: 'pdeck-top' }, g);
      el('rect', {
        x: x - 0.36, y: y - 0.48, width: 0.72, height: 0.96, rx: 0.08,
        class: 'pdeck-card', fill: meta.color,
      }, card);
      el('image', {
        href: `/assets/opt/progress-${track}.webp`,
        x: x - 0.285, y: y - 0.45, width: 0.57, height: 0.75, class: 'hex-img',
      }, card);
      const cnt = el('text', { x, y: y + 0.33, class: 'pdeck-count' }, card);
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

// ---------- 城市升级轨道：每列 5 个等级格 + 底部购买按钮，与上方牌堆同列同色 ----------
// data = { tracks: { trade: { lvl, cost, have, canBuy, crane, maxed, metroName, metroMine }, ... } }
// onBuy(track)：点击购买按钮时回调；传 null 清除
export function updateImproveBoard(data, onBuy) {
  const layer = layers.improve;
  if (!layer) return;
  if (!data) {
    layer.innerHTML = '';
    impEls = null;
    return;
  }
  const CELL_H = 0.46;
  const CELL_GAP = 0.1;
  const yCell = (k) => isle.cy - 1.9 + k * (CELL_H + CELL_GAP); // 等级格顶边（1 级在最上）
  if (!impEls) {
    layer.innerHTML = '';
    impEls = { cells: {}, cellTxt: {}, buy: {}, buyTxt: {}, tip: {}, onBuy: null };
    Object.entries(DECK_META).forEach(([track, meta], i) => {
      const x = colX(i);
      const g = el('g', { class: 'impb-col' }, layer);
      impEls.cells[track] = [];
      impEls.cellTxt[track] = [];
      for (let k = 0; k < 5; k++) {
        const y = yCell(k);
        const cell = el('g', { class: 'impb-cell' }, g);
        el('rect', {
          x: x - 0.55, y, width: 1.1, height: CELL_H, rx: 0.08,
          class: 'impb-cell-bg',
        }, cell);
        const txt = el('text', { x, y: y + CELL_H / 2 + 0.065, class: 'impb-cell-txt' }, cell);
        // 3 级解锁能力，4 级大都会；其余格只标等级
        txt.textContent = k === 2 ? `3 级 ${meta.perk3}` : (k === 3 ? '4 级 🏛️' : `${k + 1} 级`);
        impEls.cells[track].push(cell);
        impEls.cellTxt[track].push(txt);
      }
      // 购买按钮
      const buy = el('g', { class: 'impb-buy' }, g);
      el('rect', {
        x: x - 0.55, y: yCell(5) + 0.06, width: 1.1, height: 0.5, rx: 0.12,
        class: 'impb-buy-bg',
      }, buy);
      const buyTxt = el('text', { x, y: yCell(5) + 0.06 + 0.32, class: 'impb-buy-txt' }, buy);
      buy.onclick = () => {
        if (buy.classList.contains('can')) impEls?.onBuy?.(track);
      };
      impEls.buy[track] = buy;
      impEls.buyTxt[track] = buyTxt;
      const tip = el('title', {}, g);
      impEls.tip[track] = tip;
    });
  }
  impEls.onBuy = onBuy;
  for (const [track, meta] of Object.entries(DECK_META)) {
    const t = data.tracks[track];
    impEls.cells[track].forEach((cell, k) => {
      const bg = cell.firstChild;
      const on = k < t.lvl;
      bg.classList.toggle('on', on);
      bg.style.fill = on ? meta.color : '';
      impEls.cellTxt[track][k].classList.toggle('on', on);
    });
    // 4 级格：大都会有主时显示归属
    impEls.cellTxt[track][3].textContent = t.metroName
      ? `🏛️ ${t.metroName.slice(0, 4)}` : '4 级 🏛️';
    const buy = impEls.buy[track];
    if (t.maxed) {
      impEls.buyTxt[track].textContent = '已满级';
      buy.classList.remove('can');
    } else {
      impEls.buyTxt[track].textContent = `${t.crane ? '🏗️' : ''}升级 ${t.cost}${meta.icon}`;
      buy.classList.toggle('can', t.canBuy);
    }
    impEls.tip[track].textContent = `${meta.name}：3 级 ${meta.perk3Name}；4 级率先达到可获大都会（+2 分）`
      + (t.metroName ? `\n大都会：${t.metroName}${t.metroMine ? '（你）' : ''}` : '')
      + (t.maxed ? '' : `\n升到 ${t.lvl + 1} 级需 ${t.cost} 张${meta.com}（有 ${t.have}）${t.crane ? '，含起重机 -1' : ''}`)
      + (t.noCity ? '\n⚠️ 需要至少拥有一座城市才能升级' : '');
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

// 顶点的屏幕坐标（毁城爆炸等定位用）
export function vertexPixelPosition(vid, svgElement) {
  const v = board.vertices[vid];
  if (!v) return null;
  const pt = svgElement.createSVGPoint();
  pt.x = v.x; pt.y = v.y;
  const ctm = svgElement.querySelector('#layer-buildings')?.getScreenCTM();
  if (!ctm) return null;
  return pt.matrixTransform(ctm);
}
