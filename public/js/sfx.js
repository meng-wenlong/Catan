// 按钮音效：Web Audio 现场合成，无需音频文件（Safari 用 webkitAudioContext）
// Safari 两个坑，勿回退成"resume 后直接排程"的写法：
// 1. 新建的 AudioContext 处于 suspended，resume() 是异步的；挂起状态下排程的音会被 Safari 丢掉，
//    必须等 resume 完成后再按新的 currentTime 排程（Chrome 会宽容地补播，所以只有 Safari 无声）。
// 2. 需要在用户手势里先播一个静音 buffer「解锁」，之后才允许出声。
let ctx = null;
let unlocked = false;

// 音效总音量（0-1），由声音面板控制，持久化到 localStorage
let sfxVol = (() => {
  const v = parseFloat(localStorage.getItem('catan_sfx_vol'));
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
})();
export function setSfxVolume(v) {
  sfxVol = Math.max(0, Math.min(1, v));
  localStorage.setItem('catan_sfx_vol', String(sfxVol));
}
export function getSfxVolume() {
  return sfxVol;
}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function unlock(c) {
  if (unlocked) return;
  unlocked = true;
  const src = c.createBufferSource();
  src.buffer = c.createBuffer(1, 1, 22050);
  src.connect(c.destination);
  src.start(0);
}

function schedule(c, { freq, freq2, type, dur, gain, when }) {
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

// 若手势后音频上下文仍未 running，多半是浏览器的自动播放策略在拦（Safari：设置→网站→自动播放）
let blockWarned = false;
function checkBlocked() {
  if (blockWarned) return;
  setTimeout(() => {
    if (blockWarned || !ctx || ctx.state === 'running') return;
    blockWarned = true;
    console.warn(`[sfx] AudioContext 卡在 ${ctx.state}：浏览器阻止了网页发声`);
    const tip = document.createElement('div');
    tip.textContent = '🔇 浏览器阻止了音效播放：请在 Safari「设置 → 网站 → 自动播放」里把本站设为「允许所有自动播放」';
    tip.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);'
      + 'background:rgba(30,30,30,.92);color:#fff;padding:10px 18px;border-radius:10px;'
      + 'font-size:13px;z-index:99;max-width:90vw;';
    document.body.appendChild(tip);
    setTimeout(() => tip.remove(), 9000);
  }, 1200);
}

// 单个短音：freq 起始频率，freq2 结束频率（滑音），dur 秒，gain 音量，when 延迟秒
function tone(opts) {
  if (sfxVol <= 0) return;
  const c = ac();
  if (!c) return;
  const full = { freq: 600, freq2: 0, type: 'sine', dur: 0.08, gain: 0.1, when: 0, ...opts };
  full.gain *= sfxVol;
  unlock(c);
  if (c.state === 'running') {
    schedule(c, full);
  } else {
    c.resume().then(() => schedule(c, full)).catch(() => {});
    checkBlocked();
  }
}

export const sfx = {
  // 普通按钮：短促的「嗒」
  click() {
    tone({ freq: 740, freq2: 500, type: 'triangle', dur: 0.055, gain: 0.16 });
  },
  // 主要按钮（橙色）：上扬的「叮」
  primary() {
    tone({ freq: 520, freq2: 800, type: 'triangle', dur: 0.09, gain: 0.2 });
    tone({ freq: 1150, type: 'sine', dur: 0.07, gain: 0.1, when: 0.04 });
  },
  // 危险按钮（红色）：低沉的「咚」
  danger() {
    tone({ freq: 300, freq2: 180, type: 'triangle', dur: 0.13, gain: 0.24 });
  },
};

// 事件委托挂在捕获阶段：即使按钮自己的 handler 里 stopPropagation 也能出声
export function initSfx() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.classList.contains('primary')) sfx.primary();
    else if (b.classList.contains('danger')) sfx.danger();
    else sfx.click();
  }, true);
}
