// 客户端主逻辑：Socket 通信、界面状态、交互与动画
import {
  initBoard, updatePieces, clearHotspots,
  showVertexSpots, showEdgeSpots, showRobberSpots,
  zoomAt, resetZoom, highlightProducingHexes,
} from './render.js';
import { initSfx } from './sfx.js';
import { initSound } from './sound.js';

initSfx();
initSound();
const socket = io();
const $ = (id) => document.getElementById(id);

const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
const RES_META = {
  wood: { icon: '🌲', name: '木材' },
  brick: { icon: '🧱', name: '砖块' },
  sheep: { icon: '🐑', name: '羊毛' },
  wheat: { icon: '🌾', name: '小麦' },
  ore: { icon: '🪨', name: '矿石' },
};
const DEV_META = {
  knight: { icon: '⚔️', name: '骑士' },
  vp: { icon: '🏆', name: '分数' },
  roadBuilding: { icon: '🛤️', name: '修路' },
  yearOfPlenty: { icon: '🌟', name: '丰收' },
  monopoly: { icon: '💰', name: '垄断' },
};

let S = null;          // 最新游戏状态
let myIndex = -1;
let armed = null;      // 当前准备建造的类型
let lastSeq = 0;       // 已播放的动画事件
let boardReady = false;
let prevHand = null;
let discardSel = {};
let tradeGive = {};
let tradeGet = {};
let yopSel = {};
let bankGiveSel = null;
let bankGetSel = null;

// ---------- 通用 ----------
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 4800);
}

function send(data) { socket.emit('action', data); }

function show(screen) {
  for (const s of ['screen-home', 'screen-lobby', 'screen-game']) {
    $(s).classList.toggle('hidden', s !== screen);
  }
}

// ---------- 首页 / 大厅 ----------
$('home-name').value = localStorage.getItem('catan_name') || '';

$('btn-create').onclick = () => {
  const name = $('home-name').value.trim();
  if (!name) return ($('home-error').textContent = '请输入昵称');
  localStorage.setItem('catan_name', name);
  socket.emit('createRoom', { name });
};

$('btn-join').onclick = () => {
  const name = $('home-name').value.trim();
  const code = $('home-code').value.trim().toUpperCase();
  if (!name) return ($('home-error').textContent = '请输入昵称');
  if (code.length !== 4) return ($('home-error').textContent = '房间码为 4 位字符');
  localStorage.setItem('catan_name', name);
  socket.emit('joinRoom', { code, name, token: null });
};

$('home-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

$('btn-copy').onclick = () => {
  navigator.clipboard?.writeText($('lobby-code').textContent).then(() => toast('已复制房间码'));
};

$('btn-start').onclick = () => socket.emit('startGame');

// 非房主：退出房间
$('btn-leave').onclick = () => socket.emit('leaveRoom');

// 房主：销毁房间（3 秒内点第二次才真正执行，防误触）
let destroyArmed = null;
$('btn-destroy').onclick = () => {
  if (destroyArmed) {
    clearTimeout(destroyArmed);
    destroyArmed = null;
    socket.emit('destroyRoom');
    return;
  }
  $('btn-destroy').textContent = '⚠️ 再点一次确认销毁';
  destroyArmed = setTimeout(() => {
    destroyArmed = null;
    $('btn-destroy').textContent = '💥 销毁房间';
  }, 3000);
};

socket.on('leftRoom', () => {
  clearSession();
  myRoomCode = null;
  $('home-error').textContent = '';
  show('screen-home');
});

socket.on('roomDestroyed', () => {
  clearSession();
  myRoomCode = null;
  $('home-error').textContent = '房间已被房主销毁';
  show('screen-home');
});

// 会话保存：sessionStorage 按标签页隔离（方便同机多开测试），localStorage 兜底（标签页误关后可恢复）
function saveSession(code, token) {
  sessionStorage.setItem('catan_token', token);
  sessionStorage.setItem('catan_code', code);
  localStorage.setItem('catan_token', token);
  localStorage.setItem('catan_code', code);
}
function loadSession() {
  return {
    token: sessionStorage.getItem('catan_token') || localStorage.getItem('catan_token'),
    code: sessionStorage.getItem('catan_code') || localStorage.getItem('catan_code'),
  };
}
function clearSession() {
  sessionStorage.removeItem('catan_token');
  sessionStorage.removeItem('catan_code');
  localStorage.removeItem('catan_token');
  localStorage.removeItem('catan_code');
}

socket.on('joined', ({ code, token, index }) => {
  autoJoining = false;
  saveSession(code, token);
  myIndex = index;
  myRoomCode = code;
  $('home-error').textContent = '';
  show('screen-lobby');
});

socket.on('lobby', (lobby) => {
  myRoomCode = lobby.code;
  $('lobby-code').textContent = lobby.code;
  const ul = $('lobby-players');
  ul.innerHTML = '';
  let iAmHost = false;
  lobby.players.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${esc(p.name)}${p.isHost ? ' 👑' : ''}</span>
      <span>${p.connected ? '🟢 在线' : '🔴 离线'}</span>`;
    ul.appendChild(li);
    if (p.isHost && p.index === myIndex) iAmHost = true;
  });
  $('btn-start').classList.toggle('hidden', !iAmHost || lobby.started);
  $('btn-destroy').classList.toggle('hidden', !iAmHost || lobby.started);
  $('btn-leave').classList.toggle('hidden', iAmHost || lobby.started);
  renderOpenRooms(); // 房间码变化后刷新「其它房间」列表（排除自己）
});

// ---------- 公开房间列表 ----------
let openRoomsData = [];
let myRoomCode = null;

socket.on('openRooms', (list) => { openRoomsData = list || []; renderOpenRooms(); });

function renderOpenRooms() {
  fillRooms($('home-rooms'), $('home-rooms-list'), openRoomsData);
  // 大厅里不显示自己所在的房间
  fillRooms($('lobby-rooms'), $('lobby-rooms-list'), openRoomsData.filter((r) => r.code !== myRoomCode));
}

function fillRooms(wrap, ul, list) {
  ul.innerHTML = '';
  for (const r of list) {
    const li = document.createElement('li');
    const info = document.createElement('span');
    info.className = 'room-info';
    info.innerHTML = `<b>${esc(r.code)}</b> · ${esc(r.hostName)} 的房间`;
    const right = document.createElement('span');
    right.className = 'room-right';
    const meta = document.createElement('span');
    meta.className = 'room-meta';
    meta.textContent = `${r.count}/4 人`;
    const btn = document.createElement('button');
    btn.className = 'btn small primary';
    btn.textContent = '加入';
    btn.onclick = () => joinRoomByCode(r.code);
    right.append(meta, btn);
    li.append(info, right);
    ul.appendChild(li);
  }
  wrap.classList.toggle('hidden', list.length === 0);
}

function joinRoomByCode(code) {
  const name = $('home-name').value.trim() || localStorage.getItem('catan_name') || '';
  if (!name) {
    $('home-error').textContent = '请先输入昵称';
    $('lobby-error').textContent = '请先输入昵称';
    return;
  }
  localStorage.setItem('catan_name', name);
  socket.emit('joinRoom', { code, name, token: null });
}

socket.on('gameError', ({ msg }) => {
  // 页面加载时旧会话自动重连失败：静默清理，不打扰用户
  if (autoJoining && msg === '房间不存在') {
    autoJoining = false;
    clearSession();
    return;
  }
  autoJoining = false;
  if ($('screen-home').classList.contains('hidden')
      && $('screen-lobby').classList.contains('hidden')) {
    toast(msg);
  } else {
    $('home-error').textContent = msg;
    $('lobby-error').textContent = msg;
    // 房间失效则清掉本地会话
    if (msg === '房间不存在') {
      clearSession();
      show('screen-home');
    }
  }
});

socket.on('chat', ({ name, text }) => {
  appendLog(`<span class="chat-msg">💬 ${esc(name)}：${esc(text)}</span>`, true);
});

// 断线重连
// 访问 /?new 可强制以新玩家身份进入（同机多开测试用）
if (new URLSearchParams(location.search).has('new')) {
  sessionStorage.clear();
  localStorage.removeItem('catan_token');
  localStorage.removeItem('catan_code');
}

let autoJoining = false;
socket.on('connect', () => {
  socket.emit('listRooms'); // 拉取当前正在等待玩家的房间
  const { token, code } = loadSession();
  const name = localStorage.getItem('catan_name');
  if (token && code) {
    autoJoining = true;
    socket.emit('joinRoom', { code, name, token });
  }
});

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---------- 游戏状态 ----------
// 掷骰后，界面结算（弃牌窗、资源牌、状态文字、各家手牌数、产出飘字…）统一等骰子动画播完再生效
let holdUntil = 0;      // 结算冻结截止时刻
let holdTimer = null;
socket.on('state', (state) => {
  S = state;
  window.__S = state; // 调试/测试用
  myIndex = state.you.index;
  if (!boardReady) {
    initBoard($('board'), state.board);
    boardReady = true;
    // 首次加载/重连：不重播历史动画事件
    lastSeq = state.events.reduce((m, e) => Math.max(m, e.seq), lastSeq);
  }
  show('screen-game');

  // 本批新事件里若有掷骰：先单独播放骰子动画，随后所有结算推迟到动画结束
  const diceEvent = state.events.find((e) => e.type === 'dice' && e.seq > lastSeq);
  if (diceEvent) {
    lastSeq = diceEvent.seq;
    animateDiceRoll(diceEvent.dice[0], diceEvent.dice[1]);
    holdUntil = Date.now() + DICE_ROLL_MS + 900;
  }

  // 处于冻结窗口内则延后应用（含冻结期间到达的后续状态），否则立即应用
  const wait = holdUntil - Date.now();
  clearTimeout(holdTimer);
  if (wait > 0) holdTimer = setTimeout(applyState, wait);
  else applyState();
});

function applyState() {
  renderAll();
  playEvents(); // 剩余事件（产出/偷牌飘字、回合横幅等；骰子已单独播放）
}

// 房主结束本局：清空对局相关状态，回到等待大厅（后续 lobby 事件会填充大厅）
socket.on('returnToLobby', () => {
  boardReady = false;   // 下一局需重新 initBoard
  lastSeq = 0;
  S = null;
  prevHand = null;
  armed = null;
  discardOpen = false;
  holdUntil = 0;
  clearTimeout(holdTimer);
  for (const m of ['modal-winner', 'modal-discard', 'modal-steal', 'modal-trade',
    'modal-yop', 'modal-monopoly', 'modal-endgame']) {
    $(m).classList.add('hidden');
  }
  show('screen-lobby');
  toast('房主已结束本局，回到等待大厅');
});

const colors = () => S.players.map((p) => p.color);
const isMyTurn = () => S.phase === 'play' && S.turn.player === myIndex;
const isMySetup = () => S.phase === 'setup' && S.setup.current === myIndex;
const amHost = () => !!S && S.hostIndex === myIndex;

function renderAll() {
  updatePieces(S, colors());
  renderStatus();
  renderPlayers();
  renderHand();
  renderDevCards();
  renderButtons();
  renderHotspots();
  renderLog();
  renderModals();
  renderTradeBanner();
}

function renderStatus() {
  const cur = S.players[S.turn.player];
  let text = '';
  if (S.phase === 'setup') {
    const p = S.players[S.setup.current];
    const what = S.setup.awaiting === 'settlement' ? '村庄' : '道路';
    text = S.setup.current === myIndex
      ? `📍 请放置你的${what}（${S.setup.pos + 1}/${S.setup.total}）`
      : `等待 ${p.name} 放置${what}…`;
  } else if (S.phase === 'ended') {
    text = `🎉 ${S.players[S.winner].name} 获胜！`;
  } else {
    const st = S.turn.state;
    if (st === 'preroll') text = isMyTurn() ? '🎲 你的回合：请掷骰子（也可先打骑士卡）' : `${cur.name} 的回合`;
    else if (st === 'discard') {
      const names = Object.keys(S.turn.pendingDiscards).map((i) => S.players[i].name).join('、');
      text = `等待弃牌：${names}`;
    } else if (st === 'robber') text = isMyTurn() ? '🦹 请点击一个板块移动强盗' : `${cur.name} 正在移动强盗…`;
    else if (st === 'steal') text = isMyTurn() ? '🕵️ 请选择偷取对象' : `${cur.name} 正在选择偷取对象…`;
    else if (st === 'roadbuilding') text = isMyTurn() ? `🛤️ 修路卡：还可免费修 ${S.turn.freeRoads} 条路` : `${cur.name} 正在修路…`;
    else text = isMyTurn() ? '你的回合：建造、交易或结束回合' : `${cur.name} 的回合`;
  }
  $('status-text').textContent = text;

  if (S.turn.dice) {
    $('dice-box').classList.remove('hidden');
    // 骰子动画播放期间不提前显示最终点数
    if (Date.now() >= diceAnimUntil) {
      $('die1').textContent = S.turn.dice[0];
      $('die2').textContent = S.turn.dice[1];
    }
  } else if (Date.now() >= diceAnimUntil) {
    $('dice-box').classList.add('hidden');
  }
}

function renderPlayers() {
  const panel = $('players-panel');
  panel.innerHTML = '';
  S.players.forEach((p, i) => {
    const active = (S.phase === 'setup' ? S.setup.current : S.turn.player) === i && S.phase !== 'ended';
    const div = document.createElement('div');
    div.className = `player-card${active ? ' active' : ''}`;
    div.id = `player-card-${i}`;
    div.style.borderLeftColor = p.color;
    const badges = [];
    if (S.awards.longestRoad?.player === i) badges.push('<span class="badge">🛤️ 最长道路</span>');
    if (S.awards.largestArmy?.player === i) badges.push('<span class="badge">⚔️ 最大军队</span>');
    div.innerHTML = `
      <div class="p-name">
        <span>${esc(p.name)}${i === myIndex ? '（我）' : ''}${p.connected ? '' : ' <span class="offline">离线</span>'}</span>
        <span class="vp-big">${i === myIndex ? S.you.vpTotal : p.vp} 分</span>
      </div>
      <div class="p-stats">
        <span title="手牌">🃏 ${p.handCount}</span>
        <span title="发展卡">🎴 ${p.devCount}</span>
        <span title="已出骑士">⚔️ ${p.knightsPlayed}</span>
        ${badges.join('')}
      </div>`;
    panel.appendChild(div);
  });
}

function renderHand() {
  const wrap = $('hand-cards');
  wrap.innerHTML = '';
  for (const r of RES) {
    const n = S.you.hand[r];
    const div = document.createElement('div');
    div.className = `res-card res-${r}`;
    div.innerHTML = `<span>${RES_META[r].icon}</span><span class="cnt">${n}</span>`;
    div.title = `${RES_META[r].name} ×${n}（银行汇率 ${S.you.rates[r]}:1）`;
    if (prevHand && n > prevHand[r]) div.classList.add('bump');
    wrap.appendChild(div);
  }
  prevHand = { ...S.you.hand };
}

function renderDevCards() {
  const wrap = $('dev-cards');
  wrap.innerHTML = '';
  const groups = {};
  for (const c of S.you.devCards) {
    if (c.played) continue;
    if (!groups[c.type]) groups[c.type] = { total: 0, playable: 0 };
    groups[c.type].total++;
    if (c.playable) groups[c.type].playable++;
  }
  for (const [type, g] of Object.entries(groups)) {
    const btn = document.createElement('button');
    btn.className = 'dev-card';
    btn.innerHTML = `<span>${DEV_META[type].icon}</span><small>${DEV_META[type].name}${g.total > 1 ? `×${g.total}` : ''}</small>`;
    const canPlay = g.playable > 0 && isMyTurn() && !S.turn.devPlayed
      && (type === 'knight'
        ? ['preroll', 'main'].includes(S.turn.state)
        : S.turn.state === 'main');
    btn.disabled = !canPlay || type === 'vp';
    if (type === 'vp') btn.title = '分数卡：保留在手中，计入总分';
    btn.onclick = () => playDevCard(type);
    wrap.appendChild(btn);
  }
}

function playDevCard(type) {
  if (type === 'yearOfPlenty') {
    yopSel = {};
    renderYopPickers();
    $('modal-yop').classList.remove('hidden');
  } else if (type === 'monopoly') {
    renderMonopolyButtons();
    $('modal-monopoly').classList.remove('hidden');
  } else {
    send({ type: 'playDev', card: type });
  }
}

function renderButtons() {
  const my = isMyTurn();
  const main = my && S.turn.state === 'main';
  const hand = S.you.hand;
  $('btn-roll').disabled = !(my && S.turn.state === 'preroll');
  $('btn-road').disabled = !(main && hand.wood >= 1 && hand.brick >= 1 && (S.you.hints.roads || []).length > 0);
  $('btn-settlement').disabled = !(main && hand.wood >= 1 && hand.brick >= 1 && hand.sheep >= 1 && hand.wheat >= 1 && (S.you.hints.settlements || []).length > 0);
  $('btn-city').disabled = !(main && hand.wheat >= 2 && hand.ore >= 3 && (S.you.hints.cities || []).length > 0);
  $('btn-buydev').disabled = !(main && hand.sheep >= 1 && hand.wheat >= 1 && hand.ore >= 1 && S.bank.devDeck > 0);
  $('btn-trade').disabled = !main;
  $('btn-end').disabled = !main;

  for (const [id, kind] of [['btn-road', 'road'], ['btn-settlement', 'settlement'], ['btn-city', 'city']]) {
    $(id).classList.toggle('armed', armed === kind);
  }

  // 房主随时可结束本局
  $('btn-endgame').classList.toggle('hidden', !amHost());
}

// ---------- 热点交互 ----------
function renderHotspots() {
  if (isMySetup()) {
    if (S.setup.awaiting === 'settlement') {
      showVertexSpots(S.you.hints.settlements || [], (v) => send({ type: 'setupSettlement', vertex: v }));
    } else {
      showEdgeSpots(S.you.hints.roads || [], (e) => send({ type: 'setupRoad', edge: e }));
    }
    return;
  }
  if (isMyTurn()) {
    const st = S.turn.state;
    if (st === 'robber') {
      showRobberSpots(S.robber, (h) => send({ type: 'moveRobber', hex: h }));
      return;
    }
    if (st === 'roadbuilding') {
      showEdgeSpots(S.you.hints.roads || [], (e) => send({ type: 'buildRoad', edge: e }));
      return;
    }
    if (st === 'main' && armed) {
      if (armed === 'road') {
        showEdgeSpots(S.you.hints.roads || [], (e) => { armed = null; send({ type: 'buildRoad', edge: e }); });
      } else if (armed === 'settlement') {
        showVertexSpots(S.you.hints.settlements || [], (v) => { armed = null; send({ type: 'buildSettlement', vertex: v }); });
      } else if (armed === 'city') {
        showVertexSpots(S.you.hints.cities || [], (v) => { armed = null; send({ type: 'buildCity', vertex: v }); });
      }
      return;
    }
  }
  clearHotspots();
}

for (const [id, kind] of [['btn-road', 'road'], ['btn-settlement', 'settlement'], ['btn-city', 'city']]) {
  $(id).onclick = () => {
    armed = armed === kind ? null : kind;
    renderButtons();
    renderHotspots();
  };
}
$('zoom-in').onclick = () => zoomAt(1.35);
$('zoom-out').onclick = () => zoomAt(1 / 1.35);
$('zoom-reset').onclick = () => resetZoom();

$('btn-roll').onclick = () => { $('btn-roll').disabled = true; send({ type: 'roll' }); };
$('btn-buydev').onclick = () => send({ type: 'buyDev' });
$('btn-end').onclick = () => { armed = null; send({ type: 'endTurn' }); };

// 结束本局（房主）：动作栏按钮需二次确认；胜利弹窗里的「再来一局」直接结束
$('btn-endgame').onclick = () => $('modal-endgame').classList.remove('hidden');
$('endgame-confirm').onclick = () => { $('modal-endgame').classList.add('hidden'); socket.emit('endGame'); };
$('btn-again').onclick = () => socket.emit('endGame');

// ---------- 日志 ----------
let logRendered = 0;
function renderLog() {
  const list = $('log-list');
  if (S.log.length < logRendered) { list.innerHTML = ''; logRendered = 0; }
  for (let i = logRendered; i < S.log.length; i++) appendLog(esc(S.log[i]), false);
  logRendered = S.log.length;
  list.scrollTop = list.scrollHeight;
}

function appendLog(html, scroll) {
  const div = document.createElement('div');
  div.innerHTML = html;
  $('log-list').appendChild(div);
  if (scroll) $('log-list').scrollTop = $('log-list').scrollHeight;
}

$('chat-send').onclick = sendChat;
$('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
function sendChat() {
  const text = $('chat-input').value.trim();
  if (!text) return;
  socket.emit('chat', { text });
  $('chat-input').value = '';
}

// ---------- 表情包 ----------
// 与服务端 index.js 的 EMOTES 白名单保持一致
const EMOTES = ['😄', '😂', '😭', '😡', '🤔', '😱', '👍', '👎', '👏', '🎉', '❤️', '🐑'];
for (const em of EMOTES) {
  const b = document.createElement('button');
  b.className = 'emote-item';
  b.textContent = em;
  b.onclick = () => {
    socket.emit('emote', { emoji: em });
    $('emote-panel').classList.add('hidden');
  };
  $('emote-panel').appendChild(b);
}
$('emote-btn').onclick = () => $('emote-panel').classList.toggle('hidden');
// 点面板外任意处收起（emote-btn 自己的 onclick 先执行 toggle，这里跳过 emote-box 内部的点击）
document.addEventListener('click', (e) => {
  if (!e.target.closest('#emote-box')) $('emote-panel').classList.add('hidden');
});

socket.on('emote', ({ index, name, emoji }) => {
  appendLog(`<span class="chat-msg">${emoji} ${esc(name)}</span>`, true);
  emoteBurst(index, emoji);
});

// 大表情从发送者的玩家卡片旁弹出
function emoteBurst(playerIdx, emoji) {
  const card = $(`player-card-${playerIdx}`);
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = 'emote-burst';
  d.textContent = emoji;
  d.style.left = `${rect.left - 46}px`;
  d.style.top = `${rect.top + rect.height / 2}px`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}

// ---------- 资源选择器组件 ----------
function makePickers(container, sel, limits, onChange) {
  container.innerHTML = '';
  for (const r of RES) {
    const div = document.createElement('div');
    div.className = 'res-picker';
    div.innerHTML = `
      <div class="rp-card res-${r}"><span>${RES_META[r].icon}</span><span class="rp-cnt">${sel[r] || 0}</span></div>
      <div class="rp-btns">
        <button data-d="-1">−</button>
        <button data-d="1">＋</button>
      </div>
      ${limits ? `<div class="avail">有${limits[r]}</div>` : ''}`;
    for (const b of div.querySelectorAll('button')) {
      b.onclick = () => {
        const d = Number(b.dataset.d);
        const cur = sel[r] || 0;
        const next = cur + d;
        if (next < 0) return;
        if (limits && next > limits[r]) return;
        sel[r] = next;
        div.querySelector('.rp-cnt').textContent = next;
        onChange?.();
      };
    }
    container.appendChild(div);
  }
}

// ---------- 弃牌 ----------
let discardOpen = false;
function renderModals() {
  const needDiscard = S.turn.state === 'discard' && S.turn.pendingDiscards[myIndex];
  if (needDiscard && !discardOpen) {
    discardOpen = true;
    discardSel = {};
    $('discard-need').textContent = needDiscard;
    makePickers($('discard-pickers'), discardSel, S.you.hand, () => {
      const total = RES.reduce((s, r) => s + (discardSel[r] || 0), 0);
      $('discard-count').textContent = total;
      $('discard-confirm').disabled = total !== needDiscard;
    });
    $('discard-count').textContent = '0';
    $('discard-confirm').disabled = true;
    $('modal-discard').classList.remove('hidden');
  } else if (!needDiscard) {
    discardOpen = false;
    $('modal-discard').classList.add('hidden');
  }

  // 偷牌
  const stealing = isMyTurn() && S.turn.state === 'steal';
  $('modal-steal').classList.toggle('hidden', !stealing);
  if (stealing) {
    const box = $('steal-targets');
    box.innerHTML = '';
    for (const t of S.turn.stealTargets) {
      const b = document.createElement('button');
      b.className = 'btn primary';
      b.textContent = `${S.players[t].name}（${S.players[t].handCount} 张手牌）`;
      b.onclick = () => send({ type: 'steal', target: t });
      box.appendChild(b);
    }
  }

  // 胜利
  if (S.phase === 'ended') {
    $('winner-title').textContent = `🎉 ${S.players[S.winner].name} 获胜！`;
    const scores = S.players.map((p, i) => `<p><b style="color:${p.color}">${esc(p.name)}</b>：${p.vp} 分</p>`).join('');
    $('winner-scores').innerHTML = scores;
    $('btn-again').classList.toggle('hidden', !amHost());
    $('winner-hint').classList.toggle('hidden', amHost());
    $('modal-winner').classList.remove('hidden');
  }
}

$('discard-confirm').onclick = () => {
  send({ type: 'discard', resources: discardSel });
  discardOpen = false;
  $('modal-discard').classList.add('hidden');
};

// ---------- 交易 ----------
$('btn-trade').onclick = () => {
  tradeGive = {}; tradeGet = {};
  makePickers($('trade-give'), tradeGive, S.you.hand);
  makePickers($('trade-get'), tradeGet, null);
  renderBankPane();
  $('modal-trade').classList.remove('hidden');
};

$('tab-player').onclick = () => switchTradeTab(true);
$('tab-bank').onclick = () => switchTradeTab(false);
function switchTradeTab(player) {
  $('tab-player').classList.toggle('active', player);
  $('tab-bank').classList.toggle('active', !player);
  $('trade-player-pane').classList.toggle('hidden', !player);
  $('trade-bank-pane').classList.toggle('hidden', player);
}

function renderBankPane() {
  bankGiveSel = null; bankGetSel = null;
  updateBankRate();
  for (const [containerId, isGive] of [['bank-give', true], ['bank-get', false]]) {
    const c = $(containerId);
    c.innerHTML = '';
    for (const r of RES) {
      const b = document.createElement('button');
      b.className = `res-${r}`;
      b.innerHTML = RES_META[r].icon;
      b.title = `${RES_META[r].name}${isGive ? `（${S.you.rates[r]}:1）` : ''}`;
      b.onclick = () => {
        if (isGive) bankGiveSel = r; else bankGetSel = r;
        for (const x of c.children) x.classList.remove('sel');
        b.classList.add('sel');
        updateBankRate();
      };
      c.appendChild(b);
    }
  }
}

function updateBankRate() {
  $('bank-rate').textContent = bankGiveSel ? S.you.rates[bankGiveSel] : '?';
  $('bank-confirm').disabled = !bankGiveSel || !bankGetSel || bankGiveSel === bankGetSel
    || S.you.hand[bankGiveSel] < S.you.rates[bankGiveSel];
}

$('bank-confirm').onclick = () => {
  send({ type: 'bankTrade', give: bankGiveSel, get: bankGetSel });
  $('modal-trade').classList.add('hidden');
};

$('trade-offer').onclick = () => {
  send({ type: 'offerTrade', give: tradeGive, get: tradeGet });
  $('modal-trade').classList.add('hidden');
};

for (const btn of document.querySelectorAll('.modal-close')) {
  btn.onclick = () => $(btn.dataset.close).classList.add('hidden');
}

function renderTradeBanner() {
  const banner = $('trade-banner');
  if (!S.trade || S.phase !== 'play') {
    banner.classList.add('hidden');
    return;
  }
  const t = S.trade;
  const fmt = (m) => RES.filter((r) => m[r]).map((r) => `${m[r]}${RES_META[r].icon}`).join(' ') || '无';
  banner.classList.remove('hidden');
  banner.innerHTML = '';

  const label = document.createElement('span');
  if (t.from === myIndex) {
    label.innerHTML = `你发起的交易：出 ${fmt(t.give)} ➡️ 换 ${fmt(t.get)}`;
    banner.appendChild(label);
    S.players.forEach((p, i) => {
      if (i === myIndex) return;
      const resp = t.responses[i];
      const chip = document.createElement('span');
      if (resp === 'accept') {
        const b = document.createElement('button');
        b.className = 'btn primary small';
        b.textContent = `✅ 与 ${p.name} 成交`;
        b.onclick = () => send({ type: 'acceptTradeWith', target: i });
        banner.appendChild(b);
        return;
      }
      chip.textContent = resp === 'decline' ? `❌ ${p.name}` : `⏳ ${p.name}`;
      banner.appendChild(chip);
    });
    const cancel = document.createElement('button');
    cancel.className = 'btn small';
    cancel.textContent = '取消';
    cancel.onclick = () => send({ type: 'cancelTrade' });
    banner.appendChild(cancel);
  } else {
    label.innerHTML = `${esc(S.players[t.from].name)} 想用 ${fmt(t.give)} 换你的 ${fmt(t.get)}`;
    banner.appendChild(label);
    const my = t.responses[myIndex];
    if (!my) {
      const yes = document.createElement('button');
      yes.className = 'btn primary small';
      yes.textContent = '✅ 同意';
      yes.onclick = () => send({ type: 'respondTrade', accept: true });
      const no = document.createElement('button');
      no.className = 'btn small';
      no.textContent = '❌ 拒绝';
      no.onclick = () => send({ type: 'respondTrade', accept: false });
      banner.append(yes, no);
    } else {
      const st = document.createElement('span');
      st.textContent = my === 'accept' ? '已同意，等待对方确认…' : '已拒绝';
      banner.appendChild(st);
    }
  }
}

// ---------- 丰收之年 / 垄断 ----------
function renderYopPickers() {
  makePickers($('yop-pickers'), yopSel, null, () => {
    const total = RES.reduce((s, r) => s + (yopSel[r] || 0), 0);
    $('yop-confirm').disabled = total !== 2;
  });
  $('yop-confirm').disabled = true;
}

$('yop-confirm').onclick = () => {
  const picked = [];
  for (const r of RES) for (let i = 0; i < (yopSel[r] || 0); i++) picked.push(r);
  if (picked.length !== 2) return;
  send({ type: 'playDev', card: 'yearOfPlenty', payload: { r1: picked[0], r2: picked[1] } });
  $('modal-yop').classList.add('hidden');
};

function renderMonopolyButtons() {
  const box = $('monopoly-btns');
  box.innerHTML = '';
  for (const r of RES) {
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.textContent = `${RES_META[r].icon} ${RES_META[r].name}`;
    b.onclick = () => {
      send({ type: 'playDev', card: 'monopoly', payload: { res: r } });
      $('modal-monopoly').classList.add('hidden');
    };
    box.appendChild(b);
  }
}

// ---------- 动画事件 ----------
const DICE_ROLL_MS = 2400;   // 骰子翻滚时长
const GAIN_STAGGER_MS = 900; // 每条产出飘字的间隔
let diceAnimUntil = 0;
let diceRollTimer = null;

function animateDiceRoll(d1, d2) {
  const total = d1 + d2;
  diceAnimUntil = Date.now() + DICE_ROLL_MS;
  $('dice-box').classList.remove('hidden');
  const dies = [$('die1'), $('die2')];
  for (const d of dies) {
    d.classList.remove('rolling', 'settle');
    void d.offsetWidth;
    d.classList.add('rolling');
  }
  clearInterval(diceRollTimer);
  const t0 = Date.now();
  diceRollTimer = setInterval(() => {
    if (Date.now() - t0 < DICE_ROLL_MS) {
      // 翻滚中显示随机点数
      for (const d of dies) d.textContent = 1 + Math.floor(Math.random() * 6);
      return;
    }
    clearInterval(diceRollTimer);
    dies[0].textContent = d1;
    dies[1].textContent = d2;
    for (const d of dies) {
      d.classList.remove('rolling');
      void d.offsetWidth;
      d.classList.add('settle');
    }
    // 中央大数字 + 产出板块闪烁
    const overlay = $('roll-overlay');
    overlay.textContent = total === 7 ? '7 🦹' : total;
    overlay.classList.toggle('seven', total === 7);
    overlay.classList.remove('show');
    void overlay.offsetWidth;
    overlay.classList.add('show');
    setTimeout(() => overlay.classList.remove('show'), 4600);
    if (total !== 7) highlightProducingHexes(total, S.robber);
  }, 170);
}

function playEvents() {
  let delay = 0; // 同一批事件按顺序错开播放（骰子动画已在收到状态时单独播放）
  for (const ev of S.events) {
    if (ev.seq <= lastSeq) continue;
    lastSeq = ev.seq;
    switch (ev.type) {
      case 'gain': {
        const d = delay;
        setTimeout(() => floatOverPlayer(ev.player, `+${ev.n} ${RES_META[ev.res].icon}`), d);
        delay += GAIN_STAGGER_MS;
        break;
      }
      case 'steal':
        floatOverPlayer(ev.to, '🕵️ +1');
        floatOverPlayer(ev.from, '−1 🃏');
        break;
      case 'monopoly':
        floatOverPlayer(ev.player, `💰 +${ev.n} ${RES_META[ev.res].icon}`);
        break;
      case 'trade':
        floatOverPlayer(ev.a, '🔄');
        floatOverPlayer(ev.b, '🔄');
        break;
      case 'turnEnd':
        showTurnBanner(ev.to);
        break;
      default:
        break;
    }
  }
}

function showTurnBanner(to) {
  const p = S.players[to];
  const mine = to === myIndex;
  const banner = $('turn-banner');
  const inner = banner.querySelector('.turn-banner-inner');
  inner.textContent = mine ? '🎲 轮到你了！' : `轮到 ${p.name} 的回合`;
  inner.classList.toggle('mine', mine);
  // 横幅底色使用新玩家的颜色；浅色（如白色玩家）自动改用深色文字
  inner.style.background = `linear-gradient(135deg, ${p.color}e6, ${p.color}b0)`;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(p.color.slice(i, i + 2), 16));
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 186;
  inner.style.color = light ? '#334' : '#fff';
  inner.style.textShadow = light ? 'none' : '0 2px 6px rgba(0,0,0,.35)';
  banner.classList.remove('show');
  void banner.offsetWidth;
  banner.classList.add('show');
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => banner.classList.remove('show'), 4600);

  // 新玩家卡片闪烁 + 骰子传递飘字
  const card = $(`player-card-${to}`);
  if (card) {
    card.classList.remove('turn-flash');
    void card.offsetWidth;
    card.classList.add('turn-flash');
  }
  floatOverPlayer(to, '🎲');
}

function floatOverPlayer(playerIdx, text) {
  const card = $(`player-card-${playerIdx}`);
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'floater';
  f.textContent = text;
  f.style.left = `${rect.left - 60 + Math.random() * 30}px`;
  // 垂直锚定在卡片中线，配合较小的上飘幅度，保证全程贴着自己的卡片
  f.style.top = `${rect.top + rect.height / 2 - 4}px`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 5000);
}
