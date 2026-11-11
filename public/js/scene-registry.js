// 卡牌演出的场景表与场景公用小工具。各牌堆的场景文件（scenes-*.js）往 SCENES 里登记：
// SCENES[card] = { light, camera, build(ctx) → 状态（可带 dur / camera）, frame(st, ts, dt, ctx) }
import { THREE, lerp, textures, buildKnight, setStance, applyKnightPose } from './three-figures.js';
import * as K from './scene-kit.js';

export const SCENES = {};

export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const RES5 = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
// 抛物线：from → to，最高点 h
export function arc(from, to, k, h) {
  return V3(lerp(from.x, to.x, k), lerp(from.y, to.y, k) + h * 4 * k * (1 - k), lerp(from.z, to.z, k));
}
// 走路：沿直线从 a 到 b，k ∈ [0,1]，返回步伐相位
export function walk(actor, a, b, k, steps, amp = 0.55, yaw = null) {
  const x = lerp(a[0], b[0], k);
  const z = lerp(a[1], b[1], k);
  const ph = k * steps * Math.PI;
  const moving = k > 0 && k < 1;
  actor.place(x, z, moving ? Math.abs(Math.sin(ph)) * 0.03 : 0, yaw ?? Math.atan2(b[0] - a[0], b[1] - a[1]));
  if (moving) K.gait(actor.P, ph, amp);
  return moving ? ph : null;
}
export function floorDisc(world, color = '#7a5232', r = 2.1) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.02, 0.1, 48), K.mat(color, { rough: 0.85 }));
  m.position.y = -0.05;
  world.add(m);
  // 木地板纹路
  for (let i = -4; i <= 4; i++) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.002, Math.sqrt(Math.max(0, r * r - (i * 0.45) ** 2)) * 2), K.mat('#5a3b22'));
    l.position.set(i * 0.45, 0.001, 0);
    world.add(l);
  }
  return m;
}
export function hexPos(board, id) {
  const hex = board?.hexes?.[id];
  if (!hex) return '';
  const sameRow = board.hexes.filter((h) => h.r === hex.r).sort((a, b) => a.q - b.q);
  return `第${hex.r + 3}行第${sameRow.findIndex((h) => h.id === hex.id) + 1}列`;
}


// 场景地面：一大块地块（顶面贴插画），顶面在 y=0
export function ground(world, terrain = 'pasture', r = 2.15) {
  const g = K.hexTile(terrain, r);
  g.position.y = -0.12;
  world.add(g);
  return g;
}

// 骑士演员（three-figures 的三级骑士），P 为骑士姿态表
export function knightActor(world, level, color, shadowSize = 0.5) {
  const model = buildKnight(Math.max(1, Math.min(3, level || 1)), color);
  const root = new THREE.Group();
  const squash = new THREE.Group();
  root.add(squash);
  squash.add(model.fig);
  world.add(root);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: textures().blob, color: '#120804', transparent: true, depthWrite: false, opacity: 0.5 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.setScalar(shadowSize);
  world.add(shadow);
  const P = setStance({}, 'guard');
  return {
    model, root, squash, shadow, P,
    place(x, z, lift = 0, yaw = null) {
      root.position.set(x, lift, z);
      if (yaw !== null) root.rotation.y = yaw;
      shadow.position.set(x, 0.004, z);
      shadow.scale.setScalar(shadowSize / (1 + lift * 2));
    },
    show(v) { root.visible = v; shadow.visible = v; },
    apply() { model.fig.rotation.x = P.lean || 0; applyKnightPose(model, P); },
  };
}

// 一组沿抛物线飞的牌：items = [{ from, to, t0, mk }]，每帧 update(ts) 推进；落地回调 onLand(i)
export function flyGroup(world, items, { dur = 0.6, h = 0.6, spin = 3, onLand } = {}) {
  const list = items.map((it) => {
    const o = it.mk();
    o.visible = false;
    world.add(o);
    return { ...it, o, landed: false };
  });
  return {
    list,
    update(ts) {
      list.forEach((it, i) => {
        const k = (ts - it.t0) / (it.dur ?? dur);
        if (k < 0) { it.o.visible = false; return; }
        if (k >= 1) {
          it.o.visible = !!it.keep;
          if (it.keep) it.o.position.copy(it.to);
          if (!it.landed) { it.landed = true; onLand?.(i, it); }
          return;
        }
        it.o.visible = true;
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        it.o.position.copy(arc(it.from, it.to, e, it.h ?? h));
        it.o.rotation.set(0.4 * Math.sin(k * 6), k * Math.PI * spin, 0.2 * Math.sin(k * 9));
      });
    },
  };
}

// 资源/商品牌面（resource-*.webp）
export const cardOf = (res, w = 0.13) => () => K.resCard(res, w);
