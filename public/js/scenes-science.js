// 科学（绿）进步卡的发动演出：炼金术士、起重机、工程师、灌溉、采矿、医学、印刷机（分数卡）、修路、铁匠
// （发明家在 card-scenes.js）
import { THREE, lerp, easeInOut, easeOut, easeIn, seg, spring, mixStance, setStance } from './three-figures.js';
import * as K from './scene-kit.js';
import { sfx } from './sfx.js';
import { SCENES, V3, arc, walk, ground, floorDisc, knightActor, flyGroup, cardOf } from './scene-registry.js';

// 分数卡收尾：金色「+1 分」
function plusOne(ctx, st, ts, at, pos) {
  if (!st.plus) {
    st.plus = K.label('+1 分', '#ffd36b', 0.24);
    st.plus.material.opacity = 0;
    ctx.world.add(st.plus);
  }
  const k = seg(ts, at, at + 0.6);
  st.plus.position.set(pos.x, pos.y + 0.4 * easeOut(k), pos.z);
  st.plus.material.opacity = k > 0 ? Math.min(1, k * 3) : 0;
  if (k > 0) ctx.once('plus', () => { sfx.fanfare(); ctx.fx.sparks(pos.clone(), 18, 1.4, '#ffe08a', 0.08, 0.9, 1.5); });
}

// --------------------------------------------------------------------
// 炼金术士：坩埚咕嘟冒泡，搅拌，两颗骰子从药水里浮起、翻滚着定在指定点数
// --------------------------------------------------------------------
SCENES.alchemist = {
  light: 'interior',
  camera: { target: [0, 0.55, 0.1], dist: 4.2, elev: 0.3, width: 3.6 },
  build(ctx) {
    const { world, ev } = ctx;
    floorDisc(world, '#4e3a2a', 2.0);
    const col = ctx.color(ev.player);
    const pot = K.cauldron('#6cff9a');
    pot.position.set(0.15, 0, 0);
    pot.scale.setScalar(1.3);
    world.add(pot);
    const glow = new THREE.PointLight('#6cff9a', 2.5, 3, 1.5);
    glow.position.set(0.15, 0.7, 0);
    world.add(glow);
    const alc = K.actor(world, K.folk({ cloth: '#5b3f8a', robe: true, hat: 'hood', eyes: 'glow', eyeColor: '#9dffb8', trim: '#e2b04f', base: col }));
    alc.place(-0.6, 0.0, 0, Math.PI / 2 - 0.3);
    const spoon = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), K.mat('#6e4a2c'));
    spoon.position.y = -0.15;
    alc.rig.handR.add(spoon);
    const d1 = ev.d1 || 3;
    const d2 = ev.d2 || 4;
    const dice = [K.die(d1, 0.24, true), K.die(d2, 0.24, false)];
    dice.forEach((d) => { d.visible = false; world.add(d); });
    return { pot, glow, alc, spoon, dice, d1, d2, dur: 3.2 };
  },
  frame(st, ts, dt, ctx) {
    const { alc, dice, glow } = st;
    glow.intensity = 2.2 + 0.6 * Math.sin(ts * 9) * Math.sin(ts * 5.3);
    st.pot.userData.surface.material.emissiveIntensity = 0.7 + 0.3 * Math.sin(ts * 7);
    if (Math.random() < dt * 14) ctx.fx.puff(V3(0.15 + (Math.random() - 0.5) * 0.4, 0.55, (Math.random() - 0.5) * 0.3), V3(0, 0.5, 0), 0.18, 0.9, '#9dffb8', 0.6);
    alc.pose('offer');
    const stir = ts < 1.3 ? 1 : 0;
    alc.P.aRx = -1.1 + 0.15 * Math.sin(ts * 9) * stir;
    alc.P.aRz = 0.2 * Math.cos(ts * 9) * stir;
    alc.P.lean = 0.2;
    if (ts >= 1.3) K.pose(alc.P, 'offer', 'cheer', easeOut(seg(ts, 1.3, 1.5)));
    alc.rig.setGlow(1 + 0.5 * Math.sin(ts * 6));
    alc.apply();
    if (ts > 0.1) ctx.once('stir', () => ctx.say(`⚗️ ${ctx.tag(ctx.ev.player)} 的炼金术士调配骰子……`));
    dice.forEach((d, i) => {
      const t0 = 1.35 + i * 0.15;
      const k = seg(ts, t0, t0 + 1.0);
      d.visible = ts >= t0;
      const x = 0.15 + (i ? 0.25 : -0.25) * easeOut(k);
      d.position.set(x, 0.5 + 0.55 * easeOut(Math.min(1, k * 1.5)), 0.15 * easeOut(k));
      const spin = (1 - easeOut(k)) * 12;
      d.rotation.set(1.22 + spin, spin * 0.7, spin * 0.4 + (i ? -0.12 : 0.12)); // 停下时指定点数那面（顶面）正对镜头
      if (k >= 1) ctx.once(`land${i}`, () => { sfx.dice([{ t: 0, v: 0.8 }, { t: 0.12, v: 0.3 }]); ctx.fx.flash(d.position.clone(), '#bfffd2', 0.5, 0.3); });
    });
    if (ts > 2.4) ctx.once('show', () => ctx.say(`⚗️ 骰子定为 ${st.d1} + ${st.d2} = ${st.d1 + st.d2}`));
  },
};

// --------------------------------------------------------------------
// 起重机：木吊臂转过来，把一块建材吊上城市
// --------------------------------------------------------------------
SCENES.crane = {
  light: 'day',
  camera: { target: [0.2, 0.6, 0], dist: 4.8, elev: 0.26, width: 4.0 },
  build(ctx) {
    const { world, ev } = ctx;
    ground(world, 'hills', 2.1);
    const col = ctx.color(ev.player);
    const rig = K.craneRig();
    rig.position.set(-0.6, 0, -0.2);
    world.add(rig);
    const c = K.city(col, 2.2);
    c.position.set(0.4, 0, -0.1);
    world.add(c);
    const block = K.crate('#8bbf6a', 0.16);
    rig.userData.hook.add(block);
    block.position.y = -0.16;
    const worker = K.actor(world, K.folk({ cloth: col, hat: 'cap', base: col }));
    worker.place(-0.9, 0.5, 0, 0.4);
    return { rig, c, block, worker, dur: 2.9 };
  },
  frame(st, ts, dt, ctx) {
    const u = st.rig.userData;
    const swing = easeInOut(seg(ts, 0.3, 1.3));
    u.boom.rotation.y = lerp(1.6, -0.15, swing);
    const lift = seg(ts, 0, 0.3);
    const lower = seg(ts, 1.4, 2.0);
    u.setDrop(lerp(0.95, 0.5, lift) + 0.25 * easeInOut(lower));
    st.block.visible = ts < 2.05;
    st.worker.pose('idle');
    st.worker.P.aRx = -2.4 + 0.3 * Math.sin(ts * 8); // 指挥
    st.worker.apply();
    if (ts > 0.3) ctx.once('go', () => { sfx.lever(); ctx.say(`🏗️ ${ctx.tag(ctx.ev.player)} 的起重机开工`); });
    if (ts >= 2.05) ctx.once('set', () => {
      sfx.build('city');
      ctx.fx.puff(V3(0.4, 0.5, -0.1), V3(0, 0.3, 0), 0.5, 0.7);
      ctx.fx.sparks(V3(0.4, 0.8, -0.1), 10, 0.9, '#9fe38a', 0.07, 0.6, 1.5);
      ctx.say('🏗️ 本回合下一次城市升级少付 1 张商品');
    });
    st.c.scale.y = 1 + 0.06 * spring(seg(ts, 2.05, 2.7));
  },
};

// --------------------------------------------------------------------
// 工程师：石块一块块飞上来，在城市周围砌出一圈城墙
// --------------------------------------------------------------------
SCENES.engineer = {
  light: 'day',
  camera: { target: [0, 0.4, 0.1], dist: 4.4, elev: 0.4, width: 3.8 },
  build(ctx) {
    const { world, ev } = ctx;
    ground(world, 'hills', 2.0);
    const col = ctx.color(ev.player);
    const c = K.city(col, 2.4);
    world.add(c);
    const blocks = [];
    const R = 0.62;
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + layer * 0.22;
        const b = K.stoneBlock(0.1);
        b.userData.to = V3(Math.cos(a) * R, 0.05 + layer * 0.1, Math.sin(a) * R);
        b.userData.rot = -a + Math.PI / 2;
        b.userData.t0 = 0.6 + (layer * 14 + i) * 0.055;
        b.visible = false;
        world.add(b);
        blocks.push(b);
      }
    }
    const eng = K.actor(world, K.folk({ cloth: col, hat: 'goggles', apron: '#7a5232', base: col }));
    eng.place(-1.25, 0.6, 0, 0.9);
    return { blocks, eng, dur: 0.6 + 28 * 0.055 + 1.2 };
  },
  frame(st, ts, dt, ctx) {
    st.eng.pose('idle');
    st.eng.P.aRx = -1.5 + 0.4 * Math.sin(ts * 10);
    st.eng.apply();
    if (ts > 0.2) ctx.once('go', () => ctx.say(`🧱 ${ctx.tag(ctx.ev.player)} 的工程师开始筑城`));
    st.blocks.forEach((b, i) => {
      const k = seg(ts, b.userData.t0, b.userData.t0 + 0.35);
      b.visible = ts >= b.userData.t0;
      if (!b.visible) return;
      b.position.copy(arc(V3(-1.2, 0.5, 0.6), b.userData.to, easeOut(k), 0.5));
      b.rotation.set(0, b.userData.rot + (1 - k) * 4, (1 - k) * 3);
      if (k >= 1 && i % 3 === 0) ctx.once(`b${i}`, () => sfx.knightStep(false));
    });
    if (ts > st.dur - 1.0) ctx.once('done', () => {
      sfx.build('city');
      ctx.fx.ring(0, 0.02, 0, '#ffd36b', 2.2, 0.6);
      ctx.say('🧱 免费修建一座城墙：被 7 洗劫时手牌上限 +2');
    });
  },
};

// --------------------------------------------------------------------
// 灌溉 / 采矿：按受益地块数摆出麦田或矿山，水车转起来 / 镐头敲山，小麦或矿石牌一张张蹦出来
// --------------------------------------------------------------------
function harvestScene(kind) {
  const isIrr = kind === 'irrigation';
  return {
    light: 'day',
    camera: { target: [0, 0.4, 0.1], dist: 5.0, elev: 0.36, width: 4.4 },
    build(ctx) {
      const { world, ev, board } = ctx;
      ground(world, 'pasture', 2.2);
      const col = ctx.color(ev.player);
      const n = Math.max(1, Math.min(4, (ev.hexes || []).length || 2));
      const tiles = [];
      for (let i = 0; i < n; i++) {
        const x = lerp(-0.85, 0.95, n === 1 ? 0.5 : i / (n - 1));
        const z = -0.25 + (i % 2) * 0.35;
        const t = K.hexTile(isIrr ? 'fields' : 'mountains', 0.42, 0.06);
        t.position.set(x, 0, z);
        world.add(t);
        const hx = board?.hexes?.[(ev.hexes || [])[i]];
        if (hx?.number) { const tok = K.numberToken(hx.number, 0.1); tok.position.set(x, 0.061, z + 0.15); world.add(tok); }
        const extra = isIrr ? K.wheatTuft(9) : null;
        if (extra) { extra.position.set(x, 0.06, z - 0.05); world.add(extra); }
        tiles.push({ x, z, t, extra, t0: 1.0 + i * 0.3 });
      }
      let tool;
      let worker;
      if (isIrr) {
        tool = K.waterWheel(0.38);
        tool.position.set(-1.45, 0.48, 0.3);
        tool.rotation.y = Math.PI / 2;
        world.add(tool);
        // 水渠：从水车引到各块麦田（蓝色细管，逐段亮起）
        tool.userData.channels = tiles.map((tl) => {
          const curve = new THREE.CatmullRomCurve3([V3(-1.45, 0.03, 0.3), V3((tl.x - 1.45) / 2, 0.03, (tl.z + 0.3) / 2 + 0.25), V3(tl.x, 0.07, tl.z)]);
          const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.025, 6, false), new THREE.MeshStandardMaterial({ color: '#58b6f0', emissive: '#2a7fc0', emissiveIntensity: 0.6, roughness: 0.1 }));
          m.geometry.setDrawRange(0, 0);
          world.add(m);
          return m;
        });
      } else {
        worker = K.actor(world, K.folk({ cloth: col, hat: 'cap', base: col, apron: '#6b5a48' }));
        const pk = K.pickaxe();
        pk.rotation.x = Math.PI / 2;
        worker.rig.handR.add(pk);
      }
      const res = ev.res || (isIrr ? 'wheat' : 'ore');
      const got = ev.n ?? n * 2;
      const items = [];
      tiles.forEach((tl, i) => { for (let j = 0; j < Math.min(2, Math.ceil(got / n)); j++) items.push({ from: V3(tl.x, 0.15, tl.z), to: V3(tl.x * 0.3, 1.05, 0.7), t0: tl.t0 + 0.25 + j * 0.15, mk: cardOf(res, 0.15) }); });
      const flights = flyGroup(world, items, { dur: 0.5, h: 0.35, spin: 2, onLand: () => sfx.gainTick(0) });
      return { tiles, tool, worker, flights, res, got, n, col, dur: 1.4 + 0.3 * n + 1.0 };
    },
    frame(st, ts, dt, ctx) {
      if (isIrr) {
        st.tool.userData.wheel.rotation.z -= dt * (1 + 3 * seg(ts, 0.3, 0.9));
        if (ts > 0.2) ctx.once('go', () => { sfx.aqueduct(); ctx.say(`💧 ${ctx.tag(ctx.ev.player)} 引水灌溉麦田`); });
        st.tool.userData.channels.forEach((m, i) => {
          const k = seg(ts, 0.5 + i * 0.15, 1.0 + i * 0.3);
          m.geometry.setDrawRange(0, Math.floor(k * m.geometry.index.count / 6) * 6);
        });
        if (Math.random() < dt * 12) ctx.fx.puff(V3(-1.45, 0.15, 0.3 + (Math.random() - 0.5) * 0.3), V3(0.1, 0.3, 0), 0.15, 0.6, '#cfeeff', 0.7);
        for (const tl of st.tiles) {
          tl.extra.userData.grow(0.3 + 0.7 * easeOut(seg(ts, tl.t0, tl.t0 + 0.4)) + 0.08 * spring(seg(ts, tl.t0 + 0.3, tl.t0 + 1)));
          if (ts > tl.t0) ctx.once(`w${tl.x}`, () => ctx.fx.ring(tl.x, 0.08, tl.z, '#9fe3ff', 1.0, 0.5));
        }
      } else {
        // 矿工依次走到每座矿山前，抡镐敲下去
        const W = st.worker;
        W.pose('idle');
        const cur = st.tiles.findIndex((tl) => ts < tl.t0 + 0.3);
        const idx = cur < 0 ? st.tiles.length - 1 : cur;
        const tl = st.tiles[idx];
        const prev = st.tiles[Math.max(0, idx - 1)];
        const mv = idx === 0 ? seg(ts, 0, 0.9) : seg(ts, prev.t0 + 0.3, tl.t0 - 0.05);
        const fromX = idx === 0 ? -2.0 : prev.x - 0.45;
        const ph = walk(W, [fromX, idx === 0 ? 0.6 : prev.z + 0.1], [tl.x - 0.45, tl.z + 0.1], easeInOut(mv), 4, 0.5, Math.PI / 2);
        if (ph !== null) ctx.once(`st${idx}${Math.floor(ph / Math.PI)}`, () => sfx.sneak());
        const sw = seg(ts, tl.t0 - 0.2, tl.t0 + 0.05);
        if (mv >= 1) {
          W.root.rotation.y = Math.PI / 2;
          W.P.aRx = lerp(-2.9, -0.9, easeIn(sw));
          W.P.aLx = W.P.aRx;
          W.P.lean = 0.2 * sw;
        }
        W.apply();
        if (ts > 0.2) ctx.once('go', () => ctx.say(`⛏️ ${ctx.tag(ctx.ev.player)} 的矿工下矿了`));
        for (const t of st.tiles) {
          if (ts >= t.t0) ctx.once(`hit${t.x}`, () => {
            sfx.shieldBash();
            ctx.shake(0.03);
            ctx.fx.sparks(V3(t.x - 0.1, 0.2, t.z), 12, 1.2, '#ffd36b', 0.06, 0.5, 4);
            ctx.fx.debris(() => K.oreChunk(0.035), V3(t.x, 0.15, t.z), 6, { speed: 1, up: 1.2, gravity: 4, drag: 1, dur: 1.2, spread: 0.8, floor: 0.06 });
          });
        }
      }
      st.flights.update(ts);
      if (ts > st.dur - 0.9) ctx.once('done', () => ctx.say(`${isIrr ? '💧' : '⛏️'} ${st.n} 块${isIrr ? '麦田' : '矿山'}，获得 ${st.got} 张${ctx.resName(st.res)}`));
    },
  };
}
SCENES.irrigation = harvestScene('irrigation');
SCENES.mining = harvestScene('mining');

// --------------------------------------------------------------------
// 医学：药剂师给村庄洒下一瓶发光药水，村庄长高长大变成城市
// --------------------------------------------------------------------
SCENES.medicine = {
  light: 'day',
  camera: { target: [0.1, 0.45, 0.1], dist: 4.2, elev: 0.32, width: 3.6 },
  build(ctx) {
    const { world, ev } = ctx;
    ground(world, 'pasture', 2.0);
    const col = ctx.color(ev.player);
    const h = K.house(col, 2.6);
    h.position.set(0.35, 0, -0.1);
    world.add(h);
    const c = K.city(col, 2.4);
    c.position.set(0.35, 0, -0.1);
    c.scale.setScalar(0.01);
    world.add(c);
    const doc = K.actor(world, K.folk({ cloth: '#f4efe4', robe: true, hat: 'cap', base: col, trim: '#4a9c6a' }));
    doc.place(-0.75, 0.35, 0, Math.PI / 2 - 0.4);
    const pot = K.potion('#7dffb0');
    doc.rig.handR.add(pot);
    pot.position.set(0, -0.02, 0.04);
    return { h, c, doc, pot, dur: 3.0 };
  },
  frame(st, ts, dt, ctx) {
    st.doc.pose('idle');
    const lift = easeOut(seg(ts, 0.2, 0.6));
    st.doc.P.aRx = lerp(-0.3, -1.6, lift);
    const pour = seg(ts, 0.7, 1.4);
    st.pot.rotation.z = -1.8 * easeOut(pour);
    st.doc.apply();
    if (ts > 0.2) ctx.once('go', () => ctx.say(`⚕️ ${ctx.tag(ctx.ev.player)} 的药剂师调制良方`));
    if (pour > 0 && pour < 1 && Math.random() < dt * 40) {
      const p = st.pot.getWorldPosition(V3(0, 0, 0));
      ctx.fx.sparks(p, 1, 0.5, '#7dffb0', 0.07, 0.8, 2);
    }
    const grow = seg(ts, 1.4, 2.1);
    st.h.scale.setScalar(Math.max(0.01, 1 - easeIn(grow)));
    st.c.scale.setScalar(Math.max(0.01, easeOut(grow) + 0.15 * spring(seg(ts, 1.9, 2.6))));
    if (grow > 0) ctx.once('grow', () => { sfx.build('city'); ctx.fx.glow(V3(0.35, 0.4, -0.1), '#7dffb0', 1.6, 0.8); ctx.fx.ring(0.35, 0.02, -0.1, '#9fffc6', 2, 0.7); });
    if (ts > 2.1) ctx.once('done', () => ctx.say('⚕️ 村庄升级为城市（只花 2 矿石 + 1 小麦）'));
  },
};

// --------------------------------------------------------------------
// 印刷机：压板压下，印好的书页一张张飞出，合成一本书 → +1 分
// --------------------------------------------------------------------
SCENES.printer = {
  light: 'interior',
  camera: { target: [0, 0.55, 0.1], dist: 4.2, elev: 0.26, width: 3.6 },
  build(ctx) {
    const { world, ev } = ctx;
    floorDisc(world, '#6a482c', 2.0);
    const col = ctx.color(ev.player);
    const press = K.printingPress();
    press.position.set(-0.3, 0, -0.2);
    press.scale.setScalar(1.3);
    world.add(press);
    const pages = Array.from({ length: 6 }, () => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.28), K.mat('#f6eedb', { side: 2 }));
      p.visible = false;
      world.add(p);
      return p;
    });
    const book = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.38), K.mat(col, { rough: 0.5 }));
    book.add(cover);
    const leaves = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.36), K.mat('#f6eedb'));
    leaves.position.x = 0.01;
    book.add(leaves);
    book.position.set(0.7, 0.6, 0.2);
    book.scale.setScalar(0.01);
    world.add(book);
    return { press, pages, book, dur: 3.2 };
  },
  frame(st, ts, dt, ctx) {
    const u = st.press.userData;
    const cycles = 3;
    const ph = Math.min(1, ts / 1.8) * cycles;
    const down = ts < 1.8 ? Math.max(0, Math.sin((ph % 1) * Math.PI)) : 0;
    u.platen.position.y = 0.45 - 0.1 * down;
    u.bar.rotation.y = ph * Math.PI;
    if (ts < 1.8 && down > 0.95) ctx.once(`hit${Math.floor(ph)}`, () => { sfx.kegLand(); ctx.shake(0.015); });
    if (ts > 0.1) ctx.once('go', () => ctx.say(`📰 ${ctx.tag(ctx.ev.player)} 的印刷机开印`));
    st.pages.forEach((p, i) => {
      const t0 = 0.35 + i * 0.27;
      const k = seg(ts, t0, t0 + 0.7);
      p.visible = k > 0 && k < 1;
      p.position.copy(arc(V3(-0.3, 0.45, 0.1), V3(0.7, 0.6, 0.2), easeOut(k), 0.8));
      p.rotation.set(-Math.PI / 2 + k * 6, k * 2, 0);
    });
    st.book.scale.setScalar(Math.max(0.01, easeOut(seg(ts, 0.6, 2.1)) + 0.2 * spring(seg(ts, 2.1, 2.8))));
    st.book.rotation.y = 0.4 + 0.3 * Math.sin(ts * 1.5);
    plusOne(ctx, st, ts, 2.2, V3(0.7, 1.0, 0.2));
  },
};

// --------------------------------------------------------------------
// 修路（进步卡 / 发展卡共用）：工人扛着玩家色木段一段段铺下去，锤子敲实
// --------------------------------------------------------------------
export const roadBuildingScene = {
  light: 'day',
  camera: { target: [0.1, 0.35, 0.1], dist: 4.8, elev: 0.38, width: 4.2 },
  build(ctx) {
    const { world, ev } = ctx;
    ground(world, 'forest', 2.1);
    const col = ctx.color(ev.player);
    const n = Math.max(1, Math.min(2, ev.n ?? 2));
    const h = K.house(col, 1.8);
    h.position.set(-1.15, 0, 0.05);
    world.add(h);
    const segs = Array.from({ length: n }, (_, i) => {
      const r = K.roadPiece(col, 0.62);
      r.userData.to = V3(-0.55 + i * 0.68, 0.03, 0.05 - i * 0.12);
      r.userData.t0 = 0.8 + i * 0.9;
      r.rotation.y = 0.17;
      r.visible = false;
      world.add(r);
      return r;
    });
    const worker = K.actor(world, K.folk({ cloth: col, hat: 'cap', base: col, apron: '#7a5232' }));
    const hm = K.hammer();
    hm.rotation.x = Math.PI / 2;
    worker.rig.handR.add(hm);
    return { segs, worker, n, dur: 0.8 + n * 0.9 + 0.9 };
  },
  frame(st, ts, dt, ctx) {
    const W = st.worker;
    W.pose('idle');
    const cur = st.segs.findIndex((r) => ts < r.userData.t0 + 0.7);
    const r = st.segs[cur < 0 ? st.segs.length - 1 : cur];
    const x = r.userData.to.x;
    const mv = seg(ts, r.userData.t0 - 0.6, r.userData.t0);
    walk(W, [x - 0.85, 0.45], [x - 0.15, 0.4], easeInOut(mv), 4, 0.45, Math.PI / 2);
    if (mv < 1) { W.P.aLx = W.P.aRx = -2.6; } // 扛着木段
    else { // 敲两锤
      W.root.rotation.y = Math.PI * 0.8;
      W.P.aRx = -1.2 - 1.2 * Math.abs(Math.sin((ts - r.userData.t0) * 10));
      W.P.lean = 0.25;
    }
    W.apply();
    if (ts > 0.1) ctx.once('go', () => ctx.say(`🛤️ ${ctx.tag(ctx.ev.player)} 的工人修路`));
    for (const s of st.segs) {
      const k = seg(ts, s.userData.t0 - 0.6, s.userData.t0);
      s.visible = ts >= s.userData.t0 - 0.6;
      if (k < 1) s.position.copy(W.root.position.clone().add(V3(0, 0.85, 0)));
      else {
        const d = seg(ts, s.userData.t0, s.userData.t0 + 0.2);
        s.position.copy(s.userData.to).add(V3(0, 0.4 * (1 - easeIn(d)), 0));
        if (d >= 1) ctx.once(`set${s.userData.t0}`, () => { sfx.build('road'); ctx.fx.puff(s.userData.to.clone(), V3(0, 0.15, 0), 0.3, 0.5); });
      }
    }
    if (ts > st.dur - 0.8) ctx.once('done', () => ctx.say(`🛤️ 可免费修 ${st.n} 条路`));
  },
};
SCENES.roadBuilding = roadBuildingScene;

// --------------------------------------------------------------------
// 铁匠：铁砧上叮叮当当火花四溅，选中的骑士一个个升级换装
// --------------------------------------------------------------------
SCENES.smith = {
  light: 'interior',
  camera: { target: [0.1, 0.5, 0.1], dist: 4.6, elev: 0.28, width: 4.0 },
  build(ctx) {
    const { world, ev } = ctx;
    floorDisc(world, '#4e3a2a', 2.1);
    const col = ctx.color(ev.player);
    const av = K.anvil();
    av.position.set(-0.6, 0, 0.1);
    world.add(av);
    const forge = new THREE.PointLight('#ff8a3c', 2.5, 3, 1.5);
    forge.position.set(-0.6, 0.6, 0.1);
    world.add(forge);
    const smith = K.actor(world, K.folk({ cloth: col, hat: 'none', apron: '#3a2a1a', base: col }));
    smith.place(-1.0, 0.1, 0, Math.PI / 2);
    const hm = K.hammer();
    hm.rotation.x = Math.PI / 2;
    smith.rig.handR.add(hm);
    const levels = (ev.levels && ev.levels.length ? ev.levels : [2, 3]).slice(0, 2);
    const knights = levels.map((lv, i) => {
      const x = 0.4 + i * 0.75;
      const before = knightActor(world, Math.max(1, lv - 1), col);
      const after = knightActor(world, lv, col);
      before.place(x, 0, 0, -0.3);
      after.place(x, 0, 0, -0.3);
      after.show(false);
      const tag = K.label(`→ ${lv} 级`, '#ffd36b', 0.13);
      tag.position.set(x, 1.15, 0);
      tag.material.opacity = 0;
      world.add(tag);
      return { before, after, tag, x, t0: 1.6 + i * 0.5 };
    });
    return { smith, forge, knights, dur: 1.6 + knights.length * 0.5 + 1.0 };
  },
  frame(st, ts, dt, ctx) {
    st.forge.intensity = 2.2 + 0.8 * Math.abs(Math.sin(ts * 7));
    const S = st.smith;
    S.pose('idle');
    const beat = (ts * 3.2) % 1;
    S.P.aRx = ts < 1.5 ? lerp(-2.8, -1.0, easeIn(Math.min(1, beat * 2))) : -1.2;
    S.P.lean = 0.15;
    S.apply();
    if (ts < 1.5 && beat > 0.5) ctx.once(`clang${Math.floor(ts * 3.2)}`, () => {
      sfx.swordHit();
      ctx.fx.sparks(V3(-0.6, 0.38, 0.1), 14, 1.6, '#ffb347', 0.06, 0.5, 4);
    });
    if (ts > 0.1) ctx.once('go', () => ctx.say(`🔨 ${ctx.tag(ctx.ev.player)} 的铁匠打造新装备`));
    for (const k of st.knights) {
      setStance(k.before.P, 'guard');
      setStance(k.after.P, 'guard');
      if (ts >= k.t0) {
        ctx.once(`up${k.t0}`, () => {
          k.before.show(false);
          k.after.show(true);
          ctx.fx.flash(V3(k.x, 0.55, 0.15), '#fff2c0', 1.1, 0.45);
          ctx.fx.ring(k.x, 0.02, 0, '#ffd36b', 1.6, 0.6);
          sfx.heroImpact();
        });
        mixStance(k.after.P, 'guard', 'victory', easeOut(seg(ts, k.t0 + 0.1, k.t0 + 0.4)));
        k.after.squash.scale.y = 1 + 0.08 * spring(seg(ts, k.t0, k.t0 + 0.8));
        k.tag.material.opacity = seg(ts, k.t0, k.t0 + 0.2);
      } else k.before.P.hy = 0.3 * Math.sin(ts * 2 + k.x);
      k.before.apply();
      k.after.apply();
    }
    if (ts > st.dur - 0.8) ctx.once('done', () => ctx.say(`🔨 免费升级了 ${st.knights.length} 名骑士`));
  },
};
