// 卡牌演出的公共素材：程式化小人、道具、地块、文字标签与粒子。全部现场建模，无外部模型文件。
// 风格与 three-figures.js 的骑士一致（桌游棋子：圆台底座 + 圆润的身体），约定高约 1、正面朝 +Z。
import { THREE, clamp01, easeOut, textures } from './three-figures.js';

// ---------- 材质 ----------
const MAT = new Map();
export function mat(color, o = {}) {
  const key = `${color}|${o.metal ?? 0}|${o.rough ?? 0.7}|${o.emissive ?? ''}|${o.side ?? ''}|${o.opacity ?? 1}`;
  if (MAT.has(key)) return MAT.get(key);
  const m = new THREE.MeshStandardMaterial({
    color, metalness: o.metal ?? 0, roughness: o.rough ?? 0.7,
    side: o.side === 2 ? THREE.DoubleSide : THREE.FrontSide,
    transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1,
  });
  if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei ?? 1; }
  MAT.set(key, m);
  return m;
}
export const unlit = (color, o = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, ...o });

function mesh(geo, material, p = [0, 0, 0], parent = null) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...p);
  if (parent) parent.add(m);
  return m;
}
const V2 = (x, y) => new THREE.Vector2(x, y);
function capsule(a, b, r) {
  const p1 = new THREE.Vector3(...a);
  const p2 = new THREE.Vector3(...b);
  const dir = p2.clone().sub(p1);
  const geo = new THREE.CapsuleGeometry(r, dir.length(), 4, 10);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  geo.applyMatrix4(new THREE.Matrix4().compose(p1.add(p2).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return geo;
}
const darker = (c, k = 0.62) => `#${new THREE.Color(c).multiplyScalar(k).getHexString()}`;

// ====================================================================
// 小人：底座 + 腿 + 身体（短上衣或长袍）+ 双臂（肩为关节）+ 头（可戴帽）
// opts：cloth 衣服色，trim 镶边，base 底座色（默认同衣服），robe 长袍，hat，eyes:'glow' 兜帽下发光双眼
// ====================================================================
export function folk(opts = {}) {
  const {
    cloth = '#7a5a3a', trim = '#d8a852', skin = '#e2b48c', hair = '#4a2e1c', hat = 'none',
    robe = false, base = cloth, eyes = 'dot', eyeColor = '#ff5a3c', apron = null, skirt = false,
  } = opts;
  const fig = new THREE.Group();
  const C = mat(cloth, { side: 2 });
  const CD = mat(darker(cloth), { side: 2 });
  const T = mat(trim, { metal: 0.8, rough: 0.3 });
  const S = mat(skin);
  const L = mat('#5a3b22', { rough: 0.6 });

  // 底座（玩家色圆台）
  mesh(new THREE.LatheGeometry([V2(0, 0), V2(0.2, 0), V2(0.214, 0.012), V2(0.218, 0.028), V2(0.21, 0.042), V2(0.196, 0.05), V2(0, 0.05)], 36),
    mat(darker(base, 0.78), { rough: 0.5 }), [0, 0, 0], fig);

  // 腿（髋为关节）
  const legs = [];
  for (const s of [1, -1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.058, 0.3, 0);
    fig.add(leg);
    mesh(capsule([0, 0, 0], [0, -0.22, 0.01], 0.042), robe || skirt ? CD : mat(darker(cloth, 0.45)), [0, 0, 0], leg);
    mesh(new THREE.SphereGeometry(1, 12, 8), L, [0, -0.235, 0.03], leg).scale.set(0.048, 0.034, 0.075);
    legs.push(leg);
  }

  // 身体
  const body = new THREE.Group();
  fig.add(body);
  if (robe || skirt) { // 长袍/长裙：从脚踝垂到胸口，盖住腿
    const flare = skirt ? 0.24 : 0.17;
    mesh(new THREE.LatheGeometry([V2(flare, 0.07), V2(flare * 0.93, 0.16), V2(0.135, 0.32), V2(0.118, 0.44), V2(0.12, 0.54), V2(0.1, 0.62), V2(0, 0.64)], 28), C, [0, 0, 0], body);
    mesh(new THREE.TorusGeometry(flare - 0.004, 0.012, 6, 28), T, [0, 0.075, 0], body).rotation.x = Math.PI / 2;
  } else { // 短上衣（下摆到大腿）
    mesh(new THREE.LatheGeometry([V2(0.135, 0.24), V2(0.13, 0.32), V2(0.118, 0.44), V2(0.124, 0.54), V2(0.1, 0.62), V2(0, 0.64)], 24), C, [0, 0, 0], body);
  }
  mesh(new THREE.TorusGeometry(0.118, 0.014, 6, 24), mat('#5a3b22'), [0, 0.42, 0], body).rotation.x = Math.PI / 2;
  mesh(new THREE.BoxGeometry(0.036, 0.03, 0.02), T, [0, 0.42, 0.12], body);
  if (apron) mesh(new THREE.BoxGeometry(0.17, 0.26, 0.012), mat(apron), [0, 0.36, 0.125], body).rotation.x = -0.12;

  // 双臂（肩为关节，自然下垂沿 -Y；手部挂点 hand 用于拿道具）
  const arms = [];
  const hands = [];
  for (const s of [1, -1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.138, 0.585, 0);
    fig.add(arm);
    mesh(capsule([0, 0, 0], [0, -0.22, 0.02], 0.034), C, [0, 0, 0], arm);
    mesh(new THREE.SphereGeometry(0.032, 12, 10), S, [0, -0.24, 0.025], arm);
    const hand = new THREE.Group();
    hand.position.set(0, -0.25, 0.03);
    arm.add(hand);
    arms.push(arm);
    hands.push(hand);
  }

  // 头（脖颈为关节）
  const head = new THREE.Group();
  head.position.set(0, 0.63, 0);
  fig.add(head);
  const eyeMat = eyes === 'glow' ? new THREE.MeshBasicMaterial({ color: new THREE.Color(eyeColor).multiplyScalar(2.2) }) : mat('#1d130c');
  const eyeMeshes = [];
  const halos = [];
  if (hat === 'hood') { // 兜帽：帽子罩住整颗头，脸是一团暗影，只露出眼睛
    mesh(new THREE.SphereGeometry(0.1, 20, 14), mat('#0c0806'), [0, 0.08, 0.025], head).scale.set(0.9, 0.95, 0.8);
    const hood = mesh(new THREE.LatheGeometry([V2(0, 0), V2(0.11, 0.004), V2(0.13, 0.07), V2(0.13, 0.13), V2(0.108, 0.19), V2(0.06, 0.235), V2(0, 0.25)], 28, 0.55, Math.PI * 2 - 1.1), C, [0, -0.005, 0], head);
    hood.rotation.y = Math.PI; // 开口朝前
    mesh(new THREE.ConeGeometry(0.06, 0.14, 12), C, [0, 0.2, -0.08], head).rotation.x = -1.0;
    mesh(new THREE.TorusGeometry(0.1, 0.02, 8, 24), CD, [0, 0.09, 0.075], head).scale.set(1, 1.15, 0.6);
  } else {
    mesh(new THREE.SphereGeometry(0.088, 20, 14), S, [0, 0.085, 0], head);
    mesh(new THREE.SphereGeometry(0.014, 8, 6), mat(darker(skin, 0.85)), [0, 0.072, 0.088], head);
    // 头发：后脑一片
    if (hat !== 'mitre' && hat !== 'veil') mesh(new THREE.SphereGeometry(0.092, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(hair), [0, 0.09, -0.008], head);
  }
  for (const s of [1, -1]) {
    const e = mesh(new THREE.SphereGeometry(eyes === 'glow' ? 0.014 : 0.011, 10, 8), eyeMat, [s * 0.032, 0.098, hat === 'hood' ? 0.096 : 0.082], head);
    if (eyes === 'glow') {
      e.scale.set(1.5, 0.6, 0.6);
      e.rotation.z = s * 0.35;
      const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures().glow, color: eyeColor, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
      h.position.set(s * 0.032, 0.098, 0.11);
      h.scale.setScalar(0.09);
      head.add(h);
      halos.push(h);
    }
    eyeMeshes.push(e);
  }
  if (hat === 'mitre') { // 主教冠：前后扁的尖顶高帽 + 金色竖带
    const m = mesh(new THREE.LatheGeometry([V2(0, 0), V2(0.08, 0), V2(0.088, 0.09), V2(0.07, 0.19), V2(0.03, 0.26), V2(0, 0.28)], 20), mat('#f4efe2'), [0, 0.13, 0], head);
    m.scale.set(1, 1, 0.62);
    mesh(new THREE.BoxGeometry(0.026, 0.25, 0.11), T, [0, 0.25, 0], head);
    const band = mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 24), T, [0, 0.135, 0], head);
    band.rotation.x = Math.PI / 2;
    band.scale.set(1, 0.62, 1);
  } else if (hat === 'veil') { // 新娘：花冠 + 白纱垂到背后
    mesh(new THREE.TorusGeometry(0.084, 0.014, 6, 24), mat('#ffd6e6'), [0, 0.15, -0.005], head).rotation.x = Math.PI / 2 - 0.25;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      mesh(new THREE.SphereGeometry(0.018, 8, 6), mat(i % 2 ? '#ffffff' : '#ff9ec2'), [Math.cos(a) * 0.084, 0.15 + Math.sin(a) * 0.02, Math.sin(a) * 0.084 - 0.005], head);
    }
    mesh(new THREE.SphereGeometry(0.092, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat('#c58b4c'), [0, 0.09, -0.008], head);
    mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.5, 18, 1, true, Math.PI * 0.5, Math.PI), mat('#ffffff', { side: 2, opacity: 0.72, rough: 0.4 }), [0, -0.1, -0.03], head);
  } else if (hat === 'tophat') {
    mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.012, 24), mat('#1c1c22', { rough: 0.4 }), [0, 0.15, 0], head);
    mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.15, 24), mat('#1c1c22', { rough: 0.4 }), [0, 0.23, 0], head);
    mesh(new THREE.CylinderGeometry(0.081, 0.081, 0.03, 24), mat(cloth), [0, 0.17, 0], head);
  } else if (hat === 'goggles') { // 发明家：乱糟糟的头发 + 额头上的黄铜护目镜
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      mesh(new THREE.SphereGeometry(0.045, 10, 8), mat('#e8e6e0'), [Math.cos(a) * 0.075, 0.15 + Math.sin(i * 2.1) * 0.02, Math.sin(a) * 0.06 - 0.02], head);
    }
    mesh(new THREE.TorusGeometry(0.09, 0.01, 6, 28), mat('#5a3b22'), [0, 0.13, 0], head).rotation.x = Math.PI / 2 - 0.15;
    for (const s of [1, -1]) {
      mesh(new THREE.TorusGeometry(0.03, 0.01, 8, 18), mat('#c9973f', { metal: 0.85, rough: 0.3 }), [s * 0.036, 0.15, 0.078], head).rotation.x = -0.5;
      mesh(new THREE.CircleGeometry(0.026, 16), mat('#7fd3ff', { metal: 0.2, rough: 0.1, emissive: '#2a8fc0', ei: 0.5 }), [s * 0.036, 0.152, 0.082], head).rotation.x = -0.5;
    }
  } else if (hat === 'cap') {
    mesh(new THREE.SphereGeometry(0.094, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), mat(darker(cloth, 0.8)), [0, 0.1, 0], head);
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 16, 1, false, -Math.PI / 2, Math.PI), mat(darker(cloth, 0.6)), [0, 0.12, 0.07], head);
  }

  const rig = {
    fig, body, head, legL: legs[0], legR: legs[1], armL: arms[0], armR: arms[1], handL: hands[0], handR: hands[1],
    eyes: eyeMeshes, halos,
    setGlow(k) {
      if (eyes !== 'glow') return;
      eyeMat.color.set(eyeColor).multiplyScalar(1 + 1.4 * k);
      for (const h of halos) { h.material.opacity = clamp01(0.25 + 0.3 * k); h.scale.setScalar(0.07 + 0.03 * k); }
    },
  };
  return rig;
}

// 小人姿态：扁平数值（与骑士相同的约定：手臂 x 负 = 向前抬，π 左右 = 举过头顶）
export const POSE = {
  idle: { aLx: 0, aLz: 0.08, aRx: 0, aRz: -0.08, lL: 0, lR: 0, hx: 0, hy: 0, lean: 0, crouch: 0 },
  sneak: { aLx: -0.7, aLz: 0.35, aRx: -0.7, aRz: -0.35, lL: 0, lR: 0, hx: 0.15, hy: 0, lean: 0.35, crouch: 0.12 },
  carry: { aLx: -1.1, aLz: -0.25, aRx: -1.1, aRz: 0.25, lL: 0, lR: 0, hx: 0.1, hy: 0, lean: 0.12, crouch: 0.04 },
  raise: { aLx: 0, aLz: 0.1, aRx: -2.9, aRz: -0.15, lL: 0, lR: 0, hx: -0.2, hy: 0, lean: -0.06, crouch: 0 },
  cheer: { aLx: -2.8, aLz: 0.3, aRx: -2.8, aRz: -0.3, lL: 0, lR: 0, hx: -0.25, hy: 0, lean: -0.05, crouch: 0 },
  cover: { aLx: -2.4, aLz: -0.9, aRx: -2.4, aRz: 0.9, lL: 0, lR: 0, hx: 0.25, hy: 0, lean: 0.2, crouch: 0.1 }, // 抱头捂耳
  offer: { aLx: -1.2, aLz: 0.05, aRx: -1.2, aRz: -0.05, lL: 0, lR: 0, hx: 0.12, hy: 0, lean: 0.1, crouch: 0 },
  point: { aLx: 0, aLz: 0.08, aRx: -1.5, aRz: -0.1, lL: 0, lR: 0, hx: 0, hy: 0, lean: 0.04, crouch: 0 },
  write: { aLx: -0.9, aLz: -0.2, aRx: -1.0, aRz: 0.15, lL: 0, lR: 0, hx: 0.45, hy: 0, lean: 0.25, crouch: 0 },
  sleep: { aLx: -1.3, aLz: -0.45, aRx: -1.3, aRz: 0.45, lL: 0, lR: 0, hx: 0.75, hy: 0.2, lean: 0.55, crouch: 0.05 },
  bow: { aLx: -0.3, aLz: 0.1, aRx: -0.9, aRz: -0.1, lL: 0, lR: 0, hx: 0.3, hy: 0, lean: 0.45, crouch: 0 },
};
const PK = Object.keys(POSE.idle);
export function pose(out, a, b = a, k = 0) {
  const A = typeof a === 'string' ? POSE[a] : a;
  const B = typeof b === 'string' ? POSE[b] : b;
  for (const key of PK) out[key] = A[key] + (B[key] - A[key]) * k;
  return out;
}
export function gait(P, phase, amp = 0.5) {
  const s = Math.sin(phase);
  P.lL += s * amp;
  P.lR -= s * amp;
  P.aLx -= s * amp * 0.6;
  P.aRx += s * amp * 0.6;
}
export function applyPose(rig, P) {
  rig.armL.rotation.set(P.aLx, 0, P.aLz);
  rig.armR.rotation.set(P.aRx, 0, P.aRz);
  rig.legL.rotation.x = P.lL;
  rig.legR.rotation.x = P.lR;
  rig.head.rotation.set(P.hx, P.hy, 0);
  rig.body.rotation.x = P.lean * 0.6;
  rig.head.position.y = 0.63 - P.crouch * 0.4;
  rig.armL.position.y = rig.armR.position.y = 0.585 - P.crouch * 0.4;
  rig.fig.position.y = -P.crouch * 0.5;
}

// 带影子的可摆放角色：root（位置/朝向）→ squash（压扁回弹）→ fig
export function actor(scene, rig, shadowSize = 0.55) {
  const root = new THREE.Group();
  const squash = new THREE.Group();
  root.add(squash);
  squash.add(rig.fig);
  scene.add(root);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: textures().blob, color: '#120804', transparent: true, depthWrite: false, opacity: 0.5 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.setScalar(shadowSize);
  scene.add(shadow);
  const P = pose({}, 'idle');
  return {
    rig, root, squash, shadow, P,
    place(x, z, lift = 0, yaw = null) {
      root.position.set(x, lift, z);
      if (yaw !== null) root.rotation.y = yaw;
      shadow.position.set(x, 0.004 + (this.floor || 0), z);
      shadow.scale.setScalar(shadowSize / (1 + lift * 2));
      shadow.material.opacity = 0.5 / (1 + lift * 2);
    },
    show(v) { root.visible = v; shadow.visible = v; },
    pose(a, b, k) { pose(P, a, b, k); return P; },
    apply() { applyPose(rig, P); },
  };
}

// ====================================================================
// 地块与道具
// ====================================================================
const TEX = new Map();
export function tex(url) {
  if (!TEX.has(url)) {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    TEX.set(url, t);
  }
  return TEX.get(url);
}

// 尖顶六边形地块（顶面贴设计师插画），r = 外接圆半径
export function hexTile(terrain, r = 1, h = 0.12) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const top = new THREE.ShapeGeometry(shape);
  const uv = top.attributes.uv;
  const pos = top.attributes.position;
  const W = Math.sqrt(3) * r;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / W + 0.5, pos.getY(i) / (2 * r) + 0.5);
  const topMesh = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ map: tex(`/assets/opt/tile-${terrain || 'desert'}.webp`), roughness: 0.85, transparent: true, alphaTest: 0.2 }));
  topMesh.rotation.x = -Math.PI / 2;
  topMesh.position.y = h + 0.001;
  g.add(topMesh);
  const side = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.985, r, h, 6, 1, true), mat('#6b4a2c', { rough: 0.8 }));
  side.position.y = h / 2;
  g.add(side);
  g.userData.top = h;
  return g;
}

// 数字令牌：米色圆片 + 数字（6/8 红色）+ 概率点
const TOKEN_TEX = new Map();
function tokenTexture(n) {
  if (TOKEN_TEX.has(n)) return TOKEN_TEX.get(n);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4e6c4';
  g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#b8955a'; g.lineWidth = 5; g.stroke();
  const red = n === 6 || n === 8;
  g.fillStyle = red ? '#c0392b' : '#2b2118';
  g.font = 'bold 62px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 64, 56);
  const dots = 6 - Math.abs(7 - n);
  for (let i = 0; i < dots; i++) { g.beginPath(); g.arc(64 + (i - (dots - 1) / 2) * 11, 98, 4, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  TOKEN_TEX.set(n, t);
  return t;
}
export function numberToken(n, r = 0.3) {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(r, r, 0.05, 32), mat('#d9c39a', { rough: 0.6 }), [0, 0.025, 0], g);
  const face = mesh(new THREE.CircleGeometry(r * 0.98, 32), new THREE.MeshStandardMaterial({ map: tokenTexture(n), roughness: 0.6 }), [0, 0.051, 0], g);
  face.rotation.x = -Math.PI / 2;
  return g;
}

// 卡牌（正面贴图，背面深色），宽 w，比例 3:4
export function cardMesh(url, w = 0.6, back = '#3a2a1a') {
  const g = new THREE.Group();
  const h = w * (341 / 256);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex(url), roughness: 0.45, transparent: true, alphaTest: 0.05, side: THREE.FrontSide }));
  g.add(front);
  const bk = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.97, h * 0.97), mat(back, { rough: 0.6 }));
  bk.rotation.y = Math.PI;
  bk.position.z = -0.002;
  g.add(bk);
  g.userData.front = front;
  return g;
}

// 文字标签（精灵，始终朝向镜头）
export function label(text, color = '#fff3e0', size = 0.16) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = 'bold 44px "PingFang SC", "Microsoft YaHei", sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 40;
  c.width = w;
  c.height = 72;
  g.font = font;
  g.fillStyle = 'rgba(20,12,4,.72)';
  const r = 30;
  g.beginPath();
  g.roundRect(2, 4, w - 4, 64, r);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = '#fff6e6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, 38);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
  s.scale.set(size * (w / 72), size, 1);
  s.renderOrder = 10;
  return s;
}

// 仓库：墙/屋顶/木箱各自独立，爆炸时整块飞散
export function warehouse(roof = '#b33') {
  const g = new THREE.Group();
  const parts = [];
  const add = (geo, m, p, r = [0, 0, 0]) => {
    const x = mesh(geo, m, p, g);
    x.rotation.set(...r);
    parts.push(x);
    return x;
  };
  const wood = mat('#a9794a', { rough: 0.8 });
  const woodD = mat('#7a5232', { rough: 0.85 });
  add(new THREE.BoxGeometry(0.62, 0.36, 0.04), wood, [0, 0.18, 0.25]);
  add(new THREE.BoxGeometry(0.62, 0.36, 0.04), wood, [0, 0.18, -0.25]);
  add(new THREE.BoxGeometry(0.04, 0.36, 0.48), woodD, [0.3, 0.18, 0]);
  add(new THREE.BoxGeometry(0.04, 0.36, 0.48), woodD, [-0.3, 0.18, 0]);
  add(new THREE.BoxGeometry(0.16, 0.24, 0.01), mat('#3b2414'), [0, 0.12, 0.272]); // 门
  const R = mat(roof, { rough: 0.6, side: 2 });
  add(new THREE.BoxGeometry(0.72, 0.03, 0.36), R, [0, 0.45, 0.13], [0.62, 0, 0]);
  add(new THREE.BoxGeometry(0.72, 0.03, 0.36), R, [0, 0.45, -0.13], [-0.62, 0, 0]);
  const gable = new THREE.Shape();
  gable.moveTo(-0.27, 0); gable.lineTo(0.27, 0); gable.lineTo(0, 0.2); gable.closePath();
  for (const s of [1, -1]) {
    const gg = add(new THREE.ShapeGeometry(gable), mat('#9a6a3e', { side: 2 }), [s * 0.3, 0.36, 0], [0, Math.PI / 2, 0]);
    gg.scale.set(1, 1, 1);
  }
  for (const [x, z, s] of [[0.42, 0.18, 0.15], [0.43, -0.02, 0.13], [0.42, 0.08, 0.12]]) {
    add(new THREE.BoxGeometry(s, s, s), mat('#c08a52', { rough: 0.8 }), [x, s / 2 + (z === 0.08 ? 0.14 : 0), z], [0, z * 3, 0]);
  }
  g.userData.parts = parts;
  return g;
}

// 炸药桶 + 引信（引信点燃位置 fuseTip）
export function powderKeg() {
  const g = new THREE.Group();
  mesh(new THREE.LatheGeometry([V2(0, 0), V2(0.1, 0), V2(0.125, 0.07), V2(0.13, 0.13), V2(0.125, 0.19), V2(0.1, 0.26), V2(0, 0.26)], 20), mat('#6e4526', { rough: 0.8 }), [0, 0, 0], g);
  for (const y of [0.04, 0.22]) mesh(new THREE.TorusGeometry(y < 0.1 ? 0.112 : 0.112, 0.01, 6, 24), mat('#3a3a40', { metal: 0.8, rough: 0.4 }), [0, y, 0], g).rotation.x = Math.PI / 2;
  mesh(new THREE.TorusGeometry(0.13, 0.01, 6, 24), mat('#3a3a40', { metal: 0.8, rough: 0.4 }), [0, 0.13, 0], g).rotation.x = Math.PI / 2;
  // 骷髅标记（白色圆+黑眼）
  mesh(new THREE.CircleGeometry(0.045, 16), mat('#f1ead8'), [0, 0.14, 0.131], g);
  for (const s of [1, -1]) mesh(new THREE.CircleGeometry(0.011, 8), mat('#111'), [s * 0.016, 0.148, 0.132], g);
  return g;
}

// 一条贴地的引信（CatmullRom 曲线管），burn(k) 把 0..k 段烧掉（只画剩下的部分）
export function fuseLine(points) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const geo = new THREE.TubeGeometry(curve, 48, 0.012, 6, false);
  const m = mesh(geo, mat('#2e2116', { rough: 0.9 }));
  const total = geo.index.count;
  return {
    mesh: m, curve,
    burn(k) { const start = Math.floor(clamp01(k) * total / 6) * 6; geo.setDrawRange(start, total - start); },
  };
}

// 婚礼拱门：两根柱子 + 半圆花拱
export function weddingArch() {
  const g = new THREE.Group();
  const wood = mat('#f3ead8', { rough: 0.5 });
  for (const s of [1, -1]) mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.95, 12), wood, [s * 0.55, 0.475, 0], g);
  const arc = mesh(new THREE.TorusGeometry(0.55, 0.035, 10, 40, Math.PI), wood, [0, 0.95, 0], g);
  arc.rotation.z = 0;
  const flowerCols = ['#ff8fb5', '#ffffff', '#ffd36b', '#f7a6c7', '#d98cff'];
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * Math.PI;
    const f = mesh(new THREE.SphereGeometry(0.045 + (i % 3) * 0.008, 10, 8), mat(flowerCols[i % flowerCols.length], { rough: 0.5 }),
      [Math.cos(a) * 0.55, 0.95 + Math.sin(a) * 0.55, 0.03 * ((i % 2) ? 1 : -1)], g);
    f.scale.y = 0.8;
  }
  for (let i = 0; i < 6; i++) for (const s of [1, -1]) {
    mesh(new THREE.SphereGeometry(0.04, 8, 6), mat(i % 2 ? '#7cc46a' : flowerCols[i % 5]), [s * 0.55 + (i % 2 ? 0.03 : -0.03), 0.2 + i * 0.13, 0.02], g);
  }
  return g;
}

// 钟（挂在拱门顶，rotation.z 摆动）
export function bell() {
  const g = new THREE.Group();
  const b = mesh(new THREE.LatheGeometry([V2(0, -0.16), V2(0.1, -0.16), V2(0.088, -0.12), V2(0.06, -0.04), V2(0.052, 0.02), V2(0.03, 0.05), V2(0, 0.055)], 24), mat('#e3b453', { metal: 0.9, rough: 0.25, side: 2 }), [0, 0, 0], g);
  b.position.y = -0.06;
  mesh(new THREE.SphereGeometry(0.022, 10, 8), mat('#8a6a2a', { metal: 0.8 }), [0, -0.21, 0], g);
  return g;
}

// 请柬：白信封 + 封蜡
export function envelope(seal = '#c0392b') {
  const g = new THREE.Group();
  mesh(new THREE.BoxGeometry(0.22, 0.15, 0.012), mat('#fbf4e4', { rough: 0.6 }), [0, 0, 0], g);
  const flap = new THREE.Shape();
  flap.moveTo(-0.11, 0.075); flap.lineTo(0.11, 0.075); flap.lineTo(0, -0.01); flap.closePath();
  mesh(new THREE.ShapeGeometry(flap), mat('#efe3c8', { side: 2 }), [0, 0, 0.0065], g);
  mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 14), mat(seal, { rough: 0.4 }), [0, -0.005, 0.01], g).rotation.x = Math.PI / 2;
  return g;
}

// 礼盒：方盒 + 十字丝带 + 蝴蝶结
export function giftBox(color = '#c0392b', ribbon = '#ffd36b', s = 0.16) {
  const g = new THREE.Group();
  mesh(new THREE.BoxGeometry(s, s * 0.85, s), mat(color, { rough: 0.5 }), [0, s * 0.425, 0], g);
  mesh(new THREE.BoxGeometry(s * 1.06, s * 0.16, s * 1.06), mat(color, { rough: 0.45 }), [0, s * 0.85, 0], g);
  const R = mat(ribbon, { metal: 0.5, rough: 0.35 });
  mesh(new THREE.BoxGeometry(s * 0.2, s * 0.95, s * 1.08), R, [0, s * 0.46, 0], g);
  mesh(new THREE.BoxGeometry(s * 1.08, s * 0.95, s * 0.2), R, [0, s * 0.46, 0], g);
  for (const k of [1, -1]) mesh(new THREE.TorusGeometry(s * 0.16, s * 0.05, 6, 14), R, [k * s * 0.15, s * 1.0, 0], g).rotation.set(0, Math.PI / 2, k * 0.5);
  return g;
}

// 主教权杖：长杆 + 金色弯钩
export function crozier() {
  const g = new THREE.Group();
  const gold = mat('#e2b04f', { metal: 0.9, rough: 0.25 });
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.85, 10), gold, [0, 0.2, 0], g);
  const hook = mesh(new THREE.TorusGeometry(0.06, 0.013, 8, 24, Math.PI * 1.4), gold, [0.06, 0.66, 0], g);
  hook.rotation.z = -0.25;
  mesh(new THREE.SphereGeometry(0.03, 12, 10), mat('#9fe3ff', { emissive: '#5cc8ff', ei: 1.4 }), [0, 0.6, 0], g);
  return g;
}

// 放大镜
export function magnifier() {
  const g = new THREE.Group();
  mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 28), mat('#c9973f', { metal: 0.85, rough: 0.3 }), [0, 0.12, 0], g);
  mesh(new THREE.CircleGeometry(0.072, 24), new THREE.MeshStandardMaterial({ color: '#cfeeff', transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide }), [0, 0.12, 0], g);
  mesh(new THREE.CylinderGeometry(0.013, 0.016, 0.1, 10), mat('#4a2e1c'), [0, 0.02, 0], g);
  return g;
}

// 小房子（村庄造型，玩家色）
export function house(color, s = 1) {
  const g = new THREE.Group();
  mesh(new THREE.BoxGeometry(0.18 * s, 0.14 * s, 0.16 * s), mat(color, { rough: 0.6 }), [0, 0.07 * s, 0], g);
  const roof = mesh(new THREE.CylinderGeometry(0.0, 0.14 * s, 0.1 * s, 4, 1), mat(darker(color, 0.7), { rough: 0.6 }), [0, 0.19 * s, 0], g);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.0, 1, 0.85);
  return g;
}

// 桌子
export function table(w = 0.9, d = 0.5, h = 0.32, color = '#8a5a34') {
  const g = new THREE.Group();
  mesh(new THREE.BoxGeometry(w, 0.04, d), mat(color, { rough: 0.7 }), [0, h, 0], g);
  for (const sx of [1, -1]) for (const sz of [1, -1]) mesh(new THREE.BoxGeometry(0.04, h, 0.04), mat(darker(color, 0.75)), [sx * (w / 2 - 0.05), h / 2, sz * (d / 2 - 0.05)], g);
  g.userData.top = h + 0.02;
  return g;
}

// 齿轮（ExtrudeGeometry），teeth 齿数
export function gear(r = 0.18, teeth = 10, color = '#c9973f', depth = 0.04) {
  const sh = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = (Math.floor(i / 2) % 2) ? r : r * 0.8;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, r * 0.28, 0, Math.PI * 2, true);
  sh.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1 });
  geo.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geo, mat(color, { metal: 0.85, rough: 0.32 }));
}

// 蓝图（画着六边形与箭头的图纸）
let BP = null;
export function blueprint(w = 0.5) {
  if (!BP) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 180;
    const g = c.getContext('2d');
    g.fillStyle = '#1f4f8f'; g.fillRect(0, 0, 256, 180);
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
    for (let x = 0; x < 256; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 180); g.stroke(); }
    for (let y = 0; y < 180; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    g.strokeStyle = '#e8f3ff'; g.lineWidth = 3;
    const hexAt = (cx, cy, r) => { g.beginPath(); for (let i = 0; i <= 6; i++) { const a = Math.PI / 2 + i * Math.PI / 3; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.stroke(); };
    hexAt(70, 95, 40); hexAt(186, 95, 40);
    g.beginPath(); g.moveTo(100, 50); g.quadraticCurveTo(128, 20, 156, 50); g.stroke();
    g.beginPath(); g.moveTo(156, 140); g.quadraticCurveTo(128, 170, 100, 140); g.stroke();
    g.fillStyle = '#e8f3ff';
    g.font = 'bold 28px Georgia'; g.textAlign = 'center'; g.fillText('?', 70, 105); g.fillText('?', 186, 105);
    BP = new THREE.CanvasTexture(c);
    BP.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.7), new THREE.MeshStandardMaterial({ map: BP, roughness: 0.8 }));
  return m;
}

// 光柱（加色混合的开口圆柱，上宽下窄，可调 opacity）
export function lightBeam(color = '#fff2b0', r = 0.45, h = 3.2) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.4, 'rgba(255,255,255,.55)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.3, r, h, 32, 1, true),
    new THREE.MeshBasicMaterial({ map: t, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  m.position.y = h / 2;
  const g2 = new THREE.Group();
  g2.add(m);
  g2.userData.beam = m;
  return g2;
}

// ====================================================================
// 粒子：每个场景一个 FX 池，按帧推进（精灵 / 小网格），自带重力与淡出
// ====================================================================
export function fxPool(scene) {
  const list = [];
  const T = textures();
  const sprite = (map, color, additive) => new THREE.Sprite(new THREE.SpriteMaterial({
    map, color, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  const pool = {
    // 通用：obj 自带 update(p, dt)
    add(obj, dur, update, owned = true) {
      scene.add(obj);
      list.push({ obj, dur, update, t: 0, owned });
      return obj;
    },
    step(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const f = list[i];
        f.t += dt;
        const p = f.t / f.dur;
        if (p >= 1) {
          scene.remove(f.obj);
          if (f.owned) f.obj.material?.dispose?.();
          list.splice(i, 1);
        } else f.update(p, dt, f);
      }
    },
    clear() { for (const f of list) scene.remove(f.obj); list.length = 0; },
    flash(pos, color = '#fff2d0', size = 0.6, dur = 0.3) {
      const s = sprite(T.star, color, true);
      s.position.copy(pos);
      return pool.add(s, dur, (p) => {
        s.material.rotation = p * 0.9;
        s.scale.setScalar(size * (0.4 + 0.9 * Math.sin(Math.PI * Math.min(1, p * 1.4))));
        s.material.opacity = 1 - p * p;
      });
    },
    glow(pos, color, size, dur) {
      const s = sprite(T.glow, color, true);
      s.position.copy(pos);
      return pool.add(s, dur, (p) => { s.scale.setScalar(size * (0.6 + 0.6 * p)); s.material.opacity = (1 - p) ** 1.5; });
    },
    ring(x, y, z, color = '#ffd36b', size = 3, dur = 0.6) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: T.ring, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      return pool.add(m, dur, (p) => { m.scale.setScalar(size * easeOut(p)); m.material.opacity = 1 - p; });
    },
    puff(pos, vel, size = 0.3, dur = 0.9, color = '#f2e3c4', opacity = 0.85) {
      const s = sprite(T.puff, color, false);
      const p0 = pos.clone();
      return pool.add(s, dur, (p) => {
        s.position.set(p0.x + vel.x * easeOut(p), p0.y + vel.y * p, p0.z + vel.z * easeOut(p));
        s.scale.setScalar(size * (0.5 + p));
        s.material.opacity = opacity * (1 - p) ** 1.4;
      });
    },
    smoke(pos, n = 10, reach = 0.6, size = 0.4, color = '#5b5048') {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = new THREE.Vector3(Math.cos(a) * reach * Math.random(), 0.4 + Math.random() * 0.6, Math.sin(a) * reach * Math.random());
        pool.puff(pos.clone().add(new THREE.Vector3(0, Math.random() * 0.2, 0)), v, size * (0.7 + Math.random() * 0.6), 1.2 + Math.random() * 0.6, color, 0.8);
      }
    },
    // 带重力的火星
    sparks(pos, n = 12, speed = 1.6, color = '#ffcf6b', size = 0.08, dur = 0.7, gravity = 3) {
      for (let i = 0; i < n; i++) {
        const s = sprite(T.glow, color, true);
        const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.2 + 0.3, (Math.random() - 0.5) * 2).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.7));
        s.position.copy(pos);
        const sz = size * (0.6 + Math.random() * 0.8);
        pool.add(s, dur * (0.6 + Math.random() * 0.6), (p, dt) => {
          v.y -= gravity * dt;
          s.position.addScaledVector(v, dt);
          s.scale.setScalar(sz * (1 - p * 0.6));
          s.material.opacity = 1 - p;
        });
      }
    },
    // 翻飞落下的小平面（花瓣/彩纸/卡牌），mk() 返回一个 Object3D
    debris(mk, pos, n, o = {}) {
      const { speed = 1.5, up = 1.2, gravity = 2.4, dur = 1.6, drag = 1.2, spin = 8, spread = 1, floor = 0 } = o;
      for (let i = 0; i < n; i++) {
        const obj = mk(i);
        const a = Math.random() * Math.PI * 2;
        const v = new THREE.Vector3(Math.cos(a) * spread * Math.random(), up * (0.6 + Math.random() * 0.8), Math.sin(a) * spread * Math.random()).multiplyScalar(speed);
        const w = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spin);
        obj.position.copy(pos);
        const fade = obj.userData.fade !== false;
        pool.add(obj, dur * (0.8 + Math.random() * 0.4), (p, dt) => {
          v.y -= gravity * dt;
          v.multiplyScalar(Math.exp(-drag * dt));
          obj.position.addScaledVector(v, dt);
          if (obj.position.y < floor) { obj.position.y = floor; v.set(0, 0, 0); w.multiplyScalar(0.8); }
          obj.rotation.x += w.x * dt; obj.rotation.y += w.y * dt; obj.rotation.z += w.z * dt;
          if (fade && p > 0.75) obj.traverse((m) => { if (m.material) { m.material.transparent = true; m.material.opacity = (1 - p) / 0.25; } });
        }, false);
      }
    },
  };
  return pool;
}

// 小纸片/花瓣/卡片：每片独立材质（要单独淡出）
export function confettiPiece(color, w = 0.05, h = 0.035) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.6 }));
}
export function petal(color = '#ffb3cc') {
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.03, 8), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.6 }));
  m.scale.set(1, 0.6, 1);
  return m;
}
export function heart(color = '#ff5b8a', s = 0.06) {
  const sh = new THREE.Shape();
  sh.moveTo(0, -0.6);
  sh.bezierCurveTo(-1.2, 0.2, -0.5, 1.1, 0, 0.45);
  sh.bezierCurveTo(0.5, 1.1, 1.2, 0.2, 0, -0.6);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true }));
  m.scale.setScalar(s);
  return m;
}
export function resCard(res, w = 0.12) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 1.33), new THREE.MeshStandardMaterial({ map: tex(`/assets/opt/resource-${res}.webp`), side: THREE.DoubleSide, roughness: 0.5, transparent: true }));
  return m;
}

// ====================================================================
// 第二批道具：船、海面、货车摊位、卷轴、骰子、坩埚、起重机、石块、水车、镐、药瓶、铁砧、号角、印刷机、城市、谷仓
// ====================================================================
export function sea(r = 2.3) {
  const t = tex('/assets/opt/sea-texture.webp');
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ map: t, color: '#9fd0ea', roughness: 0.35, metalness: 0.1 }));
  m.rotation.x = -Math.PI / 2;
  m.userData.tex = t;
  return m;
}

// 帆船：船身 + 桅杆 + 玩家色帆，deck 为甲板挂点
export function ship(sail = '#c33', s = 1) {
  const g = new THREE.Group();
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-0.42, 0.12); hullShape.lineTo(0.46, 0.12); hullShape.quadraticCurveTo(0.42, -0.02, 0.28, -0.06);
  hullShape.lineTo(-0.3, -0.06); hullShape.quadraticCurveTo(-0.42, -0.02, -0.42, 0.12);
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape, { depth: 0.26, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 }), mat('#7a4e2c', { rough: 0.75 }));
  hull.position.z = -0.13;
  g.add(hull);
  mesh(new THREE.BoxGeometry(0.84, 0.02, 0.26), mat('#b08455'), [0.02, 0.13, 0], g);
  mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.85, 8), mat('#5a3b22'), [0.02, 0.55, 0], g);
  const sailM = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5, 8, 4), mat(sail, { side: 2, rough: 0.8 }));
  sailM.position.set(0.02, 0.6, 0.02);
  sailM.rotation.y = Math.PI / 2;
  g.add(sailM);
  mesh(new THREE.ConeGeometry(0.04, 0.1, 3), mat(sail), [0.02, 1.0, 0], g).rotation.z = -Math.PI / 2;
  const deck = new THREE.Group();
  deck.position.set(-0.22, 0.14, 0);
  g.add(deck);
  g.scale.setScalar(s);
  g.userData = { deck, sail: sailM };
  return g;
}

export function crate(color = '#c08a52', s = 0.14) {
  const g = new THREE.Group();
  mesh(new THREE.BoxGeometry(s, s, s), mat(color, { rough: 0.8 }), [0, s / 2, 0], g);
  for (const z of [1, -1]) mesh(new THREE.BoxGeometry(s * 1.02, s * 0.14, 0.006), mat(darker(color, 0.6)), [0, s / 2, z * s * 0.505], g);
  return g;
}

// 货车：车厢 + 两个轮子（wheels 可转）
export function cart(color = '#a9794a') {
  const g = new THREE.Group();
  mesh(new THREE.BoxGeometry(0.42, 0.14, 0.26), mat(color, { rough: 0.8 }), [0, 0.16, 0], g);
  mesh(new THREE.BoxGeometry(0.3, 0.02, 0.02), mat('#5a3b22'), [-0.33, 0.16, 0.08], g);
  mesh(new THREE.BoxGeometry(0.3, 0.02, 0.02), mat('#5a3b22'), [-0.33, 0.16, -0.08], g);
  const wheels = [];
  for (const z of [0.15, -0.15]) {
    const w = mesh(new THREE.TorusGeometry(0.08, 0.016, 8, 18), mat('#4a2e1c'), [0.02, 0.09, z], g);
    for (let i = 0; i < 3; i++) mesh(new THREE.BoxGeometry(0.15, 0.012, 0.01), mat('#4a2e1c'), [0, 0, 0], w).rotation.z = (i / 3) * Math.PI;
    wheels.push(w);
  }
  g.userData.wheels = wheels;
  return g;
}

// 集市摊位：四根柱子 + 玩家色条纹遮阳篷（awning 可缩放弹出）
export function stall(color = '#c33') {
  const g = new THREE.Group();
  const wood = mat('#8a5a34');
  for (const [x, z] of [[-0.25, -0.15], [0.25, -0.15], [-0.25, 0.15], [0.25, 0.15]]) mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 8), wood, [x, 0.25, z], g);
  mesh(new THREE.BoxGeometry(0.56, 0.04, 0.34), mat('#a9794a'), [0, 0.22, 0], g);
  const aw = new THREE.Group();
  aw.position.y = 0.5;
  g.add(aw);
  for (let i = 0; i < 5; i++) mesh(new THREE.BoxGeometry(0.12, 0.02, 0.42), mat(i % 2 ? '#f6efe0' : color, { rough: 0.7 }), [-0.24 + i * 0.12, 0.03 - Math.abs(i - 2) * 0.012, 0], aw).rotation.x = 0.25;
  g.userData.awning = aw;
  return g;
}

// 卷轴：两根木轴 + 可展开的纸（open(k) 0→1）
export function scroll(w = 0.5, seal = '#c0392b') {
  const g = new THREE.Group();
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.34), mat('#f3e7c8', { side: 2, rough: 0.8 }));
  g.add(paper);
  const lines = [];
  for (let i = 0; i < 5; i++) {
    const l = mesh(new THREE.BoxGeometry(w * (0.6 + (i % 2) * 0.15), 0.012, 0.002), mat('#7a5a3a'), [0, 0.1 - i * 0.05, 0.002], g);
    lines.push(l);
  }
  const rods = [-1, 1].map((s) => mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 10), mat('#8a5a34'), [s * w / 2, 0, 0], g));
  const sealM = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 16), mat(seal, { rough: 0.4 }), [w * 0.3, -0.11, 0.01], g);
  sealM.rotation.x = Math.PI / 2;
  sealM.visible = false;
  g.userData = {
    seal: sealM, lines,
    open(k) {
      const kk = Math.max(0.02, k);
      paper.scale.x = kk;
      for (const l of lines) { l.scale.x = kk; l.visible = k > 0.3; }
      rods[0].position.x = -w / 2 * kk;
      rods[1].position.x = w / 2 * kk;
    },
  };
  return g;
}

// 骰子：top 点数朝上（+Y），front 点数朝前（+Z）
const PIP = new Map();
function pipTexture(n, red = false) {
  const key = `${n}${red}`;
  if (PIP.has(key)) return PIP.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = red ? '#c8372d' : '#fbf6ea';
  g.fillRect(0, 0, 96, 96);
  g.fillStyle = red ? '#fff' : '#2b2118';
  const P = { 1: [[48, 48]], 2: [[26, 26], [70, 70]], 3: [[24, 24], [48, 48], [72, 72]], 4: [[26, 26], [70, 26], [26, 70], [70, 70]], 5: [[24, 24], [72, 24], [48, 48], [24, 72], [72, 72]], 6: [[26, 22], [70, 22], [26, 48], [70, 48], [26, 74], [70, 74]] }[n];
  for (const [x, y] of P) { g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  PIP.set(key, t);
  return t;
}
export function die(top = 6, s = 0.22, red = false) {
  const front = [1, 2, 3, 4, 5, 6].find((v) => v !== top && v !== 7 - top);
  const right = [1, 2, 3, 4, 5, 6].find((v) => ![top, 7 - top, front, 7 - front].includes(v));
  const faces = [right, 7 - right, top, 7 - top, front, 7 - front]; // +x -x +y -y +z -z
  const geo = new THREE.BoxGeometry(s, s, s, 2, 2, 2);
  const mats = faces.map((v) => new THREE.MeshStandardMaterial({ map: pipTexture(v, red), roughness: 0.4 }));
  return new THREE.Mesh(geo, mats);
}

// 坩埚：黑铁锅 + 冒泡的药水面（liquid）
export function cauldron(liquid = '#5cff8a') {
  const g = new THREE.Group();
  mesh(new THREE.LatheGeometry([V2(0, 0.04), V2(0.16, 0.06), V2(0.25, 0.18), V2(0.26, 0.3), V2(0.22, 0.4), V2(0.24, 0.42)], 28), mat('#26242a', { metal: 0.6, rough: 0.5, side: 2 }), [0, 0, 0], g);
  for (let i = 0; i < 3; i++) { const a = i * 2.1; mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), mat('#26242a'), [Math.cos(a) * 0.15, 0.03, Math.sin(a) * 0.15], g); }
  const surf = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), new THREE.MeshStandardMaterial({ color: liquid, emissive: liquid, emissiveIntensity: 0.8, roughness: 0.2 }));
  surf.rotation.x = -Math.PI / 2;
  surf.position.y = 0.38;
  g.add(surf);
  g.userData.surface = surf;
  return g;
}

// 木制起重机：立柱 + 吊臂（boom 可转）+ 绳 + 吊钩挂点 hook
export function craneRig() {
  const g = new THREE.Group();
  const wood = mat('#9a6a3e', { rough: 0.8 });
  mesh(new THREE.BoxGeometry(0.3, 0.06, 0.3), mat('#6b4a2c'), [0, 0.03, 0], g);
  mesh(new THREE.BoxGeometry(0.06, 1.2, 0.06), wood, [0, 0.6, 0], g);
  const boom = new THREE.Group();
  boom.position.y = 1.15;
  g.add(boom);
  mesh(new THREE.BoxGeometry(1.0, 0.05, 0.05), wood, [0.4, 0, 0], boom);
  mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), mat('#5a3b22'), [-0.12, 0, 0], boom);
  const rope = mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6), mat('#d9c39a'), [0.85, -0.5, 0], boom);
  const hook = new THREE.Group();
  hook.position.set(0.85, -1, 0);
  boom.add(hook);
  g.userData = {
    boom, hook, rope,
    setDrop(d) { rope.scale.y = d; rope.position.y = -d / 2; hook.position.y = -d; },
  };
  return g;
}

export function stoneBlock(s = 0.09) {
  return new THREE.Mesh(new THREE.BoxGeometry(s * 1.6, s, s), mat(['#a8a29a', '#9a948c', '#b5afa6'][Math.floor(Math.random() * 3)], { rough: 0.9 }));
}

// 水车：轮辐 + 叶片（wheel 绕 x 轴转）
export function waterWheel(r = 0.4) {
  const g = new THREE.Group();
  const wood = mat('#8a5a34', { rough: 0.8 });
  const wheel = new THREE.Group();
  g.add(wheel);
  for (const z of [0.07, -0.07]) mesh(new THREE.TorusGeometry(r, 0.02, 6, 28), wood, [0, 0, z], wheel);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const sp = mesh(new THREE.BoxGeometry(r * 2, 0.02, 0.02), wood, [0, 0, 0], wheel);
    sp.rotation.z = a;
    const paddle = mesh(new THREE.BoxGeometry(0.03, 0.12, 0.18), mat('#a9794a'), [Math.cos(a) * r, Math.sin(a) * r, 0], wheel);
    paddle.rotation.z = a;
  }
  for (const z of [0.12, -0.12]) mesh(new THREE.BoxGeometry(0.05, r + 0.1, 0.05), wood, [0, -(r + 0.1) / 2, z], g);
  g.userData.wheel = wheel;
  return g;
}

// 麦穗：一丛细杆 + 金色穗头（grow(k) 生长）
export function wheatTuft(n = 7) {
  const g = new THREE.Group();
  const stalks = [];
  for (let i = 0; i < n; i++) {
    const s = new THREE.Group();
    s.position.set((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2);
    s.rotation.set((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3);
    mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.22, 4), mat('#c9a64a'), [0, 0.11, 0], s);
    mesh(new THREE.SphereGeometry(1, 6, 6), mat('#e8c25a', { rough: 0.6 }), [0, 0.24, 0], s).scale.set(0.014, 0.04, 0.014);
    g.add(s);
    stalks.push(s);
  }
  g.userData.grow = (k) => { for (const s of stalks) s.scale.set(1, Math.max(0.02, k), 1); };
  return g;
}

export function pickaxe() {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.32, 8), mat('#6e4a2c'), [0, 0.12, 0], g);
  const head = mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 16, Math.PI * 0.7), mat('#8a8f96', { metal: 0.85, rough: 0.35 }), [0, 0.28, 0], g);
  head.rotation.z = Math.PI * 0.15;
  return g;
}

export function oreChunk(s = 0.06) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat(Math.random() < 0.4 ? '#6d8aa8' : '#8a8f96', { metal: 0.5, rough: 0.5 }));
  return m;
}

export function potion(color = '#6cf0ff') {
  const g = new THREE.Group();
  mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, transparent: true, opacity: 0.85, roughness: 0.1 }), [0, 0.06, 0], g);
  mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.06, 10), new THREE.MeshStandardMaterial({ color: '#dff6ff', transparent: true, opacity: 0.6, roughness: 0.1 }), [0, 0.14, 0], g);
  mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.025, 10), mat('#8a5a34'), [0, 0.18, 0], g);
  return g;
}

export function anvil() {
  const g = new THREE.Group();
  const iron = mat('#3c3d42', { metal: 0.8, rough: 0.4 });
  mesh(new THREE.BoxGeometry(0.2, 0.16, 0.16), mat('#6b4a2c'), [0, 0.08, 0], g);
  mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), iron, [0, 0.19, 0], g);
  mesh(new THREE.BoxGeometry(0.3, 0.06, 0.12), iron, [0, 0.25, 0], g);
  mesh(new THREE.ConeGeometry(0.06, 0.14, 8), iron, [0.21, 0.25, 0], g).rotation.z = -Math.PI / 2;
  g.userData.top = 0.28;
  return g;
}

export function hammer() {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.22, 8), mat('#6e4a2c'), [0, 0.08, 0], g);
  mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), mat('#5c5f66', { metal: 0.85, rough: 0.35 }), [0, 0.2, 0], g);
  return g;
}

export function horn() {
  const g = new THREE.Group();
  const m = mesh(new THREE.ConeGeometry(0.06, 0.28, 16, 1, true), mat('#e2b04f', { metal: 0.85, rough: 0.3, side: 2 }), [0, 0.14, 0], g);
  m.rotation.x = Math.PI;
  mesh(new THREE.TorusGeometry(0.06, 0.01, 6, 18), mat('#c9973f', { metal: 0.85 }), [0, 0.28, 0], g).rotation.x = Math.PI / 2;
  return g;
}

export function banner(color = '#c33') {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 8), mat('#5a3b22'), [0, 0.55, 0], g);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24, 8, 2), mat(color, { side: 2, rough: 0.8 }));
  flag.position.set(0.17, 0.95, 0);
  g.add(flag);
  mesh(new THREE.SphereGeometry(0.025, 10, 8), mat('#e2b04f', { metal: 0.85 }), [0, 1.11, 0], g);
  g.userData.flag = flag;
  return g;
}
// 旗面飘动：按顶点 x 叠正弦
export function waveFlag(flag, t, amp = 0.03) {
  const pos = flag.geometry.attributes.position;
  if (!flag.userData.base) flag.userData.base = Float32Array.from(pos.array);
  const b = flag.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const x = b[i * 3];
    pos.setZ(i, Math.sin(x * 14 - t * 8) * amp * (x + 0.17) * 3);
  }
  pos.needsUpdate = true;
}

export function printingPress() {
  const g = new THREE.Group();
  const wood = mat('#7a4e2c', { rough: 0.8 });
  for (const x of [-0.25, 0.25]) mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), wood, [x, 0.45, 0], g);
  mesh(new THREE.BoxGeometry(0.62, 0.08, 0.1), wood, [0, 0.88, 0], g);
  mesh(new THREE.BoxGeometry(0.5, 0.06, 0.4), wood, [0, 0.3, 0.05], g);
  const screw = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8), mat('#8a8f96', { metal: 0.8 }), [0, 0.65, 0], g);
  const platen = mesh(new THREE.BoxGeometry(0.36, 0.05, 0.28), mat('#5c5f66', { metal: 0.6, rough: 0.4 }), [0, 0.45, 0.05], g);
  const bar = mesh(new THREE.BoxGeometry(0.4, 0.02, 0.02), mat('#5a3b22'), [0, 0.75, 0], g);
  g.userData = { screw, platen, bar, bed: 0.33 };
  return g;
}

// 城市：主楼 + 塔楼（玩家色），比村庄高大
export function city(color, s = 1) {
  const g = new THREE.Group();
  mesh(new THREE.BoxGeometry(0.26 * s, 0.16 * s, 0.2 * s), mat(color, { rough: 0.6 }), [-0.04 * s, 0.08 * s, 0], g);
  const roof = mesh(new THREE.CylinderGeometry(0, 0.19 * s, 0.1 * s, 4), mat(darker(color, 0.7)), [-0.04 * s, 0.21 * s, 0], g);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.8);
  mesh(new THREE.BoxGeometry(0.12 * s, 0.3 * s, 0.12 * s), mat(color, { rough: 0.6 }), [0.13 * s, 0.15 * s, 0], g);
  const tr = mesh(new THREE.CylinderGeometry(0, 0.1 * s, 0.12 * s, 4), mat(darker(color, 0.7)), [0.13 * s, 0.36 * s, 0], g);
  tr.rotation.y = Math.PI / 4;
  return g;
}

export function barn() {
  const g = new THREE.Group();
  mesh(new THREE.BoxGeometry(0.7, 0.45, 0.5), mat('#b5452f', { rough: 0.7 }), [0, 0.225, 0], g);
  const gable = new THREE.Shape(); // 三角屋顶：山墙截面沿 z 拉伸
  gable.moveTo(-0.4, 0); gable.lineTo(0.4, 0); gable.lineTo(0, 0.3); gable.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(gable, { depth: 0.56, bevelEnabled: false });
  roofGeo.translate(0, 0, -0.28);
  mesh(roofGeo, mat('#6e3a2a', { rough: 0.7 }), [0, 0.45, 0], g);
  const doors = [-1, 1].map((s) => {
    const d = new THREE.Group();
    d.position.set(s * 0.14, 0, 0.255);
    g.add(d);
    mesh(new THREE.BoxGeometry(0.14, 0.3, 0.02), mat('#f1e6d0'), [-s * 0.07, 0.15, 0], d);
    return d;
  });
  g.userData.doors = doors;
  return g;
}

// 道路段（玩家色长条）
export function roadPiece(color, len = 0.42) {
  return new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.08), mat(color, { rough: 0.6 }));
}

// 宝箱（垄断收缴用）
export function chest() {
  const g = new THREE.Group();
  mesh(new THREE.BoxGeometry(0.34, 0.18, 0.22), mat('#7a4e2c'), [0, 0.09, 0], g);
  for (const x of [-0.12, 0.12]) mesh(new THREE.BoxGeometry(0.03, 0.19, 0.225), mat('#c9973f', { metal: 0.8, rough: 0.3 }), [x, 0.095, 0], g);
  const lid = new THREE.Group();
  lid.position.set(0, 0.18, -0.11);
  g.add(lid);
  mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.34, 12, 1, false, 0, Math.PI), mat('#8a5a34'), [0, 0, 0.11], lid).rotation.z = Math.PI / 2;
  g.userData.lid = lid;
  return g;
}
