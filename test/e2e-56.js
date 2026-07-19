// 5-6 人扩展端到端冒烟：5 名玩家真实 Socket.IO 连接
// 大地图开局 → 初始放置 → 随机跑回合，验证特别建设阶段出现且可推进
import { io } from 'socket.io-client';

const URL = process.env.URL || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
const ALL = [...RES, 'cloth', 'coin', 'paper'];

function makeClient(name) {
  const socket = io(URL, { forceNew: true });
  const c = { name, socket, state: null, picking: null, index: -1, code: null, token: null };
  socket.on('state', (s) => { c.state = s; c.index = s.you.index; });
  socket.on('picking', (pk) => { c.picking = pk; });
  socket.on('joined', (d) => { c.code = d.code; c.token = d.token; c.index = d.index; });
  socket.on('gameError', ({ msg }) => console.log(`  [${name}] 错误提示: ${msg}`));
  return c;
}

async function until(fn, desc, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return;
    await wait(50);
  }
  throw new Error(`超时: ${desc}`);
}

const names = ['甲', '乙', '丙', '丁', '戊'];
const clients = names.map(makeClient);
const [A] = clients;
const byIndex = (i) => clients.find((c) => c.index === i);

// 1. 建房 + 5 人加入
A.socket.emit('createRoom', { name: names[0] });
await until(() => A.code, '创建房间');
for (const c of clients.slice(1)) {
  c.socket.emit('joinRoom', { code: A.code, name: c.name, token: null });
  await until(() => c.code, `${c.name} 加入`);
}
console.log(`✔ 房间 ${A.code}，5 人已加入`);

// 2. ck 模式 + 选颜色 + 开局
A.socket.emit('startGame');
await until(() => clients.every((c) => c.picking), '进入选择阶段');
A.socket.emit('pickMode', { mode: 'ck' });
await until(() => clients[4].picking?.mode === 'ck', '模式同步');
clients.forEach((c, i) => c.socket.emit('pickColor', { colorIdx: i }));
A.socket.emit('pickFirst', { index: 0 });
await until(() => A.picking?.players.every((p) => p.colorIdx !== null), '颜色选完');
A.socket.emit('pickConfirm');
await until(() => clients.every((c) => c.state), '游戏开始');

const b = A.state.board;
if (b.hexes.length !== 30) throw new Error(`大地图应为 30 格，实际 ${b.hexes.length}`);
if (b.harbors.length !== 11) throw new Error(`应有 11 个港口，实际 ${b.harbors.length}`);
if (b.hexes.filter((h) => h.terrain === 'desert').length !== 2) throw new Error('应有 2 个沙漠');
if (A.state.bank.wood !== 24 || A.state.bank.cloth !== 18) {
  throw new Error(`银行未扩容: wood=${A.state.bank.wood} cloth=${A.state.bank.cloth}`);
}
console.log('✔ 5 人 ck 对局开始：30 格大地图 / 11 港 / 双沙漠，银行 24/18');

// 3. 初始放置
while (true) {
  const st = A.state;
  if (st.phase !== 'setup') break;
  const cur = byIndex(st.setup.current);
  await until(() => cur.state.phase !== 'setup'
    || cur.state.setup.current === cur.index, '轮到当前玩家');
  const s = cur.state;
  if (s.phase !== 'setup') break;
  if (s.setup.awaiting === 'settlement') {
    cur.socket.emit('action', { type: 'setupSettlement', vertex: s.you.hints.settlements[0] });
  } else {
    cur.socket.emit('action', { type: 'setupRoad', edge: s.you.hints.roads[0] });
  }
  const before = s.log[s.log.length - 1]?.seq;
  await until(() => cur.state.log[cur.state.log.length - 1]?.seq !== before, '放置生效');
}
console.log('✔ 5 人初始放置完成');

// 4. 随机跑回合：重点验证特别建设阶段
let sawSB = false;
let sbBuilt = false;
for (let turn = 0; turn < 80 && A.state.phase === 'play'; ) {
  const st = A.state;
  const s = st.turn.state;
  const cur = byIndex(st.turn.player);
  const logSeq = st.log[st.log.length - 1]?.seq;
  const changed = () => A.state.log[A.state.log.length - 1]?.seq !== logSeq
    || A.state.turn.state !== s || A.state.phase !== 'play'
    || (s === 'specialBuild' && A.state.turn.sb?.idx !== st.turn.sb?.idx);

  if (s === 'preroll') {
    cur.socket.emit('action', { type: 'roll' });
  } else if (s === 'specialBuild') {
    sawSB = true;
    const bi = st.turn.sb.queue[st.turn.sb.idx];
    const c = byIndex(bi);
    // 建设窗口：能修路就修一条（验证窗口内可建造），然后结束窗口
    const hand = c.state.you.hand;
    const roads = c.state.you.hints.roads || [];
    if (!sbBuilt && hand.wood >= 1 && hand.brick >= 1 && roads.length > 0) {
      c.socket.emit('action', { type: 'buildRoad', edge: roads[0] });
      await until(() => A.state.roads[roads[0]] === bi, '特别建设阶段修路生效');
      sbBuilt = true;
      console.log('✔ 特别建设阶段：非回合玩家成功修路');
    }
    if (A.state.turn.state === 'specialBuild'
      && A.state.turn.sb.queue[A.state.turn.sb.idx] === bi) {
      c.socket.emit('action', { type: 'sbPass' });
    }
  } else if (s === 'discard') {
    const idx = Number(Object.keys(st.turn.pendingDiscards)[0]);
    const c = byIndex(idx);
    const need = st.turn.pendingDiscards[idx];
    const sel = {};
    let left = need;
    for (const r of ALL) {
      const take = Math.min(left, c.state.you.hand[r] || 0);
      sel[r] = take; left -= take;
    }
    c.socket.emit('action', { type: 'discard', resources: sel });
  } else if (s === 'robber') {
    const hex = st.board.hexes.find((h) => h.id !== st.robber);
    cur.socket.emit('action', { type: 'moveRobber', hex: hex.id });
  } else if (s === 'steal') {
    cur.socket.emit('action', { type: 'steal', target: st.turn.stealTargets[0] });
  } else if (s === 'aqueduct') {
    const idx = st.ck.pendingAqueduct[0];
    byIndex(idx).socket.emit('action', { type: 'aqueductPick', res: 'wheat' });
  } else if (s === 'barbarianLoss') {
    const idx = st.ck.pendingCityLoss[0];
    const c = byIndex(idx);
    await until(() => (c.state.you.hints.cityLoss || []).length > 0, '收到毁城选项');
    c.socket.emit('action', { type: 'chooseCityLoss', vertex: c.state.you.hints.cityLoss[0] });
  } else if (s === 'defenderPick') {
    const idx = st.ck.pendingDefenderPick[0];
    byIndex(idx).socket.emit('action', { type: 'defenderPick', deck: 'trade' });
  } else if (s === 'progressDiscard') {
    const idx = st.ck.pendingProgressDiscard[0];
    const c = byIndex(idx);
    c.socket.emit('action', { type: 'progressDiscard', card: c.state.you.progressCards[0].type });
  } else if (s === 'main') {
    cur.socket.emit('action', { type: 'endTurn' });
    turn++;
  } else if (s === 'ended') {
    break;
  }
  await until(changed, `状态推进(${s})`, 8000);
}
if (!sawSB) throw new Error('特别建设阶段从未出现');
console.log(`✔ 跑完 ${A.state.turn.count} 个回合，特别建设阶段正常出现${sbBuilt ? '且可建造' : ''}`);

console.log('\n5-6 人扩展冒烟测试通过 🎉');
process.exit(0);
