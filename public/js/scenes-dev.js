// 基础版发展卡的发动演出：骑士、丰收之年、垄断（与资源垄断共用）、修路（与进步卡共用）
// 分数卡不会被「打出」，没有演出
import { THREE, lerp, easeInOut, easeOut, seg, spring, mixStance, setStance, addGait, buildRobber } from './three-figures.js';
import * as K from './scene-kit.js';
import { sfx } from './sfx.js';
import { SCENES, V3, arc, ground, knightActor, flyGroup, cardOf } from './scene-registry.js';
import { monopolyScene } from './scenes-trade.js';
import './scenes-science.js'; // 修路场景（roadBuilding）在科学牌堆里登记

SCENES.monopoly = monopolyScene(Infinity);

// --------------------------------------------------------------------
// 骑士：玩家色骑士举剑冲锋，强盗吓得跳起来溜走（接下来由玩家把强盗挪到新地块）
// --------------------------------------------------------------------
SCENES.knight = {
  light: 'day',
  camera: { target: [0.1, 0.45, 0.1], dist: 4.8, elev: 0.28, width: 4.2 },
  build(ctx) {
    const { world, ev } = ctx;
    ground(world, 'hills', 2.1);
    const col = ctx.color(ev.player);
    const kn = knightActor(world, 2, col);
    const rm = buildRobber();
    rm.fig.scale.setScalar(0.8);
    const root = new THREE.Group();
    root.add(rm.fig);
    world.add(root);
    const army = ctx.state?.players?.[ev.player]?.knightsPlayed;
    return { kn, rm, root, army, dur: 3.0 };
  },
  frame(st, ts, dt, ctx) {
    const { kn, rm, root } = st;
    setStance(kn.P, 'guard');
    const run = seg(ts, 0.3, 1.3);
    const x = lerp(-2.0, 0.05, easeInOut(run));
    if (run > 0 && run < 1) {
      const ph = run * 9 * Math.PI;
      addGait(kn.P, ph, 0.6);
      kn.P.lean = 0.2;
      mixStance(kn.P, kn.P, 'raise', 0.5);
      ctx.once(`s${Math.floor(ph / Math.PI)}`, () => sfx.knightStep(true));
      kn.place(x, 0.2, Math.abs(Math.sin(ph)) * 0.04, Math.PI / 2);
    } else if (run >= 1) {
      kn.place(0.05, 0.2, 0, Math.PI / 2 - 0.3);
      mixStance(kn.P, 'raise', 'victory', easeOut(seg(ts, 1.4, 1.8)));
    } else kn.place(-2.0, 0.2, 0, Math.PI / 2);
    kn.apply();
    if (ts > 0.3) ctx.once('go', () => { sfx.swordSwing(); ctx.say(`⚔️ ${ctx.tag(ctx.ev.player)} 派出骑士！`); });
    // 强盗：起初抱臂，骑士逼近时吓得一跳，连蹦带滚溜出画面
    const flee = seg(ts, 1.2, 2.3);
    if (flee <= 0) {
      root.position.set(0.9, 0, 0.1);
      root.rotation.set(0, -Math.PI / 2 + 0.3, 0);
      rm.setGlow(1 + (ts > 0.9 ? 2 * Math.sin(ts * 20) : 0));
      rm.head.rotation.y = 0.5 * Math.sin(ts * 3);
    } else {
      ctx.once('yelp', () => { sfx.robberYelp(); ctx.fx.puff(V3(0.9, 0.05, 0.1), V3(0, 0.25, 0), 0.4, 0.5); });
      const hops = 4;
      const k = flee * hops;
      const hop = k % 1;
      root.position.set(lerp(0.9, 2.6, flee), 0.22 * Math.sin(Math.PI * hop), lerp(0.1, -0.6, flee));
      root.rotation.set(0, Math.PI / 2 + 0.3, 0.3 * Math.sin(k * 3));
      rm.setGlow(3);
      if (hop < 0.1) ctx.once(`h${Math.floor(k)}`, () => ctx.fx.puff(root.position.clone(), V3(0, 0.1, 0), 0.25, 0.4));
    }
    if (ts > 1.9) ctx.once('next', () => ctx.say(st.army ? `⚔️ 已出动 ${st.army} 名骑士 · 请把强盗移到新地块` : '⚔️ 请把强盗移到新地块'));
  },
};

// --------------------------------------------------------------------
// 丰收之年：谷仓大门一开，两种资源满溢而出，麦穗与牌雨纷飞
// --------------------------------------------------------------------
SCENES.yearOfPlenty = {
  light: 'day',
  camera: { target: [0, 0.5, 0.1], dist: 4.6, elev: 0.28, width: 4.0 },
  build(ctx) {
    const { world, ev } = ctx;
    ground(world, 'fields', 2.1);
    const b = K.barn();
    b.position.set(0, 0, -0.35);
    b.scale.setScalar(1.3);
    world.add(b);
    for (const x of [-1.2, -0.8, 0.9, 1.25]) { const w = K.wheatTuft(10); w.position.set(x, 0, 0.3 + (x > 0 ? 0.1 : -0.1)); w.scale.setScalar(1.6); world.add(w); }
    const r1 = ev.r1 || 'wheat';
    const r2 = ev.r2 || 'ore';
    const flights = flyGroup(world, [r1, r2].map((r, i) => ({
      from: V3(0, 0.3, 0.0), to: V3(i ? 0.45 : -0.45, 0.85, 0.6), t0: 1.2 + i * 0.25, mk: cardOf(r, 0.28), keep: true,
    })), { dur: 0.6, h: 0.6, spin: 2, onLand: () => sfx.coin() });
    return { b, flights, r1, r2, dur: 3.0 };
  },
  frame(st, ts, dt, ctx) {
    const open = easeOut(seg(ts, 0.6, 1.0));
    st.b.userData.doors.forEach((d, i) => { d.rotation.y = (i ? -1 : 1) * -1.6 * open; });
    if (ts > 0.6) ctx.once('open', () => { sfx.build('city'); ctx.say(`🌾 ${ctx.tag(ctx.ev.player)} 迎来丰收之年`); });
    if (ts > 1.0 && ts < 2.2 && Math.random() < dt * 35) {
      ctx.fx.debris(() => K.resCard([st.r1, st.r2][Math.floor(Math.random() * 2)], 0.09), V3(0, 0.35, 0.05), 1,
        { speed: 1.2, up: 1.4, gravity: 2.5, drag: 1.2, dur: 1.4, spread: 1, floor: 0.01 });
    }
    st.flights.update(ts);
    for (const it of st.flights.list) if (it.landed) { it.o.rotation.set(0, Math.sin(ts * 2) * 0.3, 0); it.o.position.y = 0.85 + 0.03 * Math.sin(ts * 3); }
    if (ts > 2.0) ctx.once('done', () => ctx.say(`🌾 获得 ${ctx.resName(st.r1)} 和 ${ctx.resName(st.r2)}`));
  },
};
