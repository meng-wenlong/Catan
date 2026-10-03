// 开场演出（新开局、初始摆放前）：电影黑边睁眼 → 镜头穿云俯冲落到岛上、地块逐圈落成 →
// 烫金标题砸下扫光 → 玩家铭牌按摆放顺序冲入 → 黑边收起、界面从四边滑入。点击任意处跳过。
import { playBoardIntro } from './render.js';
import { sfx } from './sfx.js';
import { duckBgm } from './sound.js';

let abortCurrent = null;

// 换局/退出观战时中止仍在播放的开场：直接撤掉遮罩与界面隐藏，不回调 onDone（动画时间线已被清空）
export function stopOpening() {
  abortCurrent?.();
}

const esc = (s) => {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
};

// 镜头：从高空远处斜着俯冲下来（倾斜 + 偏转 + 远小），边推近边回正到俯视，末端轻微过冲再落定。
// 全程缩放不超过 1：Chrome 对 3D 变换图层按 1 倍栅格化，放大会糊，缩小则清晰（纵深感靠透视给）
const CAMERA = [
  { transform: 'perspective(1200px) translateY(-4%) rotateX(54deg) rotateZ(-20deg) scale(.6)', offset: 0 },
  { transform: 'perspective(1200px) translateY(-1%) rotateX(26deg) rotateZ(-7deg) scale(.84)', offset: 0.5 },
  { transform: 'perspective(1200px) translateY(0) rotateX(-1.5deg) rotateZ(.5deg) scale(1.01)', offset: 0.9 },
  { transform: 'perspective(1200px) translateY(0) rotateX(0) rotateZ(0) scale(1)', offset: 1 },
];
const CAMERA_MS = 5400;

// opts：{ players: [{name, color, me}]（按摆放顺序，首位先手）, mode, goal, onDone }
export function playOpening({ players, mode, goal, onDone }) {
  const screen = document.getElementById('screen-game');
  const board = document.getElementById('board');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { onDone?.(); return; }

  screen.classList.add('opening-hud'); // 界面元素先收到屏幕外
  duckBgm(9000);

  const root = document.createElement('div');
  root.id = 'opening';
  const plates = players.map((p, k) => `
    <div class="op-plate ${k % 2 ? 'from-right' : 'from-left'}" style="--seat:${p.color}; --k:${k}">
      <div class="op-plate-inner">
        <span class="op-seat-no">${k + 1}</span>
        <span class="op-seat-name">${esc(p.name)}${p.me ? '<small>我</small>' : ''}</span>
        ${k === 0 ? '<span class="op-first">先手</span>' : ''}
      </div>
    </div>`).join('');
  root.innerHTML = `
    <div class="op-fog">${'<i></i>'.repeat(5)}</div>
    <div class="op-dim"></div>
    <div class="op-flash"></div>
    <div class="op-center">
      <div class="op-eyebrow">新 的 航 程</div>
      <div class="op-rule"><i></i><b>◆</b><i></i></div>
      <div class="op-title"><span class="t-shadow">卡坦岛</span><span class="t-gold">卡坦岛</span><span class="t-shine">卡坦岛</span></div>
      <div class="op-sub">${esc(mode)}<span>·</span>先到 <b>${goal}</b> 分获胜</div>
      <div class="op-lineup">${plates}</div>
    </div>
    <div class="op-bar top"></div>
    <div class="op-bar bottom"><span class="op-skip">点击任意处跳过 ▸▸</span></div>`;
  document.body.appendChild(root);

  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const camera = board.animate(CAMERA, { duration: CAMERA_MS, easing: 'cubic-bezier(.42,0,.18,1)', fill: 'backwards' });
  let tiles = null;
  sfx.openingWind();
  void root.offsetWidth;
  root.classList.add('s-open'); // 黑边睁眼 + 云雾散开
  at(700, () => { tiles = playBoardIntro({ onRing: (i) => sfx.gainTick(i), pace: 1.6 }); });
  at(CAMERA_MS - 150, () => { sfx.openingImpact(); root.classList.add('s-land'); });
  at(CAMERA_MS + 400, () => root.classList.add('s-title'));
  at(CAMERA_MS + 600, () => sfx.openingImpact());
  at(CAMERA_MS + 1600, () => { root.classList.add('s-shine'); sfx.openingShine(); });
  const lineupAt = CAMERA_MS + 2400;
  at(lineupAt, () => root.classList.add('s-lineup'));
  players.forEach((_, k) => at(lineupAt + k * 450, () => sfx.openingPlate(k)));
  const outroAt = lineupAt + players.length * 450 + 2200;
  at(outroAt, () => outro());

  let ending = false;
  function outro() {
    if (ending) return;
    ending = true;
    timers.forEach(clearTimeout);
    camera.cancel(); // 动画结束即撤图层：保留终帧会让棋盘停在低分辨率栅格上发糊
    tiles?.finish();
    root.classList.add('s-out'); // 标题组上浮淡出、黑边收起
    screen.classList.remove('opening-hud'); // 界面元素按各自延迟滑入
    setTimeout(() => {
      if (!abortCurrent) return; // 已被 stopOpening 中止
      abortCurrent = null;
      root.remove();
      onDone?.();
    }, 1100);
  }
  root.addEventListener('click', outro);

  abortCurrent = () => {
    abortCurrent = null;
    timers.forEach(clearTimeout);
    camera.cancel();
    tiles?.finish();
    root.remove();
    screen.classList.remove('opening-hud');
  };
}
