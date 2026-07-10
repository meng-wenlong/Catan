// 客户端主逻辑：Socket 通信、界面状态、交互与动画
import {
  initBoard, updatePieces, updateCKPieces, clearHotspots,
  showVertexSpots, showEdgeSpots, showRobberSpots, showHexSpots,
  zoomAt, resetZoom, highlightProducingHexes, hexPixelPosition,
  updateBarbarianTrack, updateProgressDecks, deckPixelPosition,
  updateImproveBoard, attachCardInspect,
} from './render.js';
import { initSfx, sfx } from './sfx.js';
import { initSound } from './sound.js';

initSfx();
initSound();
const socket = io();
const $ = (id) => document.getElementById(id);

const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
const COM = ['cloth', 'coin', 'paper']; // 城市与骑士：商品
const RES_META = {
  wood: { icon: '🌲', name: '木材' },
  brick: { icon: '🧱', name: '砖块' },
  sheep: { icon: '🐑', name: '羊毛' },
  wheat: { icon: '🌾', name: '小麦' },
  ore: { icon: '🪨', name: '矿石' },
  cloth: { icon: '🧶', name: '布匹' },
  coin: { icon: '🪙', name: '铸币' },
  paper: { icon: '📜', name: '纸张' },
};
// 当前模式下的全部牌类型
const cardList = () => (S && S.mode === 'ck' ? [...RES, ...COM] : RES);
// 行内资源/商品小图标（均用设计师插画）
const resIcon = (r) => `<img class="res-ico" src="/assets/opt/icon-${r}.webp" alt="${RES_META[r].name}">`;
// 骰面插画；红骰（ck）用 canvas 预染色的副本 —— Safari 对 img 的 CSS 滤镜链渲染不稳定
const redDieSrc = {};
for (let n = 1; n <= 6; n++) {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'multiply'; // 白色骰身→红，深色点数保持深色
    ctx.fillStyle = '#e0574a';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'destination-in'; // 恢复原图的透明区域
    ctx.drawImage(img, 0, 0);
    redDieSrc[n] = c.toDataURL('image/png');
  };
  img.src = `/assets/opt/die-${n}.webp`;
}
const setDie = (el, n) => {
  const red = el.classList.contains('red-die') && redDieSrc[n];
  el.innerHTML = `<img src="${red || `/assets/opt/die-${n}.webp`}" alt="${n}">`;
};
const DEV_META = {
  knight: { icon: '⚔️', name: '骑士', desc: '移动强盗，并从相邻的一名玩家偷 1 张牌' },
  vp: { icon: '🏆', name: '分数', desc: '胜利点数：+1 分，保留在手中计入总分' },
  roadBuilding: { icon: '🛤️', name: '修路', desc: '免费建造 2 条道路' },
  yearOfPlenty: { icon: '🌟', name: '丰收', desc: '从银行任取 2 张资源' },
  monopoly: { icon: '💰', name: '垄断', desc: '指定一种资源，收取所有对手手中的该资源' },
};
// 发展卡类型 → 插画文件名（完整卡浮层用）
const DEV_ASSET = { knight: 'knight', vp: 'vp', roadBuilding: 'road', yearOfPlenty: 'plenty', monopoly: 'monopoly' };
// 进步卡（城市与骑士）
const PROG_META = {
  merchant: { name: '商人', desc: '放在自己建筑相邻的板块上：该资源 2:1 交易，+1 分（可被他人夺走）' },
  merchantFleet: { name: '商船队', desc: '本回合内指定一种资源/商品按 2:1 与银行交易' },
  commercialHarbor: { name: '商业港', desc: '与每位对手交换：你出 1 张资源，换对方 1 张商品（随机）' },
  masterMerchant: { name: '商业大亨', desc: '从一名分数比你高的玩家手中拿走 2 张牌' },
  resourceMonopoly: { name: '资源垄断', desc: '指定一种资源，每位对手最多上缴 2 张' },
  tradeMonopoly: { name: '商品垄断', desc: '指定一种商品，每位对手上缴 1 张' },
  bishop: { name: '主教', desc: '移动强盗，并从相邻的每位玩家各偷 1 张牌' },
  deserter: { name: '逃兵', desc: '指定一名对手，由对方选一名骑士叛逃；你放置一个同级骑士（棋子不足自动降级）' },
  diplomat: { name: '外交官', desc: '移除一条「开放道路」（自己的可立即重放）' },
  intrigue: { name: '阴谋', desc: '驱逐一名位于你道路上的对手骑士' },
  saboteur: { name: '破坏者', desc: '分数不低于你的玩家全部弃一半手牌' },
  spy: { name: '间谍', desc: '偷看并拿走一名对手的进步卡（随机）' },
  warlord: { name: '军阀', desc: '免费激活你的所有骑士' },
  wedding: { name: '婚礼', desc: '分数比你高的玩家各给你 2 张牌' },
  alchemist: { name: '炼金术士', desc: '掷骰前打出：自选两个骰子的点数' },
  crane: { name: '起重机', desc: '本回合下一次城市升级少付 1 张商品' },
  engineer: { name: '工程师', desc: '免费修建一座城墙' },
  inventor: { name: '发明家', desc: '交换两块板块的数字（2/6/8/12 除外）' },
  irrigation: { name: '灌溉', desc: '每块与你建筑相邻的麦田给你 2 张小麦' },
  medicine: { name: '医学', desc: '用 2矿石 1小麦 升级一座城市' },
  mining: { name: '采矿', desc: '每块与你建筑相邻的矿山给你 2 张矿石' },
  roadBuilding: { name: '修路', desc: '免费修 2 条路' },
  smith: { name: '铁匠', desc: '免费升级 2 名骑士各一级' },
};
const TRACKS = ['trade', 'politics', 'science'];
const TRACK_META = {
  trade: { name: '贸易', com: 'cloth', color: '#c9a227', perk3: '商栈：商品可 2:1 与银行交易' },
  politics: { name: '政治', com: 'coin', color: '#3a6ea5', perk3: '城堡：可将骑士升到 3 级' },
  science: { name: '科学', com: 'paper', color: '#4a8c4a', perk3: '引水渠：无产出时任选 1 张资源' },
};
// 事件骰骰面
const EVENT_FACE = {
  ship: { icon: '⛵', cls: 'ev-ship', name: '野蛮人船' },
  trade: { icon: '🏛️', cls: 'ev-trade', name: '贸易城门' },
  politics: { icon: '🏛️', cls: 'ev-politics', name: '政治城门' },
  science: { icon: '🏛️', cls: 'ev-science', name: '科学城门' },
};

let S = null;          // 最新游戏状态
let myIndex = -1;
let isSpectating = false;
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
  for (const s of ['screen-home', 'screen-lobby', 'screen-pick', 'screen-game']) {
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
$('home-spectate-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-spectate').click(); });

$('btn-spectate').onclick = () => {
  const name = $('home-name').value.trim();
  const code = $('home-spectate-code').value.trim().toUpperCase();
  if (!name) return ($('home-error').textContent = '请输入昵称');
  if (code.length !== 4) return ($('home-error').textContent = '房间码为 4 位字符');
  socket.emit('spectateRoom', { code, name });
};

// 退出观战 / 观战结束：重置本地对局状态，回到首页
function exitSpectate(msg) {
  isSpectating = false;
  boardReady = false;
  S = null;
  myRoomCode = null;
  lastSeq = 0;
  lastLogSeq = 0;
  $('log-list').innerHTML = '';
  show('screen-home');
  if (msg) toast(msg);
}
$('btn-spec-leave').onclick = () => {
  socket.emit('leaveSpectate');
  exitSpectate();
};

$('btn-copy').onclick = () => {
  navigator.clipboard?.writeText($('lobby-code').textContent).then(() => toast('已复制房间码'));
};

$('btn-start').onclick = () => socket.emit('startGame');

// ---------- 单人调试模式（仅 /?dev 显示入口；面板仅在 dev 房渲染） ----------
if (new URLSearchParams(location.search).has('dev')) $('btn-dev').classList.remove('hidden');
$('btn-dev').onclick = () => {
  const name = $('home-name').value.trim() || '调试';
  localStorage.setItem('catan_name', name);
  socket.emit('createDevRoom', { name });
};

let devBuilt = false;
function buildDevPanel() {
  if (devBuilt) return;
  devBuilt = true;
  const opt = (pairs) => pairs.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  const devCards = [['knight', '骑士'], ['roadBuilding', '修路'], ['yearOfPlenty', '丰收'], ['monopoly', '垄断'], ['vp', '分数']];
  const progCards = Object.entries(PROG_META).map(([k, v]) => [k, v.name]);
  const events = [['', '随机事件骰'], ['ship', '⛵ 船'], ['trade', '贸易门'], ['politics', '政治门'], ['science', '科学门']];
  $('dev-panel').innerHTML = `
    <div class="dev-head">🛠 调试面板 <button id="dev-toggle" title="收起/展开">–</button></div>
    <div class="dev-body">
      <button class="dev-btn" data-act="fill">💰 填满我的资源</button>
      <div class="dev-line"><select id="dev-c1">${opt(devCards)}</select><button class="dev-btn" data-act="grantDev">发展卡→我</button></div>
      <div class="dev-line"><select id="dev-c2">${opt(progCards)}</select><button class="dev-btn" data-act="grantProg">进步卡→我</button></div>
      <div class="dev-line">🎲 <input id="dev-d1" type="number" min="1" max="6" value="4"><input id="dev-d2" type="number" min="1" max="6" value="4"><select id="dev-ev">${opt(events)}</select><button class="dev-btn" data-act="dice">掷</button></div>
      <div class="dev-line">给 <select id="dev-npc"></select><select id="dev-card"></select><button class="dev-btn" data-act="give">发牌</button></div>
      <div id="dev-hands"></div>
    </div>`;
  $('dev-toggle').onclick = () => $('dev-panel').classList.toggle('collapsed');
  $('dev-panel').querySelector('.dev-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'fill') send({ type: 'devFill' });
    else if (a === 'grantDev') send({ type: 'devGrantDev', card: $('dev-c1').value });
    else if (a === 'grantProg') send({ type: 'devGrantProgress', card: $('dev-c2').value });
    else if (a === 'dice') send({ type: 'devSetDice', d1: +$('dev-d1').value, d2: +$('dev-d2').value, eventDie: $('dev-ev').value || null });
    else if (a === 'give') send({ type: 'devGiveNPC', target: +$('dev-npc').value, card: $('dev-card').value, n: 1 });
  });
}

function renderDevPanel() {
  const el = $('dev-panel');
  if (!S || !S.dev) { el.classList.add('hidden'); return; }
  buildDevPanel();
  el.classList.remove('hidden');
  // NPC 下拉（排除玩家 0）与卡牌下拉
  const npcSel = $('dev-npc');
  if (npcSel.options.length !== S.players.length - 1) {
    npcSel.innerHTML = S.players.map((p, i) => (i === 0 ? '' : `<option value="${i}">${esc(p.name)}</option>`)).join('');
  }
  const cardSel = $('dev-card');
  if (!cardSel.options.length) cardSel.innerHTML = cardList().map((r) => `<option value="${r}">${RES_META[r].name}</option>`).join('');
  // 所有玩家手牌一览（含 NPC）
  const dp = S.you.devPlayers || [];
  $('dev-hands').innerHTML = dp.map((p) => {
    const cards = cardList().filter((r) => p.hand[r] > 0).map((r) => `${RES_META[r].name}${p.hand[r]}`).join(' ');
    const extra = [(p.devCards || []).length ? `发×${p.devCards.length}` : '', (p.progressCards || []).length ? `进×${p.progressCards.length}` : ''].filter(Boolean).join(' ');
    return `<div class="dev-hand"><b style="color:${p.color}">${esc(p.name)}</b>：${cards || '空'}${extra ? ` <span class="dev-dim">${extra}</span>` : ''}</div>`;
  }).join('');
}

// 非房主：退出房间
$('btn-leave').onclick = () => socket.emit('leaveRoom');

// 房主：销毁房间（3 秒内点第二次才真正执行，防误触）
let destroyArmed = null;
function resetDestroyBtn() {
  clearTimeout(destroyArmed);
  destroyArmed = null;
  $('btn-destroy').textContent = '💥 销毁房间';
}
$('btn-destroy').onclick = () => {
  if (destroyArmed) {
    resetDestroyBtn();
    socket.emit('destroyRoom');
    return;
  }
  $('btn-destroy').textContent = '⚠️ 再点一次确认销毁';
  destroyArmed = setTimeout(resetDestroyBtn, 3000);
};

socket.on('leftRoom', () => {
  clearSession();
  myRoomCode = null;
  $('home-error').textContent = '';
  show('screen-home');
});

// ---------- 选颜色 / 定先手 ----------
socket.on('picking', (pk) => {
  isSpectating = !!pk.spectating;
  if (isSpectating) {
    renderPickingReadOnly(pk);
    show('screen-pick');
    return;
  }
  renderPicking(pk);
  show('screen-pick');
});

socket.on('pickingCancelled', () => {
  if (isSpectating) {
    exitSpectate('房间取消了选颜色，观战结束');
    return;
  }
  if (!$('screen-pick').classList.contains('hidden')) show('screen-lobby');
});

$('pick-confirm').onclick = () => socket.emit('pickConfirm');
$('pick-cancel').onclick = () => socket.emit('pickCancel');

function renderPicking(pk) {
  myIndex = pk.you; // 顺便校正本地下标（有人退出房间后下标可能变化）
  const iAmHost = !!pk.players[pk.you]?.isHost;

  // 游戏模式（房主可切换）
  for (const [id, mode] of [['mode-base', 'base'], ['mode-ck', 'ck']]) {
    const b = $(id);
    b.classList.toggle('active', pk.mode === mode);
    b.disabled = !iAmHost;
    b.onclick = () => socket.emit('pickMode', { mode });
  }

  // 颜色格：空闲可选，自己已选的再点一次取消，别人选走的置灰并显示名字
  const box = $('pick-colors');
  box.innerHTML = '';
  pk.palette.forEach((c, ci) => {
    const owner = pk.players.find((p) => p.colorIdx === ci);
    const b = document.createElement('button');
    b.className = 'pick-swatch';
    b.style.setProperty('--sw', c.color);
    if (owner) b.classList.add(owner.index === pk.you ? 'mine' : 'taken');
    b.innerHTML = `<span class="sw-dot"></span><span class="sw-name">${owner ? esc(owner.name) : esc(c.name)}</span>`;
    b.disabled = !!(owner && owner.index !== pk.you);
    b.onclick = () => socket.emit('pickColor', { colorIdx: ci });
    box.appendChild(b);
  });

  // 玩家进度列表
  const ul = $('pick-players');
  ul.innerHTML = '';
  pk.players.forEach((p) => {
    const c = p.colorIdx === null ? null : pk.palette[p.colorIdx];
    const li = document.createElement('li');
    li.innerHTML = `<span><span class="pick-dot" style="background:${c ? c.color : 'transparent'}"></span>${esc(p.name)}${p.isHost ? ' 👑' : ''}${p.connected ? '' : ' 🔴'}</span>
      <span>${c ? esc(c.name) : '<i>选择中…</i>'}</span>`;
    ul.appendChild(li);
  });

  // 起始玩家：房主可点，其他人只看
  const fbox = $('pick-first');
  fbox.innerHTML = '';
  const opts = [{ index: -1, label: '🎲 随机' }, ...pk.players.map((p) => ({ index: p.index, label: p.name }))];
  for (const o of opts) {
    const b = document.createElement('button');
    b.className = 'btn small pick-first-btn' + (pk.first === o.index ? ' active' : '');
    b.textContent = o.label;
    b.disabled = !iAmHost;
    b.onclick = () => socket.emit('pickFirst', { index: o.index });
    fbox.appendChild(b);
  }
  $('pick-first-hint').textContent = iAmHost ? '' : '由房主指定（默认随机）';

  const ready = pk.players.every((p) => p.colorIdx !== null);
  $('pick-confirm').classList.toggle('hidden', !iAmHost);
  $('pick-confirm').disabled = !ready;
  $('pick-cancel').classList.toggle('hidden', !iAmHost);
  $('pick-hint').textContent = ready
    ? (iAmHost ? '全员就绪！' : '全员就绪，等待房主开始对局…')
    : '等待所有人选好颜色…';
  $('pick-error').textContent = '';
}

// 观战者只读版的选颜色界面：所有按钮禁用，仅展示当前状态
function renderPickingReadOnly(pk) {
  myIndex = -1;
  const box = $('pick-colors');
  box.innerHTML = '';
  pk.palette.forEach((c, ci) => {
    const owner = pk.players.find((p) => p.colorIdx === ci);
    const b = document.createElement('button');
    b.className = 'pick-swatch';
    b.style.setProperty('--sw', c.color);
    if (owner) b.classList.add('taken');
    b.innerHTML = `<span class="sw-dot"></span><span class="sw-name">${owner ? esc(owner.name) : esc(c.name)}</span>`;
    b.disabled = true;
    box.appendChild(b);
  });
  const ul = $('pick-players');
  ul.innerHTML = '';
  pk.players.forEach((p) => {
    const c = p.colorIdx === null ? null : pk.palette[p.colorIdx];
    const li = document.createElement('li');
    li.innerHTML = `<span><span class="pick-dot" style="background:${c ? c.color : 'transparent'}"></span>${esc(p.name)}${p.isHost ? ' 👑' : ''}${p.connected ? '' : ' 🔴'}</span>
      <span>${c ? esc(c.name) : '<i>选择中…</i>'}</span>`;
    ul.appendChild(li);
  });
  const fbox = $('pick-first');
  fbox.innerHTML = '';
  const opts = [{ index: -1, label: '🎲 随机' }, ...pk.players.map((p) => ({ index: p.index, label: p.name }))];
  for (const o of opts) {
    const b = document.createElement('button');
    b.className = 'btn small pick-first-btn' + (pk.first === o.index ? ' active' : '');
    b.textContent = o.label;
    b.disabled = true;
    fbox.appendChild(b);
  }
  $('pick-first-hint').textContent = '';
  $('pick-confirm').classList.add('hidden');
  $('pick-cancel').classList.add('hidden');
  $('pick-hint').textContent = '👁️ 观战中，等待游戏开始…';
  $('pick-error').textContent = '';
}

socket.on('roomDestroyed', () => {
  clearSession();
  isSpectating = false;
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

socket.on('joined', ({ code, token, index, spectating }) => {
  autoJoining = false;
  resetDestroyBtn(); // 进入新房间时清掉上次遗留的「确认销毁」状态
  if (spectating) {
    isSpectating = true;
    myRoomCode = code;
    myIndex = -1;
    $('home-error').textContent = '';
    return; // 等待后续 state/picking 事件决定显示哪个屏幕
  }
  saveSession(code, token);
  myIndex = index;
  myRoomCode = code;
  $('home-error').textContent = '';
  show('screen-lobby');
});

socket.on('lobby', (lobby) => {
  myRoomCode = lobby.code;
  // 有人退出后下标会移动（如房主移交），以服务端下发的为准；旧版服务端无此字段时沿用本地值
  if (lobby.you !== undefined) myIndex = lobby.you;
  $('lobby-code').textContent = lobby.code;
  const ul = $('lobby-players');
  ul.innerHTML = '';
  lobby.players.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${esc(p.name)}${p.isHost ? ' 👑' : ''}</span>
      <span>${p.connected ? '🟢 在线' : '🔴 离线'}</span>`;
    ul.appendChild(li);
  });
  const iAmHost = !!lobby.players[myIndex]?.isHost;
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
  if (!$('screen-pick').classList.contains('hidden')) {
    $('pick-error').textContent = msg;
    return;
  }
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
  isSpectating = !!state.you.spectating;
  myIndex = state.you.index;
  if (!boardReady) {
    initBoard($('board'), state.board, state.mode === 'ck');
    boardReady = true;
    // 首次加载/重连：不重播历史动画事件
    lastSeq = state.events.reduce((m, e) => Math.max(m, e.seq), lastSeq);
  } else if (state.events.some((e) => e.type === 'inventor' && e.seq > lastSeq)) {
    initBoard($('board'), state.board, state.mode === 'ck'); // 发明家换了数字令牌，重建棋盘
  }
  show('screen-game');
  updateSpectatorUI();

  // 本批新事件里若有掷骰：先单独播放骰子动画，随后所有结算推迟到动画结束
  const diceEvent = state.events.find((e) => e.type === 'dice' && e.seq > lastSeq);
  if (diceEvent) {
    lastSeq = diceEvent.seq;
    animateDiceRoll(diceEvent.dice[0], diceEvent.dice[1], diceEvent.eventDie);
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
  if (isSpectating) {
    exitSpectate('游戏已结束，观战完毕');
    return;
  }
  boardReady = false;   // 下一局需重新 initBoard
  lastSeq = 0;
  lastLogSeq = 0;
  $('log-list').innerHTML = '';
  S = null;
  prevHand = null;
  armed = null;
  discardOpen = false;
  holdUntil = 0;
  clearTimeout(holdTimer);
  for (const m of ['modal-winner', 'modal-discard', 'modal-steal', 'modal-trade',
    'modal-yop', 'modal-monopoly', 'modal-endgame', 'modal-aqueduct',
    'modal-alchemist', 'modal-pick', 'modal-knightmenu']) {
    $(m).classList.add('hidden');
  }
  cancelProgAction();
  $('aqueduct-btns').innerHTML = '';
  show('screen-lobby');
  toast('房主已结束本局，回到等待大厅');
});

const colors = () => S.players.map((p) => p.color);
const isMyTurn = () => S.phase === 'play' && S.turn.player === myIndex;
const isMySetup = () => S.phase === 'setup' && S.setup.current === myIndex;
const amHost = () => !!S && S.hostIndex === myIndex;

function updateSpectatorUI() {
  const hide = isSpectating;
  $('hand-cards').classList.toggle('hidden', hide);
  $('dev-cards').classList.toggle('hidden', hide);
  $('action-buttons').classList.toggle('hidden', hide);
  $('bottom-bar').classList.toggle('spectating', hide);
  $('btn-spec-leave').classList.toggle('hidden', !hide);
  // 观战状态前缀由 renderStatus 统一处理（这里加会被下一次渲染覆盖）
}

function renderAll() {
  updatePieces(S, colors());
  if (S.mode === 'ck') updateCKPieces(S, colors(), onKnightClick);
  renderStatus();
  renderBarbBar();
  renderPlayers();
  renderHand();
  renderDevCards();
  renderButtons();
  renderHotspots();
  renderLog();
  renderModals();
  renderDevPanel();
  renderTradeBanner();
}

// ---------- 野蛮人航道（画在棋盘海面上，见 render.js） ----------
function renderBarbBar() {
  if (S.mode !== 'ck' || S.phase === 'setup') {
    updateBarbarianTrack(null);
    updateProgressDecks(null);
    updateImproveBoard(null);
    return;
  }
  const strength = Object.values(S.buildings).filter((b) => b.type === 'city').length;
  const defense = Object.values(S.ck.knights).filter((k) => k.active)
    .reduce((s, k) => s + k.level, 0);
  updateBarbarianTrack(S.ck, strength, defense);
  updateProgressDecks(S.ck.decks);
  // 观战者没有自己的升级数据（S.players[-1] 不存在），不渲染升级轨道
  if (myIndex < 0) {
    updateImproveBoard(null);
    return;
  }
  const canAct = isMyTurn() && S.turn.state === 'main';
  const craneOn = canAct && S.ck.crane;
  // 官方规则：没有城市时不能购买城市升级（已有等级保留）
  const hasCity = Object.values(S.buildings).some((b) => b.player === myIndex && b.type === 'city');
  updateImproveBoard({
    tracks: Object.fromEntries(TRACKS.map((t) => {
      const lvl = S.players[myIndex].improvements[t];
      const maxed = lvl >= 5;
      const cost = maxed ? 0 : Math.max(0, lvl + 1 - (craneOn ? 1 : 0));
      const have = S.you.hand[TRACK_META[t].com];
      const metro = S.ck.metropolis[t];
      return [t, {
        lvl,
        maxed,
        cost,
        have,
        crane: craneOn && !maxed,
        canBuy: canAct && !maxed && hasCity && have >= cost,
        noCity: !hasCity,
        metroName: metro ? S.players[metro.player].name : null,
        metroMine: metro?.player === myIndex,
      }];
    })),
  }, (t) => send({ type: 'buyImprovement', track: t }));
}

function renderStatus() {
  const cur = S.players[S.turn.player];
  let text = '';
  if (S.phase === 'setup') {
    const p = S.players[S.setup.current];
    const what = S.setup.awaiting === 'settlement'
      ? (S.setup.building === 'city' ? '城市' : '村庄') : '道路';
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
    else if (st === 'aqueduct') {
      const names = S.ck.pendingAqueduct.map((i) => S.players[i].name).join('、');
      text = S.ck.pendingAqueduct.includes(myIndex) ? '🚰 引水渠：请任选 1 张资源' : `等待引水渠选择：${names}`;
    } else if (st === 'barbarianLoss') {
      const names = S.ck.pendingCityLoss.map((i) => S.players[i].name).join('、');
      text = S.ck.pendingCityLoss.includes(myIndex)
        ? '💥 野蛮人来袭！请点击你的一座城市（将被摧毁）'
        : `野蛮人来袭！等待 ${names} 选择被摧毁的城市…`;
    } else if (st === 'displace') {
      const d = S.ck.displace;
      if (d.reason === 'deserter') {
        text = d.owner === myIndex
          ? `🏇 逃兵：请点击位置放置获得的 ${d.level} 级骑士`
          : `等待 ${S.players[d.owner].name} 放置获得的骑士…`;
      } else {
        text = d.owner === myIndex
          ? '⚔️ 你的骑士被驱逐！请点击新位置安置'
          : `等待 ${S.players[d.owner].name} 安置被驱逐的骑士…`;
      }
    } else if (st === 'deserterPick') {
      const d = S.ck.deserter;
      text = d.target === myIndex
        ? '🏳️ 逃兵！请点击你要交出的骑士'
        : `等待 ${S.players[d.target].name} 选择叛逃的骑士…`;
    } else if (st === 'metropolis') {
      text = isMyTurn() ? '🏛️ 请点击一座城市建立大都会' : `${cur.name} 正在选择大都会城市…`;
    } else if (st === 'pickCards') {
      text = isMyTurn()
        ? `🃏 商业大亨：请从对方手牌中拿 ${S.ck.pick.count} 张`
        : `${cur.name} 正在拿取 ${S.players[S.ck.pick.from].name} 的手牌…`;
    } else if (st === 'pickProgress') {
      text = isMyTurn() ? '🎴 间谍：请选择要偷的进步卡' : `${cur.name} 正在查看 ${S.players[S.ck.pick.from].name} 的进步卡…`;
    } else if (st === 'wedding') {
      const names = Object.keys(S.ck.pendingGive).map((i) => S.players[i].name).join('、');
      text = S.ck.pendingGive[myIndex]
        ? `💒 婚礼：请选 ${S.ck.pendingGive[myIndex]} 张牌送给 ${cur.name}`
        : `婚礼！等待 ${names} 送礼…`;
    } else if (st === 'defenderPick') {
      const names = S.ck.pendingDefenderPick.map((i) => S.players[i].name).join('、');
      text = S.ck.pendingDefenderPick.includes(myIndex)
        ? '🛡️ 防御并列第一！请选一种颜色的进步卡'
        : `防御成功！等待 ${names} 选择进步卡…`;
    } else if (st === 'harbor') {
      const h = S.ck.harbor;
      if (h.stage === 'give') {
        text = isMyTurn() ? `⚓ 商业港：选 1 张资源交给 ${S.players[h.current].name}` : `${cur.name} 正在选择交换的资源…`;
      } else {
        text = h.current === myIndex ? `⚓ 商业港：选 1 张商品交给 ${cur.name}` : `等待 ${S.players[h.current].name} 返还商品…`;
      }
    } else text = isMyTurn() ? '你的回合：建造、交易或结束回合' : `${cur.name} 的回合`;
  }
  $('status-text').textContent = (isSpectating ? '👁️ ' : '') + text;

  // ck：第一颗是红骰（与事件骰城门配合决定进步卡派发）；setDie 依赖该类，需先设置
  $('die1').classList.toggle('red-die', S.mode === 'ck');
  $('die1').title = S.mode === 'ck' ? '红骰：掷出城门时决定谁获得进步卡' : '';
  if (S.turn.dice) {
    $('dice-box').classList.remove('hidden');
    // 骰子动画播放期间不提前显示最终点数
    if (Date.now() >= diceAnimUntil) {
      setDie($('die1'), S.turn.dice[0]);
      setDie($('die2'), S.turn.dice[1]);
      if (S.mode === 'ck' && S.ck.eventDie) setEventDie($('die3'), S.ck.eventDie);
    }
  } else if (Date.now() >= diceAnimUntil) {
    $('dice-box').classList.add('hidden');
  }
  $('die3').classList.toggle('hidden', S.mode !== 'ck');
}

function setEventDie(el, face) {
  const f = EVENT_FACE[face];
  // 只换骰面配色类，保留 rolling/settle 动画类
  for (const key of Object.keys(EVENT_FACE)) el.classList.remove(EVENT_FACE[key].cls);
  el.classList.add(f.cls);
  el.textContent = f.icon;
  el.title = f.name;
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
    const ckMode = S.mode === 'ck';
    const badges = [];
    if (S.awards.longestRoad?.player === i) badges.push('<span class="badge">🛤️ 最长道路</span>');
    if (!ckMode && S.awards.largestArmy?.player === i) badges.push('<span class="badge">⚔️ 最大军队</span>');
    if (ckMode) {
      for (const t of TRACKS) {
        if (S.ck.metropolis[t]?.player === i) badges.push(`<span class="badge">🏛️ ${TRACK_META[t].name}大都会</span>`);
      }
      if (S.ck.merchant?.player === i) badges.push('<span class="badge">⛺ 商人</span>');
      if (p.defenderVP > 0) badges.push(`<span class="badge">🏅 守护者×${p.defenderVP}</span>`);
    }
    const ckStats = ckMode
      ? `<span title="城市升级：贸易/政治/科学">${TRACKS.map((t) => `<b style="color:${TRACK_META[t].color}">${TRACK_META[t].name[0]}${p.improvements[t]}</b>`).join(' ')}</span>`
      : `<span title="已出骑士">⚔️ ${p.knightsPlayed}</span>`;
    div.innerHTML = `
      <div class="p-name">
        <span>${esc(p.name)}${i === myIndex ? '（我）' : ''}${p.connected ? '' : ' <span class="offline">离线</span>'}</span>
        <span class="vp-big">${i === myIndex ? S.you.vpTotal : p.vp} 分</span>
      </div>
      <div class="p-stats">
        <span title="手牌">🃏 ${p.handCount}</span>
        <span title="${ckMode ? '进步卡' : '发展卡'}">🎴 ${p.devCount}</span>
        ${ckStats}
        ${badges.join('')}
      </div>`;
    panel.appendChild(div);
  });
}

function renderHand() {
  const wrap = $('hand-cards');
  wrap.innerHTML = '';
  for (const r of cardList()) {
    const n = S.you.hand[r];
    const div = document.createElement('div');
    div.className = `res-card res-${r}`;
    // 资源与商品卡面都是插画（CSS 背景图）
    div.innerHTML = `<span class="cnt">${n}</span>`;
    div.title = `${RES_META[r].name} ×${n}（银行汇率 ${S.you.rates[r]}:1）`;
    if (prevHand && n > (prevHand[r] || 0)) div.classList.add('bump');
    attachCardInspect(div, () => ({
      img: `/assets/opt/resource-${r}.webp`,
      name: RES_META[r].name,
      sub: `×${S.you.hand[r]} · 银行汇率 ${S.you.rates[r]}:1`,
    }));
    wrap.appendChild(div);
  }
  prevHand = { ...S.you.hand };
}

function renderDevCards() {
  const wrap = $('dev-cards');
  wrap.innerHTML = '';
  if (S.mode === 'ck') {
    renderProgressCards(wrap);
    return;
  }
  const groups = {};
  for (const c of S.you.devCards) {
    if (c.played) continue;
    if (!groups[c.type]) groups[c.type] = { total: 0, playable: 0 };
    groups[c.type].total++;
    if (c.playable) groups[c.type].playable++;
  }
  for (const [type, g] of Object.entries(groups)) {
    const btn = document.createElement('button');
    btn.className = `dev-card t-${type}`;
    btn.innerHTML = `<small>${DEV_META[type].name}${g.total > 1 ? `×${g.total}` : ''}</small>`;
    const canPlay = g.playable > 0 && isMyTurn() && !S.turn.devPlayed
      && (type === 'knight'
        ? ['preroll', 'main'].includes(S.turn.state)
        : S.turn.state === 'main');
    btn.disabled = !canPlay || type === 'vp';
    if (type === 'vp') btn.title = '分数卡：保留在手中，计入总分';
    btn.onclick = () => playDevCard(type);
    attachCardInspect(btn, () => ({
      img: `/assets/opt/dev-${DEV_ASSET[type]}.webp`,
      name: `${DEV_META[type].name}${g.total > 1 ? ` ×${g.total}` : ''}`,
      desc: DEV_META[type].desc,
      boxed: true,
    }));
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

// ---------- 进步卡（城市与骑士） ----------
function renderProgressCards(wrap) {
  const groups = {};
  for (const c of S.you.progressCards) {
    const key = c.type;
    if (!groups[key]) groups[key] = { deck: c.deck, n: 0 };
    groups[key].n++;
  }
  for (const [type, g] of Object.entries(groups)) {
    const btn = document.createElement('button');
    btn.className = `dev-card prog-card prog-${g.deck}`;
    btn.innerHTML = `<small>${PROG_META[type].name}${g.n > 1 ? `×${g.n}` : ''}</small>`;
    btn.title = PROG_META[type].desc;
    const st = S.turn.state;
    const canPlay = isMyTurn() && (type === 'alchemist' ? st === 'preroll' : st === 'main');
    btn.disabled = !canPlay;
    btn.onclick = () => playProgressCard(type);
    attachCardInspect(btn, () => ({
      img: `/assets/opt/progress-${type}.webp`,
      name: `${PROG_META[type].name}${g.n > 1 ? ` ×${g.n}` : ''}`,
      desc: PROG_META[type].desc,
      boxed: true,
    }));
    wrap.appendChild(btn);
  }
}

const sendProg = (card, payload = {}) => send({ type: 'playProgress', card, payload });

function playProgressCard(type) {
  cancelProgAction();
  switch (type) {
    // 直接生效
    case 'warlord': case 'crane': case 'irrigation': case 'mining':
    case 'commercialHarbor': case 'wedding': case 'saboteur': case 'roadBuilding':
      sendProg(type);
      break;
    // 选一种牌
    case 'merchantFleet':
      openPickModal('商船队：选择 2:1 的牌', cardList().map(cardOption((r) => sendProg(type, { res: r }))));
      break;
    case 'resourceMonopoly':
      openPickModal('资源垄断：选择资源', RES.map(cardOption((r) => sendProg(type, { res: r }))));
      break;
    case 'tradeMonopoly':
      openPickModal('商品垄断：选择商品', COM.map(cardOption((r) => sendProg(type, { res: r }))));
      break;
    // 选一名玩家
    case 'spy': {
      const opts = S.players.map((p, i) => ({ i, p })).filter(({ i, p }) => i !== myIndex && p.devCount > 0)
        .map(({ i, p }) => ({ label: `${p.name}（${p.devCount} 张进步卡）`, onPick: () => sendProg(type, { target: i }) }));
      if (opts.length === 0) return toast('没有持有进步卡的对手');
      openPickModal('间谍：选择目标', opts);
      break;
    }
    case 'masterMerchant': {
      const myVp = S.you.vpTotal;
      const opts = S.players.map((p, i) => ({ i, p })).filter(({ i, p }) => i !== myIndex && p.vp > myVp)
        .map(({ i, p }) => ({ label: `${p.name}（${p.vp} 分，${p.handCount} 张手牌）`, onPick: () => sendProg(type, { target: i }) }));
      if (opts.length === 0) return toast('没有分数比你高的玩家');
      openPickModal('商业大亨：选择目标', opts);
      break;
    }
    // 棋盘交互
    case 'bishop':
      startProgAction(type, '主教：点击强盗的新位置');
      break;
    case 'merchant':
      if (!(S.you.hints.merchantHexes || []).length) return toast('没有可放置商人的板块');
      startProgAction(type, '商人：点击自己建筑相邻的板块');
      break;
    case 'inventor':
      startProgAction(type, '发明家：点击第一块板块（数字 3/4/5/9/10/11）');
      break;
    case 'medicine': {
      const mine = Object.keys(S.buildings).filter((v) => S.buildings[v].player === myIndex && S.buildings[v].type === 'settlement');
      if (mine.length === 0) return toast('没有可升级的村庄');
      startProgAction(type, '医学：点击要升级的村庄（2矿 1麦）');
      break;
    }
    case 'engineer':
      if (!(S.you.hints.wallSpots || []).length) return toast('没有可修城墙的城市');
      startProgAction(type, '工程师：点击要修城墙的城市');
      break;
    case 'diplomat':
      if (!(S.you.hints.openRoads || []).length) return toast('场上没有开放道路');
      startProgAction(type, '外交官：点击要移除的开放道路');
      break;
    case 'intrigue':
      if (!(S.you.hints.intrigueKnights || []).length) return toast('你的道路上没有对手骑士');
      startProgAction(type, '阴谋：点击你道路上的对手骑士');
      break;
    case 'deserter': {
      const targets = S.players.map((_, i) => i).filter((i) => i !== myIndex
        && Object.values(S.ck.knights).some((k) => k.player === i));
      if (!targets.length) return toast('对手没有骑士');
      openPickModal('逃兵：指定一名对手（由对方选择叛逃的骑士）', targets.map((i) => ({
        label: `${esc(S.players[i].name)}（${Object.values(S.ck.knights).filter((k) => k.player === i).length} 名骑士）`,
        onPick: () => sendProg('deserter', { target: i }),
      })));
      break;
    }
    case 'smith': {
      const upgradable = Object.entries(S.you.hints.myKnights || {}).filter(([, k]) => k.upgrade);
      if (upgradable.length === 0) return toast('没有可升级的骑士');
      startProgAction(type, '铁匠：点击 1-2 名自己的骑士，然后确认', { confirm: true });
      break;
    }
    case 'alchemist':
      openAlchemist();
      break;
    default:
      break;
  }
}

// 多步进步卡的客户端状态机：{card, step, data, confirm}
let progAction = null;
function startProgAction(card, tip, opts = {}) {
  progAction = { card, step: 0, data: {}, sel: [], ...opts };
  $('prog-banner-text').textContent = tip;
  $('prog-confirm').classList.toggle('hidden', !opts.confirm);
  $('prog-confirm').disabled = true;
  $('prog-banner').classList.remove('hidden');
  renderHotspots();
}
function cancelProgAction() {
  progAction = null;
  $('prog-banner').classList.add('hidden');
  if (S) renderHotspots();
}
$('prog-cancel').onclick = () => cancelProgAction();
$('prog-confirm').onclick = () => {
  if (progAction?.card === 'smith' && progAction.sel.length >= 1) {
    const vs = [...progAction.sel];
    cancelProgAction();
    sendProg('smith', { vertices: vs });
  }
};

// 通用选择弹窗（进步卡：选牌 / 选玩家）；forced 时不可取消（必须选）
function openPickModal(title, options, { forced = false } = {}) {
  $('pick-modal-title').textContent = title;
  const box = $('pick-modal-btns');
  box.innerHTML = '';
  for (const o of options) {
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.innerHTML = o.label;
    b.onclick = () => {
      $('modal-pick').classList.add('hidden');
      o.onPick();
    };
    box.appendChild(b);
  }
  document.querySelector('#modal-pick .modal-close').classList.toggle('hidden', forced);
  $('modal-pick').classList.remove('hidden');
}
const cardOption = (fn) => (r) => ({ label: `${resIcon(r)} ${RES_META[r].name}`, onPick: () => fn(r) });

// 炼金术士：两个 1-6 选择器
let alchSel = [null, null];
function openAlchemist() {
  alchSel = [null, null];
  const box = $('alchemist-picks');
  box.innerHTML = '';
  [0, 1].forEach((di) => {
    const col = document.createElement('div');
    col.className = 'alch-col';
    col.innerHTML = `<p class="trade-label small">${di === 0 ? '红骰（决定进步卡）' : '黄骰'}</p>`;
    const row = document.createElement('div');
    row.className = 'alch-btns';
    for (let n = 1; n <= 6; n++) {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = n;
      b.onclick = () => {
        alchSel[di] = n;
        for (const x of row.children) x.classList.remove('active');
        b.classList.add('active');
        $('alchemist-confirm').disabled = alchSel.some((v) => v === null);
      };
      row.appendChild(b);
    }
    col.appendChild(row);
    box.appendChild(col);
  });
  $('alchemist-confirm').disabled = true;
  $('modal-alchemist').classList.remove('hidden');
}
$('alchemist-confirm').onclick = () => {
  $('modal-alchemist').classList.add('hidden');
  sendProg('alchemist', { d1: alchSel[0], d2: alchSel[1] });
};

// ---------- 城市升级面板 ----------

function renderButtons() {
  const my = isMyTurn();
  const main = my && S.turn.state === 'main';
  const hand = S.you.hand;
  const ckMode = S.mode === 'ck';
  $('btn-roll').disabled = !(my && S.turn.state === 'preroll');
  $('btn-road').disabled = !(main && hand.wood >= 1 && hand.brick >= 1 && (S.you.hints.roads || []).length > 0);
  $('btn-settlement').disabled = !(main && hand.wood >= 1 && hand.brick >= 1 && hand.sheep >= 1 && hand.wheat >= 1 && (S.you.hints.settlements || []).length > 0);
  $('btn-city').disabled = !(main && hand.wheat >= 2 && hand.ore >= 3 && (S.you.hints.cities || []).length > 0);
  $('btn-buydev').classList.toggle('hidden', ckMode);
  $('btn-buydev').disabled = !(main && hand.sheep >= 1 && hand.wheat >= 1 && hand.ore >= 1 && S.bank.devDeck > 0);
  $('btn-knight').classList.toggle('hidden', !ckMode);
  $('btn-wall').classList.toggle('hidden', !ckMode);
  if (ckMode) {
    $('btn-knight').disabled = !(main && hand.sheep >= 1 && hand.ore >= 1 && (S.you.hints.knightSpots || []).length > 0);
    $('btn-wall').disabled = !(main && hand.brick >= 2 && (S.you.hints.wallSpots || []).length > 0);
  }
  $('btn-trade').disabled = !main;
  $('btn-end').disabled = !main;

  for (const [id, kind] of [['btn-road', 'road'], ['btn-settlement', 'settlement'], ['btn-city', 'city'], ['btn-knight', 'knight'], ['btn-wall', 'wall']]) {
    $(id).classList.toggle('armed', armed === kind);
  }

  // 房主随时可结束本局
  $('btn-endgame').classList.toggle('hidden', !amHost());
}

// ---------- 热点交互 ----------
// 悬停放置点时显示的半透明预览棋子（自己的颜色）
const ghostOf = (kind) => ({ kind, color: S.players[myIndex].color });

function renderHotspots() {
  if (isMySetup()) {
    if (S.setup.awaiting === 'settlement') {
      showVertexSpots(S.you.hints.settlements || [], (v) => send({ type: 'setupSettlement', vertex: v }), ghostOf(S.setup.building || 'settlement'));
    } else {
      showEdgeSpots(S.you.hints.roads || [], (e) => send({ type: 'setupRoad', edge: e }), ghostOf('road'));
    }
    return;
  }
  // 野蛮人毁城：轮到谁选都要显示（不一定是当前回合玩家）
  if (S.turn.state === 'barbarianLoss' && (S.you.hints.cityLoss || []).length) {
    showVertexSpots(S.you.hints.cityLoss, (v) => send({ type: 'chooseCityLoss', vertex: v }));
    return;
  }
  // 被驱逐骑士安置：同样可能不是当前回合玩家
  if (S.turn.state === 'displace' && (S.you.hints.displaceSpots || []).length) {
    showVertexSpots(S.you.hints.displaceSpots, (v) => send({ type: 'placeDisplaced', vertex: v }));
    return;
  }
  // 逃兵：受害者点选交出的骑士（非当前回合玩家）
  if (S.turn.state === 'deserterPick' && (S.you.hints.deserterKnights || []).length) {
    showVertexSpots(S.you.hints.deserterKnights, (v) => send({ type: 'deserterPick', vertex: v }));
    return;
  }
  if (isMyTurn()) {
    const st = S.turn.state;
    if (st === 'metropolis') {
      showVertexSpots(S.you.hints.metroSpots || [], (v) => send({ type: 'chooseMetropolis', vertex: v }));
      return;
    }
    if (st === 'robber') {
      showRobberSpots(S.robber, (h) => send({ type: 'moveRobber', hex: h }));
      return;
    }
    if (st === 'roadbuilding') {
      showEdgeSpots(S.you.hints.roads || [], (e) => send({ type: 'buildRoad', edge: e }), ghostOf('road'));
      return;
    }
    if (st === 'main' && progAction) {
      renderProgSpots();
      return;
    }
    if (st === 'main' && armed) {
      if (armed === 'road') {
        showEdgeSpots(S.you.hints.roads || [], (e) => { armed = null; send({ type: 'buildRoad', edge: e }); }, ghostOf('road'));
      } else if (armed === 'settlement') {
        showVertexSpots(S.you.hints.settlements || [], (v) => { armed = null; send({ type: 'buildSettlement', vertex: v }); }, ghostOf('settlement'));
      } else if (armed === 'city') {
        showVertexSpots(S.you.hints.cities || [], (v) => { armed = null; send({ type: 'buildCity', vertex: v }); }, ghostOf('city'));
      } else if (armed === 'knight') {
        showVertexSpots(S.you.hints.knightSpots || [], (v) => { armed = null; send({ type: 'buildKnight', vertex: v }); });
      } else if (armed === 'wall') {
        showVertexSpots(S.you.hints.wallSpots || [], (v) => { armed = null; send({ type: 'buildWall', vertex: v }); });
      }
      return;
    }
  }
  clearHotspots();
}

// 多步进步卡当前步骤的可点目标
function renderProgSpots() {
  const pa = progAction;
  if (!pa) return;
  switch (pa.card) {
    case 'bishop':
      showRobberSpots(S.robber, (h) => { cancelProgAction(); sendProg('bishop', { hex: h }); });
      break;
    case 'merchant':
      showHexSpots(S.you.hints.merchantHexes || [], (h) => { cancelProgAction(); sendProg('merchant', { hex: h }); });
      break;
    case 'inventor': {
      const ok = S.board.hexes.filter((h) => [3, 4, 5, 9, 10, 11].includes(h.number)).map((h) => h.id);
      if (pa.step === 0) {
        showHexSpots(ok, (h) => {
          pa.step = 1;
          pa.data.h1 = h;
          $('prog-banner-text').textContent = '发明家：点击第二块板块';
          showHexSpots(ok.filter((x) => x !== h), (h2) => { cancelProgAction(); sendProg('inventor', { h1: h, h2 }); });
        });
      }
      break;
    }
    case 'medicine': {
      const mine = Object.keys(S.buildings)
        .filter((v) => S.buildings[v].player === myIndex && S.buildings[v].type === 'settlement')
        .map(Number);
      showVertexSpots(mine, (v) => { cancelProgAction(); sendProg('medicine', { vertex: v }); }, ghostOf('city'));
      break;
    }
    case 'engineer':
      showVertexSpots(S.you.hints.wallSpots || [], (v) => { cancelProgAction(); sendProg('engineer', { vertex: v }); });
      break;
    case 'diplomat':
      showEdgeSpots(S.you.hints.openRoads || [], (e) => { cancelProgAction(); sendProg('diplomat', { edge: e }); });
      break;
    case 'intrigue':
    case 'smith':
      clearHotspots(); // 点击骑士棋子完成
      break;
    default:
      clearHotspots();
  }
}

// 骑士棋子被点击：优先交给进行中的进步卡流程，否则打开自己骑士的操作菜单
function onKnightClick(v, k) {
  if (progAction && isMyTurn()) {
    const pa = progAction;
    if (pa.card === 'intrigue' && (S.you.hints.intrigueKnights || []).includes(v)) {
      cancelProgAction();
      sendProg('intrigue', { vertex: v });
      return;
    }
    if (pa.card === 'smith' && k.player === myIndex) {
      const hint = (S.you.hints.myKnights || {})[v];
      if (!hint?.upgrade) return toast('该骑士本回合不能升级');
      const i = pa.sel.indexOf(v);
      if (i >= 0) pa.sel.splice(i, 1);
      else if (pa.sel.length < 2) pa.sel.push(v);
      $('prog-banner-text').textContent = `铁匠：已选 ${pa.sel.length} 名骑士（可选 1-2 名）`;
      $('prog-confirm').disabled = pa.sel.length < 1;
      return;
    }
    return;
  }
  if (k.player !== myIndex || !isMyTurn() || S.turn.state !== 'main') return;
  openKnightMenu(v, k);
}

// 自己骑士的操作菜单
function openKnightMenu(v, k) {
  const hint = (S.you.hints.myKnights || {})[v];
  if (!hint) return;
  $('knightmenu-title').textContent = `⚔️ ${k.level} 级骑士（${k.active ? '已激活' : '未激活'}）`;
  const box = $('knightmenu-btns');
  box.innerHTML = '';
  const hand = S.you.hand;
  const addBtn = (label, enabled, fn, tip = '') => {
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.innerHTML = label;
    b.disabled = !enabled;
    if (tip) b.title = tip;
    b.onclick = () => {
      $('modal-knightmenu').classList.add('hidden');
      fn();
    };
    box.appendChild(b);
  };
  if (hint.activate) {
    addBtn(`🔥 激活（1 ${resIcon('wheat')}）`, hand.wheat >= 1,
      () => send({ type: 'activateKnight', vertex: v }));
  }
  addBtn(`⬆️ 升级（1 ${resIcon('sheep')} 1 ${resIcon('ore')}）`,
    hint.upgrade && hand.sheep >= 1 && hand.ore >= 1,
    () => send({ type: 'upgradeKnight', vertex: v }),
    hint.upgrade ? '' : '本回合招募/已升级过、等级或政治等级不足时不能升级');
  const targets = [...(hint.moves || []), ...(hint.displaces || [])];
  addBtn('🚶 移动', targets.length > 0, () => {
    showVertexSpots(targets, (to) => send({ type: 'moveKnight', from: v, to }));
  }, k.active ? '沿自己的道路移动（可驱逐低级敌方骑士）' : '需要先激活，激活当回合不能行动');
  addBtn('🦹 驱逐强盗', !!hint.chase, () => send({ type: 'chaseRobber', vertex: v }),
    '骑士需已激活、与强盗相邻，且野蛮人已来袭过');
  $('modal-knightmenu').classList.remove('hidden');
}

for (const [id, kind] of [['btn-road', 'road'], ['btn-settlement', 'settlement'], ['btn-city', 'city'], ['btn-knight', 'knight'], ['btn-wall', 'wall']]) {
  $(id).onclick = () => {
    cancelProgAction();
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
// 按服务端的日志 seq 增量渲染（发送的是最近 60 条的滑动窗口，不能按数组下标对齐）
let lastLogSeq = 0;
function renderLog() {
  let appended = false;
  for (const entry of S.log) {
    if (entry.seq <= lastLogSeq) continue;
    lastLogSeq = entry.seq;
    appendLog(esc(entry.text), false);
    appended = true;
  }
  if (appended) $('log-list').scrollTop = $('log-list').scrollHeight;
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
  for (const r of cardList()) {
    const div = document.createElement('div');
    div.className = 'res-picker';
    div.innerHTML = `
      <div class="rp-card res-${r}" title="${RES_META[r].name}"><span class="rp-cnt">${sel[r] || 0}</span></div>
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
// 状态驱动的选牌弹窗内容：返回 {title, options} 或 null
let statePickOpen = false;
function statePickSpec() {
  if (S.mode !== 'ck' || S.phase !== 'play') return null;
  const st = S.turn.state;
  const H = S.you.hints;
  const opt = (r, n, msg) => ({
    label: `${resIcon(r)} ${RES_META[r].name}${n > 1 ? ` ×${n}` : ''}`,
    onPick: () => send(msg),
  });
  if (st === 'pickCards' && isMyTurn() && H.pickHand) {
    return {
      title: `商业大亨：从 ${S.players[S.ck.pick.from].name} 的手牌中拿取（还差 ${S.ck.pick.count} 张）`,
      options: cardList().filter((r) => H.pickHand[r] > 0)
        .map((r) => opt(r, H.pickHand[r], { type: 'pickCard', card: r })),
    };
  }
  if (st === 'pickProgress' && isMyTurn() && H.pickList) {
    return {
      title: `间谍：偷取 ${S.players[S.ck.pick.from].name} 的一张进步卡`,
      options: H.pickList.map((t) => ({
        label: PROG_META[t].name,
        onPick: () => send({ type: 'pickProgress', card: t }),
      })),
    };
  }
  if (st === 'wedding' && H.weddingGive) {
    return {
      title: `婚礼：选 ${H.weddingGive} 张牌送给 ${S.players[S.turn.player].name}`,
      options: cardList().filter((r) => S.you.hand[r] > 0)
        .map((r) => opt(r, S.you.hand[r], { type: 'weddingGive', card: r })),
    };
  }
  if (st === 'defenderPick' && H.defenderPick) {
    return {
      title: '防御并列第一：选一种颜色抽 1 张进步卡',
      options: TRACKS.filter((t) => S.ck.decks[t] > 0).map((t) => ({
        label: `${resIcon(TRACK_META[t].com)} ${TRACK_META[t].name}（剩 ${S.ck.decks[t]} 张）`,
        onPick: () => send({ type: 'defenderPick', deck: t }),
      })),
    };
  }
  if (st === 'harbor' && S.ck.harbor) {
    const h = S.ck.harbor;
    if (h.stage === 'give' && isMyTurn() && H.harborGive) {
      return {
        title: `商业港：选 1 张资源交给 ${S.players[h.current].name}`,
        options: RES.filter((r) => S.you.hand[r] > 0)
          .map((r) => opt(r, S.you.hand[r], { type: 'harborGive', res: r })),
      };
    }
    if (h.stage === 'take' && h.current === myIndex && H.harborTake) {
      return {
        title: `商业港：选 1 张商品交给 ${S.players[S.turn.player].name}`,
        options: COM.filter((r) => S.you.hand[r] > 0)
          .map((r) => opt(r, S.you.hand[r], { type: 'harborTake', com: r })),
      };
    }
  }
  return null;
}

function renderModals() {
  const needDiscard = S.turn.state === 'discard' && S.turn.pendingDiscards[myIndex];
  if (needDiscard && !discardOpen) {
    discardOpen = true;
    discardSel = {};
    $('discard-need').textContent = needDiscard;
    makePickers($('discard-pickers'), discardSel, S.you.hand, () => {
      const total = cardList().reduce((s, r) => s + (discardSel[r] || 0), 0);
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

  // 交互式选牌（商业大亨/间谍/婚礼/商业港）：状态驱动的强制选择
  const spec = statePickSpec();
  if (spec) {
    openPickModal(spec.title, spec.options, { forced: true });
    statePickOpen = true;
  } else if (statePickOpen) {
    statePickOpen = false;
    $('modal-pick').classList.add('hidden');
  }

  // 引水渠：任选 1 张资源
  const aqueduct = S.mode === 'ck' && S.turn.state === 'aqueduct' && S.ck.pendingAqueduct.includes(myIndex);
  $('modal-aqueduct').classList.toggle('hidden', !aqueduct);
  if (aqueduct && !$('aqueduct-btns').childElementCount) {
    const box = $('aqueduct-btns');
    for (const r of RES) {
      const b = document.createElement('button');
      b.className = 'btn primary';
      b.innerHTML = `${resIcon(r)} ${RES_META[r].name}`;
      b.onclick = () => send({ type: 'aqueductPick', res: r });
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
    for (const r of cardList()) {
      const b = document.createElement('button');
      b.className = `res-${r}`;
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
  const fmt = (m) => cardList().filter((r) => m[r]).map((r) => `${m[r]}${resIcon(r)}`).join(' ') || '无';
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
    b.innerHTML = `${resIcon(r)} ${RES_META[r].name}`;
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
let lastDiceTotal = 0;       // 最近一次掷骰点数：产出飞卡动画据此反查产出地块

function animateDiceRoll(d1, d2, eventFace = null) {
  const total = d1 + d2;
  lastDiceTotal = total;
  diceAnimUntil = Date.now() + DICE_ROLL_MS;
  $('dice-box').classList.remove('hidden');
  const dies = [$('die1'), $('die2')];
  const evDie = $('die3');
  const evFaces = Object.keys(EVENT_FACE);
  dies[0].classList.toggle('red-die', !!eventFace);
  if (eventFace) evDie.classList.remove('hidden');
  for (const d of (eventFace ? [...dies, evDie] : dies)) {
    d.classList.remove('rolling', 'settle');
    void d.offsetWidth;
    d.classList.add('rolling');
  }
  clearInterval(diceRollTimer);
  const t0 = Date.now();
  diceRollTimer = setInterval(() => {
    if (Date.now() - t0 < DICE_ROLL_MS) {
      // 翻滚中显示随机骰面
      for (const d of dies) setDie(d, 1 + Math.floor(Math.random() * 6));
      if (eventFace) setEventDie(evDie, evFaces[Math.floor(Math.random() * evFaces.length)]);
      return;
    }
    clearInterval(diceRollTimer);
    setDie(dies[0], d1);
    setDie(dies[1], d2);
    if (eventFace) {
      setEventDie(evDie, eventFace);
      evDie.classList.remove('rolling');
      void evDie.offsetWidth;
      evDie.classList.add('settle');
    }
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
        const { player, res, n } = ev;
        setTimeout(() => {
          // 自己的产出：资源图标从产出地块飞进手牌；条件不满足时回落为飘字
          if (player !== myIndex || !flyResourceFromHex(res, n)) {
            floatOverPlayer(player, `+${n} ${resIcon(res)}`);
          }
        }, d);
        delay += GAIN_STAGGER_MS;
        break;
      }
      case 'steal':
        floatOverPlayer(ev.to, '🕵️ +1');
        floatOverPlayer(ev.from, '−1 🃏');
        break;
      case 'monopoly':
        floatOverPlayer(ev.player, `💰 +${ev.n} ${resIcon(ev.res)}`);
        break;
      case 'trade':
        floatOverPlayer(ev.a, '🔄');
        floatOverPlayer(ev.b, '🔄');
        break;
      case 'turnEnd':
        showTurnBanner(ev.to);
        break;
      case 'robber':
        sfx.robber();
        break;
      // ---- 城市与骑士 ----
      case 'ship': {
        const d = delay;
        setTimeout(() => sfx.ship(), d);
        delay += 500; // 同批的来袭结算（barbarian）让号角先响完
        break;
      }
      case 'barbarian': {
        const d = delay;
        setTimeout(() => {
          sfx.barbarian(ev.win);
          showBarbarianBanner(ev);
        }, d);
        delay += 1200;
        break;
      }
      case 'pillage':
        floatOverPlayer(ev.player, '💥 城市被毁');
        break;
      case 'progress': {
        const d = delay;
        const { player, deck } = ev;
        setTimeout(() => {
          if (!flyProgressCard(deck, player)) floatOverPlayer(player, '🎴 +1');
        }, d);
        delay += 250;
        break;
      }
      case 'progressVP': {
        const d = delay;
        const { player, deck } = ev;
        setTimeout(() => {
          flyProgressCard(deck, player);
          floatOverPlayer(player, '📜 +1 分');
        }, d);
        delay += 250;
        break;
      }
      case 'defender':
        floatOverPlayer(ev.player, '🏅 卡坦守护者 +1 分');
        break;
      case 'metropolis':
        floatOverPlayer(ev.player, '🏛️ 大都会');
        break;
      case 'playProgress':
        flyProgressCard(ev.deck, ev.player, true); // 用掉的卡飞回牌堆底部
        floatOverPlayer(ev.player, `🎴 ${PROG_META[ev.card]?.name || ''}`);
        break;
      default:
        break;
    }
  }
}

// 野蛮人来袭的结果横幅（复用回合横幅样式）
function showBarbarianBanner(ev) {
  const banner = $('turn-banner');
  const inner = banner.querySelector('.turn-banner-inner');
  inner.textContent = ev.win
    ? `🛡️ 野蛮人被击退！（防御 ${ev.defense} ≥ 兵力 ${ev.strength}）`
    : `🔥 野蛮人洗劫卡坦！（防御 ${ev.defense} < 兵力 ${ev.strength}）`;
  inner.classList.remove('mine');
  inner.style.background = ev.win
    ? 'linear-gradient(135deg, #2e8b57e6, #1f6e42b0)'
    : 'linear-gradient(135deg, #8b2e2ee6, #6e1f1fb0)';
  inner.style.color = '#fff';
  inner.style.textShadow = '0 2px 6px rgba(0,0,0,.35)';
  banner.classList.remove('show');
  void banner.offsetWidth;
  banner.classList.add('show');
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => banner.classList.remove('show'), 4600);
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

// 产出飞卡：按掷骰点数反查产出该资源的地块，把资源图标从地块飞到底部对应手牌
const RES_TERRAIN = { wood: 'forest', brick: 'hills', sheep: 'pasture', wheat: 'fields', ore: 'mountains' };
function flyResourceFromHex(res, n) {
  if (!S || !lastDiceTotal) return false;
  const hexes = S.board.hexes.filter(
    (h) => h.number === lastDiceTotal && h.terrain === RES_TERRAIN[res] && h.id !== S.robber,
  );
  const card = document.querySelector(`#hand-cards .res-card.res-${res}`);
  if (!hexes.length || !card) return false;
  const rect = card.getBoundingClientRect();
  const ex = rect.left + rect.width / 2;
  const ey = rect.top + rect.height / 2;
  for (let i = 0; i < Math.min(n, 6); i++) {
    const from = hexPixelPosition(hexes[i % hexes.length].id, $('board'));
    if (!from) return false;
    const f = document.createElement('div');
    f.className = 'fly-res';
    f.innerHTML = resIcon(res); // .fly-res img 的尺寸规则会覆盖 .res-ico
    f.style.left = `${from.x}px`;
    f.style.top = `${from.y}px`;
    document.body.appendChild(f);
    const anim = f.animate([
      { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 1, offset: 0.2 },
      { transform: `translate(calc(${ex - from.x}px - 50%), calc(${ey - from.y}px - 50%)) scale(.6)`, opacity: .9 },
    ], { duration: 900, delay: i * 140, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'backwards' });
    anim.onfinish = () => {
      f.remove();
      // 到达时再顶一下手牌（renderHand 可能已重建卡片，按需重新查找）
      const c = document.querySelector(`#hand-cards .res-card.res-${res}`);
      if (c) {
        c.classList.remove('bump');
        void c.offsetWidth;
        c.classList.add('bump');
      }
    };
  }
  return true;
}

// 进步卡飞行动画：从棋盘上的牌堆飞向玩家面板（reverse 表示打出后飞回牌堆底）
function flyProgressCard(deck, playerIdx, reverse = false) {
  const meta = TRACK_META[deck];
  const deckPos = deckPixelPosition(deck, $('board'));
  const panel = $(`player-card-${playerIdx}`);
  if (!meta || !deckPos || !panel) return false;
  const r = panel.getBoundingClientRect();
  const panelPos = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const [from, to] = reverse ? [panelPos, deckPos] : [deckPos, panelPos];
  const f = document.createElement('div');
  f.className = 'fly-card';
  f.style.background = meta.color;
  f.textContent = RES_META[meta.com].icon;
  f.style.left = `${from.x}px`;
  f.style.top = `${from.y}px`;
  document.body.appendChild(f);
  const anim = f.animate([
    { transform: 'translate(-50%,-50%) scale(.5) rotate(-8deg)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.15) rotate(0deg)', opacity: 1, offset: 0.25 },
    { transform: `translate(calc(${to.x - from.x}px - 50%), calc(${to.y - from.y}px - 50%)) scale(.55) rotate(10deg)`, opacity: .85 },
  ], { duration: 950, easing: 'cubic-bezier(.45,.05,.55,.95)' });
  anim.onfinish = () => f.remove();
  return true;
}

// html 只拼接内部常量（图标 img / emoji / 数字），无用户输入
function floatOverPlayer(playerIdx, html) {
  const card = $(`player-card-${playerIdx}`);
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'floater';
  f.innerHTML = html;
  f.style.left = `${rect.left - 60 + Math.random() * 30}px`;
  // 垂直锚定在卡片中线，配合较小的上飘幅度，保证全程贴着自己的卡片
  f.style.top = `${rect.top + rect.height / 2 - 4}px`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 5000);
}
