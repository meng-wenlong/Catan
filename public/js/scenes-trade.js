// 贸易（黄）进步卡的发动演出：商人、商船队、商业港、商业大亨、资源垄断、商品垄断
import { THREE, lerp, easeInOut, easeOut, seg, spring } from './three-figures.js';
import * as K from './scene-kit.js';
import { sfx } from './sfx.js';
import { SCENES, V3, arc, walk, hexPos, ground, flyGroup, cardOf } from './scene-registry.js';

const TERRAIN_RES = { forest: 'wood', hills: 'brick', pasture: 'sheep', fields: 'wheat', mountains: 'ore' };
const others = (ctx) => (ctx.state?.players || []).map((_, i) => i).filter((i) => i !== ctx.ev.player);

// --------------------------------------------------------------------
// 商人：推着货车走上目标地块，支起摊位，该地块的资源牌浮起「2:1」
// --------------------------------------------------------------------
SCENES.merchant = {
  light: 'day',
  camera: { target: [0.1, 0.4, 0.1], dist: 5.4, elev: 0.34, width: 4.6 },
  build(ctx) {
    const { world, ev, board } = ctx;
    const hex = board?.hexes?.[ev.hex];
    const terrain = hex?.terrain || 'pasture';
    ground(ctx.world, terrain, 2.15);
    const col = ctx.color(ev.player);
    const m = K.actor(world, K.folk({ cloth: col, hat: 'cap', apron: '#e8dcc0', base: col }));
    const cart = K.cart('#a9794a');
    world.add(cart);
    for (let i = 0; i < 3; i++) { const c = K.crate(i % 2 ? '#c08a52' : '#b07a45', 0.1); c.position.set(-0.1 + i * 0.1, 0.23, (i % 2) * 0.04 - 0.02); cart.add(c); }
    const stall = K.stall(col);
    stall.position.set(0.55, 0, -0.35);
    stall.scale.setScalar(0.01);
    world.add(stall);
    const res = TERRAIN_RES[terrain];
    const cards = [0, 1].map(() => { const c = K.resCard(res || 'sheep', 0.2); c.visible = false; world.add(c); return c; });
    const tag = K.label(`${ctx.resName(res)} 2:1`, '#ffd36b', 0.16);
    tag.material.opacity = 0;
    world.add(tag);
    return { m, cart, stall, cards, tag, res, dur: 3.1 };
  },
  frame(st, ts, dt, ctx) {
    const { m, cart, stall, cards, tag } = st;
    m.pose('carry');
    const k = easeInOut(seg(ts, 0, 1.3));
    const ph = walk(m, [-2.2, 0.55], [-0.4, 0.3], k, 8, 0.45, Math.PI / 2);
    m.P.aLx = m.P.aRx = -0.9;
    if (ph !== null) ctx.once(`s${Math.floor(ph / Math.PI)}`, () => sfx.sneak());
    const cx = m.root.position.x + 0.45;
    cart.position.set(cx, 0, m.root.position.z);
    for (const w of cart.userData.wheels) w.rotation.z = -cx * 6;
    if (ts > 0.1) ctx.once('in', () => ctx.say(`🛒 ${ctx.tag(ctx.ev.player)} 的商人来到${hexPos(ctx.board, ctx.ev.hex)}`));
    if (ts >= 1.3) {
      m.root.rotation.y = lerp(Math.PI / 2, -0.3, easeOut(seg(ts, 1.3, 1.6)));
      K.pose(m.P, 'carry', 'cheer', easeOut(seg(ts, 1.5, 1.7)));
      m.P.aLx += 0.2 * Math.sin(ts * 12);
    }
    m.apply();
    const pop = seg(ts, 1.35, 1.75);
    stall.scale.setScalar(Math.max(0.01, easeOut(pop) + 0.18 * spring(seg(ts, 1.6, 2.3))));
    stall.userData.awning.rotation.z = 0.05 * Math.sin(ts * 3);
    if (pop > 0) ctx.once('pop', () => { sfx.build('settlement'); ctx.fx.puff(V3(0.55, 0.05, -0.35), V3(0, 0.25, 0), 0.5, 0.6); });
    // 资源牌升起：两张牌换一张 → 「2:1」
    cards.forEach((c, i) => {
      const t0 = 1.9 + i * 0.12;
      const kk = easeOut(seg(ts, t0, t0 + 0.4));
      c.visible = ts >= t0;
      c.position.set(0.4 + i * 0.28, 0.6 + 0.35 * kk, -0.3);
      c.rotation.y = Math.sin(ts * 2 + i) * 0.3;
      c.scale.setScalar(Math.max(0.01, kk));
    });
    tag.position.set(0.55, 1.3, -0.3);
    tag.material.opacity = seg(ts, 2.2, 2.5);
    if (ts >= 2.25) ctx.once('tag', () => {
      sfx.coin();
      ctx.fx.sparks(V3(0.55, 1.15, -0.3), 12, 1, '#ffe08a', 0.07, 0.7, 1.5);
      ctx.say(`🛒 ${ctx.resName(st.res)}可 2:1 交易 · 商人 +1 分（可被他人夺走）`);
    });
  },
};

// --------------------------------------------------------------------
// 商船队：玩家色帆船满载选定货物破浪驶过，帆上飘出「2:1」
// --------------------------------------------------------------------
SCENES.merchantFleet = {
  light: 'day',
  camera: { target: [0, 0.4, 0], dist: 5.2, elev: 0.3, width: 4.6 },
  build(ctx) {
    const { world, ev } = ctx;
    const water = K.sea(2.4);
    world.add(water);
    const col = ctx.color(ev.player);
    const ships = [0, 1, 2].map((i) => {
      const s = K.ship(col, i === 0 ? 1.15 : 0.8);
      world.add(s);
      const res = ev.res || 'cloth';
      for (let j = 0; j < 3; j++) {
        const c = K.crate(j % 2 ? '#c08a52' : '#b07a45', 0.1);
        c.position.set(j * 0.12, 0, (j % 2) * 0.06 - 0.03);
        s.userData.deck.add(c);
      }
      const card = K.resCard(res, 0.11);
      card.position.set(0.12, 0.2, 0.0);
      s.userData.deck.add(card);
      return { s, lane: [0.35, -0.5, 0.95][i], delay: i * 0.35 };
    });
    const tag = K.label(`${ctx.resName(ev.res || 'cloth')} 2:1`, '#ffd36b', 0.17);
    tag.material.opacity = 0;
    world.add(tag);
    return { water, ships, tag, dur: 3.0 };
  },
  frame(st, ts, dt, ctx) {
    st.water.userData.tex.offset.set(ts * 0.03, ts * 0.05);
    st.ships.forEach(({ s, lane, delay }, i) => {
      const k = seg(ts, delay, delay + 2.8);
      const x = lerp(-3.0, 3.0, easeInOut(k));
      s.position.set(x, 0.02 + 0.03 * Math.sin(ts * 3 + i), lane);
      s.rotation.set(0.05 * Math.sin(ts * 2.4 + i), 0, 0.06 * Math.sin(ts * 3 + i));
      K.waveFlag(s.userData.sail, ts + i, 0.04);
      if (i === 0 && Math.random() < dt * 30 && k > 0 && k < 1) ctx.fx.puff(V3(x - 0.45, 0.03, lane), V3(-0.3, 0.1, (Math.random() - 0.5) * 0.3), 0.18, 0.7, '#ffffff', 0.7);
    });
    if (ts > 0.2) ctx.once('sail', () => { sfx.ship(); ctx.say(`⛵ ${ctx.tag(ctx.ev.player)} 的商船队出航`); });
    const lead = st.ships[0].s;
    st.tag.position.set(lead.position.x, 1.45, lead.position.z);
    st.tag.material.opacity = seg(ts, 1.1, 1.4);
    if (ts > 1.15) ctx.once('tag', () => { sfx.coin(); ctx.say(`⛵ 本回合${ctx.resName(ctx.ev.res || 'cloth')}可按 2:1 与银行交易`); });
  },
};

// --------------------------------------------------------------------
// 商业港：自家船靠岸，各对手的小船依次驶来，木箱互相抛到对方甲板（资源换商品）
// --------------------------------------------------------------------
SCENES.commercialHarbor = {
  light: 'day',
  camera: { target: [0, 0.35, 0.1], dist: 5.6, elev: 0.36, width: 4.8 },
  build(ctx) {
    const { world, ev } = ctx;
    const water = K.sea(2.4);
    world.add(water);
    const dock = new THREE.Group();
    world.add(dock);
    const plank = K.mat('#8a5a34', { rough: 0.85 });
    const deckM = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.6), plank);
    deckM.position.set(0, 0.12, -0.75);
    dock.add(deckM);
    for (let i = -6; i <= 6; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), K.mat('#5a3b22')); p.position.set(i * 0.2, 0, -0.47); dock.add(p); }
    const col = ctx.color(ev.player);
    const me = K.ship(col, 1);
    world.add(me);
    const partners = (ev.partners || others(ctx)).slice(0, 4);
    const boats = partners.map((who, i) => {
      const s = K.ship(ctx.color(who), 0.75);
      world.add(s);
      const tag = K.label(ctx.pname(who), ctx.color(who), 0.13);
      world.add(tag);
      const x = lerp(-1.4, 1.4, partners.length === 1 ? 0.75 : i / (partners.length - 1));
      return { who, s, tag, x, t0: 0.9 + i * 0.45 };
    });
    const crates = flyGroup(world, boats.flatMap((b) => [
      { from: V3(0, 0.35, 0.05), to: V3(b.x, 0.3, 0.85), t0: b.t0 + 0.55, mk: cardOf(['wood', 'brick', 'sheep', 'wheat', 'ore'][Math.floor(Math.random() * 5)], 0.16) },
      { from: V3(b.x, 0.3, 0.85), to: V3(0, 0.35, 0.05), t0: b.t0 + 0.75, mk: cardOf(['cloth', 'coin', 'paper'][Math.floor(Math.random() * 3)], 0.16) },
    ]), { dur: 0.55, h: 0.7, spin: 2, onLand: () => sfx.card() });
    return { water, me, boats, crates, partners, dur: 1.6 + 0.45 * boats.length + 0.9 };
  },
  frame(st, ts, dt, ctx) {
    st.water.userData.tex.offset.set(ts * 0.02, ts * 0.04);
    const k = easeOut(seg(ts, 0, 0.9));
    st.me.position.set(lerp(-2.6, 0, k), 0.02 + 0.02 * Math.sin(ts * 3), 0.05);
    st.me.rotation.set(0, 0, 0.05 * Math.sin(ts * 2.6));
    K.waveFlag(st.me.userData.sail, ts, 0.03);
    if (ts > 0.85) ctx.once('dock', () => { sfx.kegLand(); ctx.say(`⚓ ${ctx.tag(ctx.ev.player)} 在商业港与 ${ctx.names(st.partners)} 依次交换`); });
    for (const b of st.boats) {
      const kk = easeOut(seg(ts, b.t0, b.t0 + 0.5));
      b.s.position.set(b.x + lerp(2.5, 0, kk), 0.02 + 0.02 * Math.sin(ts * 3 + b.x), 0.85);
      b.s.rotation.set(0, Math.PI, 0.05 * Math.sin(ts * 2.8 + b.x));
      K.waveFlag(b.s.userData.sail, ts + b.x, 0.03);
      b.tag.position.set(b.s.position.x, 1.05, 0.85);
    }
    st.crates.update(ts);
    if (ts > st.dur - 0.8) ctx.once('end', () => ctx.say('⚓ 你出 1 张资源，对方回 1 张商品（接下来逐个选择）'));
  },
};

// --------------------------------------------------------------------
// 商业大亨：戴礼帽的大亨捋着金天平走到分数更高的对手面前，两张牌从对方手里飘进钱袋
// --------------------------------------------------------------------
SCENES.masterMerchant = {
  light: 'day',
  camera: { target: [0, 0.5, 0.1], dist: 4.8, elev: 0.3, width: 4.0 },
  build(ctx) {
    const { world, ev } = ctx;
    ground(world, 'fields', 2.1);
    const col = ctx.color(ev.player);
    const tycoon = K.actor(world, K.folk({ cloth: col, hat: 'tophat', trim: '#e2c06a', base: col, robe: true }));
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), K.mat('#b08455'));
    bag.scale.set(1, 1.1, 1);
    tycoon.rig.handL.add(bag);
    const t = ev.target ?? others(ctx)[0] ?? 0;
    const tc = ctx.color(t);
    const victim = K.actor(world, K.folk({ cloth: tc, hat: 'cap', base: tc }));
    victim.place(0.95, 0.1, 0, -Math.PI / 2);
    const fan = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const c = K.cardMesh('/assets/opt/dev-card.webp', 0.11, '#3a2a1a');
      c.rotation.set(0, Math.PI, (i - 1.5) * 0.25);
      c.position.set((i - 1.5) * 0.03, 0.06, 0.01 * i);
      fan.add(c);
    }
    victim.rig.handR.add(fan);
    const tag = K.label(ctx.pname(t), tc, 0.14);
    tag.position.set(0.95, 1.0, 0.1);
    world.add(tag);
    const n = ev.n ?? 2;
    const flights = flyGroup(world, Array.from({ length: n }, (_, i) => ({
      from: V3(0.85, 0.45, 0.2), to: V3(-0.15, 0.4, 0.25), t0: 1.9 + i * 0.3, mk: () => K.cardMesh('/assets/opt/dev-card.webp', 0.13, '#3a2a1a'),
    })), { dur: 0.55, h: 0.5, spin: 2, onLand: () => sfx.coin() });
    return { tycoon, victim, fan, flights, t, n, dur: 3.3 };
  },
  frame(st, ts, dt, ctx) {
    const { tycoon, victim } = st;
    tycoon.pose('idle');
    walk(tycoon, [-2.0, 0.25], [-0.25, 0.15], easeInOut(seg(ts, 0, 1.1)), 6, 0.3);
    tycoon.P.aLx = -0.5;
    if (ts >= 1.1) {
      tycoon.root.rotation.y = Math.PI / 2;
      K.pose(tycoon.P, 'idle', 'point', easeOut(seg(ts, 1.15, 1.4)));
      tycoon.P.aLx = -0.9;
      tycoon.P.hx = -0.15; // 仰着下巴
      ctx.once('demand', () => { sfx.coin(); ctx.say(`💰 ${ctx.tag(ctx.ev.player)} 的商业大亨找上了 ${ctx.tag(st.t)}`); });
    }
    tycoon.apply();
    victim.pose('idle');
    victim.P.aRx = -1.0;
    const flinch = Math.sin(Math.PI * seg(ts, 1.35, 1.9));
    victim.P.lean = -0.25 * flinch;
    victim.P.hx = -0.2 * flinch;
    victim.apply();
    st.fan.visible = ts < 1.9 + st.n * 0.3;
    st.flights.update(ts);
    if (ts > 2.3) ctx.once('take', () => ctx.say(`💰 从 ${ctx.tag(st.t)} 手中拿走 ${st.n} 张牌（接下来挑选）`));
  },
};

// --------------------------------------------------------------------
// 垄断（资源垄断 / 商品垄断 / 发展卡垄断共用）：传令官吹响号角，各家飞出牌落进宝箱
// --------------------------------------------------------------------
export function monopolyScene(maxPer) {
  return {
    light: 'day',
    camera: { target: [0, 0.45, 0.1], dist: 5.6, elev: 0.34, width: 4.8 },
    build(ctx) {
      const { world, ev } = ctx;
      ground(world, 'fields', 2.2);
      const col = ctx.color(ev.player);
      const res = ev.res || 'wheat';
      const herald = K.actor(world, K.folk({ cloth: col, hat: 'cap', base: col, trim: '#e2c06a' }));
      herald.place(-0.55, 0.45, 0, 0.35);
      const hornM = K.horn();
      hornM.rotation.x = Math.PI / 2;
      herald.rig.handR.add(hornM);
      const box = K.chest();
      box.position.set(0.15, 0, 0.45);
      world.add(box);
      const from = ev.from || Object.fromEntries(others(ctx).map((i) => [i, Math.min(maxPer || 3, 2)]));
      const victims = others(ctx);
      const houses = victims.map((who, i) => {
        const a = Math.PI * (0.15 + 0.7 * (victims.length === 1 ? 0.5 : i / (victims.length - 1)));
        const x = -Math.cos(a) * 1.35 + 0.15;
        const z = -Math.sin(a) * 0.75 - 0.15;
        const h = K.house(ctx.color(who), 1.6);
        h.position.set(x, 0, z);
        h.rotation.y = -x * 0.3;
        world.add(h);
        const n = from[who] || 0;
        const tag = K.label(`${ctx.pname(who)} ×${n}`, ctx.color(who), 0.13);
        tag.position.set(x, 0.62, z);
        world.add(tag);
        return { who, x, z, n };
      });
      const items = [];
      houses.forEach((h, i) => {
        for (let j = 0; j < Math.min(h.n, 5); j++) items.push({ from: V3(h.x, 0.25, h.z + 0.1), to: V3(0.15, 0.25, 0.45), t0: 1.2 + i * 0.25 + j * 0.12, mk: cardOf(res, 0.15) });
      });
      const total = Object.values(from).reduce((s, n) => s + n, 0);
      const flights = flyGroup(world, items, { dur: 0.6, h: 0.8, spin: 2.5, onLand: (i) => sfx.gainTick(i % 6) });
      const tag = K.label(`+${total} ${ctx.resName(res)}`, '#ffd36b', 0.18);
      tag.material.opacity = 0;
      tag.position.set(0.15, 0.85, 0.45);
      world.add(tag);
      return { herald, horn: hornM, box, flights, tag, total, res, dur: 1.2 + 0.25 * houses.length + 0.12 * 5 + 1.3 };
    },
    frame(st, ts, dt, ctx) {
      const { herald, box } = st;
      herald.pose('idle');
      const blow = easeOut(seg(ts, 0.2, 0.45));
      K.pose(herald.P, 'idle', 'offer', blow);
      herald.P.aRx = lerp(0, -1.9, blow);
      herald.P.hx = -0.25 * blow;
      st.horn.rotation.x = 1.1 - herald.P.aRx; // 抵消手臂转角：号角口始终朝前上方
      herald.squash.scale.set(1 + 0.04 * Math.sin(ts * 20) * blow * (ts < 1.2 ? 1 : 0), 1, 1);
      herald.apply();
      if (ts > 0.3) ctx.once('horn', () => { sfx.ship(); ctx.say(`📯 ${ctx.tag(ctx.ev.player)} 宣布垄断「${ctx.resName(st.res)}」！`); });
      box.userData.lid.rotation.x = -1.4 * easeOut(seg(ts, 0.9, 1.2)) * (1 - easeInOut(seg(ts, st.dur - 0.7, st.dur - 0.45)));
      st.flights.update(ts);
      st.tag.material.opacity = seg(ts, st.dur - 1.0, st.dur - 0.8);
      if (ts > st.dur - 1.0) ctx.once('sum', () => {
        sfx.coin();
        ctx.fx.sparks(V3(0.15, 0.4, 0.45), 14, 1.2, '#ffe08a', 0.07, 0.7, 2);
        ctx.say(`📯 共收缴 ${st.total} 张${ctx.resName(st.res)}`);
      });
    },
  };
}
SCENES.resourceMonopoly = monopolyScene(2);
SCENES.tradeMonopoly = monopolyScene(1);
