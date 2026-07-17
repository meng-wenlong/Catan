// 中央舞台：Master Duel 式的关键事件全屏演出队列。
// 打出进步卡 / 野蛮人来袭 / 大都会等「关键时刻」依次在屏幕中央放大播放，
// 给玩家留出思绪缓冲；点击任意处跳过当前一幕。队列串行，信息不会同时涌出。
let stage = null;
let queue = [];
let playing = false;
let skipFn = null;

function ensureStage() {
  if (stage) return stage;
  stage = document.createElement('div');
  stage.id = 'spotlight';
  stage.addEventListener('click', () => skipFn && skipFn());
  document.body.appendChild(stage);
  return stage;
}

// item：
//  { kind:'card', img, title, name, desc, accent, dur, onShow, onDone }   打牌/抽分数卡（大卡面居中）
//  { kind:'banner', icon|img, title, sub, accent, dur, onShow, onDone }   大都会/守护者等公告
//  { kind:'barbarian', win, strength, defense, dur, onShow, onDone }      野蛮人来袭结算
// onDone：本幕结束（含点击跳过）时回调一次，动画时间线靠它串行推进后续步骤
export function spotlight(item) {
  queue.push(item);
  if (!playing) next();
}

// 清空未播的演出（回到大厅/换局时调用，避免上一局的画面串场）
export function clearSpotlight() {
  queue = [];
  if (skipFn) skipFn();
}

function next() {
  const item = queue.shift();
  if (!item) { playing = false; return; }
  playing = true;
  show(item);
}

const esc = (s) => {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
};

function show(item) {
  const st = ensureStage();
  st.innerHTML = '';
  st.className = `sp-${item.kind || 'banner'}`;
  st.style.setProperty('--sp-accent', item.accent || '#e6b345');

  if (item.kind === 'card') {
    st.innerHTML = `
      <div class="sp-scrim"></div>
      <div class="sp-stage">
        <div class="sp-title">${esc(item.title)}</div>
        <div class="sp-cardbox">
          <img class="sp-cardimg" src="${item.img}" alt="">
        </div>
        <div class="sp-info">
          <div class="sp-name">${esc(item.name)}</div>
          <div class="sp-desc">${esc(item.desc)}</div>
        </div>
      </div>`;
  } else if (item.kind === 'barbarian') {
    st.innerHTML = `
      <div class="sp-scrim heavy"></div>
      <div class="sp-stage">
        <img class="sp-ship" src="/assets/opt/barbarian-ship.webp" alt="">
        <div class="sp-title big">⚔️ 野蛮人来袭！</div>
        <div class="sp-vs">
          <span class="sp-side foe">🏰 兵力 <b>${item.strength}</b></span>
          <span class="sp-vs-x">VS</span>
          <span class="sp-side ally">⚔️ 防御 <b>${item.defense}</b></span>
        </div>
        <div class="sp-verdict ${item.win ? 'win' : 'lose'}">${item.win ? '🛡️ 击退！' : '🔥 洗劫！'}</div>
        <div class="sp-sub">${item.win ? '防御成功，出力最多的玩家获得嘉奖' : '防御出力最少的玩家将失去一座城市'}</div>
      </div>`;
  } else {
    // item.html：调用方自行拼好（并转义）的内容块，插在标题下方（交易明细等）
    st.innerHTML = `
      <div class="sp-scrim"></div>
      <div class="sp-stage">
        ${item.img ? `<img class="sp-bannerimg" src="${item.img}" alt="">`
    : `<div class="sp-bannerico">${item.icon || '📣'}</div>`}
        <div class="sp-title big">${esc(item.title)}</div>
        ${item.html || ''}
        ${item.sub ? `<div class="sp-sub">${esc(item.sub)}</div>` : ''}
      </div>`;
  }

  // 强制回流后再加 show，保证入场动画每次都播
  void st.offsetWidth;
  st.classList.add('show');
  item.onShow?.();

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    skipFn = null;
    st.classList.remove('show');
    st.classList.add('hide');
    item.onDone?.(); // 淡出即算结束：后续步骤与 280ms 淡出重叠衔接
    setTimeout(() => {
      st.className = '';
      st.innerHTML = '';
      next();
    }, 280);
  };
  skipFn = finish;
  setTimeout(finish, item.dur || 3200);
}
