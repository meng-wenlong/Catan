// 海岸场景的船、城堡和木筋屋。城堡以建筑为单位组装，让塔楼能独立倾倒。
import { THREE } from './three-figures.js';
import { mat } from './scene-kit.js';

function part(group, geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function box(group, material, x, y, z, w, h, d) {
  return part(group, new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

function spar(group, a, b, radius, material) {
  const start = new THREE.Vector3(...a),
    end = new THREE.Vector3(...b);
  const axis = end.clone().sub(start);
  const mid = start.addScaledVector(axis, 0.5);
  const beam = part(
    group,
    new THREE.CylinderGeometry(radius, radius, axis.length(), 8),
    material,
    mid.x,
    mid.y,
    mid.z,
  );
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
}

const surfaces = new Map();
function painted(key, paint) {
  if (surfaces.has(key)) return surfaces.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  paint(canvas.getContext('2d'));
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.88, side: THREE.DoubleSide });
  surfaces.set(key, material);
  return material;
}

function masonry() {
  return painted('stone', (ctx) => {
    ctx.fillStyle = '#655d56';
    ctx.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 12; row++) {
      for (let col = -1; col < 8; col++) {
        const x = col * 32 + (row % 2) * 16,
          y = (row * 256) / 12;
        const light = 54 + 10 * Math.sin(row * 12.7 + col * 7.3);
        ctx.fillStyle = `hsl(32 17% ${light}%)`;
        ctx.fillRect(x + 1, y + 1, 30.5, 19.7);
        ctx.fillStyle = '#e4d9bc88';
        ctx.fillRect(x + 2, y + 1, 28, 1.4);
      }
    }
  });
}

function sailCloth(color) {
  return painted('sail' + color, (ctx) => {
    ctx.fillStyle = '#efdcad';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = color;
    for (let x = 0; x < 256; x += 64) ctx.fillRect(x, 0, 32, 256);
    // 鸦纹与缝边直接绘入帆布，随帆面弯曲。
    ctx.fillStyle = '#28252b';
    ctx.beginPath();
    for (const [x, y] of [
      [42, 93],
      [99, 114],
      [121, 134],
      [132, 110],
      [150, 104],
      [174, 111],
      [151, 116],
      [143, 143],
      [120, 156],
      [85, 168],
      [100, 148],
      [65, 134],
      [95, 136],
      [54, 114],
      [92, 124],
    ])
      ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#795638';
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, 250, 250);
  });
}

export function longship(color) {
  const ship = new THREE.Group();
  const oak = mat('#65412e'),
    brass = mat('#c7984e', { metal: 0.55 }),
    cord = mat('#856c4c');
  // 两舷逐道搭接的木板，由尖首尾向龙骨收窄。
  for (const side of [-1, 1]) {
    for (let plank = 0; plank < 4; plank++) {
      const vertices = [],
        indices = [];
      for (let i = 0; i <= 16; i++) {
        const x = (i / 8 - 1) * 0.85;
        const breadth = Math.sin((Math.PI * i) / 16);
        for (const h of [plank / 4, (plank + 1) / 4]) {
          vertices.push(
            x,
            -0.1 + 0.28 * h + 0.27 * (1 - breadth) ** 3,
            side * breadth * (0.035 + 0.24 * Math.sqrt(h)),
          );
        }
        if (i) {
          const j = i * 2;
          indices.push(j - 2, j - 1, j, j, j - 1, j + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      part(ship, geo, mat(['#563224', '#875336', '#a36942', '#bf8a53'][plank], { side: 2 }), 0, 0, 0);
    }
    for (let i = -2; i <= 2; i++) {
      const x = i * 0.215,
        z = side * (0.27 * Math.cos(((x / 0.85) * Math.PI) / 2));
      const shield = part(
        ship,
        new THREE.CylinderGeometry(0.103, 0.103, 0.025, 16),
        mat(i % 2 ? color : '#d9b577'),
        x,
        0.18,
        z,
      );
      shield.rotation.x = Math.PI / 2;
      part(ship, new THREE.SphereGeometry(0.034, 8, 6), brass, x, 0.18, z + side * 0.016);
      spar(ship, [x - 0.1, 0.18, z], [x - 0.32, -0.04, z + side * 0.29], 0.015, oak);
    }
  }
  const deck = part(ship, new THREE.SphereGeometry(1, 24, 8), oak, 0, 0.095, 0);
  deck.scale.set(0.82, 0.035, 0.25);
  for (const end of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3(
      [
        [0.67, 0.23],
        [0.83, 0.39],
        [0.87, 0.56],
        [0.8, 0.61],
        [0.77, 0.56],
      ].map(([x, y]) => new THREE.Vector3(end * x, y, 0)),
    );
    part(ship, new THREE.TubeGeometry(curve, 16, 0.043, 8, false), brass, 0, 0, 0);
    spar(ship, [0, 1.16, 0], [end * 0.69, 0.22, 0], 0.009, cord);
  }
  spar(ship, [0, 0.1, 0], [0, 1.34, 0], 0.029, oak);
  spar(ship, [-0.46, 1.21, 0], [0.46, 1.21, 0], 0.023, oak);
  const sail = part(ship, new THREE.PlaneGeometry(0.88, 0.75, 16, 10), sailCloth(color), 0, 0.82, 0.035);
  ship.userData.sail = sail;
  return ship;
}

export function fillSail(ship, t) {
  const geo = ship.userData.sail.geometry;
  const pos = geo.attributes.position,
    uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i),
      v = uv.getY(i);
    pos.setZ(
      i,
      (1 - v) * (0.15 * Math.sin(Math.PI * u) + 0.038 * Math.sin(8 * u - 4 * t)) + 0.13 * Math.sin(Math.PI * v),
    );
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

export function cottage(color) {
  const group = new THREE.Group(),
    timber = mat('#5a3929'),
    plaster = mat('#e7d5ab');
  box(group, plaster, 0, 0.17, 0, 0.58, 0.34, 0.43);
  const roof = new THREE.Shape();
  roof.moveTo(-0.36, 0);
  roof.lineTo(0, 0.3);
  roof.lineTo(0.36, 0);
  roof.closePath();
  part(group, new THREE.ExtrudeGeometry(roof, { depth: 0.53, bevelEnabled: false }), mat(color), 0, 0.33, -0.265);
  for (const x of [-0.26, 0, 0.26]) box(group, timber, x, 0.16, 0.22, 0.032, 0.32, 0.022);
  box(group, timber, 0, 0.29, 0.22, 0.58, 0.028, 0.025);
  box(group, timber, -0.12, 0.1, 0.227, 0.1, 0.2, 0.025);
  box(group, mat('#dca950'), 0.14, 0.18, 0.228, 0.09, 0.1, 0.025);
  box(group, masonry(), 0.18, 0.46, -0.08, 0.09, 0.27, 0.09);
  return group;
}

export function stronghold(color) {
  const city = new THREE.Group(),
    stone = masonry(),
    trim = mat('#d0ba91');
  const slate = painted('slate', ctx => {
    ctx.fillStyle = '#263846';
    ctx.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 10; row++) {
      for (let col = -1; col < 14; col++) {
        const x = col * 20 + (row % 2) * 10, y = row * 26;
        ctx.fillStyle = `hsl(205 20% ${29 + 5 * Math.cos(3 * row + col)}%)`;
        ctx.fillRect(x + 1, y, 19, 24);
        ctx.fillStyle = '#99b2b966';
        ctx.fillRect(x + 2, y + 22, 17, 1);
      }
    }
  }),
    gold = mat('#c79d5c', { metal: 0.45 });
  function section(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    city.add(g);
    return g;
  }
  const hall = section(0, -0.22);
  box(hall, stone, 0, 0.34, 0, 0.89, 0.68, 0.55);
  const roof = part(hall, new THREE.ConeGeometry(0.67, 0.42, 4), slate, 0, 0.87, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = 0.72;
  for (const x of [-0.27, 0, 0.27]) box(hall, mat('#463a32'), x, 0.54, 0.28, 0.071, 0.17, 0.012);
  for (const [x, z, height] of [
    [-0.54, 0.22, 0.74],
    [0.54, 0.22, 0.84],
    [0.32, -0.42, 1.12],
  ]) {
    const tower = section(x, z);
    part(tower, new THREE.CylinderGeometry(0.18, 0.23, height, 16), stone, 0, height / 2, 0);
    for (const y of [0.055, height - 0.06, height])
      part(tower, new THREE.CylinderGeometry(0.226, 0.21, 0.056, 16), trim, 0, y, 0);
    for (const a of [-0.85, 0, 0.85]) {
      const slit = box(
        tower,
        mat('#343031'),
        0.19 * Math.sin(a),
        height * 0.67,
        0.19 * Math.cos(a),
        0.04,
        0.145,
        0.018,
      );
      slit.rotation.y = a;
    }
    part(tower, new THREE.ConeGeometry(0.265, 0.39, 12), slate, 0, height + 0.21, 0);
    spar(tower, [0, height + 0.39, 0], [0, height + 0.63, 0], 0.011, gold);
    const flag = new THREE.Shape();
    flag.moveTo(0, 0);
    flag.lineTo(0.25, -0.055);
    flag.lineTo(0, -0.12);
    flag.closePath();
    part(tower, new THREE.ShapeGeometry(flag), mat(color, { side: 2 }), 0, height + 0.62, 0);
  }
  const gate = section(0, 0.27),
    arch = new THREE.Shape();
  arch.moveTo(-0.55, 0);
  arch.lineTo(-0.55, 0.47);
  arch.lineTo(0.55, 0.47);
  arch.lineTo(0.55, 0);
  arch.lineTo(0.13, 0);
  arch.lineTo(0.13, 0.18);
  arch.absarc(0, 0.18, 0.13, 0, Math.PI, false);
  arch.lineTo(-0.13, 0);
  arch.closePath();
  const archGeometry = new THREE.ExtrudeGeometry(arch, { depth: 0.12, bevelEnabled: false });
  const uv = archGeometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + 0.55) / 1.1, uv.getY(i));
  part(gate, archGeometry, stone, 0, 0, 0);
  for (let i = -3; i <= 3; i++) box(gate, trim, i * 0.145, 0.51, 0.06, 0.09, 0.085, 0.15);
  for (const x of [-0.075, 0, 0.075]) box(gate, mat('#554030'), x, 0.19, 0.07, 0.017, 0.2, 0.025);
  return city;
}
