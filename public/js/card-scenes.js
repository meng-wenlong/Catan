// 卡牌发动演出：打出进步卡/发展卡时，先在全桌面前把卡上的故事演一遍（3D 小剧场），演完才轮到选择。
// 每幕 = 公共开场（3D 卡牌翻入 → 缩到左上角当徽章）+ 该卡的场景。点击任意处跳过。
// 只读公开信息：事件里服务端补的字段（受害者、宾客、目标地块…）和公开状态。three 不可用时返回 null，调用方回退平面大卡。
import {
  THREE, loadThree, reduced, clamp01, lerp, easeInOut, easeOut, easeIn, seg, spring,
  makeRenderer, addLights, textures, buildRobber,
} from './three-figures.js';
import * as K from './scene-kit.js';
import { sfx } from './sfx.js';
import { SCENES, V3, RES5, arc, walk, floorDisc, hexPos } from './scene-registry.js';
import './scenes-trade.js';
import './scenes-politics.js';
import './scenes-science.js';
import './scenes-dev.js';

const INTRO = 1.25; // 开场（卡牌翻入、停留）时长，场景从这之后开始计时
const OUTRO = 0.3;
const FOV = 32;
const H = { ready: false, renderer: null, canvas: null, el: null, cam: null, scene: null, raf: 0, finish: null };

export function preloadCardScenes() {
  return loadThree().then((ok) => {
    if (ok) setup();
    return ok;
  });
}
export const hasCardScene = (card) => !!SCENES[card];

function setup() {
  if (H.ready) return;
  const el = document.createElement('div');
  el.id = 'card-scene';
  el.className = 'hidden';
  el.innerHTML = `
    <div class="cx-scrim"></div>
    <canvas class="cx-canvas"></canvas>
    <div class="cx-intro"><div class="cx-title"></div><div class="cx-name"></div><div class="cx-desc"></div></div>
    <div class="cx-badge"><span class="cx-badge-name"></span></div>
    <div class="cx-beat"></div>
    <div class="cx-skip">点击跳过 ▸▸</div>`;
  document.body.appendChild(el);
  try {
    H.renderer = makeRenderer(el.querySelector('canvas'));
  } catch (e) {
    el.remove();
    return;
  }
  H.el = el;
  H.canvas = el.querySelector('canvas');
  H.ready = true;
  el.addEventListener('click', () => H.finish?.());
}

const esc = (s) => {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
};

// spec：{ card, img, accent, title, name, desc, ev, players:[{name,color}], board, state }
// 返回 Promise（播完/跳过时 resolve），不支持时返回 null
export function playCardScene(spec) {
  const def = SCENES[spec.card];
  if (!def || !H.ready || reduced || document.hidden) return null;
  H.finish?.(true);
  const el = H.el;
  el.style.setProperty('--cx-accent', spec.accent || '#e6b345');
  el.querySelector('.cx-title').textContent = spec.title || '';
  el.querySelector('.cx-name').textContent = spec.name ? `「${spec.name}」` : '';
  el.querySelector('.cx-desc').textContent = spec.desc || '';
  el.querySelector('.cx-badge-name').textContent = spec.name || '';
  const beat = el.querySelector('.cx-beat');
  beat.innerHTML = '';
  el.className = 'show';

  // ---- 场景与灯光 ----
  const scene = new THREE.Scene();
  const lights = addLights(scene, H.renderer);
  const hemi = scene.children.find((c) => c.isHemisphereLight);
  const preset = LIGHTS[def.light || 'day'];
  hemi.intensity = preset.hemi;
  hemi.color.set(preset.sky);
  hemi.groundColor.set(preset.ground);
  lights.key.intensity = preset.key;
  lights.key.color.set(preset.keyColor);
  lights.rim.intensity = preset.rim;
  lights.rim.color.set(preset.rimColor);
  scene.environmentIntensity = preset.env;
  const cam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);
  scene.add(cam);
  const world = new THREE.Group();
  scene.add(world);
  const fx = K.fxPool(scene);

  // ---- 开场卡牌（挂在镜头上，始终正对观众） ----
  const card = K.cardMesh(spec.img, 0.6);
  const cardGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures().glow, color: spec.accent || '#e6b345', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  cardGlow.scale.setScalar(1.6);
  cardGlow.position.z = -0.05;
  // 卡面高光：同一张贴图当自发光，入场后亮一下（不另画扫光条，免得超出卡边）
  const faceMat = card.userData.front.material;
  faceMat.emissive = new THREE.Color('#fff4d6');
  faceMat.emissiveMap = faceMat.map;
  faceMat.emissiveIntensity = 0;
  const cardRig = new THREE.Group();
  const cardSpin = new THREE.Group();
  cardRig.add(cardGlow);
  cardRig.add(cardSpin);
  cardSpin.add(card);
  cam.add(cardRig);
  card.userData.front.material.depthTest = false;
  card.userData.front.renderOrder = 20;
  card.children[1].material = card.children[1].material.clone();
  card.children[1].material.depthTest = false;
  card.children[1].renderOrder = 20;
  cardGlow.material.depthTest = false;
  cardGlow.renderOrder = 19;

  const once = new Set();
  let shakeAmp = 0;
  let shakeT = 0;
  const ctx = {
    THREE, K, world, fx, scene, cam, lights, ev: spec.ev, state: spec.state, board: spec.board,
    color: (i) => spec.players[i]?.color || '#888888',
    resName: (r) => spec.resName?.(r) || r,
    pname: (i) => spec.players[i]?.name || '?',
    tag: (i) => `<b style="color:${spec.players[i]?.color || '#fff'}">${esc(spec.players[i]?.name || '?')}</b>`,
    names: (list) => list.map((i) => ctx.tag(i)).join('、'),
    once(key, fn) { if (!once.has(key)) { once.add(key); fn(); } },
    say(html) { // 场景旁白：换一句时淡入
      beat.classList.remove('on');
      void beat.offsetWidth;
      beat.innerHTML = html;
      beat.classList.add('on');
    },
    shake(a) { shakeAmp = Math.max(shakeAmp * Math.exp(-shakeT / 0.12), a); shakeT = 0; },
  };
  let st;
  try {
    st = def.build(ctx);
  } catch (e) { // 建模出错：不演了，交给调用方回退平面大卡
    console.warn('卡牌演出建模失败', spec.card, e);
    el.className = 'hidden';
    return null;
  }
  const dur = INTRO + (st.dur ?? def.dur ?? 3.5);
  const camDef = { target: [0, 0.45, 0], dist: 4.4, elev: 0.3, width: 3.6, ...def.camera, ...st.camera };

  return new Promise((resolve) => {
    let t0 = null;
    let last = 0;
    let done = false;
    const end = (immediate) => {
      if (done) return;
      done = true;
      H.finish = null;
      cancelAnimationFrame(H.raf);
      el.classList.add('out');
      const cleanup = () => {
        el.className = 'hidden';
        fx.clear();
        scene.traverse((o) => { if (o.geometry && !o.userData.keep) o.geometry.dispose(); });
        H.renderer.renderLists.dispose();
        resolve();
      };
      if (immediate) cleanup(); else setTimeout(cleanup, 280);
    };
    H.finish = end;
    sfx.card();
    const frame = (now) => {
      if (done) return;
      if (t0 === null) { t0 = now; last = now; }
      const t = (now - t0) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (t >= dur) { end(); return; }
      const w = H.canvas.clientWidth;
      const h = H.canvas.clientHeight;
      if (w && h) {
        const pr = Math.min(window.devicePixelRatio || 1, 2);
        if (H.canvas.width !== Math.round(w * pr) || H.canvas.height !== Math.round(h * pr)) {
          H.renderer.setPixelRatio(pr);
          H.renderer.setSize(w, h, false);
        }
        cam.aspect = w / h;
        // 开场卡牌：从下方翻入 → 停留扫光 → 飞到左上角缩成徽章
        const halfH = Math.tan((FOV / 2) * Math.PI / 180);
        const D = 2.55;
        const inK = easeOut(seg(t, 0, 0.5));
        const out = easeInOut(seg(t, INTRO - 0.15, INTRO + 0.3));
        const badgeX = -D * halfH * cam.aspect + 0.3;
        const badgeY = D * halfH - 0.32;
        cardRig.position.set(lerp(0, badgeX, out), lerp(-1.6 * (1 - inK) + 0.08 + 0.02 * Math.sin(t * 2.4), badgeY, out), -D);
        cardRig.scale.setScalar(lerp(0.7 + 0.3 * inK, 0.32, out));
        cardSpin.rotation.set(0.12 * (1 - inK) - 0.05 * (1 - out) * Math.sin(t * 1.7), lerp(-Math.PI * (1 - inK) + 0.25 * spring(seg(t, 0.35, 1.1)) * (1 - out), 0, out), 0.06 * (1 - inK));
        cardGlow.material.opacity = (0.5 + 0.25 * Math.sin(t * 5)) * (1 - 0.7 * out) * inK;
        faceMat.emissiveIntensity = 0.55 * Math.sin(Math.PI * seg(t, 0.45, 0.95));
        el.classList.toggle('intro', t < INTRO - 0.1);
        el.classList.toggle('badge', t >= INTRO + 0.2 && t < dur - OUTRO);
        // 场景
        const ts = Math.max(0, t - INTRO);
        try {
          def.frame(st, ts, t < INTRO ? 0 : dt, ctx);
        } catch (e) { // 逐帧出错：直接收场，绝不卡住时间线
          console.warn('卡牌演出播放出错', spec.card, e);
          end(true);
          return;
        }
        fx.step(dt);
        // 镜头：按宽度取景，窄屏拉远；全程缓慢推近 + 轻微横摇
        const tgt = camDef.target;
        const dist = Math.max(camDef.dist, camDef.width / (2 * halfH * cam.aspect)) * (1 - 0.05 * easeInOut(clamp01(ts / 4)));
        const az = 0.05 * Math.sin(ts * 0.6);
        shakeT += dt;
        const s = shakeAmp * Math.exp(-shakeT / 0.12);
        cam.position.set(tgt[0] + Math.sin(az) * dist + (Math.random() - 0.5) * s,
          tgt[1] + Math.sin(camDef.elev) * dist + (Math.random() - 0.5) * s,
          tgt[2] + Math.cos(az) * Math.cos(camDef.elev) * dist);
        cam.lookAt(tgt[0], tgt[1], tgt[2]);
        cam.updateProjectionMatrix();
        H.renderer.render(scene, cam);
      }
      H.raf = requestAnimationFrame(frame);
    };
    H.raf = requestAnimationFrame(frame);
  });
}

const LIGHTS = {
  day: { hemi: 1.1, sky: '#ffe9cc', ground: '#3a2817', key: 2.5, keyColor: '#fff0d8', rim: 1.5, rimColor: '#ffc27a', env: 0.45 },
  night: { hemi: 0.45, sky: '#7d8fe0', ground: '#1a1410', key: 1.1, keyColor: '#a9bcff', rim: 2.2, rimColor: '#ff9a4a', env: 0.2 },
  interior: { hemi: 0.6, sky: '#ffd9a8', ground: '#2a1a0e', key: 1.4, keyColor: '#ffd9a0', rim: 1.4, rimColor: '#ffb070', env: 0.3 },
  holy: { hemi: 1.0, sky: '#fff4dc', ground: '#3a2817', key: 2.2, keyColor: '#fff6e0', rim: 2.0, rimColor: '#ffe39a', env: 0.5 },
};

// ====================================================================
// 场景表：build(ctx) 建模并返回状态（可带 dur / camera），frame(st, ts, dt, ctx) 逐帧推进（ts 为场景内秒数）
// ====================================================================

// --------------------------------------------------------------------
// 破坏者：黑衣人蹑手蹑脚摸进来，点燃炸药桶，一桶一桶扔进受害者的仓库——轰！牌散落一地
// --------------------------------------------------------------------
SCENES.saboteur = {
  light: 'night',
  camera: { target: [0, 0.35, 0.1], dist: 6.2, elev: 0.38, width: 5.4 },
  build(ctx) {
    const { world, K: k } = ctx;
    const ground = k.hexTile('hills', 2.15);
    ground.position.y = -0.12;
    world.add(ground);
    const victims = (ctx.ev.victims || []).slice(0, 5);
    const n = Math.max(1, victims.length);
    const sc = n > 3 ? 0.72 : 0.85;
    const houses = [];
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0.35 : lerp(-1.05, 1.25, i / (n - 1));
      const z = -0.55 - 0.18 * Math.sin((i / Math.max(1, n - 1)) * Math.PI);
      const who = victims[i];
      const g = k.warehouse(who === undefined ? '#777' : ctx.color(who));
      g.scale.setScalar(sc);
      g.position.set(x, 0, z);
      g.rotation.y = -x * 0.12;
      world.add(g);
      const parts = g.userData.parts.map((m) => ({ m, v: null, w: null }));
      let tag = null;
      if (who !== undefined) {
        tag = k.label(ctx.pname(who), ctx.color(who), 0.15);
        tag.position.set(x, 0.78 * sc + 0.12, z);
        world.add(tag);
      }
      houses.push({ g, parts, who, x, z, tag, door: V3(x, 0.05, z + 0.3 * sc) });
    }
    const sab = k.actor(world, k.folk({ cloth: '#2b2630', base: ctx.color(ctx.ev.player), hat: 'hood', eyes: 'glow', eyeColor: '#ff5a3c', trim: '#777' }));
    sab.rig.fig.scale.setScalar(0.95);
    // 炸药桶：手里一桶，扔出去的各自独立
    const kegs = houses.map(() => {
      const keg = k.powderKeg();
      keg.scale.setScalar(0.7);
      keg.visible = false;
      world.add(keg);
      return keg;
    });
    const throwAt = 1.35;
    const gap = 0.3;
    const lastLand = throwAt + gap * (n - 1) + 0.55;
    return { victims, houses, sab, kegs, throwAt, gap, boomAt: lastLand + 0.35, dur: lastLand + 0.35 + (victims.length ? 1.7 : 1.4), lastSizzle: 0 };
  },
  frame(st, ts, dt, ctx) {
    const { sab, houses, kegs, throwAt, gap } = st;
    const P = sab.pose('sneak');
    const n = houses.length;
    const tEndThrow = throwAt + gap * (n - 1) + 0.25;
    // 1) 蹑手蹑脚摸进来（高抬腿慢步）
    if (ts < 1.0) {
      const ph = walk(sab, [-2.3, 0.75], [-0.35, 0.55], easeInOut(seg(ts, 0, 1.0)), 7, 0.7);
      if (ph !== null) ctx.once(`st${Math.floor(ph / Math.PI)}`, () => sfx.sneak());
      sab.rig.setGlow(0.6 + 0.4 * Math.sin(ts * 6));
    } else if (ts < tEndThrow) {
      // 2) 站定、转身面向仓库，点燃引信，逐桶抛出
      sab.place(-0.35, 0.55, 0, lerp(Math.PI / 2, Math.PI * 0.82, easeOut(seg(ts, 1.0, 1.25))));
      sab.pose('sneak', 'carry', easeOut(seg(ts, 1.0, 1.2)));
      sab.rig.setGlow(1.4);
      if (ts >= 1.15) ctx.once('light', () => { sfx.fuseLight(); ctx.fx.flash(sab.rig.handR.getWorldPosition(V3(0, 0, 0)), '#ffcf6b', 0.35, 0.3); });
      for (let i = 0; i < n; i++) {
        const t0 = throwAt + gap * i;
        if (ts >= t0 - 0.25 && ts < t0) K.pose(P, 'carry', 'raise', easeOut(seg(ts, t0 - 0.25, t0 - 0.05)));
        else if (ts >= t0 && ts < t0 + 0.2) K.pose(P, 'raise', 'point', easeOut(seg(ts, t0, t0 + 0.12)));
      }
    } else {
      // 3) 扔完转身就跑，躲到前面抱头
      const k = seg(ts, tEndThrow, tEndThrow + 0.55);
      if (k < 1) {
        const ph = walk(sab, [-0.35, 0.55], [-1.45, 1.05], easeOut(k), 5, 0.9);
        sab.P.lean = -0.1;
        if (ph !== null) ctx.once(`run${Math.floor(ph / Math.PI)}`, () => sfx.sneak());
      } else {
        sab.place(-1.45, 1.05, 0, 0.35);
        sab.pose('cover');
        sab.P.hy = 0.6 * Math.sin(ts * 3) * (ts > st.boomAt ? 0 : 1); // 偷瞄
        sab.root.position.x += Math.sin(ts * 60) * 0.004;
      }
      sab.rig.setGlow(ts > st.boomAt ? 0.4 + 0.6 * Math.abs(Math.sin(ts * 8)) : 1);
    }
    sab.apply();
    // 炸药桶飞行：手里 → 仓库门口，翻滚 + 火星拖尾；落地后引信嘶嘶作响
    const hand = sab.rig.handR.getWorldPosition(V3(0, 0, 0));
    for (let i = 0; i < n; i++) {
      const keg = kegs[i];
      const h = houses[i];
      const t0 = throwAt + gap * i;
      if (ts < 1.12 || h.blown) { keg.visible = false; continue; }
      keg.visible = true;
      const fuse = V3(0, 0.26 * 0.7, 0);
      if (ts < t0) {
        keg.position.copy(i === Math.min(n - 1, Math.max(0, Math.floor((ts - throwAt + gap) / gap))) ? hand.clone().add(V3(0, -0.08, 0.02)) : V3(-9, -9, -9));
        keg.rotation.set(0, 0, 0);
      } else {
        const k = seg(ts, t0, t0 + 0.55);
        if (k < 1) {
          keg.position.copy(arc(hand.clone(), h.door, easeIn(k) * 0.3 + k * 0.7, 0.9));
          keg.rotation.set(k * 9, 0, k * 4);
          ctx.once(`whoosh${i}`, () => sfx.swordSwing());
        } else {
          keg.position.copy(h.door);
          keg.rotation.set(0, 0, 0);
          ctx.once(`thud${i}`, () => { sfx.kegLand(); ctx.fx.puff(h.door.clone(), V3(0, 0.15, 0), 0.25, 0.6); });
        }
      }
      // 引信火星
      if (ts > 1.15 && Math.random() < dt * 40) {
        const tip = keg.localToWorld(fuse.clone());
        ctx.fx.sparks(tip, 1, 0.6, '#ffcf6b', 0.06, 0.35, 2);
      }
    }
    if (ts > 1.2 && ts < st.boomAt && ts - st.lastSizzle > 0.32) { st.lastSizzle = ts; sfx.fuseHiss(); }
    // 4) 爆炸（有受害者：逐个炸开，墙板屋顶飞散、资源牌漫天飘落；无受害者：引信熄灭冒一股烟）
    for (let i = 0; i < n; i++) {
      const h = houses[i];
      const tb = st.boomAt + i * 0.14;
      if (ts < tb) continue;
      if (h.who === undefined) {
        ctx.once('dud', () => {
          h.blown = false;
          ctx.fx.smoke(h.door.clone(), 5, 0.15, 0.3, '#8a8078');
          sfx.fizzle();
          ctx.say('💨 引信灭了……没有玩家受到破坏者影响');
        });
        continue;
      }
      ctx.once(`boom${i}`, () => {
        h.blown = true;
        const c = h.door.clone().add(V3(0, 0.2, -0.2));
        ctx.fx.flash(c.clone().add(V3(0, 0.15, 0.2)), '#fff2c0', 2.2, 0.45);
        ctx.fx.glow(c.clone(), '#ff8a3c', 2.4, 0.8);
        ctx.fx.ring(h.x, 0.02, h.z + 0.1, '#ffb060', 3, 0.7);
        ctx.fx.sparks(c.clone(), 26, 2.6, '#ffb347', 0.1, 0.9, 3);
        ctx.fx.smoke(c.clone(), 12, 0.8, 0.55, '#4e443c');
        ctx.fx.debris(() => K.resCard(RES5[Math.floor(Math.random() * 5)], 0.13), c.clone().add(V3(0, 0.2, 0)), 9,
          { speed: 1.5, up: 1.6, gravity: 2.2, drag: 1.6, dur: 2.2, spread: 1.2, floor: 0.005 });
        for (const p of h.parts) {
          const d = p.m.position.clone().setY(0).normalize();
          p.v = V3(d.x * (0.5 + Math.random() * 0.6), 1.3 + Math.random() * 0.9, d.z * (0.4 + Math.random() * 0.5) - 0.15);
          p.w = V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(10);
        }
        ctx.shake(0.12);
        sfx.boom(i);
        if (i === 0) ctx.say(`💥 ${ctx.names(st.victims)} 的仓库被炸了！各自弃掉一半手牌`);
      });
      // 碎片：重力 + 地面摩擦（局部坐标系下推进，仓库缩放 sc）
      for (const p of h.parts) {
        if (!p.v) continue;
        p.v.y -= 6 * dt;
        p.m.position.addScaledVector(p.v, dt);
        if (p.m.position.y < 0.02) { p.m.position.y = 0.02; p.v.multiplyScalar(0.4); p.v.y = Math.abs(p.v.y) * 0.3; p.w.multiplyScalar(0.6); }
        p.m.rotation.x += p.w.x * dt;
        p.m.rotation.y += p.w.y * dt;
        p.m.rotation.z += p.w.z * dt;
      }
      if (h.tag) { // 名字牌被震得一抖、变红
        const kk = seg(ts, tb, tb + 0.6);
        h.tag.position.y = 0.78 * 0.85 + 0.12 + 0.25 * Math.sin(Math.PI * kk);
        h.tag.material.color.setRGB(1, 1 - 0.45 * Math.sin(Math.PI * Math.min(1, kk * 2)), 1 - 0.5 * Math.sin(Math.PI * Math.min(1, kk * 2)));
      }
    }
    if (ts > 0.2 && ts < 1.0) ctx.once('intro', () => ctx.say(`🧨 ${ctx.tag(ctx.ev.player)} 派出的破坏者摸进了夜色……`));
  },
};

// --------------------------------------------------------------------
// 婚礼：新人从两侧走到花拱下相会、钟声齐鸣花瓣纷飞 → 请柬飞向分数更高的宾客 → 宾客捧出礼盒鞠躬
// --------------------------------------------------------------------
SCENES.wedding = {
  light: 'day',
  camera: { target: [0, 0.55, 0.15], dist: 6.0, elev: 0.28, width: 5.0 },
  build(ctx) {
    const { world, K: k } = ctx;
    const ground = k.hexTile('pasture', 2.15);
    ground.position.y = -0.12;
    world.add(ground);
    const arch = k.weddingArch();
    arch.position.set(0, 0, -0.45);
    world.add(arch);
    const bellG = k.bell();
    bellG.position.set(0, 1.47, -0.45);
    world.add(bellG);
    // 红毯
    const carpet = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.01, 1.7), K.mat('#b8323e', { rough: 0.9 }));
    carpet.position.set(0, 0.005, 0.35);
    world.add(carpet);
    const col = ctx.color(ctx.ev.player);
    const groom = k.actor(world, k.folk({ cloth: col, hat: 'tophat', trim: '#e2c06a', base: col }));
    const bride = k.actor(world, k.folk({ cloth: '#fbf8f2', skirt: true, hat: 'veil', trim: '#f0d48a', base: col, skin: '#f0c4a0' }));
    const bouquet = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), K.mat(['#ff8fb5', '#ffffff', '#ffd36b', '#ff6f9a', '#d98cff'][i]));
      f.position.set(Math.cos(i * 1.3) * 0.03, 0.02 + (i % 2) * 0.02, Math.sin(i * 1.3) * 0.03);
      bouquet.add(f);
    }
    bride.rig.handL.add(bouquet);
    const guests = (ctx.ev.guests || []).slice(0, 5).map((who, i) => {
      const side = i % 2 ? 1 : -1;
      const row = Math.floor(i / 2);
      const x = side * (1.25 + row * 0.25);
      const z = 0.25 + row * 0.6;
      const a = k.actor(world, k.folk({ cloth: ctx.color(who), hat: 'cap', base: ctx.color(who) }));
      a.home = [x, z];
      a.who = who;
      const yaw = Math.atan2(-x, -0.1 - z);
      a.place(x, z, 0, yaw);
      a.yaw = yaw;
      const tag = k.label(ctx.pname(who), ctx.color(who), 0.14);
      tag.position.set(x, 1.0, z);
      world.add(tag);
      const env = k.envelope(col);
      env.visible = false;
      world.add(env);
      const gift = k.giftBox(ctx.color(who), '#ffe08a', 0.1);
      gift.visible = false;
      a.rig.handR.add(gift);
      gift.position.set(0.07, -0.02, 0.06);
      return { a, env, gift, tag };
    });
    return { groom, bride, bellG, guests, dur: guests.length ? 2.6 + 0.18 * guests.length + 1.3 : 3.0 };
  },
  frame(st, ts, dt, ctx) {
    const { groom, bride, bellG, guests } = st;
    // 1) 新人从两侧走到花拱下
    const wk = easeInOut(seg(ts, 0, 1.0));
    groom.pose('idle');
    bride.pose('idle');
    const phG = walk(groom, [-2.0, 0.35], [-0.2, -0.2], wk, 6, 0.5);
    walk(bride, [2.0, 0.35], [0.2, -0.2], wk, 6, 0.35);
    if (phG !== null) ctx.once(`s${Math.floor(phG / Math.PI)}`, () => sfx.sneak());
    bride.P.aLx = -0.9; // 捧花
    if (ts >= 1.0) {
      // 2) 相对而立、靠近——钟声、心形与花瓣
      const face = easeOut(seg(ts, 1.0, 1.25));
      const lean = Math.sin(Math.PI * seg(ts, 1.2, 1.9));
      groom.place(-0.2 + 0.05 * lean, -0.2, 0, lerp(Math.PI * 0.75, Math.PI / 2, face));
      bride.place(0.2 - 0.05 * lean, -0.2, 0, lerp(-Math.PI * 0.75, -Math.PI / 2, face));
      groom.P.lean = 0.3 * lean;
      bride.P.lean = 0.3 * lean;
      groom.P.aRx = -0.6 * face;
      bride.P.aRx = -0.6 * face; // 牵手
      if (ts >= 1.45) ctx.once('kiss', () => {
        sfx.weddingBell();
        ctx.fx.debris(() => K.heart(['#ff5b8a', '#ff8fb5', '#ff3d6e'][Math.floor(Math.random() * 3)], 0.05), V3(0, 0.78, -0.2), 8,
          { speed: 0.5, up: 1.6, gravity: -0.15, drag: 1.8, dur: 1.6, spread: 0.6, spin: 1.5 });
        ctx.say(`💒 ${ctx.tag(ctx.ev.player)} 举行婚礼！`);
      });
      if (ts >= 1.45 && Math.random() < dt * 30) {
        ctx.fx.debris(() => K.petal(['#ffb3cc', '#ffffff', '#ffd6e6'][Math.floor(Math.random() * 3)]),
          V3((Math.random() - 0.5) * 1.6, 1.7, -0.3 + (Math.random() - 0.5) * 0.6), 1,
          { speed: 0.3, up: 0.1, gravity: 0.5, drag: 2.5, dur: 2.4, spread: 1, spin: 5, floor: 0.01 });
      }
      if (ts >= 1.95) { // 转向观众挥手
        const turn = easeInOut(seg(ts, 1.95, 2.25));
        groom.root.rotation.y = lerp(Math.PI / 2, 0.2, turn);
        bride.root.rotation.y = lerp(-Math.PI / 2, -0.2, turn);
        groom.P.lean = bride.P.lean = 0;
        groom.P.aLx = -2.6 * turn + 0.3 * Math.sin(ts * 10) * turn;
        groom.P.aLz = 0.3 * turn;
        bride.P.aRx = -2.6 * turn + 0.3 * Math.sin(ts * 10 + 1) * turn;
        bride.P.aRz = -0.3 * turn;
      }
    }
    bellG.rotation.z = ts >= 1.45 ? 0.5 * Math.sin((ts - 1.45) * 9) * Math.exp(-(ts - 1.45) * 0.9) : 0;
    groom.apply();
    bride.apply();
    // 3) 请柬飞向宾客 → 宾客接住，捧出礼盒鞠躬
    const t3 = 2.3;
    guests.forEach((g, i) => {
      const { a, env, gift } = g;
      const t0 = t3 + i * 0.18;
      a.pose('idle');
      a.P.hy = 0.15 * Math.sin(ts * 1.5 + i);
      if (ts >= 1.45 && ts < t0) { a.P.aLx = a.P.aRx = -2.4 + 0.4 * Math.sin(ts * 14 + i); a.P.aLz = 0.5; a.P.aRz = -0.5; } // 鼓掌
      const from = V3(0, 0.75, -0.2);
      const to = V3(a.home[0] * 0.92, 0.5, a.home[1] + 0.08);
      const k = seg(ts, t0, t0 + 0.6);
      if (ts >= t0 && k < 1) {
        env.visible = true;
        env.position.copy(arc(from, to, easeInOut(k), 0.55));
        env.rotation.set(0.3, k * Math.PI * 4, 0.2 * Math.sin(k * 9));
        ctx.once(`env${i}`, () => sfx.card());
      } else if (k >= 1) {
        env.visible = false;
        ctx.once(`got${i}`, () => {
          ctx.fx.debris(() => K.confettiPiece(['#ffd36b', '#ff8fb5', '#9fe3ff', '#b6e380'][Math.floor(Math.random() * 4)]), to.clone(), 10,
            { speed: 0.9, up: 1.2, gravity: 2, drag: 2, dur: 1.4, spread: 1, floor: 0.01 });
          sfx.coin();
          if (i === guests.length - 1) ctx.say(`💌 请柬送到 ${ctx.names(st.guests.map((x) => x.a.who))}：各备 2 张牌作贺礼`);
        });
        const b = easeOut(seg(ts, t0 + 0.6, t0 + 0.9));
        gift.visible = true;
        gift.scale.setScalar(Math.max(0.01, b + 0.25 * spring(seg(ts, t0 + 0.6, t0 + 1.4))));
        a.pose('idle', 'offer', b);
        const bow = Math.sin(Math.PI * seg(ts, t0 + 1.0, t0 + 1.7));
        a.P.lean += 0.4 * bow;
        a.P.hx += 0.3 * bow;
      }
      a.apply();
    });
    if (!guests.length && ts >= 2.3) ctx.once('noguest', () => ctx.say('没有分数更高的宾客，婚礼无人送礼'));
  },
};

// --------------------------------------------------------------------
// 间谍：对手趴在桌上打盹，间谍从暗处摸到桌边，举起放大镜一张张翻看他的进步卡；对手一哆嗦，间谍僵住
// --------------------------------------------------------------------
SCENES.spy = {
  light: 'interior',
  camera: { target: [0, 0.42, 0], dist: 5.2, elev: 0.34, width: 4.4 },
  build(ctx) {
    const { world, K: k } = ctx;
    floorDisc(world, '#6e4a2e', 2.0);
    const target = ctx.ev.target;
    const tcol = ctx.color(target);
    const tbl = k.table(1.15, 0.6, 0.44, '#7a4e2c');
    tbl.position.set(0.35, 0, -0.25);
    world.add(tbl);
    const victim = k.actor(world, k.folk({ cloth: tcol, hat: 'cap', base: tcol }));
    victim.place(0.55, -0.72, 0, 0.2);
    // 油灯（暖色点光源，忽明忽暗）
    const lamp = new THREE.PointLight('#ffb35a', 2.2, 4, 1.6);
    lamp.position.set(0.82, 0.7, -0.3);
    world.add(lamp);
    const lampGlass = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), K.unlit('#ffd28a', { opacity: 0.9 }));
    lampGlass.position.copy(lamp.position);
    world.add(lampGlass);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.06, 12), K.mat('#c9973f', { metal: 0.8, rough: 0.3 }));
    lampBase.position.set(0.82, 0.49, -0.3);
    world.add(lampBase);
    // 对手的进步卡：背面朝上摊在桌上（只演张数，不泄露卡面）
    const count = Math.max(1, Math.min(4, ctx.state?.players?.[target]?.devCount || 3));
    const cards = [];
    for (let i = 0; i < count; i++) {
      const c = k.cardMesh('/assets/opt/progress-politics.webp', 0.2, '#3a2a1a');
      c.rotation.x = Math.PI / 2; // 背面朝上平放
      c.position.set(0.02 + i * 0.22, tbl.userData.top + 0.005 + i * 0.001, -0.12);
      world.add(c);
      cards.push({ c, x: c.position.x });
    }
    const spy = k.actor(world, k.folk({ cloth: '#23202a', base: ctx.color(ctx.ev.player), hat: 'hood', eyes: 'glow', eyeColor: '#7fe3ff', trim: '#556' }));
    const glass = k.magnifier();
    glass.rotation.x = -Math.PI / 2;
    glass.position.set(0, -0.02, 0.06);
    spy.rig.handR.add(glass);
    const zs = [0, 1, 2].map(() => { const z = k.label('z', '#9fb4ff', 0.1); z.material.opacity = 0; world.add(z); return z; });
    const alarm = k.label('!', '#ff6a4a', 0.2);
    alarm.material.opacity = 0;
    world.add(alarm);
    return { victim, spy, cards, lamp, zs, alarm, target, dur: 3.5 };
  },
  frame(st, ts, dt, ctx) {
    const { victim, spy, cards, lamp, zs, alarm } = st;
    lamp.intensity = 2.0 + 0.35 * Math.sin(ts * 13) * Math.sin(ts * 7.3);
    // 打盹的对手：随呼吸起伏，头顶冒 z
    victim.pose('sleep');
    const startle = seg(ts, 2.15, 2.75);
    const jolt = Math.sin(Math.PI * startle);
    victim.P.hx = 0.75 - 0.9 * jolt;
    victim.P.lean = 0.55 - 0.45 * jolt;
    victim.P.hy = 0.2 + 0.5 * jolt * Math.sin(ts * 9);
    victim.squash.scale.y = 1 + 0.015 * Math.sin(ts * 2.6);
    victim.apply();
    zs.forEach((z, i) => {
      const p = ((ts * 0.55 + i / 3) % 1);
      const hide = startle > 0 && startle < 1 ? 0 : 1;
      z.position.set(0.62 + p * 0.25, 0.75 + p * 0.45, -0.65);
      z.material.opacity = Math.sin(Math.PI * p) * 0.9 * hide;
      z.scale.setScalar(0.06 + p * 0.06);
    });
    alarm.position.set(0.55, 1.05 + 0.06 * jolt, -0.7);
    alarm.material.opacity = jolt > 0.05 ? 1 : 0;
    alarm.scale.setScalar(0.14 * (1 + 0.4 * jolt));
    if (startle > 0) ctx.once('startle', () => sfx.spyAlarm());
    // 间谍：从左侧暗处蹑手蹑脚摸到桌边
    spy.pose('sneak');
    if (ts < 1.25) {
      const ph = walk(spy, [-2.2, 0.55], [-0.2, 0.22], easeInOut(seg(ts, 0, 1.25)), 8, 0.7);
      if (ph !== null) ctx.once(`st${Math.floor(ph / Math.PI)}`, () => sfx.sneak());
      spy.rig.setGlow(0.5);
    } else {
      spy.place(-0.2 + 0.32 * easeInOut(seg(ts, 1.6, 2.1)) - 0.12 * easeInOut(seg(ts, 2.15, 2.4)) + 0.12 * easeInOut(seg(ts, 2.8, 3.1)), 0.22, 0, Math.PI * 0.78);
      // 举起放大镜贴近卡牌，沿着一排卡扫过去
      const up = easeOut(seg(ts, 1.25, 1.55));
      K.pose(spy.P, 'sneak', 'point', up);
      spy.P.aRx = lerp(-0.7, -1.25, up);
      spy.P.lean = 0.35 + 0.15 * up;
      spy.P.hx = 0.35;
      const freeze = startle > 0 && startle < 1;
      spy.rig.setGlow(freeze ? 0.15 : 1.2 + 0.6 * Math.sin(ts * 7));
      if (freeze) { spy.P.crouch = 0.2; spy.P.hy = 0; }
      else spy.P.hy = 0.25 * Math.sin(ts * 3);
      if (ts > 1.4) ctx.once('peek', () => ctx.say(`🕵️ ${ctx.tag(ctx.ev.player)} 正在偷看 ${ctx.tag(st.target)} 的进步卡……`));
    }
    spy.apply();
    // 卡牌：放大镜扫到哪张，哪张竖起来朝向间谍（观众只看到背面）
    const scan = seg(ts, 1.55, 3.2);
    cards.forEach((c, i) => {
      const center = (i + 0.5) / cards.length;
      const near = Math.max(0, 1 - Math.abs(scan - center) * cards.length * 1.2);
      const lift = easeOut(near) * (startle > 0 && startle < 1 ? 0.2 : 1);
      c.c.rotation.set(Math.PI / 2 - 1.1 * lift, -0.7 * lift, 0);
      c.c.position.y = 0.47 + 0.1 * lift;
      if (near > 0.9) ctx.once(`flip${i}`, () => { sfx.card(); ctx.fx.flash(c.c.position.clone().add(V3(0, 0.08, 0)), '#bff3ff', 0.25, 0.25); });
    });
  },
};

// --------------------------------------------------------------------
// 主教：主教举起权杖，圣光落在目标地块上，强盗被光牵引飞进光柱、落地发抖 → 周围各家飞来一枚什一税金币
// --------------------------------------------------------------------
SCENES.bishop = {
  light: 'holy',
  camera: { target: [0.1, 0.45, 0.1], dist: 6.0, elev: 0.36, width: 5.2 },
  build(ctx) {
    const { world, K: k, ev, board } = ctx;
    const hex = board?.hexes?.[ev.hex];
    const ground = k.hexTile('pasture', 2.25);
    ground.position.y = -0.12;
    world.add(ground);
    // 目标地块（小一号，叠在中央，带数字令牌）
    const tile = k.hexTile(hex?.terrain || 'desert', 0.62, 0.08);
    tile.position.set(0.35, 0, -0.15);
    world.add(tile);
    if (hex?.number) {
      const tok = k.numberToken(hex.number, 0.15);
      tok.position.set(0.35, 0.081, 0.2);
      world.add(tok);
    }
    const tileTop = 0.08;
    const victims = (ev.victims || []).slice(0, 5);
    const houses = victims.map((who, i) => {
      const a = -Math.PI / 2 + (i - (victims.length - 1) / 2) * 0.85 + Math.PI;
      const x = 0.35 + Math.cos(a) * 0.78;
      const z = -0.15 + Math.sin(a) * 0.62 - 0.1;
      const h = k.house(ctx.color(who), 1.3);
      h.position.set(x, 0, z);
      h.rotation.y = -a;
      world.add(h);
      const tag = k.label(ctx.pname(who), ctx.color(who), 0.13);
      tag.position.set(x, 0.5, z);
      world.add(tag);
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.014, 20), K.mat('#e9b94f', { metal: 0.9, rough: 0.25 }));
      coin.visible = false;
      world.add(coin);
      return { who, x, z, coin };
    });
    const col = ctx.color(ev.player);
    const bishop = k.actor(world, k.folk({ cloth: '#f4efe4', robe: true, hat: 'mitre', trim: '#e2b04f', base: col }));
    const staff = k.crozier();
    staff.position.set(0, -0.15, 0.0);
    bishop.rig.handR.add(staff);
    // 主教胸前的玩家色圣带
    const stole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.02), K.mat(col));
    stole.position.set(0, 0.38, 0.135);
    bishop.rig.body.add(stole);
    const robberM = buildRobber();
    const robber = k.actor(world, { fig: robberM.fig }, 0.5);
    robber.robberM = robberM;
    robberM.fig.scale.setScalar(0.62);
    const beam = k.lightBeam('#fff0b0', 0.42, 3.4);
    beam.position.set(0.35, tileTop, -0.15);
    world.add(beam);
    const holy = new THREE.PointLight('#ffe7a0', 0, 3, 1.5);
    holy.position.set(0.35, 0.8, -0.15);
    world.add(holy);
    return { bishop, staff, robber, beam, holy, houses, victims, tileTop, dur: 3.0 + (victims.length ? 0.3 * victims.length + 0.6 : 0.4) };
  },
  frame(st, ts, dt, ctx) {
    const { bishop, robber, beam, holy, houses, tileTop } = st;
    // 1) 主教走上前，高举权杖
    bishop.pose('idle');
    walk(bishop, [-2.0, 0.75], [-1.1, 0.55], easeInOut(seg(ts, 0, 0.7)), 4, 0.35);
    if (ts >= 0.7) {
      bishop.place(-1.1, 0.55, 0, lerp(Math.PI / 2, Math.PI * 0.62, easeOut(seg(ts, 0.7, 0.9))));
      const r = easeOut(seg(ts, 0.7, 1.0));
      K.pose(bishop.P, 'idle', 'raise', r);
      bishop.P.aRx += 0.05 * Math.sin(ts * 3);
      ctx.once('raise', () => { sfx.holyChime(); ctx.say(`⛪ ${ctx.tag(ctx.ev.player)} 的主教降下圣光……`); });
    } else bishop.P.aRx = -0.5; // 拄着权杖
    bishop.apply();
    st.staff.rotation.set(-bishop.P.aRx, 0, -bishop.P.aRz); // 抵消手臂转角：权杖始终竖直
    const tip = bishop.rig.handR.getWorldPosition(V3(0, 0, 0)).add(V3(0, 0.45, 0));
    if (ts > 0.9 && Math.random() < dt * 25) ctx.fx.sparks(tip, 1, 0.4, '#fff2b0', 0.06, 0.6, -0.3);
    // 2) 光柱落在目标地块
    const b = easeOut(seg(ts, 1.0, 1.35));
    beam.userData.beam.material.opacity = 0.55 * b * (1 - 0.6 * seg(ts, st.dur - 0.6, st.dur)) * (0.85 + 0.15 * Math.sin(ts * 9));
    beam.scale.set(0.3 + 0.7 * b, 1, 0.3 + 0.7 * b);
    holy.intensity = 3 * b;
    if (ts >= 1.05) ctx.once('beam', () => { ctx.fx.ring(0.35, tileTop + 0.01, -0.15, '#fff0b0', 2.2, 0.7); ctx.fx.flash(V3(0.35, 0.5, -0.15), '#fff6d0', 1.4, 0.4); });
    // 3) 强盗被圣光拽进光柱（原地躲在右侧草丛 → 腾空飞起 → 落进地块发抖）
    const R = robber;
    const RM = R.robberM;
    const from = V3(1.75, 0, 0.45);
    const to = V3(0.35, tileTop, -0.15);
    const fk = seg(ts, 1.4, 2.15);
    RM.setGlow(1 + 2 * Math.sin(Math.PI * fk));
    if (fk <= 0) {
      R.place(from.x, from.z, 0, -0.9 + 0.3 * Math.sin(ts * 1.3));
      R.squash.scale.set(1, 1, 1);
      RM.head.rotation.y = 0.4 * Math.sin(ts * 2);
    } else if (fk < 1) {
      const p = arc(from, to, easeInOut(fk), 0.9);
      R.root.position.copy(p);
      R.root.rotation.set(0.3 * Math.sin(fk * 10), -0.9 + fk * Math.PI * 2, 0.25 * Math.sin(fk * 7));
      R.shadow.position.set(p.x, 0.004, p.z);
      ctx.once('yank', () => { sfx.robberYelp(); });
    } else {
      R.root.rotation.set(0, 0.2, 0);
      R.place(to.x, to.z, tileTop, 0.25);
      R.root.position.x += Math.sin(ts * 55) * 0.006; // 发抖
      R.squash.scale.set(1 + 0.12 * spring(seg(ts, 2.15, 2.8)), 1 - 0.2 * spring(seg(ts, 2.15, 2.8)), 1 + 0.12 * spring(seg(ts, 2.15, 2.8)));
      RM.head.rotation.set(0.3, 0, 0);
      ctx.once('land', () => { sfx.robber(); ctx.fx.puff(to.clone().add(V3(0, 0.02, 0)), V3(0, 0.2, 0), 0.5, 0.6, '#fff4d0'); ctx.shake(0.04); });
      R.shadow.position.y = tileTop + 0.004;
    }
    // 4) 什一税：每家飞来一枚金币落进主教手里
    houses.forEach((h, i) => {
      const t0 = 2.35 + i * 0.3;
      const k = seg(ts, t0, t0 + 0.6);
      if (ts < t0 || k >= 1) { h.coin.visible = false; if (k >= 1) ctx.once(`coin${i}`, () => { sfx.coin(); ctx.fx.flash(V3(-1.05, 0.65, 0.6), '#ffe08a', 0.4, 0.3); }); return; }
      h.coin.visible = true;
      h.coin.position.copy(arc(V3(h.x, 0.25, h.z), V3(-1.05, 0.62, 0.6), easeInOut(k), 0.7));
      h.coin.rotation.set(Math.PI / 2, k * 14, 0);
      ctx.once(`up${i}`, () => sfx.card());
    });
    if (ts >= 2.3) ctx.once('tithe', () => ctx.say(st.victims.length
      ? `⛪ 强盗被赶到${hexPos(ctx.board, ctx.ev.hex)} · 向 ${ctx.names(st.victims)} 各收取 1 张牌`
      : `⛪ 强盗被赶到${hexPos(ctx.board, ctx.ev.hex)}（周围没有可收取的玩家）`));
  },
};

// --------------------------------------------------------------------
// 发明家：在图纸上涂涂画画 → 灵光一闪 → 一拉拉杆，两块地块的数字令牌腾空交换
// --------------------------------------------------------------------
SCENES.inventor = {
  light: 'interior',
  camera: { target: [0.2, 0.42, 0.05], dist: 5.4, elev: 0.36, width: 4.6 },
  build(ctx) {
    const { world, K: k, ev, board } = ctx;
    floorDisc(world, '#6a482c', 2.05);
    const col = ctx.color(ev.player);
    const desk = k.table(0.7, 0.45, 0.36, '#7a4e2c');
    desk.position.set(-0.95, 0, -0.25);
    world.add(desk);
    const bp = k.blueprint(0.5);
    bp.rotation.x = -Math.PI / 2 + 0.25;
    bp.position.set(-0.95, desk.userData.top + 0.03, -0.25);
    world.add(bp);
    const inv = k.actor(world, k.folk({ cloth: col, hat: 'goggles', apron: '#7a5232', base: col }));
    const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6), K.mat('#f2c14e'));
    pencil.rotation.x = Math.PI / 2;
    inv.rig.handR.add(pencil);
    // 背后的齿轮墙
    const gears = [[-0.4, 1.05, -0.95, 0.28, 12, 1], [0.05, 0.78, -0.95, 0.18, 9, -1.5], [0.38, 1.12, -0.95, 0.22, 10, 1.2], [0.75, 0.82, -0.95, 0.15, 8, -1.8]]
      .map(([x, y, z, r, n, sp]) => { const g = k.gear(r, n, '#b98a3a'); g.position.set(x, y, z); world.add(g); return { g, sp }; });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.8), K.mat('#4a3020', { rough: 0.9 }));
    wall.position.set(0, 0.9, -1.05);
    world.add(wall);
    // 拉杆
    const lever = new THREE.Group();
    lever.position.set(-0.45, 0.0, 0.05);
    world.add(lever);
    const lb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.1), K.mat('#5a3b22'));
    lb.position.y = 0.04;
    lever.add(lb);
    const arm = new THREE.Group();
    arm.position.y = 0.08;
    lever.add(arm);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 8), K.mat('#8a8f96', { metal: 0.8, rough: 0.35 }));
    stick.position.y = 0.175;
    arm.add(stick);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), K.mat('#c0392b', { rough: 0.4 }));
    knob.position.y = 0.36;
    arm.add(knob);
    arm.rotation.z = 0.6;
    // 两块地块与令牌
    const h1 = board?.hexes?.[ev.h1];
    const h2 = board?.hexes?.[ev.h2];
    const n1 = ev.n1 ?? h2?.number ?? 4; // 事件里是交换前的数字；老事件没有就用交换后的反推
    const n2 = ev.n2 ?? h1?.number ?? 10;
    const A = V3(0.25, 0, 0.35);
    const B = V3(1.25, 0, 0.1);
    const tiles = [[h1, A], [h2, B]].map(([h, p]) => { const t = k.hexTile(h?.terrain || 'fields', 0.45, 0.07); t.position.copy(p); world.add(t); return t; });
    const tokA = k.numberToken(n1, 0.16);
    const tokB = k.numberToken(n2, 0.16);
    world.add(tokA);
    world.add(tokB);
    const tagA = k.label(hexPos(board, ev.h1), '#ffd36b', 0.11);
    tagA.position.set(A.x, 0.62, A.z);
    world.add(tagA);
    const tagB = k.label(hexPos(board, ev.h2), '#ffd36b', 0.11);
    tagB.position.set(B.x, 0.62, B.z);
    world.add(tagB);
    return { inv, gears, arm, A, B, tokA, tokB, n1, n2, tiles, dur: 3.1 };
  },
  frame(st, ts, dt, ctx) {
    const { inv, gears, arm, A, B, tokA, tokB } = st;
    const fast = seg(ts, 1.45, 1.7) * (1 - seg(ts, 2.5, 2.9));
    for (const g of gears) g.g.rotation.z += g.sp * dt * (0.6 + 5 * fast);
    // 1) 伏案涂画
    inv.place(-0.95, 0.12, 0, Math.PI * 0.95);
    inv.pose('write');
    inv.P.aRz += 0.25 * Math.sin(ts * 18);
    inv.P.aRx += 0.1 * Math.sin(ts * 11);
    if (ts < 0.9 && Math.floor(ts * 6) !== st.lastScr) { st.lastScr = Math.floor(ts * 6); sfx.scribble(); }
    if (ts > 0.1) ctx.once('think', () => ctx.say(`⚙️ ${ctx.tag(ctx.ev.player)} 的发明家埋头画图纸……`));
    // 2) 灵光一闪：蹦起来
    if (ts >= 0.9) {
      const j = seg(ts, 0.9, 1.25);
      inv.place(-0.95, 0.12, 0.22 * Math.sin(Math.PI * j), lerp(Math.PI * 0.95, 0.5, easeOut(seg(ts, 0.95, 1.2))));
      inv.pose('write', 'cheer', easeOut(seg(ts, 0.9, 1.05)));
      ctx.once('eureka', () => {
        sfx.twinkle();
        ctx.fx.flash(V3(-0.95, 1.05, 0.12), '#fff6b0', 0.9, 0.5);
        ctx.fx.sparks(V3(-0.95, 1.0, 0.12), 10, 1.0, '#ffe08a', 0.07, 0.6, 1.5);
      });
    }
    // 3) 走到拉杆边一拉
    if (ts >= 1.2) {
      const wk = seg(ts, 1.2, 1.45);
      walk(inv, [-0.95, 0.12], [-0.68, 0.12], easeInOut(wk), 2, 0.4);
      if (wk >= 1) inv.root.rotation.y = Math.PI / 2;
      inv.pose('idle', 'point', easeOut(seg(ts, 1.3, 1.45)));
      const pull = easeOut(seg(ts, 1.45, 1.6));
      inv.P.aRx = lerp(-1.5, -0.6, pull);
      arm.rotation.z = lerp(0.6, -0.6, pull);
      if (pull > 0) ctx.once('lever', () => { sfx.lever(); ctx.shake(0.02); });
      if (ts > 2.75) K.pose(inv.P, 'idle', 'cheer', easeOut(seg(ts, 2.75, 2.95)));
    }
    inv.apply();
    // 4) 令牌腾空、自转、交叉换位、落地回弹
    const top = 0.071;
    const up = easeOut(seg(ts, 1.6, 1.85));
    const sw = easeInOut(seg(ts, 1.9, 2.55));
    const land = seg(ts, 2.55, 3.0);
    const place = (tok, from, to, side) => {
      const p = V3(lerp(from.x, to.x, sw), top + 0.5 * up * (1 - easeIn(land)) + 0.35 * Math.sin(Math.PI * sw), lerp(from.z, to.z, sw) + side * 0.35 * Math.sin(Math.PI * sw));
      tok.position.copy(p);
      tok.rotation.set(0.3 * up * (1 - land), ts * 8 * up * (1 - land), 0);
      const sq = spring(land);
      tok.scale.set(1 + 0.15 * sq, 1 - 0.3 * sq, 1 + 0.15 * sq);
    };
    place(tokA, A, B, 1);
    place(tokB, B, A, -1);
    if (ts >= 1.6) ctx.once('rise', () => { sfx.card(); ctx.fx.sparks(A.clone().add(V3(0, 0.1, 0)), 8, 0.8, '#ffe08a', 0.06, 0.5); ctx.fx.sparks(B.clone().add(V3(0, 0.1, 0)), 8, 0.8, '#ffe08a', 0.06, 0.5); });
    if (ts >= 2.6) ctx.once('land', () => {
      sfx.coin();
      ctx.fx.ring(A.x, 0.08, A.z, '#ffd36b', 1.3, 0.5);
      ctx.fx.ring(B.x, 0.08, B.z, '#ffd36b', 1.3, 0.5);
      ctx.say(`⚙️ ${hexPos(ctx.board, ctx.ev.h1)} 的 ${st.n1} ⇄ ${hexPos(ctx.board, ctx.ev.h2)} 的 ${st.n2}`);
    });
  },
};
