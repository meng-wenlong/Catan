// BGM 播放 + 声音控制面板（🎵 音乐开关/音量、🔔 音效音量）
// 音乐文件不随仓库分发（版权原因）：自行把 mp3 放到 public/audio/bgm.mp3
import { sfx, setSfxVolume, getSfxVolume } from './sfx.js';

const BGM_URL = 'audio/bgm.mp3';
const $ = (id) => document.getElementById(id);

let audio = null;
let bgmOn = localStorage.getItem('catan_bgm_on') !== '0';
let bgmVol = (() => {
  const v = parseFloat(localStorage.getItem('catan_bgm_vol'));
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.25;
})();

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio(BGM_URL);
  audio.loop = true;
  audio.volume = bgmVol;
  // 文件缺失/加载失败：提示并停用开关，避免反复重试
  audio.addEventListener('error', () => {
    bgmOn = false;
    $('bgm-hint').classList.remove('hidden');
    syncUI();
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
    if (audio) audio.volume = bgmVol;
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
