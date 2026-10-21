// 中央 3D 演出：掷 7「强盗砸落」与「骑士驱逐强盗」特写，外加放大镜用的静帧。
// 一块画布在两个演出层之间搬家（同一时刻只演一幕），three 不可用时两幕都回退：
// 掷 7 用原插画动画，驱逐特写直接跳过（棋盘上的动作照常）。
import {
  THREE, loadThree, reduced, clamp01, lerp, easeInOut, easeOut, seg, spring,
  makeRenderer, addLights, textures, buildRobber, buildKnight, mixStance, setStance, addGait, applyKnightPose,
} from './three-figures.js';
import { sfx } from './sfx.js';

const TILT = 0.5; // 静帧用棋盘同款俯视角
const S = {
  canvas: null, renderer: null, scene: null, cam: null, rim: null, red: null, gold: null,
  robber: null, knights: {}, fx: [], mode: null, raf: 0, t0: 0, w: 0, h: 0,
  seven: null, chase: null, snapshots: new Map(), shake: { amp: 0, t0: 0 },
};

export function preloadStage3D() {
  return loadThree().then((ok) => { if (ok) setup(); return ok; });
}

function rigOf(fig) {
  const root = new THREE.Group();
  const squash = new THREE.Group();
  const yaw = new THREE.Group();
  const lean = new THREE.Group();
  root.add(squash); squash.add(yaw); yaw.add(lean); lean.add(fig);
  S.scene.add(root);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: textures().blob, color: '#120804', transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  S.scene.add(shadow);
  return { root, squash, yaw, lean, shadow };
}

function setup() {
  if (S.renderer) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'stage3d';
  try {
    S.renderer = makeRenderer(canvas);
  } catch (e) {
    return;
  }
  S.canvas = canvas;
  S.scene = new THREE.Scene();
  const { rim } = addLights(S.scene, S.renderer);
  S.rim = rim;
  S.red = new THREE.DirectionalLight('#ff4d33', 0); // 掷 7：背后猩红光，落地瞬间爆亮
  S.red.position.set(0, 1.4, -2.4);
  S.scene.add(S.red);
  S.gold = new THREE.PointLight('#ffcf6b', 0, 5, 1.5); // 3 级骑士下劈的金光
  S.scene.add(S.gold);
  S.cam = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  const robberModel = buildRobber();
  S.robber = { ...rigOf(robberModel.fig), model: robberModel };
  // 掷 7 演出层：画布插在压幕与插画盒之间，插画转为隐形占位（每帧取它的位置对准落点）
  const stage = document.getElementById('seven-stage');
  const box = stage?.querySelector('.sv-box');
  const img = box?.querySelector('.sv-robber');
  if (img) {
    S.seven = { stage, box, img };
    stage.insertBefore(canvas, box);
    stage.classList.add('r3d');
  }
  makeRobberSnapshot();
}

function knightRig(level) {
  if (!S.knights[level]) {
    const model = buildKnight(level, '#888888');
    S.knights[level] = { ...rigOf(model.fig), model, P: {} };
  }
  return S.knights[level];
}

function showOnly(list) {
  const on = new Set(list);
  for (const r of [S.robber, ...Object.values(S.knights)]) {
    r.root.visible = on.has(r);
    r.shadow.visible = on.has(r);
  }
}

function fit(w, h, pr = Math.min(window.devicePixelRatio || 1, 2)) {
  if (w === S.w && h === S.h && pr === S.pr) return;
  S.w = w;
  S.h = h;
  S.pr = pr;
  S.renderer.setPixelRatio(pr);
  S.renderer.setSize(w, h, false);
}

// ---------- 特效（精灵 + 地面圆环） ----------
function spawn(obj, dur, update) { // 用帧时间计时（与 rAF 时间戳同一时钟，首帧进度不会为负）
  S.scene.add(obj);
  S.fx.push({ obj, dur, update, t0: S.now ?? performance.now() });
}
function clearFx() {
  for (const f of S.fx) { S.scene.remove(f.obj); f.obj.material.dispose(); }
  S.fx.length = 0;
}
function stepFx(now) {
  for (let i = S.fx.length - 1; i >= 0; i--) {
    const f = S.fx[i];
    const p = Math.max(0, (now - f.t0) / f.dur);
    if (p >= 1) {
      S.scene.remove(f.obj);
      f.obj.material.dispose();
      S.fx.splice(i, 1);
    } else f.update(p);
  }
}
function dust3(pos, vel, size = 0.3, dur = 800, color = '#f2e3c4') {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures().puff, color, transparent: true, depthWrite: false }));
  spawn(s, dur, (p) => {
    s.position.set(pos.x + vel.x * easeOut(p), pos.y + vel.y * p, pos.z + vel.z * easeOut(p));
    s.scale.setScalar(size * (0.5 + p));
    s.material.opacity = 0.85 * (1 - p) ** 1.4;
  });
}
function dustBurst(x, z, n = 12, reach = 0.9, size = 0.3) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
    const spd = 0.75 + Math.random() * 0.5;
    dust3({ x: x + Math.cos(a) * 0.25, y: 0.05, z: z + Math.sin(a) * 0.2 },
      { x: Math.cos(a) * reach * spd, y: 0.22, z: Math.sin(a) * reach * 0.8 * spd }, size, 900);
  }
}
function flash3(pos, color = '#fff2d0', size = 0.6, dur = 300) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures().star, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.position.copy(pos);
  spawn(s, dur, (p) => {
    s.material.rotation = p * 0.9;
    s.scale.setScalar(size * (0.4 + 0.9 * Math.sin(Math.PI * Math.min(1, p * 1.4))));
    s.material.opacity = 1 - p * p;
  });
}
function ring3(x, z, color = '#ffd36b', size = 3.2, dur = 650) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: textures().ring, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.01, z);
  spawn(m, dur, (p) => {
    m.scale.setScalar(size * easeOut(p));
    m.material.opacity = 1 - p;
  });
}
function shake(amp) { S.shake = { amp, t0: S.now ?? performance.now() }; }

// ====================================================================
// 掷 7：强盗从镜头前砸下 → 落地压扁回弹扬尘 → 双眼爆亮、转身正对镜头
// ====================================================================
export function playSevenRobber() {
  if (!S.renderer || !S.seven) return false;
  stopLoop();
  S.mode = 'seven';
  if (S.canvas.parentElement !== S.seven.stage) S.seven.stage.insertBefore(S.canvas, S.seven.box);
  showOnly([S.robber]);
  S.cam.clearViewOffset();
  S.t0 = performance.now();
  S.landed = false;
  S.raf = requestAnimationFrame(frame);
  return true;
}
export function stopSevenRobber() {
  if (S.mode === 'seven') stopLoop();
}

function stopLoop() {
  cancelAnimationFrame(S.raf);
  S.raf = 0;
  clearFx();
  S.mode = null;
}

const SV_LAND = 0.36; // 与 showSevenStage 的震屏（380ms）对齐
const SV_FOV = 30;
function frameSeven(now) {
  const t = (now - S.t0) / 1000;
  const { stage, img } = S.seven;
  if (t > 2.9 || stage.classList.contains('hidden')) { stopLoop(); return false; }
  const w = S.canvas.clientWidth;
  const h = S.canvas.clientHeight;
  const sr = stage.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  if (!w || !h || !ir.height) return true;
  fit(w, h);
  // 模型高 1 ≈ 插画高的 0.92；据此反推镜头距离，再把模型腰部（y=0.46）平移到插画盒中心
  const dist = h / (0.92 * ir.height * 2 * Math.tan((SV_FOV / 2) * Math.PI / 180));
  const cx = ir.left + ir.width / 2 - sr.left;
  const cy = ir.top + ir.height * 0.5 - sr.top;
  const cam = S.cam;
  cam.fov = SV_FOV;
  cam.aspect = w / h;
  cam.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);

  const R = S.robber;
  let py = 0, pz = 0, sy = 1, sxz = 1, lean = 0;
  let yaw = -0.75;
  if (t < SV_LAND) {
    const e = (t / SV_LAND) ** 2;
    py = 0.35 * (1 - e);
    pz = 0.55 * dist * (1 - e); // 起点离镜头只剩 ~1/2.2 的距离：看起来约 2.2 倍大（同原插画的砸落起点）
    lean = 0.25 * (1 - e);
  } else {
    if (!S.landed) {
      S.landed = true;
      dustBurst(0, 0, 14, 0.85, 0.32);
    }
    const s = spring((t - SV_LAND) / 0.55);
    sy = 1 - 0.24 * s;
    sxz = 1 + 0.15 * s;
    yaw = -0.75 + 0.87 * easeOut(clamp01((t - SV_LAND) / 0.9));
    lean = 0.1 * easeInOut(clamp01((t - 1.1) / 0.8));
  }
  R.root.position.set(0, py, pz);
  R.squash.scale.set(sxz, sy, sxz);
  R.yaw.rotation.set(lean, yaw, 0);
  R.lean.rotation.set(0, 0, 0);
  R.model.head.rotation.set(0, 0, 0);
  R.model.cloak.rotation.y = 0.04 * Math.sin(t * 2.4);
  const glow = t < 0.5 ? 0.3 : t < 0.65 ? 0.3 + 5.7 * ((t - 0.5) / 0.15) : 6 - 3.8 * clamp01((t - 0.65) / 0.5);
  R.model.setGlow(glow);
  S.red.intensity = t < SV_LAND ? 0.6 : 1.6 + 4 * Math.exp(-(t - SV_LAND) * 2.5);
  S.rim.intensity = 1.2;
  S.gold.intensity = 0;
  const near = 1 - pz / (0.55 * dist);
  R.shadow.position.set(0, 0.002, 0);
  R.shadow.scale.setScalar(0.95 * (0.6 + 0.4 * near));
  R.shadow.material.opacity = 0.6 * near;

  const d = dist * (1 - 0.06 * easeInOut(clamp01(t / 2.75))); // 镜头缓慢推近
  cam.position.set(0, 0.46 + d * Math.sin(0.14), d * Math.cos(0.14));
  cam.lookAt(0, 0.46, 0);
  cam.updateProjectionMatrix();
  return true;
}

// ====================================================================
// 骑士驱逐强盗特写（约 2.9 秒，点击跳过）：
// 1 级 小碎步冲上去一记突刺，强盗踉跄后跳、缩成一团发抖
// 2 级 沉重踏步（每步扬尘震屏）→ 盾击 → 横斩，强盗被撞飞滑出、翻倒后爬起
// 3 级 下蹲蓄力 → 跃起下劈，落地金色冲击波，强盗被击飞到天边化作一颗星
// ====================================================================
const KX0 = -1.15;
const RX0 = 0.75;
const KYAW = Math.PI / 2 - 0.42; // 侧身朝右、略转向镜头
const RYAW = -Math.PI / 2 + 0.42;

function ensureChaseStage() {
  if (S.chase) return S.chase;
  const el = document.createElement('div');
  el.id = 'chase-stage';
  el.className = 'hidden';
  el.innerHTML = '<div class="cs-scrim"></div><div class="cs-cap"></div><div class="cs-skip">点击跳过 ▸▸</div>';
  (document.getElementById('board-area') || document.body).appendChild(el);
  S.chase = { el, cap: el.querySelector('.cs-cap'), finish: null };
  el.addEventListener('click', () => S.chase.finish?.());
  return S.chase;
}

const esc = (s) => {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
};

export function playChaseCinematic({ level, color, name }) {
  if (!S.renderer || reduced || document.hidden) return Promise.resolve(); // 后台标签页没有 rAF，跳过特写
  stopLoop();
  const C = ensureChaseStage();
  const lv = Math.max(1, Math.min(3, level || 1));
  C.cap.innerHTML = `<b style="color:${color}">${esc(name)}</b> 的<span class="cs-lv">${lv} 级骑士</span>驱逐了强盗！`;
  C.el.classList.remove('hidden', 'cap', 'out');
  C.el.insertBefore(S.canvas, C.el.querySelector('.cs-cap'));
  const K = knightRig(lv);
  K.model.setLook(color, false);
  showOnly([S.robber, K]);
  S.cam.clearViewOffset();
  S.mode = 'chase';
  S.level = lv;
  S.t0 = performance.now();
  S.once = new Set();
  S.robber.root.visible = true;
  return new Promise((resolve) => {
    let done = false;
    C.finish = () => {
      if (done) return;
      done = true;
      C.finish = null;
      C.el.classList.add('out');
      setTimeout(() => {
        C.el.classList.add('hidden');
        if (S.mode === 'chase') stopLoop();
        resolve();
      }, 280);
    };
    S.raf = requestAnimationFrame(frame);
  });
}

const once = (key, fn) => { if (!S.once.has(key)) { S.once.add(key); fn(); } };

function frameChase(now) {
  const t = (now - S.t0) / 1000;
  const C = S.chase;
  if (t > 2.9) { C.finish?.(); return t < 3.3; }
  const w = S.canvas.clientWidth;
  const h = S.canvas.clientHeight;
  if (!w || !h) return true;
  fit(w, h);
  const lv = S.level;
  const K = knightRig(lv);
  const R = S.robber;
  const KP = K.P;
  setStance(KP, 'guard');
  let kx = KX0, klift = 0, ksy = 1, kyaw = KYAW;
  let rx = RX0, rz = 0, rlift = 0, ryaw = RYAW, rsy = 1, rsx = 1, rlean = 0, rroll = 0, rhead = 0, rvis = true;
  let rglow = 1 + 0.25 * Math.sin(t * 3.3);
  const cower = (x, from) => { // 缩成一团发抖、低头、眼光乱闪
    rx = x + Math.sin(t * 55) * 0.008 * (t > from ? 1 : 0);
    rsy = 0.86;
    rhead = 0.3;
    rglow = 0.5 + 0.4 * Math.abs(Math.sin(t * 9));
  };
  // 强盗起初抱臂冷笑；骑士冲到半路时才回过神来
  const notice = seg(t, 0.5, 0.8);
  rglow += 1.5 * notice * (1 - seg(t, 1.0, 1.1));

  if (lv === 1) {
    const run = seg(t, 0.2, 0.85);
    kx = lerp(KX0, -0.02, easeInOut(run));
    if (run > 0 && run < 1) {
      const ph = run * 8 * Math.PI;
      addGait(KP, ph, 0.65);
      klift = Math.abs(Math.sin(ph)) * 0.05;
      KP.lean += 0.16;
      once(`s${Math.floor(ph / Math.PI)}`, () => sfx.knightStep(false));
    }
    if (t >= 0.85) mixStance(KP, 'guard', 'thrustPrep', easeOut(seg(t, 0.85, 1.0)));
    if (t >= 1.0) {
      const b = easeOut(seg(t, 1.0, 1.12));
      mixStance(KP, 'thrustPrep', 'thrust', b);
      kx += 0.12 * b;
      once('swing', () => sfx.swordSwing());
    }
    if (t >= 1.2) {
      const c = easeInOut(seg(t, 1.2, 1.6));
      mixStance(KP, 'thrust', 'guard', c);
      kx += 0.12 * (1 - c);
    }
    if (t >= 1.6) mixStance(KP, 'guard', 'thrust', 0.3 * easeInOut(seg(t, 1.6, 2.0))); // 剑尖指着强盗
    if (t >= 1.1) {
      once('hit', () => { flash3(new THREE.Vector3(RX0 - 0.12, 0.55, 0.05), '#fff2d0', 0.55); sfx.swordHit(); sfx.robberYelp(); shake(0.015); });
      const k = seg(t, 1.1, 1.5);
      rx = lerp(RX0, 1.15, easeOut(k));
      rlift = 0.14 * Math.sin(Math.PI * k);
      rroll = 0.4 * Math.sin(k * 14) * (1 - k);
      rlean = -0.35 * Math.sin(Math.PI * k);
      rglow = 3 * (1 - k) + 0.6;
      if (k >= 1) { once('land', () => dustBurst(1.15, 0, 6, 0.4, 0.2)); cower(1.15, 1.5); }
    }
  } else if (lv === 2) {
    const walk = seg(t, 0.2, 1.0);
    kx = lerp(KX0, -0.06, walk);
    if (walk > 0 && walk < 1) {
      const ph = walk * 6 * Math.PI;
      addGait(KP, ph, 0.4);
      KP.lean += 0.08;
      const st = Math.floor(ph / Math.PI);
      if (st > 0) once(`s${st}`, () => { dustBurst(kx, 0.05, 4, 0.25, 0.18); shake(0.012); sfx.knightStep(true); });
      ksy = 1 - 0.04 * Math.max(0, Math.cos(ph * 1)) ** 8;
    }
    if (t >= 1.0) {
      const a = easeOut(seg(t, 1.0, 1.18));
      mixStance(KP, 'guard', 'bash', a);
      kx += 0.09 * a;
    }
    if (t >= 1.12) once('bash', () => { sfx.shieldBash(); shake(0.02); flash3(new THREE.Vector3(RX0 - 0.15, 0.5, 0.05), '#fff2d0', 0.4); });
    if (t >= 1.22) mixStance(KP, 'bash', 'slashA', easeOut(seg(t, 1.22, 1.36)));
    if (t >= 1.36) { mixStance(KP, 'slashA', 'slashB', easeOut(seg(t, 1.36, 1.5))); once('swing', () => sfx.swordSwing()); }
    if (t >= 1.5) {
      const c = easeInOut(seg(t, 1.5, 1.9));
      mixStance(KP, 'slashB', 'guard', c);
      kx += 0.09 * (1 - c);
    }
    if (t >= 2.1) mixStance(KP, 'guard', 'bash', 0.35 * easeInOut(seg(t, 2.1, 2.4))); // 举盾压阵
    // 强盗：盾击推开 → 横斩撞飞，翻倒滑出带起尘土 → 爬起来缩着
    if (t >= 1.12) {
      const k = easeOut(seg(t, 1.12, 1.34));
      rx = RX0 + 0.25 * k;
      rsx = 1 + 0.12 * Math.sin(Math.PI * seg(t, 1.12, 1.34));
      rlean = -0.3 * Math.sin(Math.PI * seg(t, 1.12, 1.34));
    }
    if (t >= 1.44) {
      once('hit', () => {
        for (let i = 0; i < 3; i++) flash3(new THREE.Vector3(RX0 + 0.12 + i * 0.05, 0.45 + i * 0.07, 0.08), '#fff2d0', 0.4 - i * 0.08, 260 + i * 60);
        sfx.swordHit();
        sfx.robberYelp();
        shake(0.025);
      });
      const k = seg(t, 1.44, 2.0);
      rx = lerp(RX0 + 0.25, 1.45, easeOut(k));
      ryaw = RYAW + 2.4 * easeOut(k);
      rroll = 0.95 * Math.sin(Math.PI * Math.min(1, seg(t, 1.44, 2.3)));
      rlean = -0.3 * (1 - k);
      rglow = 3 * (1 - k) + 0.6;
      if (k < 0.9) once(`d${Math.floor(k * 10)}`, () => dust3({ x: rx, y: 0.04, z: 0.05 }, { x: -0.15, y: 0.15, z: 0 }, 0.22, 600));
      if (t >= 2.3) cower(1.45, 2.3);
    }
  } else {
    const crouch = seg(t, 0.2, 0.5);
    if (crouch > 0) { mixStance(KP, 'guard', 'raise', 0.6 * easeOut(crouch)); ksy = 1 - 0.14 * easeOut(crouch) * (1 - seg(t, 0.5, 0.6)); KP.cape += 0.3 * crouch; }
    if (t >= 0.5) {
      const k = seg(t, 0.5, 0.95);
      kx = lerp(KX0, -0.02, easeInOut(k));
      klift = 0.62 * 4 * k * (1 - k);
      setStance(KP, 'raise');
      KP.cape += 0.55 * (1 - seg(t, 1.0, 1.3));
      KP.plume += 0.5 * (1 - seg(t, 1.0, 1.3));
      KP.lean += 0.1;
      once('leap', () => sfx.swordSwing());
    }
    if (t >= 0.92) mixStance(KP, 'raise', 'chop', easeOut(seg(t, 0.92, 1.02)));
    if (t >= 1.0) once('impact', () => {
      ring3(0.35, 0, '#ffd36b', 3.6, 700);
      flash3(new THREE.Vector3(0.5, 0.35, 0.1), '#ffd36b', 1.4, 420);
      dustBurst(0.25, 0, 14, 1.0, 0.32);
      S.goldAt = S.now;
      shake(0.05);
      sfx.heroImpact();
    });
    if (t >= 1.04) mixStance(KP, 'chop', 'guard', easeInOut(seg(t, 1.04, 1.4)));
    if (t >= 1.4) mixStance(KP, 'guard', 'victory', easeInOut(seg(t, 1.4, 1.65)));
    if (t >= 1.65) {
      KP.plume += 0.15 * Math.sin(t * 9);
      KP.cape += 0.08 * Math.sin(t * 7);
      once('glint', () => flash3(K.model.tipWorld(new THREE.Vector3()), '#fffbe8', 0.45, 380));
    }
    if (t >= 1.0) { // 强盗被击飞：边翻滚边飞向天边，最后化作一颗星
      once('yelp', () => sfx.robberYelp());
      // 往纵深飞（越飞越小、向画面中上方收拢），整段都留在画面里
      const k = seg(t, 1.0, 1.9);
      const fly = easeOut(k);
      rx = lerp(RX0, 1.5, fly);
      rz = -5.5 * fly;
      rlift = 1.6 * Math.sin((Math.PI / 2) * Math.min(1, k * 1.25)) + 0.25 * k;
      ryaw = RYAW + 6 * Math.PI * k;
      rroll = 2.5 * k;
      rglow = 3;
      if (k >= 1) {
        rvis = false;
        once('star', () => { flash3(new THREE.Vector3(1.5, 1.85, -5.5), '#ffe9a6', 1.1, 520); sfx.twinkle(); });
      }
    }
  }
  if (t >= 1.25) C.el.classList.add('cap');

  // 写入骨架
  K.root.position.set(kx, klift, 0);
  K.squash.scale.set(1, ksy, 1);
  K.yaw.rotation.y = kyaw;
  K.lean.rotation.set(KP.lean, 0, 0);
  applyKnightPose(K.model, KP);
  K.shadow.position.set(kx, 0.004, 0);
  K.shadow.scale.setScalar(0.62 / (1 + klift));
  K.shadow.material.opacity = 0.55 / (1 + klift);
  R.root.visible = rvis;
  R.root.position.set(rx, rlift, rz);
  R.squash.scale.set(rsx, rsy, rsx);
  R.yaw.rotation.set(0, ryaw, 0);
  R.lean.rotation.set(rlean, 0, rroll);
  R.model.head.rotation.set(rhead, 0, 0);
  R.model.cloak.rotation.y = 0.04 * Math.sin(t * 2.4);
  R.model.setGlow(rglow);
  R.shadow.visible = rvis;
  R.shadow.position.set(rx, 0.003, rz);
  R.shadow.scale.setScalar(0.75 / (1 + rlift));
  R.shadow.material.opacity = 0.5 / (1 + rlift);
  S.red.intensity = 0;
  S.rim.intensity = 1.6;
  S.gold.position.set(0.3, 0.5, 0.4);
  S.gold.intensity = S.goldAt && lv === 3 ? 6 * Math.exp(-(now - S.goldAt) / 250) : 0;

  // 镜头：画面横跨约 3.4 单位（骑士起点 → 强盗被打退的落点），窄屏时拉远；冲击时震动，全程缓慢推近
  const cam = S.cam;
  cam.fov = 32;
  cam.aspect = w / h;
  const half = Math.tan((16 * Math.PI) / 180);
  const dist = Math.min(8, Math.max(4.0, 3.4 / (2 * half * cam.aspect))) * (1 - 0.05 * easeInOut(clamp01(t / 2.9)));
  const sk = S.shake.amp * Math.exp(-(now - S.shake.t0) / 120);
  const cx = 0.15;
  cam.position.set(cx + 0.15 + (Math.random() - 0.5) * sk, 0.5 + dist * 0.16 + (Math.random() - 0.5) * sk, dist);
  cam.lookAt(cx, 0.48, 0);
  cam.updateProjectionMatrix();
  return true;
}

function frame(now) {
  S.raf = 0;
  S.now = now;
  let more = false;
  if (S.mode === 'seven') more = frameSeven(now);
  else if (S.mode === 'chase') more = frameChase(now);
  if (!S.mode) return;
  stepFx(now);
  S.renderer.render(S.scene, S.cam);
  if (more) S.raf = requestAnimationFrame(frame);
}

// ====================================================================
// 放大镜静帧：棋盘同款俯视角、侧身姿态，画面比例与插画一致
// ====================================================================
function snapshot(target, aspect, yaw, setupFn) {
  const cam = new THREE.PerspectiveCamera(14, aspect, 0.1, 50);
  const d = 4.4;
  cam.position.set(0, 0.47 + d * Math.sin(TILT), d * Math.cos(TILT));
  cam.lookAt(0, 0.47, 0);
  showOnly([target]);
  target.root.position.set(0, 0, 0);
  target.root.visible = true;
  target.squash.scale.set(1, 1, 1);
  target.yaw.rotation.set(0, yaw, 0);
  target.lean.rotation.set(0, 0, 0);
  target.shadow.position.set(0, 0.002, 0);
  target.shadow.scale.setScalar(0.8);
  target.shadow.material.opacity = 0.45;
  setupFn?.();
  S.red.intensity = 0;
  S.gold.intensity = 0;
  const W = 240;
  const H = Math.round(W / aspect);
  fit(W, H, 1);
  S.renderer.render(S.scene, cam);
  const url = S.canvas.toDataURL('image/png');
  S.w = S.h = 0; // 下次演出重新按画布尺寸设置
  return url;
}

function makeRobberSnapshot() {
  S.snapshots.set('robber', snapshot(S.robber, 0.8, 0.38, () => {
    S.robber.model.setGlow(1.4);
    S.robber.model.head.rotation.set(0, 0, 0);
  }));
}
export function robberSnapshot() { return S.snapshots.get('robber') || null; }

// 骑士静帧（插画框 0.54 × 0.74），首次悬停时现做并缓存；演出进行中不打断，回退插画
export function knightSnapshot(level, color) {
  if (!S.renderer || S.mode) return null;
  const key = `k${level}|${color}`;
  if (!S.snapshots.has(key)) {
    const K = knightRig(level);
    S.snapshots.set(key, snapshot(K, 0.54 / 0.74, -0.3, () => {
      K.model.setLook(color, false);
      applyKnightPose(K.model, setStance(K.P, 'guard'));
    }));
  }
  return S.snapshots.get(key);
}
