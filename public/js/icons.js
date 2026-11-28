// 界面小图标（替代 emoji）：手绘风格透明底 webp，放在 /assets/icons/。
// ic(name) 返回内联 <img>，随所在文字字号缩放；opt(name) 取 assets/opt 下的现成素材（棋子、商人等）
export const ICON_SRC = (name) => `/assets/icons/${name}.webp`;
export const ic = (name, cls = '') => `<img class="ic${cls ? ` ${cls}` : ''}" src="${ICON_SRC(name)}" alt="" draggable="false">`;
export const opt = (name, cls = '') => `<img class="ic${cls ? ` ${cls}` : ''}" src="/assets/opt/${name}.webp" alt="" draggable="false">`;
