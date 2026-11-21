// 政治（蓝）进步卡的发动演出：宪法（分数卡）、逃兵、外交官、阴谋、军阀
// （主教、破坏者、间谍、婚礼在 card-scenes.js）
import { THREE, lerp, easeInOut, easeOut, easeIn, seg, spring, mixStance, setStance, addGait } from './three-figures.js';
import * as K from './scene-kit.js';
import { sfx } from './sfx.js';
import { SCENES, V3, arc, walk, ground, knightActor } from './scene-registry.js';

const others = (ctx) => (ctx.state?.players || []).map((_, i) => i).filter((i) => i !== ctx.ev.player);

// 分数卡公共收尾：金色「+1」从画面中央升起
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
// 宪法：讲台上的羊皮卷徐徐展开，羽毛笔签名，玩家色火漆盖章 → +1 分
// --------------------------------------------------------------------
SCENES.constitution = {
  light: 'holy',
  camera: { target: [0, 0.6, 0.1], dist: 4.0, elev: 0.28, width: 3.4 },
  build(ctx) {
    const { world, ev } = ctx;
    ground(world, 'pasture', 1.9);
    const col = ctx.color(ev.player);
    const lectern = new THREE.Group();
    const wood = K.mat('#6e4a2c', { rough: 0.7 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), wood);
    post.position.y = 0.3;
    lectern.add(post);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.4), wood);
    top.position.y = 0.62;
    top.rotation.x = 0.5;
    lectern.add(top);
    world.add(lectern);
    const sc = K.scroll(0.62, col);
    sc.position.set(0, 0.68, 0.06);
    sc.rotation.x = -Math.PI / 2 + 0.5; // 平铺在倾斜的讲台面上
    world.add(sc);
    const quill = new THREE.Group();
    const feather = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.3, 6), K.mat('#f4efe4', { rough: 0.6 }));
    feather.position.y = 0.15;
    quill.add(feather);
    world.add(quill);
    const stamp = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.14, 10), K.mat('#5a3b22'));
    handle.position.y = 0.09;
    stamp.add(handle);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 14), K.mat(col, { rough: 0.4 }));
    stamp.add(face);
    world.add(stamp);
    for (const s of [-1, 1]) { const b = K.banner(col); b.position.set(s * 1.05, 0, -0.5); world.add(b); }
    return { sc, quill, stamp, dur: 3.2 };
  },
  frame(st, ts, dt, ctx) {
    st.sc.userData.open(easeOut(seg(ts, 0.1, 0.8)));
    if (ts > 0.15) ctx.once('open', () => { sfx.card(); ctx.say(`📜 ${ctx.tag(ctx.ev.player)} 颁布宪法`); });
    // 羽毛笔签字：沿 Z 形写一行
    const w = seg(ts, 0.9, 1.7);
    st.quill.visible = ts > 0.8 && ts < 1.9;
    st.quill.position.set(lerp(-0.2, 0.18, w), 0.8 + 0.03 * Math.sin(w * 30), 0.15 + 0.02 * Math.sin(w * 17));
    st.quill.rotation.set(0.5, 0, -0.5 + 0.2 * Math.sin(w * 30));
    if (w > 0 && w < 1 && Math.floor(ts * 8) !== st.lastScr) { st.lastScr = Math.floor(ts * 8); sfx.scribble(); }
    // 盖章：从上方砸下、印出火漆
    const d = seg(ts, 1.85, 2.15);
    st.stamp.visible = ts > 1.7 && ts < 2.6;
    st.stamp.position.set(0.18, lerp(1.4, 0.74, easeIn(d)) + 0.1 * seg(ts, 2.2, 2.5), 0.07);
    st.stamp.rotation.x = -0.45;
    if (d >= 1) ctx.once('seal', () => { st.sc.userData.seal.visible = true; sfx.kegLand(); ctx.shake(0.03); ctx.fx.ring(0.18, 0.7, 0.07, '#ffd36b', 0.8, 0.5); });
    plusOne(ctx, st, ts, 2.35, V3(0, 1.15, 0.2));
  },
};

// --------------------------------------------------------------------
// 逃兵：对手的骑士东张西望，扔下对手的旗帜，偷偷跑到你的营旗下换上你的颜色
// --------------------------------------------------------------------
SCENES.deserter = {
  light: 'day',
  camera: { target: [0, 0.5, 0.1], dist: 5.0, elev: 0.28, width: 4.4 },
  build(ctx) {
    const { world, ev } = ctx;
    ground(world, 'pasture', 2.2);
    const t = ev.target ?? others(ctx)[0] ?? 0;
    const tc = ctx.color(t);
    const col = ctx.color(ev.player);
    const flagT = K.banner(tc);
    flagT.position.set(-1.3, 0, -0.3);
    world.add(flagT);
    const flagMe = K.banner(col);
    flagMe.position.set(1.3, 0, -0.3);
    world.add(flagMe);
    const tagT = K.label(ctx.pname(t), tc, 0.14);
    tagT.position.set(-1.3, 1.3, -0.3);
    world.add(tagT);
    const tagMe = K.label(ctx.pname(ev.player), col, 0.14);
    tagMe.position.set(1.3, 1.3, -0.3);
    world.add(tagMe);
    const kn = knightActor(world, 1, tc);
    return { kn, flagT, flagMe, t, tc, col, dur: 3.3 };
  },
  frame(st, ts, dt, ctx) {
    const { kn } = st;
    K.waveFlag(st.flagT.userData.flag, ts, 0.025);
    K.waveFlag(st.flagMe.userData.flag, ts + 1, 0.025);
    setStance(kn.P, 'guard');
    if (ts < 1.0) { // 东张西望
      kn.place(-0.95, 0.25, 0, 0.3);
      kn.P.hy = 0.7 * Math.sin(ts * 5);
      if (ts > 0.1) ctx.once('look', () => ctx.say(`🏳️ ${ctx.tag(st.t)} 的一名骑士动摇了……`));
    } else if (ts < 2.3) { // 弯腰溜走
      const k = easeInOut(seg(ts, 1.0, 2.3));
      const x = lerp(-0.95, 0.95, k);
      kn.place(x, 0.25 + 0.2 * Math.sin(Math.PI * k), Math.abs(Math.sin(k * 8 * Math.PI)) * 0.03, Math.PI / 2);
      mixStance(kn.P, 'guard', 'rest', 0.5);
      addGait(kn.P, k * 8 * Math.PI, 0.6);
      kn.P.lean = 0.25;
      ctx.once(`st${Math.floor(k * 8)}`, () => sfx.sneak());
    } else { // 换上你的颜色，敬礼
      kn.place(0.95, 0.25, 0, -0.35);
      ctx.once('turn', () => {
        kn.model.setLook(st.col, false);
        ctx.fx.flash(V3(0.95, 0.5, 0.3), '#fff6d0', 1.0, 0.4);
        ctx.fx.ring(0.95, 0.02, 0.25, '#ffd36b', 1.6, 0.6);
        sfx.twinkle();
        ctx.say(`🏳️ 骑士叛逃到 ${ctx.tag(ctx.ev.player)} 麾下（由 ${ctx.tag(st.t)} 选择哪一名）`);
      });
      mixStance(kn.P, 'guard', 'salute', easeOut(seg(ts, 2.4, 2.7)));
    }
    kn.apply();
  },
};

// --------------------------------------------------------------------
// 外交官：卷轴一展，道路那头的木段一块块被拆起飞走
// --------------------------------------------------------------------
SCENES.diplomat = {
  light: 'day',
  camera: { target: [0.1, 0.4, 0.1], dist: 4.8, elev: 0.36, width: 4.2 },
  build(ctx) {
    const { world, ev } = ctx;
    ground(world, 'fields', 2.1);
    const col = ctx.color(ev.player);
    const owner = ev.owner ?? others(ctx)[0] ?? ev.player;
    const oc = ctx.color(owner);
    const dip = K.actor(world, K.folk({ cloth: col, hat: 'tophat', robe: true, trim: '#e2c06a', base: col }));
    dip.place(-1.0, 0.35, 0, 0.6);
    const sc = K.scroll(0.42, col);
    sc.position.set(-0.75, 0.75, 0.6);
    world.add(sc);
    // 道路：三段（只拆最外面一段）
    const segs = [0, 1, 2].map((i) => {
      const r = K.roadPiece(oc, 0.5);
      r.position.set(0.0 + i * 0.52, 0.03, -0.15 - i * 0.12);
      r.rotation.y = -0.23;
      world.add(r);
      return r;
    });
    const h = K.house(oc, 1.5);
    h.position.set(-0.4, 0, -0.08);
    world.add(h);
    const tag = K.label(ctx.pname(owner), oc, 0.13);
    tag.position.set(0.6, 0.45, -0.3);
    world.add(tag);
    return { dip, sc, segs, owner, self: owner === ev.player, dur: 3.0 };
  },
  frame(st, ts, dt, ctx) {
    st.dip.pose('idle');
    K.pose(st.dip.P, 'idle', 'offer', easeOut(seg(ts, 0.1, 0.4)));
    if (ts > 1.0) K.pose(st.dip.P, 'offer', 'point', easeOut(seg(ts, 1.0, 1.2)));
    st.dip.apply();
    st.sc.userData.open(easeOut(seg(ts, 0.2, 0.8)));
    st.sc.rotation.set(-0.3, 0.5, 0);
    if (ts > 0.25) ctx.once('read', () => { sfx.card(); ctx.say(`🕊️ ${ctx.tag(ctx.ev.player)} 的外交官宣读条约……`); });
    // 最外一段：抖动 → 被拆起 → 旋转飞走化作木屑
    const r = st.segs[2];
    const shake = seg(ts, 1.1, 1.5);
    const fly = seg(ts, 1.5, 2.3);
    if (fly <= 0) {
      r.position.set(1.04 + Math.sin(ts * 60) * 0.01 * shake, 0.03 + 0.02 * shake, -0.39);
    } else {
      ctx.once('pop', () => { sfx.shieldBash(); ctx.fx.puff(V3(1.04, 0.05, -0.39), V3(0, 0.3, 0), 0.4, 0.6); ctx.shake(0.02); });
      r.position.copy(arc(V3(1.04, 0.03, -0.39), V3(2.2, 0.2, -1.2), easeOut(fly), 0.9));
      r.rotation.set(fly * 6, -0.23 + fly * 4, fly * 3);
      r.scale.setScalar(Math.max(0.01, 1 - easeIn(fly)));
    }
    if (ts > 1.6) ctx.once('done', () => ctx.say(st.self
      ? `🕊️ ${ctx.tag(ctx.ev.player)} 收回了自己的一条道路，可立即重新放置`
      : `🕊️ ${ctx.tag(st.owner)} 的一条开放道路被拆除`));
  },
};

// --------------------------------------------------------------------
// 阴谋：斗篷人凑到对手骑士耳边嘀咕几句，骑士惊慌失措，被一把推出你的道路
// --------------------------------------------------------------------
SCENES.intrigue = {
  light: 'night',
  camera: { target: [0.1, 0.45, 0.1], dist: 4.6, elev: 0.32, width: 4.0 },
  build(ctx) {
    const { world, ev } = ctx;
    ground(world, 'forest', 2.1);
    const col = ctx.color(ev.player);
    const victim = ev.victim ?? others(ctx)[0] ?? 0;
    const vc = ctx.color(victim);
    for (let i = 0; i < 3; i++) { const r = K.roadPiece(col, 0.5); r.position.set(-0.8 + i * 0.52, 0.03, 0.1); world.add(r); }
    const kn = knightActor(world, ev.level || 2, vc);
    const plotter = K.actor(world, K.folk({ cloth: '#2b2235', hat: 'hood', eyes: 'glow', eyeColor: '#c58cff', base: col }));
    const tag = K.label(ctx.pname(victim), vc, 0.13);
    world.add(tag);
    return { kn, plotter, tag, victim, dur: 3.1 };
  },
  frame(st, ts, dt, ctx) {
    const { kn, plotter } = st;
    // 斗篷人从背后摸过来
    plotter.pose('sneak');
    const ph = walk(plotter, [-2.0, -0.2], [-0.05, -0.12], easeInOut(seg(ts, 0, 1.0)), 6, 0.6);
    if (ph !== null) ctx.once(`s${Math.floor(ph / Math.PI)}`, () => sfx.sneak());
    if (ts >= 1.0) {
      plotter.root.rotation.y = Math.PI / 2;
      plotter.P.aLx = -1.6; plotter.P.aLz = 0.6; // 手掩着嘴嘀咕
      plotter.P.lean = 0.2;
      plotter.P.hy = 0.15 * Math.sin(ts * 9);
      if (ts > 1.0 && ts < 1.8 && Math.floor(ts * 6) !== st.lastW) { st.lastW = Math.floor(ts * 6); sfx.scribble(); }
      ctx.once('whisper', () => ctx.say(`🗝️ ${ctx.tag(ctx.ev.player)} 的阴谋家在 ${ctx.tag(st.victim)} 的骑士耳边嘀咕……`));
    }
    if (ts >= 1.85) K.pose(plotter.P, 'sneak', 'point', easeOut(seg(ts, 1.85, 2.0))); // 一把推开
    plotter.rig.setGlow(ts > 1.0 ? 1.2 : 0.5);
    plotter.apply();
    // 骑士：先发懵 → 惊慌乱看 → 被推出道路翻倒
    setStance(kn.P, 'guard');
    const push = seg(ts, 1.95, 2.6);
    if (push <= 0) {
      kn.place(0.35, 0.1, 0, -Math.PI / 2 + 0.3);
      if (ts > 1.3) { kn.P.hy = 0.8 * Math.sin(ts * 14); kn.root.position.x += Math.sin(ts * 50) * 0.005; }
    } else {
      ctx.once('push', () => { sfx.shieldBash(); sfx.robberYelp(); ctx.shake(0.03); });
      kn.place(lerp(0.35, 1.25, easeOut(push)), lerp(0.1, 0.55, easeOut(push)), 0.15 * Math.sin(Math.PI * push), -Math.PI / 2 + 0.3 + push * 2);
      kn.root.rotation.z = -1.3 * easeIn(push);
      if (push >= 1) ctx.once('fall', () => { ctx.fx.puff(V3(1.25, 0.05, 0.55), V3(0, 0.2, 0), 0.4, 0.6); ctx.say(`🗝️ ${ctx.tag(st.victim)} 的骑士被逐出道路，由主人重新安置`); });
    }
    kn.apply();
    st.tag.position.set(kn.root.position.x, 1.05, kn.root.position.z);
  },
};

// --------------------------------------------------------------------
// 军阀：号角吹响，战旗升起，休整中的骑士一个接一个抖擞精神、举剑敬礼
// --------------------------------------------------------------------
SCENES.warlord = {
  light: 'day',
  camera: { target: [0, 0.5, 0.1], dist: 5.2, elev: 0.28, width: 4.6 },
  build(ctx) {
    const { world, ev } = ctx;
    ground(world, 'hills', 2.2);
    const col = ctx.color(ev.player);
    const levels = (ev.levels && ev.levels.length ? ev.levels : [1, 2, 3]).slice(0, 5);
    const knights = levels.map((lv, i) => {
      const k = knightActor(world, lv, col);
      const x = lerp(-1.2, 1.2, levels.length === 1 ? 0.5 : i / (levels.length - 1));
      k.place(x, 0.35 - 0.15 * Math.abs(x), 0, 0);
      k.model.setLook(col, true);
      return { k, x, t0: 1.0 + i * 0.22 };
    });
    const flag = K.banner(col);
    flag.position.set(0, -0.9, -0.65);
    flag.scale.setScalar(1.4);
    world.add(flag);
    return { knights, flag, col, n: ev.n ?? levels.length, dur: 1.4 + 0.22 * knights.length + 1.0 };
  },
  frame(st, ts, dt, ctx) {
    const up = easeOut(seg(ts, 0.1, 0.8));
    st.flag.position.y = lerp(-1.4, 0, up);
    K.waveFlag(st.flag.userData.flag, ts, 0.04 * up);
    if (ts > 0.15) ctx.once('horn', () => { sfx.ship(); ctx.say(`⚔️ ${ctx.tag(ctx.ev.player)} 的军阀吹响集结号`); });
    for (const { k, t0 } of st.knights) {
      if (ts < t0) setStance(k.P, 'rest');
      else {
        ctx.once(`up${t0}`, () => {
          k.model.setLook(st.col, false);
          ctx.fx.flash(k.root.position.clone().add(V3(0, 0.6, 0.1)), '#fff2c0', 0.7, 0.35);
          sfx.knightStep(true);
        });
        mixStance(k.P, 'rest', 'salute', easeOut(seg(ts, t0, t0 + 0.3)));
        k.squash.scale.y = 1 + 0.08 * spring(seg(ts, t0, t0 + 0.8));
      }
      k.apply();
    }
    if (ts > st.dur - 0.9) ctx.once('done', () => { sfx.fanfare(); ctx.say(`⚔️ ${st.n} 名骑士免费激活，整装待发`); });
  },
};
