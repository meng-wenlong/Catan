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

// 整体响度系数：各音效的 gain 参数按舒适比例配好，这里统一放大到目标响度
// （多声部叠加的峰值约 0.5，×1.6 后仍 <1 不削波；嫌吵/嫌轻优先调这里）
const SFX_BOOST = 1.6;

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

// 白噪声短音：经带通滤波塑形，模拟敲击/骰子落桌/挥卡等无音高声
// freq 滤波中心频率，freq2 结束频率（扫频，如挥卡的「唰」），q 带宽，dur/gain/when 同 tone
let noiseBuf = null;
function scheduleNoise(c, { freq, freq2, q, dur, gain, when }) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + when;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start(t0, Math.random()); // 随机起点，连续触发时不重样
  src.stop(t0 + dur + 0.02);
}
function noise(opts) {
  if (sfxVol <= 0) return;
  const c = ac();
  if (!c) return;
  const full = { freq: 1500, freq2: 0, q: 1.2, dur: 0.06, gain: 0.1, when: 0, ...opts };
  full.gain *= sfxVol * SFX_BOOST;
  unlock(c);
  if (c.state === 'running') {
    scheduleNoise(c, full);
  } else {
    c.resume().then(() => scheduleNoise(c, full)).catch(() => {});
    checkBlocked();
  }
}

// 单个短音：freq 起始频率，freq2 结束频率（滑音），dur 秒，gain 音量，when 延迟秒
function tone(opts) {
  if (sfxVol <= 0) return;
  const c = ac();
  if (!c) return;
  const full = { freq: 600, freq2: 0, type: 'sine', dur: 0.08, gain: 0.1, when: 0, ...opts };
  full.gain *= sfxVol * SFX_BOOST;
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
  // ---- 游戏事件音效 ----
  // 强盗现身：低音下滑的阴森「咚——」，叠一声小二度制造不安
  robber() {
    tone({ freq: 200, freq2: 90, type: 'sawtooth', dur: 0.4, gain: 0.15 });
    tone({ freq: 285, freq2: 268, type: 'triangle', dur: 0.22, gain: 0.09, when: 0.06 });
  },
  // 海盗船前进：短促的双声低音号角「呜·呜——」
  ship() {
    tone({ freq: 165, freq2: 152, type: 'sawtooth', dur: 0.16, gain: 0.12 });
    tone({ freq: 165, freq2: 142, type: 'sawtooth', dur: 0.28, gain: 0.14, when: 0.2 });
  },
  // 建造落成：按种类给不同质感的敲击 + 完工音
  build(kind) {
    switch (kind) {
      case 'road': // 两声木槌「笃·笃」
        noise({ freq: 750, q: 2.5, dur: 0.05, gain: 0.2 });
        tone({ freq: 190, freq2: 120, type: 'triangle', dur: 0.07, gain: 0.16 });
        noise({ freq: 950, q: 2.5, dur: 0.05, gain: 0.18, when: 0.13 });
        tone({ freq: 235, freq2: 150, type: 'triangle', dur: 0.07, gain: 0.14, when: 0.13 });
        break;
      case 'settlement': // 锤两下 + 上扬的「叮咚」完工音
        noise({ freq: 850, q: 2, dur: 0.05, gain: 0.2 });
        tone({ freq: 210, freq2: 130, type: 'triangle', dur: 0.08, gain: 0.16 });
        noise({ freq: 1050, q: 2, dur: 0.05, gain: 0.18, when: 0.14 });
        tone({ freq: 250, freq2: 160, type: 'triangle', dur: 0.08, gain: 0.15, when: 0.14 });
        tone({ freq: 660, type: 'triangle', dur: 0.1, gain: 0.14, when: 0.3 });
        tone({ freq: 880, type: 'sine', dur: 0.22, gain: 0.15, when: 0.4 });
        break;
      case 'city': // 沉重落石 + 三连音小号角：一座城拔地而起
        noise({ freq: 320, q: 1, dur: 0.14, gain: 0.26 });
        tone({ freq: 130, freq2: 65, type: 'triangle', dur: 0.18, gain: 0.24 });
        tone({ freq: 523, type: 'triangle', dur: 0.1, gain: 0.14, when: 0.22 });
        tone({ freq: 659, type: 'triangle', dur: 0.1, gain: 0.14, when: 0.33 });
        tone({ freq: 784, type: 'triangle', dur: 0.26, gain: 0.17, when: 0.44 });
        tone({ freq: 1568, type: 'sine', dur: 0.28, gain: 0.07, when: 0.44 });
        break;
      case 'knight': // 铠甲铿锵：金属高频「锵」+ 低沉踏步
        noise({ freq: 3200, q: 0.8, dur: 0.09, gain: 0.16 });
        tone({ freq: 1250, freq2: 830, type: 'square', dur: 0.07, gain: 0.07 });
        tone({ freq: 160, freq2: 95, type: 'triangle', dur: 0.12, gain: 0.2, when: 0.02 });
        noise({ freq: 2600, q: 0.8, dur: 0.07, gain: 0.1, when: 0.15 });
        break;
      case 'wall': // 厚重石墙「砰」的一声砸实
        noise({ freq: 260, q: 0.9, dur: 0.18, gain: 0.28 });
        tone({ freq: 110, freq2: 55, type: 'triangle', dur: 0.22, gain: 0.26 });
        noise({ freq: 900, q: 1.5, dur: 0.05, gain: 0.1, when: 0.16 }); // 碎石余响
        break;
      default:
        sfx.click();
    }
  },
  // 打出发展卡/进步卡：挥卡「唰」+ 亮牌闪光「叮」
  card() {
    noise({ freq: 900, freq2: 3800, q: 1, dur: 0.18, gain: 0.16 });
    tone({ freq: 1320, type: 'sine', dur: 0.14, gain: 0.13, when: 0.16 });
    tone({ freq: 1980, type: 'sine', dur: 0.2, gain: 0.08, when: 0.22 });
  },
  // 摇骰子：翻滚期一串疏密渐缓的「嗒嗒」，落定时双响落桌
  dice(rollSec = 2.4) {
    let w = 0;
    while (w < rollSec - 0.25) {
      noise({ freq: 1700 + Math.random() * 1600, q: 3, dur: 0.03, gain: 0.09, when: w });
      w += 0.1 + Math.random() * 0.06 + (w / rollSec) * 0.12; // 越滚越慢
    }
    noise({ freq: 1000, q: 1.5, dur: 0.06, gain: 0.2, when: rollSec });
    tone({ freq: 260, freq2: 160, type: 'triangle', dur: 0.08, gain: 0.16, when: rollSec });
    noise({ freq: 1300, q: 1.5, dur: 0.05, gain: 0.13, when: rollSec + 0.09 });
  },
  // 资源飞牌落进手里：清脆的拾取「叮」，逐张升调越收越爽
  gainTick(i = 0) {
    const scale = [660, 742, 880, 990, 1188, 1320];
    const f = scale[Math.min(i, scale.length - 1)];
    tone({ freq: f, type: 'sine', dur: 0.1, gain: 0.11 });
    tone({ freq: f * 2, type: 'sine', dur: 0.08, gain: 0.045, when: 0.02 });
  },
  // 交易成交/垄断收钱：钱币「叮铃」两响
  coin() {
    noise({ freq: 4200, q: 1, dur: 0.05, gain: 0.1 });
    tone({ freq: 1046, type: 'sine', dur: 0.12, gain: 0.13 });
    tone({ freq: 1568, type: 'sine', dur: 0.18, gain: 0.12, when: 0.11 });
  },
  // 偷牌：贼溜溜的下-上滑音
  steal() {
    tone({ freq: 520, freq2: 330, type: 'sine', dur: 0.09, gain: 0.1 });
    tone({ freq: 330, freq2: 620, type: 'sine', dur: 0.12, gain: 0.11, when: 0.1 });
  },
  // 城市升级：上行双音 + 高频微光
  improve() {
    tone({ freq: 587, type: 'triangle', dur: 0.1, gain: 0.14 });
    tone({ freq: 880, type: 'triangle', dur: 0.2, gain: 0.16, when: 0.11 });
    tone({ freq: 1760, type: 'sine', dur: 0.24, gain: 0.06, when: 0.13 });
  },
  // 大事件号角（大都会/守护者/分数卡）：上行琶音 + 八度泛音
  fanfare() {
    tone({ freq: 523, type: 'triangle', dur: 0.11, gain: 0.15 });
    tone({ freq: 659, type: 'triangle', dur: 0.11, gain: 0.15, when: 0.12 });
    tone({ freq: 784, type: 'triangle', dur: 0.13, gain: 0.16, when: 0.24 });
    tone({ freq: 1046, type: 'triangle', dur: 0.32, gain: 0.18, when: 0.37 });
    tone({ freq: 2093, type: 'sine', dur: 0.34, gain: 0.07, when: 0.37 });
  },
  // 海盗来袭结算：守住 → 上行凯旋三连音；失守 → 下行崩塌
  barbarian(win) {
    if (win) {
      tone({ freq: 392, type: 'triangle', dur: 0.12, gain: 0.16 });
      tone({ freq: 494, type: 'triangle', dur: 0.12, gain: 0.16, when: 0.13 });
      tone({ freq: 587, type: 'triangle', dur: 0.28, gain: 0.19, when: 0.26 });
      tone({ freq: 784, type: 'sine', dur: 0.3, gain: 0.1, when: 0.26 });
    } else {
      tone({ freq: 330, freq2: 240, type: 'sawtooth', dur: 0.25, gain: 0.16 });
      tone({ freq: 245, freq2: 150, type: 'sawtooth', dur: 0.32, gain: 0.18, when: 0.2 });
      tone({ freq: 115, freq2: 62, type: 'sawtooth', dur: 0.55, gain: 0.2, when: 0.42 });
    }
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
