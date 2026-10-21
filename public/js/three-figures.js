// 3D 棋子公共部分：three.js 加载、材质、程式化模型（强盗 + 三级骑士，无外部模型文件）与骑士姿态。
// 模型约定：高约 1、底座圆心在原点、正面朝 +Z。棋盘层（board3d.js）与中央演出（stage3d.js）共用。

export let THREE = null;
let RoomEnvironment = null;
let mergeGeometries = null;
let loading = null;
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// 页面空闲时预加载；失败（离线/老浏览器）返回 false，调用方保留插画
export function loadThree() {
  if (!loading) {
    loading = Promise.all([
      import('three'),
      import('three/addons/environments/RoomEnvironment.js'),
      import('three/addons/utils/BufferGeometryUtils.js'),
    ]).then(([t, env, bgu]) => {
      THREE = t;
      RoomEnvironment = env.RoomEnvironment;
      mergeGeometries = bgu.mergeGeometries;
      return true;
    }).catch((e) => {
      console.warn('3D 棋子加载失败，保留插画', e);
      return false;
    });
  }
  return loading;
}

// ---------- 数学小工具 ----------
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
export const easeOut = (k) => 1 - (1 - k) ** 3;
export const easeIn = (k) => k * k * k;
export const seg = (t, a, b) => clamp01((t - a) / (b - a)); // t 在 [a,b] 内的进度
export const spring = (q) => (q >= 1 ? 0 : Math.exp(-5 * q) * Math.cos(11 * q)); // 落地回弹
export function angleTo(from, to, k) {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + d * k;
}

// ---------- 渲染器 / 灯光 / 贴图 ----------
export function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  r.setClearColor(0x000000, 0);
  r.toneMapping = THREE.NeutralToneMapping;
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  return r;
}

export function addLights(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#ffe9cc', '#3a2817', 1.1));
  const key = new THREE.DirectionalLight('#fff0d8', 2.6); // 主光从左上前方打来，与插画光向一致
  key.position.set(-2, 2.6, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#ffc27a', 1.6); // 背后轮廓光，把剪影从棋盘上剥离出来
  rim.position.set(2.2, 1.6, -2.2);
  scene.add(rim);
  return { key, rim };
}

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 四芒星：刀光/闪光点
function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 ? 6 : 32;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 冲击波圆环
function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 30, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,255,255,.9)');
  grad.addColorStop(0.85, 'rgba(255,255,255,.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let TEX = null;
export function textures() {
  if (TEX) return TEX;
  TEX = {
    blob: radialTexture([[0, 'rgba(0,0,0,1)'], [0.55, 'rgba(0,0,0,.55)'], [1, 'rgba(0,0,0,0)']]),
    puff: radialTexture([[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,.5)'], [1, 'rgba(255,255,255,0)']]),
    glow: radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']]),
    star: starTexture(),
    ring: ringTexture(),
  };
  return TEX;
}

// ====================================================================
// 强盗：暗铜雕像（兜帽斗篷、双手抱胸、发光双眼）
// ====================================================================
const AMBER = [1, 0.62, 0.24];
let RMAT = null;
function robberMaterials() {
  if (RMAT) return RMAT;
  const std = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  RMAT = { // 斗篷/兜帽/袖子同色，底座与内袍更深，皮具偏暖，金属件发亮
    cloak: std('#5e4431', 0.45, 0.52, { side: THREE.DoubleSide }),
    bronze: std('#6a4c35', 0.5, 0.46),
    dark: std('#3d2c20', 0.45, 0.58),
    leather: std('#714a2b', 0.25, 0.58),
    gold: std('#d8a852', 0.9, 0.26),
    void: new THREE.MeshBasicMaterial({ color: '#0b0705' }),
  };
  return RMAT;
}

// 斗篷：开口的旋转体，再逐顶点把前襟开口改成「领口窄、下摆宽」，叠加褶皱与后摆外扩
function cloakGeometry() {
  const V = (r, y) => new THREE.Vector2(r, y);
  const pts = [V(0.255, 0.078), V(0.248, 0.14), V(0.236, 0.25), V(0.218, 0.38), V(0.2, 0.5),
    V(0.19, 0.56), V(0.174, 0.61), V(0.132, 0.655), V(0.095, 0.672)];
  const G0 = 1.2;
  const TAU = Math.PI * 2;
  const geo = new THREE.LatheGeometry(pts, 64, G0 / 2, TAU - G0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    let a = Math.atan2(x, z);
    if (a < 0) a += TAU;
    const t = (a - G0 / 2) / (TAU - G0);
    const h = clamp01((y - 0.078) / (0.672 - 0.078)); // 0 下摆 → 1 领口
    const gap = 1.5 - 1.3 * h ** 1.6;
    const a2 = gap / 2 + t * (TAU - gap);
    const low = 1 - h;
    const fold = 1 + 0.07 * low * low * Math.sin(a2 * 7 + 0.6) + 0.018 * Math.sin(a2 * 13);
    const back = 1 + 0.06 * low * (1 - Math.cos(a2)) / 2;
    const r2 = r * fold * back;
    const y2 = h < 0.01 ? y + 0.008 * (1 + Math.sin(a2 * 5)) : y; // 下摆起伏
    pos.setXYZ(i, Math.sin(a2) * r2, y2, Math.cos(a2) * r2);
  }
  geo.computeVertexNormals();
  return geo;
}

// 兜帽：旋转体，帽尖向后上方拉出
function hoodGeometry() {
  const V = (r, y) => new THREE.Vector2(r, y);
  const pts = [V(0, 0), V(0.12, 0.005), V(0.162, 0.07), V(0.168, 0.15), V(0.142, 0.235),
    V(0.088, 0.298), V(0.032, 0.334), V(0, 0.342)];
  const geo = new THREE.LatheGeometry(pts, 40);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    let z = pos.getZ(i) * 1.08;
    if (y > 0.2) z -= ((y - 0.2) / 0.14) ** 2 * 0.085;
    pos.setZ(i, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function capsuleBetween(a, b, r, segs = 12) {
  const p1 = new THREE.Vector3(...a);
  const p2 = new THREE.Vector3(...b);
  const dir = p2.clone().sub(p1);
  const geo = new THREE.CapsuleGeometry(r, dir.length(), 4, segs);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  geo.applyMatrix4(new THREE.Matrix4().compose(p1.add(p2).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return geo;
}

export function buildRobber() {
  const M = robberMaterials();
  const T = textures();
  const V = (r, y) => new THREE.Vector2(r, y);
  const fig = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = fig) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // 底座（带倒角的圆台）
  add(new THREE.LatheGeometry([V(0, 0), V(0.285, 0), V(0.302, 0.014), V(0.306, 0.036), V(0.297, 0.058), V(0.278, 0.072), V(0, 0.072)], 56), M.dark);
  // 靴尖从下摆露出
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(1, 16, 12), M.leather, s * 0.064, 0.1, 0.13).scale.set(0.052, 0.04, 0.085);
  // 内袍 + 腰带 + 金扣 + 腰包（从前襟开口里露出来）
  add(new THREE.LatheGeometry([V(0, 0.075), V(0.16, 0.075), V(0.15, 0.2), V(0.136, 0.36), V(0.15, 0.5), V(0.14, 0.58), V(0.09, 0.66), V(0, 0.67)], 36), M.dark);
  add(new THREE.TorusGeometry(0.139, 0.017, 8, 44), M.leather, 0, 0.37, 0).rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(0.062, 0.05, 0.022), M.gold, 0, 0.37, 0.15);
  add(new THREE.BoxGeometry(0.056, 0.066, 0.042), M.leather, 0.108, 0.322, 0.098).rotation.y = 0.75;
  // 斗篷与领口金扣
  const cloak = add(cloakGeometry(), M.cloak);
  add(new THREE.SphereGeometry(0.027, 14, 10), M.gold, 0, 0.628, 0.128);
  // 双臂抱胸：上臂藏在斗篷里，前臂在胸前交叉
  add(capsuleBetween([0.168, 0.585, 0], [0.172, 0.462, 0.13], 0.05), M.cloak);
  add(capsuleBetween([-0.168, 0.585, 0], [-0.172, 0.462, 0.13], 0.05), M.cloak);
  add(capsuleBetween([0.172, 0.462, 0.13], [-0.12, 0.505, 0.205], 0.047), M.bronze);
  add(capsuleBetween([-0.172, 0.462, 0.13], [0.12, 0.512, 0.185], 0.047), M.bronze);
  add(new THREE.SphereGeometry(0.04, 12, 10), M.leather, -0.13, 0.505, 0.2);
  add(new THREE.SphereGeometry(0.04, 12, 10), M.leather, 0.13, 0.512, 0.18);

  // 头部组（待机时轻微转头）：兜帽 + 帽檐 + 幽暗面孔 + 发光双眼
  const head = new THREE.Group();
  head.position.set(0, 0.66, 0);
  fig.add(head);
  add(hoodGeometry(), M.cloak, 0, 0, 0, head);
  add(new THREE.SphereGeometry(1, 24, 18), M.void, 0, 0.14, 0.12, head).scale.set(0.097, 0.1, 0.07);
  const rim = add(new THREE.TorusGeometry(0.1, 0.025, 10, 32), M.bronze, 0, 0.145, 0.165, head);
  rim.scale.set(1, 1.1, 0.7);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...AMBER) });
  const glowMat = new THREE.SpriteMaterial({
    map: T.glow, color: new THREE.Color(...AMBER), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const halos = [];
  for (const s of [-1, 1]) {
    const eye = add(new THREE.SphereGeometry(0.017, 12, 8), eyeMat, s * 0.036, 0.15, 0.187, head);
    eye.scale.set(1.5, 0.55, 0.5);
    eye.rotation.z = s * 0.35; // 内眼角压低，眼神凶一点
    const halo = new THREE.Sprite(glowMat);
    halo.position.set(s * 0.036, 0.15, 0.2);
    halo.scale.setScalar(0.11);
    head.add(halo);
    halos.push(halo);
  }

  return {
    fig, head, cloak,
    setGlow(k) { // k≈1 常态；>1 更亮（颜色超过 1 由色调映射压向白热）
      eyeMat.color.setRGB(AMBER[0] * k, AMBER[1] * k, AMBER[2] * k);
      glowMat.opacity = clamp01(0.28 * k);
      for (const h of halos) h.scale.setScalar(0.08 + 0.011 * Math.min(k, 6));
    },
  };
}

// ====================================================================
// 骑士：1 级民兵（圆顶盔、布衣、单手剑）/ 2 级重甲（面甲盔、板甲护肩、十字鸢形盾）/
// 3 级统帅（羽饰大盔、金边铠甲、纹章盾、长披风）。布衣/盾面/披风/羽毛/底座用玩家色，铠甲统一钢色。
// 可动部件（腿、双臂、剑、头、披风、羽饰）各自成组；组内按材质合并几何，每个骑士十余次绘制。
// ====================================================================
export const KNIGHT_SIZE = [0.92, 1, 1.07]; // 等级越高越魁梧
const KMAT = new Map();
export function knightMats(color, idle) {
  const key = `${color}|${idle ? 1 : 0}`;
  if (KMAT.has(key)) return KMAT.get(key);
  const c = new THREE.Color(color);
  if (idle) { // 休整：去饱和压暗，与插画版的灰化一致
    const g = (c.r + c.g + c.b) / 3;
    c.lerp(new THREE.Color(g, g, g), 0.6).multiplyScalar(0.72);
  }
  const std = (col, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color: col, metalness, roughness, ...extra });
  const m = {
    cloth: std(c, 0, 0.72, { side: THREE.DoubleSide }),
    clothDark: std(c.clone().multiplyScalar(0.62), 0, 0.75, { side: THREE.DoubleSide }),
    base: std(c.clone().multiplyScalar(0.7), 0.1, 0.55),
    steel: std(idle ? '#7b828a' : '#b6bec8', 0.85, 0.34),
    steelDark: std(idle ? '#4f555c' : '#6f7882', 0.8, 0.45),
    blade: std(idle ? '#9aa1a8' : '#e2e8ee', 0.92, 0.2),
    gold: std(idle ? '#8c784f' : '#dcab4e', 0.9, 0.28),
    leather: std(idle ? '#4e3d2f' : '#6e4a2c', 0.2, 0.62),
    skin: std(idle ? '#9a8370' : '#d9a77c', 0, 0.7),
    emblem: std(idle ? '#a7a39a' : '#f3eee2', 0.1, 0.5),
    void: new THREE.MeshBasicMaterial({ color: '#0a0a0c' }),
  };
  KMAT.set(key, m);
  return m;
}

const KGEO = new Map();
function knightGeometry(L) {
  if (KGEO.has(L)) return KGEO.get(L);
  const V2 = (x, y) => new THREE.Vector2(x, y);
  const parts = { base: [], body: [], head: [], plume: [], legL: [], legR: [], armS: [], sword: [], armH: [], cape: [] };
  const put = (part, key, geo, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
    parts[part].push([key, geo]);
  };
  const cap = (part, key, a, b, r) => parts[part].push([key, capsuleBetween(a, b, r, 10)]);
  const heavy = L >= 2;
  const metal = heavy ? 'steel' : 'leather';
  const sphere = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);

  // 底座：玩家色圆台，远看也能一眼认出是谁的骑士
  put('base', 'base', new THREE.LatheGeometry([V2(0, 0), V2(0.225, 0), V2(0.24, 0.012), V2(0.244, 0.03), V2(0.236, 0.046), V2(0.222, 0.056), V2(0, 0.056)], 40));

  // 双腿（髋关节为原点）
  for (const part of ['legL', 'legR']) {
    cap(part, metal, [0, 0, 0], [0, -0.25, 0.01], 0.043);
    if (heavy) put(part, 'steel', sphere(0.033), [0, -0.13, 0.035]);
    put(part, heavy ? 'steelDark' : 'leather', sphere(1, 12, 8), [0, -0.268, 0.03], [0, 0, 0], [0.05, 0.036, 0.078]);
  }

  // 躯干：战袍下摆（玩家色）+ 胸甲/布衣 + 腰带
  put('body', 'cloth', new THREE.LatheGeometry([V2(0.122, 0.235), V2(0.134, 0.3), V2(0.125, 0.37), V2(0.112, 0.42), V2(0, 0.425)], 24));
  put('body', heavy ? 'steel' : 'cloth', new THREE.LatheGeometry([V2(0, 0.4), V2(0.106, 0.4), V2(0.121, 0.48), V2(0.131, 0.56), V2(0.125, 0.62), V2(0.07, 0.665), V2(0, 0.672)], 24));
  put('body', L === 3 ? 'gold' : 'leather', new THREE.TorusGeometry(0.114, 0.014, 6, 28), [0, 0.41, 0], [Math.PI / 2, 0, 0]);
  put('body', 'gold', new THREE.BoxGeometry(0.04, 0.034, 0.02), [0, 0.41, 0.118]);
  if (L === 3) put('body', 'gold', new THREE.TorusGeometry(0.131, 0.009, 6, 28), [0, 0.56, 0], [Math.PI / 2, 0, 0]);
  if (!heavy) put('body', 'steelDark', new THREE.CylinderGeometry(0.06, 0.07, 0.05, 16), [0, 0.675, 0]); // 锁子甲护颈
  if (heavy) { // 护肩
    const ps = L === 3 ? [0.078, 0.06, 0.082] : [0.068, 0.052, 0.072];
    for (const s of [-1, 1]) {
      put('body', 'steel', sphere(1, 16, 10), [s * 0.145, 0.615, 0], [0, 0, 0], ps);
      if (L === 3) put('body', 'gold', new THREE.TorusGeometry(0.07, 0.009, 6, 24), [s * 0.15, 0.59, 0], [Math.PI / 2, 0, s * 0.35], [1, 1.1, 1]);
    }
  }

  // 头部（脖颈为原点）
  if (!heavy) { // 圆顶铁盔 + 帽檐 + 护鼻，露出脸
    put('head', 'steelDark', sphere(0.078), [0, 0.075, 0]);
    put('head', 'skin', sphere(0.066), [0, 0.072, 0.026]);
    put('head', 'steel', new THREE.SphereGeometry(0.088, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.088, 0]);
    put('head', 'steel', new THREE.TorusGeometry(0.09, 0.012, 6, 24), [0, 0.088, 0], [Math.PI / 2, 0, 0]);
    put('head', 'steel', new THREE.BoxGeometry(0.014, 0.07, 0.014), [0, 0.07, 0.092]);
  } else { // 桶形大盔 + 视缝 + 护鼻脊
    put('head', 'steel', new THREE.LatheGeometry([V2(0, 0), V2(0.072, 0), V2(0.084, 0.05), V2(0.086, 0.13), V2(0.077, 0.175), V2(0.045, 0.2), V2(0, 0.206)], 20));
    put('head', 'void', new THREE.BoxGeometry(0.13, 0.016, 0.03), [0, 0.122, 0.077]);
    put('head', 'steel', new THREE.BoxGeometry(0.014, 0.16, 0.03), [0, 0.1, 0.082]);
    if (L === 3) {
      put('head', 'gold', new THREE.TorusGeometry(0.087, 0.011, 6, 24), [0, 0.158, 0], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 6; i++) { // 羽饰：一串渐细的椭球向后上方甩出
        const t = i / 5;
        put('plume', 'cloth', sphere(1, 12, 8), [0, 0.035 + 0.11 * Math.sin(t * Math.PI * 0.6), -0.02 - 0.2 * t], [0.4 * t, 0, 0],
          [0.034 * (1 - 0.5 * t), 0.042 * (1 - 0.5 * t), 0.06 * (1 - 0.4 * t)]);
      }
    }
  }

  // 持剑手（右臂 = -X，肩关节为原点）
  cap('armS', heavy ? 'steel' : 'cloth', [0, 0, 0], [0, -0.13, 0.015], 0.036);
  cap('armS', heavy ? 'steel' : 'leather', [0, -0.13, 0.015], [0, -0.235, 0.07], 0.033);
  put('armS', 'leather', sphere(0.032), [0, -0.245, 0.08]);
  // 剑（握把为原点，剑身沿 +Y）
  const BL = [0.32, 0.38, 0.43][L - 1];
  put('sword', 'blade', new THREE.BoxGeometry(0.028, BL, 0.009), [0, 0.03 + BL / 2, 0]);
  put('sword', 'blade', new THREE.ConeGeometry(0.0145, 0.04, 4), [0, 0.05 + BL, 0], [0, 0, 0], [1, 1, 0.32]);
  put('sword', heavy ? 'gold' : 'steel', new THREE.BoxGeometry(L === 3 ? 0.13 : 0.1, 0.018, 0.024), [0, 0.03, 0]);
  put('sword', 'leather', new THREE.CylinderGeometry(0.012, 0.012, 0.07, 8), [0, -0.005, 0]);
  put('sword', heavy ? 'gold' : 'steel', sphere(0.019, 10, 8), [0, -0.045, 0]);

  // 持盾手（左臂 = +X）
  cap('armH', heavy ? 'steel' : 'cloth', [0, 0, 0], [0, -0.13, 0.015], 0.036);
  cap('armH', heavy ? 'steel' : 'leather', [0, -0.13, 0.015], [0, -0.22, 0.09], 0.033);
  put('armH', 'leather', sphere(0.032), [0, -0.228, 0.1]);
  if (heavy) {
    const sh = new THREE.Shape();
    if (L === 2) { // 鸢形盾
      sh.moveTo(0, 0.15);
      sh.quadraticCurveTo(0.11, 0.15, 0.1, 0.06);
      sh.quadraticCurveTo(0.085, -0.08, 0, -0.2);
      sh.quadraticCurveTo(-0.085, -0.08, -0.1, 0.06);
      sh.quadraticCurveTo(-0.11, 0.15, 0, 0.15);
    } else { // 纹章盾（平顶）
      sh.moveTo(-0.115, 0.14);
      sh.lineTo(0.115, 0.14);
      sh.quadraticCurveTo(0.115, -0.04, 0, -0.18);
      sh.quadraticCurveTo(-0.115, -0.04, -0.115, 0.14);
    }
    const ext = { depth: 0.018, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 1, curveSegments: 10 };
    const sp = [0.035, -0.19, 0.118];
    const sr = [0, -0.35, 0];
    put('armH', 'cloth', new THREE.ExtrudeGeometry(sh, ext), sp, sr);
    put('armH', L === 3 ? 'gold' : 'steel', new THREE.ExtrudeGeometry(sh, { ...ext, bevelEnabled: false, depth: 0.012 }),
      [sp[0] - 0.003, sp[1], sp[2] - 0.008], sr, [1.09, 1.07, 1]);
    const zf = 0.026;
    const emb = (geo, p) => { // 盾面纹章：先摆在盾面坐标里，再随盾一起旋转平移
      geo.translate(p[0], p[1], zf);
      geo.applyMatrix4(new THREE.Matrix4().makeRotationY(sr[1]));
      geo.translate(...sp);
      return geo;
    };
    if (L === 2) {
      parts.armH.push(['emblem', emb(new THREE.BoxGeometry(0.024, 0.27, 0.006), [0, -0.02])]);
      parts.armH.push(['emblem', emb(new THREE.BoxGeometry(0.15, 0.024, 0.006), [0, 0.05])]);
    } else {
      const crown = new THREE.Shape();
      crown.moveTo(-0.056, -0.035);
      crown.lineTo(0.056, -0.035);
      crown.lineTo(0.064, 0.045);
      crown.lineTo(0.032, 0.012);
      crown.lineTo(0, 0.062);
      crown.lineTo(-0.032, 0.012);
      crown.lineTo(-0.064, 0.045);
      crown.closePath();
      parts.armH.push(['gold', emb(new THREE.ExtrudeGeometry(crown, { depth: 0.006, bevelEnabled: false }), [0, 0.0])]);
    }
  }

  // 披风（颈后为原点，开口圆台从肩头垂到身后）
  const CH = [0.3, 0.4, 0.56][L - 1];
  const CR = [0.17, 0.19, 0.22][L - 1];
  const TH = 2.3;
  put('cape', L === 3 ? 'cloth' : 'clothDark',
    new THREE.CylinderGeometry(0.12, CR, CH, 14, 5, true, Math.PI - TH / 2, TH), [0, -CH / 2, 0.06]);

  // 同组同材质合并：toNonIndexed 统一（Extrude 本来就无索引），只保留位置与法线
  const merged = {};
  for (const [part, items] of Object.entries(parts)) {
    const byKey = new Map();
    for (const [key, g] of items) {
      const ng = g.index ? g.toNonIndexed() : g;
      for (const name of Object.keys(ng.attributes)) if (name !== 'position' && name !== 'normal') ng.deleteAttribute(name);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(ng);
    }
    merged[part] = [...byKey].map(([key, list]) => [key, list.length === 1 ? list[0] : mergeGeometries(list)]);
  }
  KGEO.set(L, merged);
  return merged;
}

export function buildKnight(level, color) {
  const geo = knightGeometry(level);
  const meshes = [];
  const mk = (part, parent, pivot) => {
    const g = new THREE.Group();
    g.position.set(...pivot);
    parent.add(g);
    for (const [key, gg] of geo[part]) {
      const m = new THREE.Mesh(gg);
      m.userData.key = key;
      g.add(m);
      meshes.push(m);
    }
    return g;
  };
  const fig = new THREE.Group();
  const sz = KNIGHT_SIZE[level - 1];
  fig.scale.set(sz * (level === 3 ? 1.05 : 1), sz, sz * (level === 3 ? 1.05 : 1));
  mk('base', fig, [0, 0, 0]);
  mk('body', fig, [0, 0, 0]);
  const legL = mk('legL', fig, [0.065, 0.36, 0]);
  const legR = mk('legR', fig, [-0.065, 0.36, 0]);
  const head = mk('head', fig, [0, 0.67, 0]);
  const plume = level === 3 ? mk('plume', head, [0, 0.2, 0]) : null;
  const armS = mk('armS', fig, [-0.142, 0.612, 0]);
  const sword = mk('sword', armS, [0, -0.245, 0.08]);
  const armH = mk('armH', fig, [0.142, 0.612, 0]);
  const cape = mk('cape', fig, [0, 0.645, -0.06]);
  const rig = {
    fig, legL, legR, head, plume, armS, sword, armH, cape, meshes, level, color, idle: null,
    setLook(col, idle) { // 换玩家色 / 激活与休整的明暗
      if (rig.color === col && rig.idle === idle) return;
      rig.color = col;
      rig.idle = idle;
      const M = knightMats(col, idle);
      for (const m of meshes) m.material = M[m.userData.key];
    },
    // 剑尖的世界坐标（刀光/闪光定位用）
    tipWorld(out) {
      return sword.localToWorld(out.set(0, 0.07 + [0.32, 0.38, 0.43][level - 1], 0));
    },
  };
  rig.setLook(color, false);
  return rig;
}

// ---------- 骑士姿态：扁平数值表，便于在姿势之间插值 ----------
// aS*/sw*：持剑手与剑（剑刃方向角 = aSx + swx：0 朝上、π/2 朝前、π 朝下）；aH*：持盾手；
// lL/lR：腿摆；hx/hy：点头/转头；cape：披风后扬；plume：羽饰；lean：全身前倾
export const STANCE = {
  guard: { aSx: -0.35, aSy: 0, aSz: 0.12, swx: 0.6, swy: 0, swz: 0.14, aHx: -0.28, aHy: 0, aHz: -0.06, lL: 0, lR: 0, hx: 0, hy: 0, cape: 0.06, plume: 0, lean: 0 },
  rest: { aSx: -0.12, aSy: 0, aSz: 0.05, swx: 2.92, swy: 0, swz: 0, aHx: -0.05, aHy: 0, aHz: -0.04, lL: 0, lR: 0, hx: 0.3, hy: 0, cape: 0, plume: -0.1, lean: 0.04 },
  raise: { aSx: -3.0, aSy: 0, aSz: 0.15, swx: 2.2, swy: 0, swz: 0, aHx: -0.6, aHy: 0, aHz: -0.1, lL: 0, lR: 0, hx: -0.12, hy: 0, cape: 0.2, plume: 0.15, lean: -0.08 },
  chop: { aSx: -1.0, aSy: 0, aSz: 0.05, swx: 2.95, swy: 0, swz: 0, aHx: -0.3, aHy: 0, aHz: -0.08, lL: -0.5, lR: 0.35, hx: 0.12, hy: 0, cape: 0.3, plume: 0.3, lean: 0.25 },
  thrustPrep: { aSx: -0.55, aSy: 0, aSz: 0.2, swx: 2.1, swy: 0, swz: 0, aHx: -0.5, aHy: 0, aHz: -0.1, lL: 0.2, lR: -0.2, hx: 0, hy: 0, cape: 0.05, plume: 0, lean: -0.06 },
  thrust: { aSx: -1.5, aSy: 0, aSz: 0, swx: 3.07, swy: 0, swz: 0, aHx: 0.35, aHy: 0, aHz: -0.1, lL: -0.6, lR: 0.4, hx: 0.05, hy: 0, cape: 0.25, plume: 0.2, lean: 0.32 },
  slashA: { aSx: -1.45, aSy: -1.25, aSz: 0, swx: 3.0, swy: 0, swz: 0, aHx: -0.6, aHy: 0, aHz: -0.1, lL: 0.15, lR: -0.15, hx: 0, hy: -0.2, cape: 0.1, plume: 0.05, lean: 0.05 },
  slashB: { aSx: -1.45, aSy: 1.0, aSz: 0, swx: 3.0, swy: 0, swz: 0, aHx: -0.3, aHy: 0, aHz: -0.1, lL: -0.4, lR: 0.3, hx: 0.05, hy: 0.25, cape: 0.3, plume: 0.25, lean: 0.2 },
  bash: { aSx: -0.5, aSy: 0, aSz: 0.2, swx: 0.8, swy: 0, swz: 0.1, aHx: -1.35, aHy: -0.35, aHz: 0, lL: -0.45, lR: 0.3, hx: 0.08, hy: 0, cape: 0.25, plume: 0.2, lean: 0.3 },
  victory: { aSx: -2.9, aSy: 0, aSz: 0.22, swx: 2.9, swy: 0, swz: 0, aHx: -0.35, aHy: 0, aHz: -0.15, lL: 0, lR: 0, hx: -0.15, hy: 0, cape: 0.12, plume: 0.1, lean: -0.05 },
  salute: { aSx: -1.25, aSy: 0.55, aSz: 0, swx: 1.25, swy: 0, swz: 0, aHx: -0.2, aHy: 0, aHz: -0.06, lL: 0, lR: 0, hx: -0.05, hy: 0, cape: 0.05, plume: 0, lean: 0 },
};
const STANCE_KEYS = Object.keys(STANCE.guard);

// 两个姿势按 k 插值，写进 out（out 上的其它字段保留）
export function mixStance(out, a, b, k) {
  const A = typeof a === 'string' ? STANCE[a] : a;
  const Bs = typeof b === 'string' ? STANCE[b] : b;
  for (const key of STANCE_KEYS) out[key] = A[key] + (Bs[key] - A[key]) * k;
  return out;
}
export function setStance(out, s) { return mixStance(out, s, s, 0); }

// 行走步态叠加：phase 为步伐相位（弧度），amp 为摆幅
export function addGait(P, phase, amp) {
  const s = Math.sin(phase);
  P.lL += s * amp;
  P.lR -= s * amp;
  P.aHx -= s * amp * 0.5;
}

export function applyKnightPose(rig, P) {
  rig.armS.rotation.set(P.aSx, P.aSy, P.aSz);
  rig.sword.rotation.set(P.swx, P.swy, P.swz);
  rig.armH.rotation.set(P.aHx, P.aHy, P.aHz);
  rig.legL.rotation.x = P.lL;
  rig.legR.rotation.x = P.lR;
  rig.head.rotation.set(P.hx, P.hy, 0);
  rig.cape.rotation.x = P.cape;
  if (rig.plume) rig.plume.rotation.x = P.plume;
}
