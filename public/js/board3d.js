// 棋盘 3D 层：强盗 + 骑士。透明 WebGL 画布叠在 svg#board 正上方（不接收指针），正交相机视野 =
// SVG 当前可见区域，场景单位即棋盘单位，平移缩放只需重算相机。SVG 里的插画保留为透明命中区
// （点击菜单/悬停放大镜照旧）；three 加载失败或不支持 WebGL 时插画原样显示。
// 棋盘是俯视平面，「腾空」用屏幕上移 + 放大表达；前后遮挡按屏幕纵向位置排序。
//
// 状态决定最终位置，事件决定「怎么过去」：状态到达前 expectBoardEvents 先登记本批事件，
// 被事件接管的变化（骑士行军/对战、驱逐强盗、强盗逃窜）在渲染时先按住原样，
// 等时间线播到该事件（playKnightMoveBoard / playChaseBoard / playRobberFlee）再演。
// 没有事件的变化（重连、逃兵等）直接按状态差补间。只做视觉，不碰规则。
import {
  THREE, loadThree, reduced, clamp01, lerp, easeInOut, easeOut, spring, angleTo,
  makeRenderer, addLights, textures, buildRobber, buildKnight, mixStance, setStance, addGait,
  applyKnightPose,
} from './three-figures.js';

const TILT = 0.5;            // 人像顶部朝镜头倾 ~29°，与插画棋子的俯视站立感一致
const ROBBER_SCALE = 0.6;    // 模型高 1 → 棋盘单位 0.6（与原插画等高）
const KNIGHT_SCALE = 0.64;
const ROBBER_REST_YAW = 0.38; // 略侧身，转向地块中心
const KNIGHT_REST_YAW = -0.22;
const Z_PER_Y = 2;           // 越靠屏幕下方越靠近镜头
const EXPECT_TTL = 15000;    // 登记的事件迟迟未播（被打断）就放弃接管，直接按状态落位

const B = {
  svg: null, board: null, getView: null, getState: null, robberEl: null, knightsLayer: null,
  canvas: null, ro: null, size: null, renderer: null, scene: null, camera: null,
  raf: 0, idleTimer: 0, lastT: 0, firstSync: true, pendingKnights: null,
  robber: null, knights: new Map(), ghosts: new Set(), fx: [],
  expectMoves: new Map(), expectChase: new Map(), chasePending: false, fleeSeq: -1, robberHeld: false, robberHeldAt: 0,
  lastChase: null, selected: new Set(),
};

export function boardCanvas() { return B.canvas; }

// ---------- 接入 / 画布 / 相机 ----------
// initBoard 时调用（每局一次）：建/复用画布，挂悬停监听；three 未就绪则等加载完成
export function attachBoard3D({ svg, board, robberEl, knightsLayer, getView, getState }) {
  Object.assign(B, { svg, board, robberEl, knightsLayer, getView, getState });
  B.firstSync = true;
  B.pendingKnights = null;
  B.expectMoves.clear();
  B.expectChase.clear();
  B.chasePending = false;
  B.robberHeld = false;
  B.lastChase = null;
  B.selected = new Set();
  for (const ent of [...B.knights.values(), ...B.ghosts]) removeEnt(ent);
  B.knights.clear();
  B.ghosts.clear();
  if (B.robber) {
    B.robber.g = null;
    B.robber.action = null;
    B.robber.cower = false;
    B.robber.hiddenUntil = 0;
  }
  if (!B.canvas) {
    B.canvas = document.createElement('canvas');
    B.canvas.id = 'board3d';
    svg.insertAdjacentElement('afterend', B.canvas);
    B.ro = new ResizeObserver((es) => {
      const r = es[es.length - 1].contentRect; // 不受 CSS 变换影响的小数尺寸（开场镜头/震屏期间也准）
      B.size = { w: r.width, h: r.height };
      layoutCanvas();
      renderNow(); // 改尺寸会清空画布，必须在本帧绘制前补画，等 rAF 就会闪一帧空白
    });
    B.ro.observe(svg);
  }
  robberEl.addEventListener('pointerenter', () => { if (B.robber) { B.robber.hoverTarget = 1; kick(); } });
  robberEl.addEventListener('pointerleave', () => { if (B.robber) { B.robber.hoverTarget = 0; kick(); } });
  const knightAt = (e) => B.knights.get(e.target.closest?.('.knight-pos')?.getAttribute('data-vid'));
  knightsLayer.addEventListener('pointerover', (e) => { const ent = knightAt(e); if (ent) { ent.hoverTarget = 1; kick(); } });
  knightsLayer.addEventListener('pointerout', (e) => {
    const ent = knightAt(e);
    if (ent && !e.relatedTarget?.closest?.(`.knight-pos[data-vid="${ent.vid}"]`)) { ent.hoverTarget = 0; kick(); }
  });
  if (THREE) setupBoard();
  else loadThree().then((ok) => { if (ok) setupBoard(); });
}

function setupBoard() {
  if (!B.svg) return;
  if (!B.renderer) {
    try {
      B.renderer = makeRenderer(B.canvas);
    } catch (e) {
      console.warn('WebGL 不可用，保留棋子插画', e);
      return;
    }
    B.scene = new THREE.Scene();
    addLights(B.scene, B.renderer);
    B.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
    B.camera.position.set(0, 0, 40);
    B.robber = createRobber();
  }
  layoutCanvas();
  B.canvas.classList.add('on');
  B.robberEl.classList.add('robber-3d');
  B.knightsLayer.classList.add('k3d');
  // 预加载恰好在开局插画落下途中完成：撤掉插画动画（否则 WAAPI 的 opacity 会盖过隐藏样式）
  B.robberEl.firstElementChild?.getAnimations().forEach((a) => a.cancel());
  if (B.pendingKnights) syncBoardKnights(...B.pendingKnights);
  renderNow();
}

// 画布与 svg 同盒（同父、同尺寸，都贴 #board-area 左下角：svg 是 flex:1 的最后一个流内元素），
// 这样开场镜头的 3D 变换可以原样复制到画布上。svg 元素没有 offsetTop，只能靠 CSS 锚定
function layoutCanvas() {
  if (!B.canvas || !B.size) return;
  const { w, h } = B.size;
  B.canvas.style.width = `${w}px`;
  B.canvas.style.height = `${h}px`;
  if (B.renderer && w && h) B.renderer.setSize(w, h, false);
}

// 正交相机视野 = svg 当前可见区域（viewBox 用 xMidYMid meet 留边，视口组再做平移缩放）
function syncCamera() {
  const { baseVB, vb } = B.getView();
  const { w: W, h: H } = B.size;
  const s0 = Math.min(W / baseVB.w, H / baseVB.h);
  const k = s0 * (baseVB.w / vb.w); // 每棋盘单位的像素数
  const left = vb.x - (W - baseVB.w * s0) / 2 / k;
  const top = vb.y - (H - baseVB.h * s0) / 2 / k;
  const cam = B.camera;
  cam.left = left;
  cam.right = left + W / k;
  cam.top = -top; // three 的 y 朝上，svg 的 y 朝下
  cam.bottom = -(top + H / k);
  cam.updateProjectionMatrix();
}

export function boardViewChanged() { kick(); }

// ---------- 实体 ----------
let PLANE = null;
function makeRig(fig, scale, shadowW) {
  PLANE ||= new THREE.PlaneGeometry(1, 1);
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  const squash = new THREE.Group();
  const yaw = new THREE.Group();
  const lean = new THREE.Group();
  tilt.rotation.x = TILT;
  root.add(tilt); tilt.add(squash); squash.add(yaw); yaw.add(lean); lean.add(fig);
  B.scene.add(root);
  // 影子画在所有棋子之下（关深度测试、最先画），地面上不会被别的棋子误挡
  const shadow = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({
    map: textures().blob, color: '#1d1206', transparent: true, depthWrite: false, depthTest: false,
  }));
  shadow.renderOrder = -10;
  B.scene.add(shadow);
  return { root, squash, yaw, lean, shadow, scale, shadowW };
}

function newEnt(kind) {
  return {
    kind, g: null, yaw: 0, restYaw: 0, hover: 0, hoverTarget: 0, action: null, token: 0,
    landAt: -1e9, P: {}, phase: Math.random() * 6.28, hiddenUntil: 0,
  };
}

function createRobber() {
  const ent = newEnt('robber');
  ent.model = buildRobber();
  ent.rig = makeRig(ent.model.fig, ROBBER_SCALE, 0.95);
  ent.yaw = ent.restYaw = ROBBER_REST_YAW;
  ent.cower = false;
  return ent;
}

function createKnight(vid, k, color) {
  const ent = newEnt('knight');
  Object.assign(ent, { vid, player: k.player, level: k.level, color, active: k.active, stanceK: k.active ? 1 : 0, stanceHold: null });
  ent.model = buildKnight(k.level, color);
  ent.model.setLook(color, !k.active);
  ent.rig = makeRig(ent.model.fig, KNIGHT_SCALE, 0.8);
  ent.yaw = ent.restYaw = KNIGHT_REST_YAW;
  ent.g = vertexGround(vid);
  return ent;
}

function swapKnightModel(ent, level) {
  const old = ent.model.fig;
  old.parent.remove(old);
  ent.model = buildKnight(level, ent.color);
  ent.model.setLook(ent.color, ent.stanceK < 0.5);
  ent.rig.lean.add(ent.model.fig);
  ent.level = level;
}

function removeEnt(ent) {
  if (ent.action) ent.action.resolve();
  ent.action = null;
  ent.token++;
  B.scene?.remove(ent.rig.root);
  B.scene?.remove(ent.rig.shadow);
  if (ent.ring) B.scene?.remove(ent.ring);
}

const vertexGround = (vid) => {
  const v = B.board.vertices[vid];
  return { x: v.x, y: v.y + 0.1 };
};
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const lerpPt = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });
const faceYaw = (from, to) => Math.atan2(to.x - from.x, to.y - from.y); // 正面朝 +Z ≈ 屏幕下方

// 动作：每帧在基础姿态上叠加 fn(p, P, now)；返回 Promise，播完（或被新动作顶掉）时兑现
function play(ent, dur, fn) {
  return new Promise((resolve) => {
    if (ent.action) ent.action.resolve();
    ent.action = { t0: performance.now(), dur: reduced ? 1 : dur, fn, resolve };
    kick();
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
// 编舞期间若实体被新的编舞接管（token 变化）就停止后续步骤
const guard = (ent) => {
  const tk = ++ent.token;
  return () => ent.token === tk && !ent.removed;
};

// ---------- 特效：扬尘 / 闪光 / 冲击波 ----------
function fxMesh(map, color, additive) {
  PLANE ||= new THREE.PlaneGeometry(1, 1);
  const m = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({
    map, color, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  B.scene.add(m);
  return m;
}
function spawnFx(fx) {
  fx.t0 = B.now ?? performance.now(); // 帧时间计时：与 rAF 时间戳同一时钟
  B.fx.push(fx);
  kick();
}
// 一圈扬尘：地面在俯视里是扁的（y 方向压到 0.42）
function dustRing(g, n = 10, reach = 0.26, size = 1) {
  const T = textures();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const dx = Math.cos(a);
    const dy = Math.sin(a) * 0.42;
    const spd = 0.8 + Math.random() * 0.4;
    const mesh = fxMesh(T.puff, '#b2946f', false);
    spawnFx({
      mesh, dur: 600,
      update(p) {
        const r = 0.1 + reach * easeOut(p) * spd;
        mesh.position.set(g.x + dx * r, -(g.y + dy * r) + 0.04 * p, (g.y + dy * r) * Z_PER_Y + (dy > 0 ? 2 : -2));
        mesh.scale.setScalar((0.07 + 0.14 * p) * size);
        mesh.material.opacity = 0.75 * (1 - p) ** 1.6;
      },
    });
  }
}
// 一小撮尘（脚步/滑行）
function dustPuff(g, size = 1) {
  const mesh = fxMesh(textures().puff, '#b2946f', false);
  const dx = (Math.random() - 0.5) * 0.1;
  spawnFx({
    mesh, dur: 450,
    update(p) {
      mesh.position.set(g.x + dx, -g.y + 0.03 * p, g.y * Z_PER_Y + 1);
      mesh.scale.setScalar((0.06 + 0.1 * p) * size);
      mesh.material.opacity = 0.6 * (1 - p) ** 1.5;
    },
  });
}
function flash(x, y, lift, color = '#fff4d6', size = 0.3, dur = 280) {
  const mesh = fxMesh(textures().star, color, true);
  spawnFx({
    mesh, dur,
    update(p) {
      mesh.position.set(x, -y + lift, y * Z_PER_Y + 3);
      mesh.rotation.z = p * 0.8;
      mesh.scale.setScalar(size * (0.4 + 0.8 * Math.sin(Math.PI * Math.min(1, p * 1.4))));
      mesh.material.opacity = 1 - p * p;
    },
  });
}
function shockRing(g, color = '#ffd36b', size = 1.1, dur = 520) {
  const mesh = fxMesh(textures().ring, color, true);
  mesh.material.depthTest = false; // 地面特效同影子：画在所有棋子之下
  mesh.renderOrder = -9;
  spawnFx({
    mesh, dur,
    update(p) {
      mesh.position.set(g.x, -g.y, g.y * Z_PER_Y - 2.5);
      const s = size * easeOut(p);
      mesh.scale.set(s, s * 0.42, 1);
      mesh.material.opacity = 1 - p;
    },
  });
}

// ---------- 帧循环 ----------
function renderNow() {
  if (!B.renderer) return;
  cancelAnimationFrame(B.raf);
  B.raf = 0;
  clearTimeout(B.idleTimer);
  frame(performance.now());
}
function kick() {
  if (!B.renderer || B.raf) return;
  clearTimeout(B.idleTimer);
  B.raf = requestAnimationFrame(frame);
}

function frame(now) {
  B.raf = 0;
  if (!B.renderer || !B.size?.w) return; // 不在对局界面：停表，尺寸变化时再唤醒
  B.now = now;
  const dt = Math.min(0.05, (now - (B.lastT || now)) / 1000);
  B.lastT = now;
  let busy = false;
  const ents = [B.robber, ...B.knights.values(), ...B.ghosts];
  for (const ent of ents) {
    if (!ent || !ent.g) {
      if (ent?.rig) { ent.rig.root.visible = false; ent.rig.shadow.visible = false; }
      continue;
    }
    if (step(ent, now, dt)) busy = true;
  }
  for (let i = B.fx.length - 1; i >= 0; i--) {
    const fx = B.fx[i];
    const p = Math.max(0, (now - fx.t0) / fx.dur);
    if (p >= 1) {
      B.scene.remove(fx.mesh);
      fx.mesh.material.dispose();
      B.fx.splice(i, 1);
      continue;
    }
    fx.update(p);
    busy = true;
  }
  syncCamera();
  B.renderer.render(B.scene, B.camera);
  if (busy) kick();
  else if (!reduced) B.idleTimer = setTimeout(kick, 40); // 只剩待机动作：降到 ~25fps 省电
}

// 单个实体一帧：基础姿态 → 叠加当前动作 → 写入骨架。返回是否仍在过渡
function step(ent, now, dt) {
  const P = ent.P;
  let busy = false;
  const hv = ent.hover + (ent.hoverTarget - ent.hover) * Math.min(1, dt * 12);
  ent.hover = Math.abs(ent.hoverTarget - hv) < 0.002 ? ent.hoverTarget : hv;
  if (ent.hover !== ent.hoverTarget) busy = true;
  if (ent.kind === 'robber') { if (robberBase(ent, P, now, dt)) busy = true; } else if (knightBase(ent, P, now, dt)) busy = true;
  const a = ent.action;
  if (a) {
    busy = true;
    const p = Math.max(0, (now - a.t0) / a.dur); // 动作可能在两帧之间开始：首帧进度夹到 0
    a.fn(Math.min(1, p), P, now);
    if (p >= 1) {
      ent.action = null;
      a.resolve();
    }
  }
  const q = (now - ent.landAt) / 420;
  if (q < 1) {
    busy = true;
    const s = spring(q);
    P.sy *= 1 - 0.22 * s;
    P.sx *= 1 + 0.14 * s;
  }
  applyEnt(ent, P);
  return busy;
}

function commonBase(ent, P) {
  P.x = ent.g.x;
  P.y = ent.g.y;
  P.lift = 0;
  P.grow = 1;
  P.sx = 1;
  P.sy = 1;
  P.roll = 0;
  P.sink = 0;
  P.visible = performance.now() >= ent.hiddenUntil;
  P.shadowK = P.visible ? 1 : clamp01(1 - (ent.hiddenUntil - performance.now()) / 400) * 0.6;
}

function easeYaw(ent, target, dt, rate = 6) {
  const next = angleTo(ent.yaw, target, Math.min(1, dt * rate));
  const moving = Math.abs(next - ent.yaw) > 0.003;
  ent.yaw = next;
  return moving;
}

function robberBase(ent, P, now, dt) {
  commonBase(ent, P);
  const t = now / 1000;
  const idle = reduced ? 0 : 1;
  let busy = false;
  P.lean = 0;
  P.glow = 1 + 0.3 * Math.sin(t * 3.3) * idle + 1.6 * ent.hover;
  P.headY = 0.22 * Math.sin(t * 0.6 + 1) * idle * (1 - ent.hover);
  P.headX = 0.04 * Math.sin(t * 0.9) * idle;
  P.cloak = 0.025 * Math.sin(t * 1.3) * idle;
  P.sy *= 1 + 0.014 * Math.sin(t * 2.1) * idle;
  let yawT = angleTo(ent.restYaw + 0.12 * Math.sin(t * 0.45) * idle, 0, ent.hover);
  if (ent.cower) { // 被骑士打退：缩成一团发抖、低头、眼光乱闪，脸朝着骑士
    P.sy *= 0.86;
    P.x += Math.sin(t * 55) * 0.006 * idle;
    P.headX = 0.3;
    P.headY = 0;
    P.glow = 0.5 + 0.4 * Math.abs(Math.sin(t * 9));
    if (ent.faceTo) yawT = faceYaw(ent.g, ent.faceTo);
  }
  if (!ent.action && easeYaw(ent, yawT, dt)) busy = true;
  P.yaw = ent.yaw;
  P.grow *= 1 + 0.2 * ent.hover;
  return busy;
}

function knightBase(ent, P, now, dt) {
  commonBase(ent, P);
  const t = now / 1000;
  const idle = reduced ? 0 : 1;
  let busy = false;
  const target = ent.stanceHold ?? (ent.active ? 1 : 0);
  const sk = ent.stanceK + (target - ent.stanceK) * Math.min(1, dt * 4);
  ent.stanceK = Math.abs(target - sk) < 0.003 ? target : sk;
  if (ent.stanceK !== target) busy = true;
  if ((ent.stanceK < 0.5) !== ent.model.idle) ent.model.setLook(ent.color, ent.stanceK < 0.5); // 灰化随姿势过半切换
  mixStance(P, 'rest', 'guard', ent.stanceK);
  const k = ent.stanceK;
  P.sy *= 1 + 0.012 * Math.sin(t * 2 + ent.phase) * k * idle;
  P.plume += 0.1 * Math.sin(t * 1.7 + ent.phase) * idle;
  P.cape += 0.03 * Math.sin(t * 1.3 + ent.phase) * k * idle;
  P.hy += 0.15 * Math.sin(t * 0.5 + ent.phase) * k * idle * (1 - ent.hover);
  if (!ent.action && easeYaw(ent, angleTo(ent.restYaw, 0, ent.hover), dt)) busy = true;
  P.yaw = ent.yaw;
  P.grow *= 1 + 0.2 * ent.hover;
  if (ent.selected) P.grow *= 1 + 0.06 * Math.sin(t * 6.3);
  return busy;
}

function applyEnt(ent, P) {
  const r = ent.rig;
  r.root.visible = P.visible;
  r.root.position.set(P.x, -P.y + P.lift, P.y * Z_PER_Y);
  r.root.scale.setScalar(r.scale * P.grow);
  r.squash.scale.set(P.sx, P.sy * (1 - P.sink), P.sx);
  r.yaw.rotation.y = P.yaw;
  if (ent.kind === 'robber') {
    r.lean.rotation.set(P.lean, 0, P.roll);
    ent.model.head.rotation.set(P.headX, P.headY, 0);
    ent.model.cloak.rotation.y = P.cloak;
    ent.model.setGlow(P.glow);
  } else {
    r.lean.rotation.set(P.lean, 0, P.roll);
    applyKnightPose(ent.model, P);
  }
  const k = (1 / (1 + P.lift * 1.6)) * (1 - P.sink);
  r.shadow.visible = true;
  r.shadow.position.set(P.x + 0.03, -(P.y + 0.012), 0);
  r.shadow.scale.set(r.scale * r.shadowW * k * (0.75 + 0.25 * P.shadowK), r.scale * r.shadowW * 0.42 * k, 1);
  r.shadow.material.opacity = 0.5 * P.shadowK * k;
  if (ent.ring) {
    ent.ring.visible = !!ent.selected;
    ent.ring.position.set(P.x, -P.y, -1);
    ent.ring.material.opacity = 0.6 + 0.3 * Math.sin(performance.now() / 160);
  }
}

// ====================================================================
// 强盗
// ====================================================================
// 落脚点（棋盘单位）。首次/后台/禁动画时直接落位，否则跳过去；驱逐后等逃窜事件再动
export function moveBoardRobber(x, y) {
  const R = B.robber;
  if (!R) return;
  const to = { x, y };
  if (B.robberHeld) { R.target = to; return; }
  const prev = R.g;
  if (!prev || reduced || document.hidden) {
    R.g = to;
    R.action = null;
    kick();
    return;
  }
  if (Math.abs(prev.x - x) < 1e-6 && Math.abs(prev.y - y) < 1e-6) return;
  guard(R);
  robberHop(R, to);
}

// 一次跳跃：下蹲蓄力 → 弧线腾空（转向目标、前倾）→ 落地压扁扬尘
function robberHop(R, to, { dur, H, panic = false } = {}) {
  const from = { ...R.g };
  const d = dist(from, to);
  dur ??= Math.max(750, Math.min(1400, 650 + d * 90));
  H ??= Math.min(1.2, 0.35 + d * 0.12);
  const dir = faceYaw(from, to);
  const A = panic ? 0.08 : 0.16;
  const L = panic ? 0.9 : 0.84;
  let landed = false;
  return play(R, dur, (p, P, now) => {
    R.yaw = angleTo(R.yaw, dir, panic ? 0.5 : 0.25);
    P.yaw = R.yaw;
    if (p < A) {
      const k = easeOut(p / A);
      P.sy *= 1 - 0.14 * k;
      P.sx *= 1 + 0.08 * k;
    } else if (p < L) {
      const k = (p - A) / (L - A);
      const arc = Math.sin(Math.PI * k);
      R.g = lerpPt(from, to, easeInOut(k));
      P.x = R.g.x;
      P.y = R.g.y;
      P.lift = H * 4 * k * (1 - k);
      P.grow *= 1 + 0.22 * arc * (panic ? 0.4 : 1);
      P.sy *= 1 + 0.12 * (1 - k) ** 3;
      P.lean = 0.28 * arc;
      if (panic) P.headY = 1.2 * Math.sin(k * Math.PI); // 边逃边回头张望
    } else {
      R.g = to;
      P.x = to.x;
      P.y = to.y;
      if (!landed) {
        landed = true;
        R.landAt = now;
        if (!panic) dustRing(to);
        else dustPuff(to, 0.8);
      }
    }
  });
}

// 开局：强盗从天而降落到沙漠（返回 false 表示 3D 未就绪，调用方回退到插画动画）
let introTimer = 0;
export function boardRobberIntro(delay, dur) {
  const R = B.robber;
  if (!B.renderer || !R) return false;
  if (reduced) return true; // 禁动画：直接站在原地
  R.hiddenUntil = performance.now() + delay;
  clearTimeout(introTimer);
  introTimer = setTimeout(() => {
    if (!R.g) return;
    let landed = false;
    play(R, dur, (p, P, now) => {
      P.lift = 1.3 * (1 - p * p);
      P.grow *= 1 + 0.18 * (1 - p);
      P.shadowK = 0.4 + 0.6 * p;
      if (p >= 1 && !landed) {
        landed = true;
        R.landAt = now;
        dustRing(R.g);
      }
    });
  }, delay);
  kick();
  return true;
}
export function finishBoardRobberIntro() {
  const R = B.robber;
  if (!R) return;
  clearTimeout(introTimer);
  R.hiddenUntil = 0;
  if (R.action) { R.action.resolve(); R.action = null; }
  kick();
}

// ====================================================================
// 骑士：状态同步
// ====================================================================
export function setKnightSelection(vids) {
  B.selected = new Set((vids || []).map(String));
  for (const [vid, ent] of B.knights) markSelected(ent, B.selected.has(vid));
  kick();
}
function markSelected(ent, on) {
  ent.selected = on;
  if (on && !ent.ring) {
    PLANE ||= new THREE.PlaneGeometry(1, 1);
    ent.ring = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({
      map: textures().ring, color: '#46cd82', transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    ent.ring.scale.set(0.5, 0.21, 1);
    ent.ring.renderOrder = -9;
    B.scene.add(ent.ring);
  }
}

// updateCKPieces 每次渲染调用：state.ck.knights（vid → {player, level, active}）
export function syncBoardKnights(knights, colors) {
  if (!B.renderer) { B.pendingKnights = [knights, colors]; return; }
  B.pendingKnights = null;
  const instant = B.firstSync || reduced; // 进局/重连的第一帧：现有骑士直接站好，不播入场
  B.firstSync = false;
  pruneExpectations();
  // 1) 事件接管的移动：实体改挂到新顶点，但先按住在原位，等 playKnightMoveBoard 再走
  for (const [to, ex] of B.expectMoves) {
    if (ex.ent) continue;
    const ent = B.knights.get(String(ex.ev.from));
    const k = knights[to];
    if (!ent || !k || ent.player !== k.player) continue;
    const victim = B.knights.get(to);
    if (victim && victim !== ent) { // 被驱逐的骑士：先留着当幽灵，等对战时被击倒
      B.knights.delete(to);
      victim.ghost = true;
      B.ghosts.add(victim);
      ex.victim = victim;
    }
    B.knights.delete(String(ex.ev.from));
    ent.vid = to;
    B.knights.set(to, ent);
    ex.ent = ent;
    ent.stanceHold = 1; // 行军时保持戒备姿态
  }
  // 2) 失效：顶点上已无骑士或换了主人
  const stale = [];
  for (const [vid, ent] of B.knights) {
    const k = knights[vid];
    if (!k || k.player !== ent.player) {
      stale.push(ent);
      B.knights.delete(vid);
    }
  }
  // 3) 逐个对齐状态
  for (const [vid, k] of Object.entries(knights)) {
    let ent = B.knights.get(vid);
    const color = colors[k.player];
    if (!ent) {
      const i = stale.findIndex((e) => e.player === k.player && e.level === k.level);
      if (i >= 0) { // 无事件的移动（重连补帧等）：沿路走过去
        ent = stale.splice(i, 1)[0];
        const from = ent.vid;
        ent.vid = vid;
        B.knights.set(vid, ent);
        if (instant) ent.g = vertexGround(vid);
        else { guard(ent); march(ent, pathPoints(k.player, from, vid)); }
      } else {
        ent = createKnight(vid, k, color);
        B.knights.set(vid, ent);
        if (!instant) dropIn(ent);
      }
    }
    if (ent.color !== color) { ent.color = color; ent.model.setLook(color, ent.stanceK < 0.5); }
    if (k.level !== ent.level) {
      if (instant || k.level < ent.level) swapKnightModel(ent, k.level);
      else promote(ent, k.level);
    }
    const wasActive = ent.active;
    ent.active = k.active;
    if (B.expectChase.has(vid)) ent.stanceHold = 1; // 驱逐强盗的骑士：等演出播完再休整
    else if (k.active && !wasActive && !instant && !ent.action) salute(ent);
    markSelected(ent, B.selected.has(vid));
  }
  // 4) 剩下的失效骑士：被驱逐无处安置 / 逃兵交出 → 击倒消失
  for (const ent of stale) {
    if (instant) removeEnt(ent);
    else knockOut(ent, { x: 0, y: -1 }, 0);
  }
  kick();
}

// ---------- 骑士通用动作 ----------
function dropIn(ent) {
  ent.hiddenUntil = 0;
  let landed = false;
  return play(ent, 380, (p, P, now) => {
    P.lift = 0.8 * (1 - p * p);
    P.grow *= 1 + 0.15 * (1 - p);
    P.shadowK = 0.4 + 0.6 * p;
    if (p >= 1 && !landed) {
      landed = true;
      ent.landAt = now;
      dustRing(ent.g, 8, 0.2, 0.8);
    }
  });
}

// 升级：腾空转一圈，金光一闪换上新装备
function promote(ent, level) {
  const alive = guard(ent);
  let swapped = false;
  return play(ent, 820, (p, P) => {
    if (!alive()) return;
    const k = Math.sin(Math.PI * Math.min(1, p / 0.8));
    P.lift = 0.22 * k;
    P.yaw = ent.yaw + Math.PI * 2 * easeInOut(Math.min(1, p / 0.8));
    setStance(P, 'victory');
    if (!swapped && p >= 0.42) {
      swapped = true;
      swapKnightModel(ent, level);
      flash(ent.g.x, ent.g.y, 0.36, '#ffd36b', 0.75, 420);
      shockRing(ent.g, '#ffd36b', 0.9, 480);
    }
    if (p >= 1) { ent.landAt = performance.now(); ent.yaw = P.yaw; }
  });
}

// 激活：举剑敬礼，剑尖一点闪光
function salute(ent) {
  let glinted = false;
  const tip = new THREE.Vector3();
  return play(ent, 700, (p, P) => {
    ent.stanceK = Math.max(ent.stanceK, p);
    mixStance(P, 'guard', 'salute', Math.sin(Math.PI * p));
    if (!glinted && p > 0.45) {
      glinted = true;
      ent.model.tipWorld(tip);
      flash(tip.x, -tip.y, 0, '#fffbe8', 0.22, 300);
    }
  });
}

// 被击倒：向后飞出、仰倒，沉进地里化作一团尘
function knockOut(ent, dir, power = 1) {
  ent.removed = true;
  B.ghosts.add(ent);
  const from = { ...ent.g };
  const to = { x: from.x + dir.x * (0.25 + 0.2 * power), y: from.y + dir.y * (0.25 + 0.2 * power) };
  let puffed = false;
  return play(ent, 760, (p, P, now) => {
    const k = Math.min(1, p / 0.55);
    ent.g = lerpPt(from, to, easeOut(k));
    P.x = ent.g.x;
    P.y = ent.g.y;
    P.lift = (0.18 + 0.2 * power) * Math.sin(Math.PI * k);
    P.lean = -1.25 * easeOut(k);
    P.yaw = ent.yaw + 0.8 * k;
    setStance(P, 'rest');
    if (p > 0.55) {
      const s = (p - 0.55) / 0.45;
      P.sink = easeOut(s);
      if (!puffed) { puffed = true; dustRing(ent.g, 8, 0.2, 0.9); ent.landAt = now; }
    }
    if (p >= 1) {
      B.ghosts.delete(ent);
      removeEnt(ent);
    }
  });
}

// 沿路网寻路（BFS），找不到就走直线；返回地面坐标点列
function pathPoints(player, from, to) {
  const roads = B.getState()?.roads || {};
  const src = Number(from);
  const dst = Number(to);
  const prev = new Map([[src, -1]]);
  const q = [src];
  while (q.length) {
    const v = q.shift();
    if (v === dst) break;
    for (const eid of B.board.vertices[v].adjE) {
      if (roads[eid] !== player) continue;
      const e = B.board.edges[eid];
      const w = e.v1 === v ? e.v2 : e.v1;
      if (prev.has(w)) continue;
      prev.set(w, v);
      q.push(w);
    }
  }
  if (!prev.has(dst)) return [vertexGround(src), vertexGround(dst)];
  const path = [];
  for (let v = dst; v !== -1; v = prev.get(v)) path.unshift(vertexGround(v));
  return path;
}

// 行军：1 级小碎步快跑、2 级沉重踏步（每步扬尘）、3 级大步流星（披风翻飞）
const GAIT = [
  { per: 400, amp: 0.6, bob: 0.05, lean: 0.14 },
  { per: 560, amp: 0.38, bob: 0.018, lean: 0.07 },
  { per: 460, amp: 0.45, bob: 0.035, lean: 0.1 },
];
function march(ent, pts, speed = 1) {
  const segLen = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    segLen.push(l);
    total += l;
  }
  if (total < 1e-3) return Promise.resolve();
  const G = GAIT[ent.level - 1];
  const steps = Math.max(2, Math.round(total * 2.4));
  let lastStep = -1;
  return play(ent, (G.per * total) / speed, (p, P) => {
    ent.stanceK = 1; // 行军中保持戒备
    let s = (ent.level === 2 ? p : easeInOut(p)) * total;
    let i = 0;
    while (i < segLen.length - 1 && s > segLen[i]) { s -= segLen[i]; i++; }
    const a = pts[i];
    const b = pts[i + 1];
    ent.g = lerpPt(a, b, segLen[i] ? Math.min(1, s / segLen[i]) : 1);
    P.x = ent.g.x;
    P.y = ent.g.y;
    ent.yaw = angleTo(ent.yaw, faceYaw(a, b), 0.3);
    P.yaw = ent.yaw;
    setStance(P, 'guard');
    const phase = p * steps * Math.PI;
    addGait(P, phase, G.amp);
    P.lift += Math.abs(Math.sin(phase)) * G.bob;
    P.lean += G.lean;
    if (ent.level === 3) { P.cape += 0.35; P.plume += 0.3; }
    const st = Math.floor(phase / Math.PI);
    if (st !== lastStep) {
      lastStep = st;
      if (ent.level === 2 && st > 0) { dustPuff(ent.g, 0.8); ent.landAt = performance.now() - 250; }
    }
  });
}

// 一跃而至（3 级冲锋）
function leap(ent, to, H = 0.32, dur = 460) {
  const from = { ...ent.g };
  return play(ent, dur, (p, P) => {
    ent.g = lerpPt(from, to, easeInOut(p));
    P.x = ent.g.x;
    P.y = ent.g.y;
    ent.yaw = angleTo(ent.yaw, faceYaw(from, to), 0.4);
    P.yaw = ent.yaw;
    P.lift = H * 4 * p * (1 - p);
    setStance(P, 'raise');
    P.cape += 0.5;
    P.plume += 0.45;
    P.lean += 0.15;
  });
}

// 出招：onImpact(i) 在每次命中时回调（2 级有盾击 + 横斩两下）；返回 Promise
async function strike(ent, target, onImpact) {
  const alive = () => !ent.removed;
  const yaw = faceYaw(ent.g, target);
  const home = { ...ent.g };
  const toward = (d) => {
    const L = dist(home, target) || 1;
    return { x: home.x + ((target.x - home.x) / L) * d, y: home.y + ((target.y - home.y) / L) * d };
  };
  const pose = (from, to, dur, lunge = 0, extra) => play(ent, dur, (p, P) => {
    ent.yaw = angleTo(ent.yaw, yaw, 0.5);
    P.yaw = ent.yaw;
    ent.stanceK = 1;
    const k = easeOut(p);
    mixStance(P, from, to, k);
    ent.g = toward(lunge * k);
    P.x = ent.g.x;
    P.y = ent.g.y;
    extra?.(p, P);
  });
  if (ent.level === 1) { // 一记突刺
    await pose('guard', 'thrustPrep', 140);
    if (!alive()) return;
    await pose('thrustPrep', 'thrust', 120, 0.1);
    onImpact(0, 1);
    await pose('thrust', 'guard', 260, 0.1, (p) => { ent.g = toward(0.1 * (1 - p)); });
  } else if (ent.level === 2) { // 盾击 + 横斩
    await pose('guard', 'bash', 180, 0.09);
    if (!alive()) return;
    onImpact(0, 2);
    await pose('bash', 'slashA', 140, 0.09);
    await pose('slashA', 'slashB', 130, 0.12);
    onImpact(1, 2);
    await pose('slashB', 'guard', 280, 0.12, (p) => { ent.g = toward(0.12 * (1 - p)); });
  } else { // 跃起下劈，落地金色冲击波
    await play(ent, 130, (p, P) => { ent.stanceK = 1; mixStance(P, 'guard', 'raise', p); P.sy *= 1 - 0.12 * p; });
    if (!alive()) return;
    await play(ent, 260, (p, P) => {
      ent.stanceK = 1;
      ent.yaw = angleTo(ent.yaw, yaw, 0.5);
      P.yaw = ent.yaw;
      P.lift = 0.22 * Math.sin(Math.PI * p);
      mixStance(P, 'raise', 'chop', easeOut(Math.max(0, (p - 0.4) / 0.6)));
      P.cape += 0.4;
      P.plume += 0.4;
    });
    ent.landAt = performance.now();
    shockRing(lerpPt(ent.g, target, 0.6), '#ffd36b', 1.3, 560);
    onImpact(0, 1);
    await pose('chop', 'guard', 320);
  }
}

// ====================================================================
// 事件编排
// ====================================================================
// 状态到达、渲染之前调用：登记本批事件，让渲染知道哪些变化要留给时间线来演
export function expectBoardEvents(events) {
  if (!B.renderer) return;
  const now = performance.now();
  for (const ev of events) {
    if (ev.type === 'knightMove') B.expectMoves.set(String(ev.to), { ev, at: now });
    else if (ev.type === 'knightChase') {
      B.expectChase.set(String(ev.vertex), { ev, at: now });
      B.chasePending = true;
    } else if (ev.type === 'robber' && B.chasePending) { // 驱逐后的那次移动：按住强盗，等逃窜演出
      B.chasePending = false;
      B.fleeSeq = ev.seq;
      B.robberHeld = true;
      B.robberHeldAt = now;
    }
  }
}
export function isRobberFlee(ev) { return !!B.renderer && ev.seq === B.fleeSeq; }

// 过期的登记：放弃接管，直接按状态落位
function pruneExpectations() {
  const now = performance.now();
  for (const [to, ex] of B.expectMoves) {
    if (now - ex.at < EXPECT_TTL) continue;
    B.expectMoves.delete(to);
    if (ex.ent) { ex.ent.stanceHold = null; ex.ent.g = vertexGround(to); }
    if (ex.victim) knockOut(ex.victim, { x: 0, y: -1 });
  }
  for (const [vid, ex] of B.expectChase) {
    if (now - ex.at < EXPECT_TTL) continue;
    B.expectChase.delete(vid);
    const ent = B.knights.get(vid);
    if (ent) ent.stanceHold = null;
  }
  if (B.robberHeld && now - B.robberHeldAt > EXPECT_TTL) releaseRobber();
}
function releaseRobber() {
  const R = B.robber;
  B.robberHeld = false;
  if (!R) return;
  R.cower = false;
  R.faceTo = null;
  if (R.target) { R.g = R.target; R.target = null; }
  kick();
}

// 时间线播放的步骤都包一层超时：任何意外都不会把后续事件卡死
const timed = (promise, ms = 8000) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);

// 骑士行军（含驱逐对方骑士的对战）
export function playKnightMoveBoard(ev) {
  return timed((async () => {
    const ex = B.expectMoves.get(String(ev.to));
    B.expectMoves.delete(String(ev.to));
    if (!B.renderer || !ex?.ent) return;
    const ent = ex.ent;
    const victim = ex.victim;
    if (document.hidden) { // 后台标签页没有 rAF：不演，直接落位，免得卡住时间线
      ent.g = vertexGround(ev.to);
      ent.stanceHold = null;
      if (victim) { B.ghosts.delete(victim); removeEnt(victim); }
      kick();
      return;
    }
    const alive = guard(ent);
    const pts = pathPoints(ent.player, ev.from, ev.to);
    if (victim) {
      const last = pts[pts.length - 1];
      const near = lerpPt(pts[pts.length - 2] || ent.g, last, 0.45);
      await march(ent, [...pts.slice(0, -1), near]);
      if (!alive()) return;
      const dir = { x: last.x - near.x, y: last.y - near.y };
      const L = Math.hypot(dir.x, dir.y) || 1;
      victim.yaw = faceYaw(victim.g, near);
      await strike(ent, last, (i, n) => {
        flash(lerp(near.x, last.x, 0.7), lerp(near.y, last.y, 0.7), 0.3, '#fff1cf', 0.32);
        if (i === n - 1) knockOut(victim, { x: dir.x / L, y: dir.y / L }, ent.level === 3 ? 1.6 : ent.level === 2 ? 1 : 0.6);
        else victim.landAt = performance.now();
      });
      if (!alive()) return;
      await march(ent, [ent.g, last], 0.8);
    } else {
      await march(ent, pts);
    }
    if (alive()) ent.stanceHold = null;
  })());
}

// 驱逐强盗·第一幕：骑士冲上去出招，强盗被打退缩到地块一角发抖，骑士回位
export function playChaseBoard(ev) {
  return timed((async () => {
    const vid = String(ev.vertex);
    B.expectChase.delete(vid);
    const K = B.knights.get(vid);
    const R = B.robber;
    if (!B.renderer || !K || !R?.g || document.hidden) { if (K) K.stanceHold = null; kick(); return; }
    const alive = guard(K);
    guard(R);
    K.stanceHold = 1;
    const home = { ...K.g };
    const d = dist(home, R.g);
    const ux = (R.g.x - home.x) / (d || 1);
    const uy = (R.g.y - home.y) / (d || 1);
    const ap = d > 0.42 ? { x: R.g.x - ux * 0.3, y: R.g.y - uy * 0.3 } : home;
    R.faceTo = home;
    R.yaw = faceYaw(R.g, home);
    if (K.level === 3) { await play(K, 140, (p, P) => { P.sy *= 1 - 0.12 * p; setStance(P, 'raise'); }); await leap(K, ap); K.landAt = performance.now(); }
    else await march(K, [home, ap], K.level === 1 ? 1.7 : 1);
    if (!alive()) return;
    await strike(K, R.g, (i, n) => robberReact(R, K, i, n, { x: ux, y: uy }));
    await wait(260);
    if (!alive()) return;
    await march(K, [K.g, home], 1.2);
    K.yaw = K.restYaw;
    K.stanceHold = null;
    B.lastChase = { knight: K };
  })());
}

// 强盗挨打的反应：1 级踉跄后跳、2 级被撞飞滑出、3 级被击飞翻滚；最后缩到地块内发抖
function robberReact(R, K, i, n, u) {
  const center = nearestHexCenter(R.g);
  const clampIn = (p) => { // 别被打出地块
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const L = Math.hypot(dx, dy);
    return L > 0.62 ? { x: center.x + (dx / L) * 0.62, y: center.y + (dy / L) * 0.62 } : p;
  };
  flash(R.g.x, R.g.y, 0.3, K.level === 3 ? '#ffd36b' : '#fff1cf', K.level === 3 ? 0.5 : 0.32);
  const from = { ...R.g };
  if (K.level === 2 && i === 0) { // 盾击：先被推开一小段
    const to = clampIn({ x: from.x + u.x * 0.12, y: from.y + u.y * 0.12 });
    play(R, 220, (p, P) => { R.g = lerpPt(from, to, easeOut(p)); P.x = R.g.x; P.y = R.g.y; P.sx *= 1 + 0.1 * Math.sin(Math.PI * p); P.lean = -0.3 * Math.sin(Math.PI * p); });
    return;
  }
  const far = K.level === 1 ? 0.22 : K.level === 2 ? 0.3 : 0.45;
  const H = K.level === 1 ? 0.1 : K.level === 2 ? 0.06 : 0.7;
  const spin = K.level === 1 ? 0 : K.level === 2 ? Math.PI * 1.2 : Math.PI * 3;
  const dur = K.level === 3 ? 820 : K.level === 2 ? 560 : 460;
  const to = clampIn({ x: from.x + u.x * far, y: from.y + u.y * far });
  const yaw0 = R.yaw;
  let landed = false;
  let lastPuff = 0;
  play(R, dur, (p, P, now) => {
    const k = K.level === 2 ? easeOut(p) : p;
    R.g = lerpPt(from, to, k);
    P.x = R.g.x;
    P.y = R.g.y;
    P.lift = H * 4 * p * (1 - p);
    P.yaw = yaw0 + spin * easeOut(p);
    P.roll = (K.level === 1 ? 0.35 * Math.sin(p * 14) * (1 - p) : K.level === 3 ? 0.6 * Math.sin(p * Math.PI) : 0);
    P.lean = -0.35 * Math.sin(Math.PI * p);
    P.glow = 3 * (1 - p) + 0.5;
    if (K.level === 2 && now - lastPuff > 70 && p < 0.8) { lastPuff = now; dustPuff(R.g, 0.7); }
    if (p >= 1 && !landed) {
      landed = true;
      R.landAt = now;
      R.yaw = P.yaw;
      if (K.level !== 1) dustRing(R.g, 8, 0.2, 0.8);
      R.cower = true;
      R.faceTo = K.g;
    }
  });
}

function nearestHexCenter(p) {
  let best = null;
  let bd = Infinity;
  for (const h of B.board.hexes) {
    const d = (h.x - p.x) ** 2 + (h.y - p.y) ** 2;
    if (d < bd) { bd = d; best = h; }
  }
  return best ? { x: best.x, y: best.y } : p;
}

// 驱逐强盗·第二幕：强盗回头看一眼，连滚带爬逃到新地块；骑士举剑庆祝后休整
export function playRobberFlee() {
  return timed((async () => {
    const R = B.robber;
    if (!B.renderer || !R?.g || !B.robberHeld || document.hidden) { releaseRobber(); return; }
    const to = R.target || R.g;
    const alive = guard(R);
    const K = B.lastChase?.knight;
    if (K && !K.removed && B.knights.get(K.vid) === K) {
      play(K, 700, (p, P) => mixStance(P, 'rest', 'victory', Math.sin(Math.PI * p)));
    }
    await play(R, 260, (p, P) => { P.sy *= 0.9; P.headY = 0.6 * Math.sin(Math.PI * p); P.lift = 0.04 * Math.sin(Math.PI * p); });
    if (!alive()) return;
    R.cower = false;
    R.faceTo = null;
    const start = { ...R.g };
    const d = dist(start, to);
    const n = Math.max(2, Math.min(7, Math.round(d / 0.55)));
    for (let i = 1; i <= n; i++) {
      await robberHop(R, lerpPt(start, to, i / n), { dur: 230, H: 0.14, panic: true });
      if (!alive()) return;
    }
    B.robberHeld = false;
    R.target = null;
    R.landAt = performance.now();
    dustRing(R.g, 8, 0.2, 0.8);
  })());
}
