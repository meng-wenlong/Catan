# 图片素材说明

本目录记录本次为「卡坦岛 Online」生成的原创图片素材。素材已复制到 `public/assets/`，当前仅作为素材包存在，尚未接入页面代码。

## 素材清单

| 文件 | 尺寸 | 建议用途 |
| --- | ---: | --- |
| `public/assets/home-island.png` | 1672 x 941 | 首页 / 大厅背景图，可放在 `#screen-home`、`#screen-lobby` 背后 |
| `public/assets/sea-texture.png` | 1254 x 1254 | 游戏海面背景纹理，可叠加到 `body` 或 `#board-area` |
| `public/assets/sea-texture-hd.png` | 1920 x 1920 | 高清静态海面背景，适合高分屏或大屏展示 |
| `public/assets/sea-animated.webp` | 640 x 640 | 推荐的动态海面背景，WebP 循环动画 |
| `public/assets/sea-animated-hd.webp` | 1280 x 1280 | 高清动态海面背景，WebP 循环动画，适合网络允许的部署 |
| `public/assets/sea-animated.gif` | 420 x 420 | 动态海面 GIF 兜底，体积更大、颜色更少 |
| `public/assets/wood-table.png` | 1983 x 793 | 底部操作栏木桌纹理，可用于 `#bottom-bar` |
| `public/assets/resource-wood.png` | 1254 x 1254 | 木材资源卡插画 |
| `public/assets/resource-brick.png` | 1254 x 1254 | 砖块资源卡插画 |
| `public/assets/resource-sheep.png` | 1254 x 1254 | 羊毛资源卡插画 |
| `public/assets/resource-wheat.png` | 1254 x 1254 | 小麦资源卡插画 |
| `public/assets/resource-ore.png` | 1254 x 1254 | 矿石资源卡插画 |
| `public/assets/dev-card.png` | 1254 x 1254 | 发展卡通用卡面 / 卡背纹理 |
| `public/assets/victory-banner.png` | 2172 x 724 | 胜利弹窗横幅装饰 |

## 接入建议

### 1. 首页 / 大厅背景

建议不要改首页结构，只在 CSS 中给首页和大厅屏幕加背景图。`home-card` 仍作为主操作面板。

```css
#screen-home,
#screen-lobby {
  background:
    radial-gradient(ellipse at center, rgba(20, 60, 70, .08), rgba(0, 0, 0, .36)),
    url("/assets/home-island.png") center / cover no-repeat;
}
```

### 2. 游戏海面纹理

当前 `body` 已有 CSS 海面渐变。可把 `sea-texture.png` 作为第一层纹理，保留原渐变作为色彩和兜底。

```css
body {
  background:
    linear-gradient(rgba(64, 152, 192, .18), rgba(30, 96, 132, .28)),
    url("/assets/sea-texture.png") center / 620px 620px repeat,
    radial-gradient(ellipse 90% 70% at 22% 12%, rgba(255,255,255,.16), transparent 55%),
    radial-gradient(ellipse 80% 90% at 85% 95%, rgba(8,35,55,.4), transparent 60%),
    linear-gradient(160deg, var(--sea) 0%, var(--sea-deep) 100%);
}
```

如果想直接使用动态海面，推荐优先使用 `sea-animated.webp`。GIF 版本主要用于需要最保守兼容的场景。

```css
body {
  background:
    linear-gradient(rgba(64, 152, 192, .12), rgba(30, 96, 132, .28)),
    url("/assets/sea-animated.webp") center / 640px 640px repeat,
    radial-gradient(ellipse 90% 70% at 22% 12%, rgba(255,255,255,.16), transparent 55%),
    radial-gradient(ellipse 80% 90% at 85% 95%, rgba(8,35,55,.4), transparent 60%),
    linear-gradient(160deg, var(--sea) 0%, var(--sea-deep) 100%);
}
```

如果设备和网络条件允许，可以直接使用高清版 `sea-animated-hd.webp`：

```css
body {
  background:
    linear-gradient(rgba(64, 152, 192, .12), rgba(30, 96, 132, .28)),
    url("/assets/sea-animated-hd.webp") center / 960px 960px repeat,
    radial-gradient(ellipse 90% 70% at 22% 12%, rgba(255,255,255,.16), transparent 55%),
    radial-gradient(ellipse 80% 90% at 85% 95%, rgba(8,35,55,.4), transparent 60%),
    linear-gradient(160deg, var(--sea) 0%, var(--sea-deep) 100%);
}
```

`background-size` 可以按实际屏幕调节：`960px` 比较细腻，`1280px` 更接近原始清晰度但运动感会更慢。也可以用 `picture` 元素做普通图片展示时的 fallback；但作为 CSS 背景时，通常直接使用 WebP 即可。现代 Chrome、Safari、Firefox、Edge 都支持 animated WebP。

### 3. 底部木桌纹理

`#bottom-bar` 现在是 CSS 木纹。可把生成图放在最上层，叠一点暗色渐变保证按钮可读。

```css
#bottom-bar {
  background:
    linear-gradient(180deg, rgba(40, 20, 8, .12), rgba(35, 18, 8, .4)),
    url("/assets/wood-table.png") center / cover no-repeat,
    linear-gradient(180deg, #8a5a33, #543218);
}
```

### 4. 资源卡插画

建议保留现有 emoji 和数量文本作为清晰信息层，把资源图作为卡面底图。可先用 CSS 变量接入。

```css
.res-card,
.rp-card {
  background-size: cover;
  background-position: center;
}

.res-wood { background-image: linear-gradient(rgba(0,0,0,.05), rgba(0,0,0,.35)), url("/assets/resource-wood.png"); }
.res-brick { background-image: linear-gradient(rgba(0,0,0,.05), rgba(0,0,0,.35)), url("/assets/resource-brick.png"); }
.res-sheep { background-image: linear-gradient(rgba(0,0,0,.05), rgba(0,0,0,.35)), url("/assets/resource-sheep.png"); }
.res-wheat { background-image: linear-gradient(rgba(0,0,0,.05), rgba(0,0,0,.35)), url("/assets/resource-wheat.png"); }
.res-ore { background-image: linear-gradient(rgba(0,0,0,.05), rgba(0,0,0,.35)), url("/assets/resource-ore.png"); }
```

如果接入后卡面太忙，可以把 `.res-card > span:first-child` 的 emoji 隐藏，只保留数量；但在小屏上建议先保留 emoji。

### 5. 发展卡

`dev-card.png` 没有文字，适合作为发展卡通用背景。当前发展卡按钮上还会显示 emoji 和中文短名，可以直接叠加。

```css
.dev-card {
  background:
    linear-gradient(rgba(38, 20, 58, .08), rgba(24, 12, 38, .45)),
    url("/assets/dev-card.png") center / cover no-repeat,
    linear-gradient(150deg,#9068c0,#6c4a99);
}
```

### 6. 胜利横幅

胜利弹窗可以在 `#modal-winner .modal-box` 中加一个装饰元素，或作为背景层使用。若修改 HTML，推荐加：

```html
<img class="victory-banner-img" src="/assets/victory-banner.png" alt="">
```

对应 CSS：

```css
.victory-banner-img {
  width: min(360px, 80vw);
  display: block;
  margin: -4px auto 10px;
  pointer-events: none;
}
```

## 生成提示词记录

所有素材均使用内置 `image_gen` 生成，风格要求为原创温暖桌游海岛风，避免官方卡坦岛标志、版式或可识别版权符号。

### `home-island.png`

```text
Create a polished warm illustrated background image for a Chinese browser board game landing/lobby screen. A cozy tabletop with a small hex-tile island map, blue sea around it, wooden table edges, dice and resource cards subtly present, inviting evening light. 16:9 landscape, central island slightly lower than center, soft empty space near center for UI card overlay. No text, no watermark, no official Catan logo, no recognizable copyrighted board-game board layout.
```

### `sea-texture.png`

```text
Create a refined painterly ocean surface texture for a browser board game. Calm teal-blue sea seen from above, subtle wave caustics, gentle foam accents, no horizon. Square tile-like texture, edges visually tileable, no strong focal object, no land, no boats, no text.
```

### `sea-animated.webp` / `sea-animated.gif`

动态海面由 `sea-texture.png` 本地后处理生成：对原图做周期性轻微位移、波纹扭曲和亮度闪动，导出为循环动画。未使用额外 AI 生成步骤。

推荐参数：

- WebP：640 x 640，40 帧，每帧 80ms，约 3.2 秒循环。
- GIF：420 x 420，32 帧，每帧 90ms，约 2.88 秒循环。
- 动效定位：细微背景流动，不抢棋盘和 UI 注意力。

### `sea-animated-hd.webp` / `sea-texture-hd.png`

高清海面素材同样由 `sea-texture.png` 后处理生成：

- `sea-animated-hd.webp`：1280 x 1280，72 帧，每帧 67ms，约 4.8 秒循环，体积约 12M。
- `sea-texture-hd.png`：1920 x 1920 静态高清海面，体积约 4M。
- 适用场景：设备性能和网络允许、希望在大屏或高分屏上获得更细腻的海面背景。

### `wood-table.png`

```text
Create a polished illustrated wooden tabletop texture for a browser board game UI. Warm varnished wood planks seen from above, subtle grain and tiny scratches. Wide horizontal texture, seamless-looking left/right, suitable behind buttons and cards. No text, no dice, no cards.
```

### 资源卡

资源卡共用要求：方形小卡插画、中心主体、留白充足、无文字、无水印、原创桌游风。分别生成木材、砖块、羊毛、小麦、矿石五种主体。

### `dev-card.png`

```text
Create a polished mysterious development card artwork for a tabletop island settlement browser game. Aged parchment card with subtle compass, shield, road, harvest, and coin motifs blended as faint embossed symbols. No readable text. Deep muted violet, warm parchment gold, subtle teal accent.
```

### `victory-banner.png`

```text
Create a celebratory victory banner illustration for an original island settlement tabletop browser game. Parchment ribbon banner with small island flag, laurel leaves, dice, coins, and warm lantern glow. Wide horizontal banner, central empty area for Chinese victory text to be overlaid by HTML. No text, no watermark.
```

## 后续处理建议

- 当前保存为 PNG 原图，质量较高但体积也较大。正式接入页面前建议另存一套压缩版，例如 WebP。
- 动态海面已经提供 WebP 版本；除非需要特别保守的兼容性，否则不建议优先使用 GIF。
- 高清动态海面体积明显更大，建议用于局域网、内网部署或明确可以接受首屏资源较大的环境。
- 首页背景可以保留较高分辨率；资源卡显示尺寸很小，接入前可压到 256 或 512 方图。
- 图片素材不参与游戏规则，不需要改服务端。
