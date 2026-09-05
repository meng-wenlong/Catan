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
const SFX_BOOST = 2.0;

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
  // 掷出 7：重锤砸地 + 半音下行的不祥小动机（强盗现身演出）
  seven() {
    noise({ freq: 220, q: 0.8, dur: 0.28, gain: 0.3 });
    tone({ freq: 98, freq2: 46, type: 'triangle', dur: 0.5, gain: 0.3 });
    tone({ freq: 392, freq2: 372, type: 'sawtooth', dur: 0.16, gain: 0.08, when: 0.34 });
    tone({ freq: 330, freq2: 300, type: 'sawtooth', dur: 0.34, gain: 0.1, when: 0.52 });
  },
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
  // 掷骰子：出手「唰」一声，之后按物理模拟给的事件表发声——
  // hits = [{ t, v }]，t 为秒，v 为 0-1 强度：重的是撞桌闷响（越重越响越低），轻的是桌面翻棱的「嗒」
  dice(hits = []) {
    noise({ freq: 700, freq2: 2600, q: 1, dur: 0.22, gain: 0.07 });
    for (const { t, v } of hits) {
      if (v >= 0.3) {
        noise({ freq: 1000 - v * 200, q: 1.4, dur: 0.05 + v * 0.03, gain: 0.05 + v * 0.16, when: t });
        tone({ freq: 230 - v * 40, freq2: 150, type: 'triangle', dur: 0.06 + v * 0.04, gain: 0.04 + v * 0.14, when: t });
      } else {
        noise({ freq: 1800 + Math.random() * 1400, q: 3, dur: 0.03, gain: 0.03 + v * 0.3, when: t });
      }
    }
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
  // 弃牌：纸牌「唰啦」散落（两声下行扫频错开）
  discard() {
    noise({ freq: 2600, freq2: 900, q: 1, dur: 0.22, gain: 0.14 });
    noise({ freq: 1800, freq2: 700, q: 1.2, dur: 0.2, gain: 0.1, when: 0.12 });
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
  // 胜利音乐：约 7 秒的凯旋小曲——军鼓滚奏起手，铜管主题两个乐句，末尾长和弦 + 钟声琶音收束
  victory() {
    const b = 60 / 132; // 132 BPM，一拍 ≈ 0.455s
    const horn = (f, when, dur, gain = 0.15) => {
      tone({ freq: f, type: 'triangle', dur, gain, when });
      tone({ freq: f, type: 'sawtooth', dur, gain: gain * 0.32, when }); // 锯齿泛音贴近铜管质感
    };
    const bass = (f, when, dur) => tone({ freq: f, type: 'sawtooth', dur, gain: 0.1, when });
    const bell = (f, when, dur = 0.5, gain = 0.06) => tone({ freq: f, type: 'sine', dur, gain, when });
    const snare = (when, gain = 0.1) => noise({ freq: 2100, q: 0.9, dur: 0.09, gain, when });

    // 开场军鼓滚奏渐强
    for (let i = 0; i < 9; i++) snare(i * 0.05, 0.035 + i * 0.011);
    snare(0.5, 0.16);

    const t0 = 0.55; // 主题起点
    const at = (beat) => t0 + beat * b;
    // 乐句一：C 大调上行琶音冲顶（C5 E5 G5 → C6 长音）
    horn(523, at(0), b * 0.5);
    horn(659, at(0.5), b * 0.5);
    horn(784, at(1), b * 0.5);
    horn(1046, at(1.5), b * 1.4, 0.18);
    bass(131, at(0), b * 1.4); bass(98, at(1.5), b * 1.4);
    bell(2093, at(1.5), 0.5);
    snare(at(0)); snare(at(1.5), 0.13);
    // 乐句二：回落盘旋（B5 A5 G5 A5 → B5），属和声托底
    horn(988, at(3), b * 0.5);
    horn(880, at(3.5), b * 0.5);
    horn(784, at(4), b * 0.5);
    horn(880, at(4.5), b * 0.5);
    horn(988, at(5), b * 1.2, 0.16);
    bass(98, at(3), b * 1.4); bass(147, at(4.5), b * 1.4);
    snare(at(3)); snare(at(4.5), 0.08);
    // 终止式：C6 长音 + 完整 C 大调和弦 + 镲声 + 钟声琶音飘上去
    horn(1046, at(6.5), b * 3, 0.2);
    horn(659, at(6.5), b * 3, 0.1);
    horn(523, at(6.5), b * 3, 0.1);
    bass(131, at(6.5), b * 3); bass(65, at(6.5), b * 3);
    noise({ freq: 6400, q: 0.7, dur: 1.1, gain: 0.07, when: at(6.5) }); // 镲
    snare(at(6.5), 0.16);
    [1046, 1318, 1568, 2093].forEach((f, i) => bell(f, at(7.2) + i * 0.14, 0.8, 0.055));
    bell(3136, at(7.9), 1.1, 0.04);
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
