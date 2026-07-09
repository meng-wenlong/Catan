// 端到端冒烟测试：两名玩家通过真实 Socket.IO 连接完成建房、初始放置并玩若干回合
import { io } from 'socket.io-client';

const URL = process.env.URL || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name) {
  const socket = io(URL, { forceNew: true });
  const c = { name, socket, state: null, picking: null, index: -1, code: null, token: null };
  socket.on('state', (s) => { c.state = s; c.index = s.you.index; });
  socket.on('picking', (pk) => { c.picking = pk; });
  socket.on('joined', (d) => { c.code = d.code; c.token = d.token; c.index = d.index; });
  socket.on('gameError', ({ msg }) => console.log(`  [${name}] 错误提示: ${msg}`));
  return c;
}

async function until(fn, desc, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return;
    await wait(50);
  }
  throw new Error(`超时: ${desc}`);
}

const A = makeClient('小明');
const B = makeClient('小红');

// 1. 建房 + 加入
A.socket.emit('createRoom', { name: '小明' });
await until(() => A.code, 'A 创建房间');
console.log(`✔ 房间创建成功: ${A.code}`);

B.socket.emit('joinRoom', { code: A.code, name: '小红', token: null });
await until(() => B.code, 'B 加入房间');
console.log('✔ 第二名玩家加入成功');

// 2. 开始游戏：先经过选颜色/定先手阶段，房主确认后正式开局
A.socket.emit('startGame');
await until(() => A.picking && B.picking, '双方进入选颜色阶段');
console.log('✔ 进入选颜色阶段');
A.socket.emit('pickColor', { colorIdx: 0 });
B.socket.emit('pickColor', { colorIdx: 1 });
await until(() => A.picking.players.every((p) => p.colorIdx !== null), '双方选好颜色');
A.socket.emit('pickFirst', { index: 0 });
A.socket.emit('pickConfirm');
await until(() => A.state && B.state, '游戏开始，双方收到状态');
console.log(`✔ 游戏开始，阶段: ${A.state.phase}`);

// 3. 初始放置（蛇形 4 次）
async function place(c) {
  const hints = c.state.you.hints;
  const v = hints.settlements[Math.floor(Math.random() * hints.settlements.length)];
  c.socket.emit('action', { type: 'setupSettlement', vertex: v });
  await until(() => c.state.you.hints.roads?.length > 0, `${c.name} 等待放路提示`);
  const e = c.state.you.hints.roads[0];
  c.socket.emit('action', { type: 'setupRoad', edge: e });
  await wait(150);
}

const clients = { 0: A.index === 0 ? A : B, 1: A.index === 0 ? B : A };
for (let step = 0; step < 4; step++) {
  const cur = A.state.setup.current;
  const c = clients[cur];
  await until(() => c.state.setup?.current === cur && c.state.you.hints.settlements?.length > 0,
    `等待玩家${cur}的放置提示`);
  await place(c);
  await until(() => A.state.phase === 'play' || A.state.setup.pos > step, '放置推进');
}
await until(() => A.state.phase === 'play', '进入正式阶段');
console.log('✔ 初始放置完成，进入正式阶段');

// 4. 玩 10 个回合：掷骰子 → 处理强盗流程 → 结束回合
for (let turn = 0; turn < 10; turn++) {
  const cur = A.state.turn.player;
  const c = clients[cur];
  const other = clients[1 - cur];
  c.socket.emit('action', { type: 'roll' });
  await until(() => c.state.turn.rolled, `回合${turn}掷骰子`);

  // 弃牌
  for (const cl of [c, other]) {
    await wait(100);
    if (cl.state.turn.state === 'discard' && cl.state.turn.pendingDiscards[cl.index]) {
      const need = cl.state.turn.pendingDiscards[cl.index];
      const sel = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
      let left = need;
      for (const r of Object.keys(sel)) {
        const have = cl.state.you.hand[r];
        const take = Math.min(left, have);
        sel[r] = take; left -= take;
      }
      cl.socket.emit('action', { type: 'discard', resources: sel });
      console.log(`  ${cl.name} 弃了 ${need} 张牌`);
    }
  }
  await wait(150);

  // 强盗
  if (c.state.turn.state === 'robber') {
    const target = c.state.board.hexes.find((h) => h.id !== c.state.robber);
    c.socket.emit('action', { type: 'moveRobber', hex: target.id });
    await until(() => c.state.turn.state !== 'robber', '强盗移动');
    console.log('  移动了强盗');
  }
  if (c.state.turn.state === 'steal') {
    c.socket.emit('action', { type: 'steal', target: c.state.turn.stealTargets[0] });
    await until(() => c.state.turn.state === 'main', '偷牌完成');
    console.log('  偷了一张牌');
  }

  await until(() => c.state.turn.state === 'main', `回合${turn}进入 main`);

  // 有资源就试着修路
  const hand = c.state.you.hand;
  if (hand.wood >= 1 && hand.brick >= 1 && c.state.you.hints.roads?.length > 0) {
    c.socket.emit('action', { type: 'buildRoad', edge: c.state.you.hints.roads[0] });
    await wait(150);
    console.log(`  ${c.name} 修了一条路`);
  }

  c.socket.emit('action', { type: 'endTurn' });
  await until(() => A.state.turn.player !== cur || A.state.phase === 'ended', `回合${turn}结束`);
}
console.log(`✔ 顺利玩了 10 个回合，当前骰子: ${JSON.stringify(A.state.turn.dice)}`);

// 5. 断线重连
B.socket.disconnect();
await wait(300);
const B2 = makeClient('小红(重连)');
B2.socket.emit('joinRoom', { code: A.code, name: '小红', token: B.token });
await until(() => B2.state !== null, '重连后收到状态');
console.log('✔ 断线重连成功，状态已恢复');

console.log('\n全部冒烟测试通过 🎉');
process.exit(0);
