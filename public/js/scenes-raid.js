// 城市与骑士：海岸洗劫与每座城市各自的损失结算。
import { THREE, seg, easeInOut, easeOut, lerp } from './three-figures.js';
import { SCENES, V3, ground } from './scene-registry.js';
import * as K from './scene-kit.js';
import { longship, fillSail, stronghold, cottage } from './raid-models.js';
import { sfx } from './sfx.js';

SCENES.barbarian = {
  light: 'night',
  camera: { target: [0, 0.42, 0], dist: 5.6, elev: 0.42, width: 5 },
  build({ world }) {
    const water = K.sea(2.8);
    world.add(water);
    const coast = K.hexTile('hills', 1.15);
    coast.position.set(1.05, 0.01, -0.4);
    const port = stronghold('#be4d36');
    port.scale.setScalar(0.75);
    port.position.y = 0.12;
    coast.add(port);
    world.add(coast);
    const quay = new THREE.Group();
    quay.position.set(1.28, 0.15, 0.52);
    const wood = K.mat('#9e7954');
    for (let i = 0; i < 7; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.048, 0.075), wood);
      plank.position.z = i * 0.08;
      quay.add(plank);
    }
    for (const x of [-0.16, 0.16]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.035, 0.25, 8), wood);
      post.position.set(x, -0.04, 0.46);
      quay.add(post);
    }
    world.add(quay);
    const ships = ['#a13d36', '#35556b'].map(longship);
    world.add(...ships);
    const loot = K.crate('#e8b552', 0.2);
    world.add(loot);
    return { water, ships, loot, dur: 3.9 };
  },
  frame({ water, ships, loot }, t, dt, ctx) {
    water.userData.tex.offset.set(t * 0.024, t * 0.035);
    ships.forEach((ship, i) => {
      const arrive = easeInOut(seg(t, i * 0.2, 1.65 + i * 0.2));
      const depart = easeInOut(seg(t, 2.75, 3.9));
      ship.position.set(lerp(-2.1, 0.65, arrive) - i * 0.88 - depart, 0.09 + 0.035 * Math.sin(4 * t + i), 0.82 - i * 0.8);
      ship.rotation.set(0.05 * Math.sin(3 * t), -0.55, 0.05 * Math.cos(4 * t + i));
      fillSail(ship, t + i);
    });
    const take = seg(t, 1.85, 2.65);
    const bow = ships[0].position;
    loot.position.set(lerp(1.1, bow.x, take), lerp(0.16, bow.y + 0.16, take) + Math.sin(Math.PI * take) * 0.55, lerp(-0.1, bow.z, take));
    if (t >= 1.6) ctx.once('landing', () => {
      ctx.shake(0.06);
      ctx.fx.smoke(V3(1.05, 0.32, -0.4), 16);
      ctx.say(`野蛮人洗劫海岸 · 兵力 ${ctx.ev.strength} 对 防御 ${ctx.ev.defense}`);
    });
  },
};

SCENES.pillage = {
  light: 'day',
  camera: { target: [0, 0.72, 0], dist: 4.5, elev: 0.35, width: 3.4 },
  build(ctx) {
    ground(ctx.world, 'pasture', 1.65);
    const color = ctx.color(ctx.ev.player);
    const city = stronghold(color);
    const village = cottage(color);
    village.visible = false;
    ctx.world.add(city, village);
    const pieces = city.children.map(mesh => ({ mesh, start: mesh.position.clone() }));
    const rubble = new THREE.Group();
    for (let i = 0; i < 18; i++) {
      const block = K.stoneBlock(0.085 + (i % 3) * 0.018);
      const a = i * 2.4;
      block.position.set(Math.cos(a) * (0.48 + 0.07 * (i % 5)), 0.035, Math.sin(a) * 0.48);
      block.userData.landing = block.position.clone();
      block.rotation.set(i * 0.71, a, i * 0.18);
      rubble.add(block);
    }
    ctx.world.add(rubble);
    return { city, village, pieces, rubble, dur: 3.8 };
  },
  frame({ city, village, pieces, rubble }, t, dt, ctx) {
    city.rotation.z = 0.035 * Math.sin(t * 30) * seg(t, 0.35, 0.65);
    pieces.forEach(({ mesh, start }, i) => {
      const fall = seg(t - i * 0.075, 0.65, 1.85);
      const side = start.x < 0 ? -1 : 1;
      mesh.rotation.z = -side * fall * fall * (0.85 + i * 0.13);
      mesh.position.x = start.x + side * 0.16 * fall;
      mesh.position.y = -0.72 * fall * fall;
    });
    rubble.children.forEach((block, i) => {
      const k = seg(t, 0.78 + (i % 4) * 0.12, 1.65 + (i % 5) * 0.14);
      block.visible = k > 0;
      block.position.copy(block.userData.landing).multiplyScalar(easeOut(k));
      block.position.y += (1 - k) * 0.35 + 1.8 * k * (1 - k);
      block.rotation.z = i * 0.18 + k * Math.PI;
    });
    if (t >= 0.65) ctx.once('collapse', () => {
      sfx.boom();
      ctx.shake(0.13);
      ctx.fx.smoke(V3(0, 0.2, 0), 20, 0.9, 0.55, '#ac957e');
    });
    const reveal = easeOut(seg(t, 1.85, 2.65));
    city.scale.setScalar(1 - reveal);
    village.visible = ctx.ev.downgraded && reveal > 0;
    village.scale.setScalar(reveal);
    if (t >= 2.1) ctx.once('result', () => {
      ctx.say(ctx.tag(ctx.ev.player) + (ctx.ev.downgraded ? ' 的城市降为村庄' : ' 的城市被夷平'));
    });
  },
};
