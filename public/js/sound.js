// BGM 播放 + 声音控制面板（🎵 音乐开关/音量、🔔 音效音量）
// 音乐文件不随仓库分发（版权原因）：自行把 mp3 放到 public/audio/bgm.mp3
import { sfx, setSfxVolume, getSfxVolume } from './sfx.js';

// 按序尝试的文件名：放哪个都行（mp4/m4a 是 AAC 音频，带视频轨也只播声音）
const BGM_CANDIDATES = ['audio/bgm.mp3', 'audio/bgm.mp4', 'audio/bgm.m4a', 'audio/bgm.ogg'];
// BGM 音量上限：滑条 100% 时的实际音量（背景音乐只作衬托，不该盖过音效和人声）
const BGM_MAX = 0.4;
const $ = (id) => document.getElementById(id);

let audio = null;
let bgmOn = localStorage.getItem('catan_bgm_on') !== '0';
let bgmVol = (() => {
  const v = parseFloat(localStorage.getItem('catan_bgm_vol'));
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.25;
})();

let srcIdx = 0;
function ensureAudio() {
  if (audio) return audio;
  audio = new Audio(BGM_CANDIDATES[0]);
  audio.loop = true;
  audio.volume = bgmVol * BGM_MAX;
  audio.addEventListener('error', () => {
    srcIdx += 1;
    if (srcIdx < BGM_CANDIDATES.length) {
      // 换下一个候选格式；起播交给下一次点击的 tryStart（浏览器要求手势）
      audio.src = BGM_CANDIDATES[srcIdx];
      if (bgmOn) audio.play().catch(() => {});
    } else {
      // 全部缺失/失败：提示并停用开关，避免反复重试
      bgmOn = false;
      $('bgm-hint').classList.remove('hidden');
      syncUI();
    }
  });
  return audio;
}

function syncUI() {
  $('bgm-toggle').classList.toggle('off', !bgmOn);
  $('bgm-range').value = Math.round(bgmVol * 100);
  $('sfx-range').value = Math.round(getSfxVolume() * 100);
}

export function initSound() {
  syncUI();

  $('sound-toggle').addEventListener('click', () => {
    $('sound-panel').classList.toggle('hidden');
  });

  $('bgm-toggle').addEventListener('click', () => {
    bgmOn = !bgmOn;
    localStorage.setItem('catan_bgm_on', bgmOn ? '1' : '0');
    if (bgmOn) ensureAudio().play().catch(() => {});
    else if (audio) audio.pause();
    syncUI();
  });

  $('bgm-range').addEventListener('input', (e) => {
    bgmVol = e.target.value / 100;
    localStorage.setItem('catan_bgm_vol', String(bgmVol));
    if (audio) audio.volume = bgmVol * BGM_MAX;
  });

  $('sfx-range').addEventListener('input', (e) => {
    setSfxVolume(e.target.value / 100);
  });
  // 松手时播一声试听，方便拿捏音量
  $('sfx-range').addEventListener('change', () => sfx.click());
  $('sfx-toggle').addEventListener('click', () => sfx.primary());

  // 浏览器要求用户手势后才能出声：任意一次点击即尝试起播，成功后不再重复
  const tryStart = () => {
    if (!bgmOn || (audio && !audio.paused)) return;
    ensureAudio().play().catch(() => {});
  };
  document.addEventListener('click', tryStart, true);
}
