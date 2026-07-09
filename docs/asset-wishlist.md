# 素材需求清单（第二期）

写给设计师：第一期素材（见 `image-assets.md`）已全部接入上线，效果很好。下面是下一批最能提升画面的素材需求，按优先级排列。**P0 三项做完，游戏画面会再上一个台阶。**

> **进度（2026-07-09 晚更新）**：P0 三项（地形板块、资源图标、发展卡卡面）与 P1 四项（港口徽章、强盗、骰子面、羊皮纸纹理）**已全部交付并接入上线**，质量很好 🎉。
> **当前唯一待交付：玩家棋子（村庄/城市/道路）**，需求已按 3D 微缩棋子方向重写（原「白模」方案作废），详见下方第 8 节——现在是最高优先级，含可直接使用的生成提示词。

## 通用要求（每一项都适用）

- **不要画任何文字、数字、水印**——数字令牌、卡名、比例（3:1）等全部由代码渲染叠加。
- 风格延续第一期：温暖扁平插画、羊皮纸/木质色调，光源统一从**左上方**来。
- 精灵类素材（板块、图标、棋子、徽章、骰子）必须**透明底 PNG**；平铺纹理类不透明即可。
- 按建议文件名交付，放到 `public/assets/`。提供显示尺寸 2 倍以上的原图即可，压缩（WebP 管线）由代码侧处理，不用你管体积。
- 同一组素材务必一批生成、构图统一（第一期资源卡五张画框各不相同，接入时只能裁切补救，这批注意）。

## P0：优先做

### 1. 六边形地形板块 × 6

**这是最重要的一项**——现在棋盘地形是代码画的简易图案，换成插画板块整个棋盘质感就完全不同了。

| 项目 | 要求 |
| --- | --- |
| 文件名 | `tile-forest.png` `tile-hills.png` `tile-pasture.png` `tile-fields.png` `tile-mountains.png` `tile-desert.png` |
| 形状 | **尖顶朝上的正六边形**（一个顶点朝正上方、一个朝正下方，左右两条边是竖直的），六边形外部完全透明，边缘干净锐利 |
| 比例 | 宽 : 高 = 0.866 : 1（正六边形几何比例），建议画布 887 × 1024 |
| 构图 | 俯视视角；**中心直径约 40% 的圆形区域留空或只画低对比度地面**（要放数字令牌）；主体元素（树/砖墙/羊群草地/麦田/山岩/沙丘）沿六边形边缘一圈分布 |
| 例外 | 沙漠没有数字令牌，中心可以自由发挥（骷髅、枯骨、仙人掌均可，会有强盗棋子站上面） |
| 可选加分 | 每种地形出 2 个变体（`tile-forest-2.png`），同地形多块时可以错开不重样 |

### 2. 资源小图标 × 5

现在界面上大量地方（日志、+1 飘字、资源飞入手牌动画、交易横幅、玩家面板）用的还是 emoji（🌲🧱🐑🌾🪨），需要一套统一的小图标替换。

| 项目 | 要求 |
| --- | --- |
| 文件名 | `icon-wood.png` `icon-brick.png` `icon-sheep.png` `icon-wheat.png` `icon-ore.png` |
| 规格 | 256 × 256，**透明底**（注意：和第一期资源卡不同，不要羊皮纸背景，就是干净的物体本身） |
| 构图 | 单一主体居中，占画面约 80%，轮廓清晰，缩到 20px 也认得出 |
| 风格 | 五个一批生成，角度、描边、饱和度一致 |

### 3. 发展卡卡面 × 5

现在五种发展卡共用一张卡背 + emoji 区分，各自有专属卡面会好很多。

| 项目 | 要求 |
| --- | --- |
| 文件名 | `dev-knight.png`（骑士）`dev-vp.png`（胜利点）`dev-road.png`（修路）`dev-plenty.png`（丰收之年）`dev-monopoly.png`（垄断） |
| 规格 | 竖版 3:4（建议 768 × 1024），不透明 |
| 构图 | 五张共用同一套边框模板（延续第一期 `dev-card.png` 的紫金羊皮纸风），中央各画主体：持剑骑士 / 金色奖杯或桂冠 / 蜿蜒道路 / 丰收谷物果篮 / 金币袋；**底部留约 20% 的相对素净区域**，代码要叠中文卡名 |

## P1：有了更好

### 4. 港口徽章 × 6

替换棋盘边缘的港口圆片（现在是 emoji + 文字）。

- 文件名：`harbor-wood/brick/sheep/wheat/ore.png` + `harbor-any.png`（通用港）
- 规格：256 × 256 圆形构图，透明底；外圈画绳索或木质圆环，中央画对应资源（通用港画船锚或帆船）
- 比例文字（3:1 / 2:1）不要画，代码叠加，所以中央下方留一点空

### 5. 强盗棋子

- 文件名：`robber.png`；规格：约 256 × 320 竖版透明底
- 深色连帽斗篷的神秘小人，站姿，底部带一点接地阴影；缩到 30px 仍有清晰剪影

### 6. 骰子面 × 6

- 文件名：`die-1.png` … `die-6.png`；规格：256 × 256，圆角方形，可透明底
- 米白色骰面 + 深色圆点，微立体，风格与首页图里的骰子呼应

### 7. 羊皮纸平铺纹理

- 文件名：`parchment-tile.png`；规格：512 × 512，**四边可无缝平铺**
- 极低对比度的羊皮纸纤维/斑驳纹理，无明显焦点物；用作侧边栏、弹窗面板的底纹，叠在现有米色底色上

## P2：锦上添花（可以先不做）

### 8. 玩家棋子（村庄 / 城市 / 道路）★ 当前最高优先级，需求已重写

**风格定位**：3D 渲染的「彩绘木质」桌游微缩棋子——想象一套高级卡坦实体件被拍成图。**风格锚点是你已交付的 `robber.png` 强盗雕像**：同样的彩绘质感、柔和左上光源、底部一小片中性接地阴影、透明底。三种棋子和四个颜色放在一起必须像同一套模具出来的。

**造型要求**：

| 棋子 | 造型 | 备注 |
| --- | --- | --- |
| 村庄 | 矮胖单间小屋：陡坡屋顶 + 小烟囱，敦实圆润 | 缩到 20px 剪影仍要清晰 |
| 城市 | 主楼 + 方形瞭望塔组合，塔顶小旗，明显比村庄气派 | 高度约为村庄的 1.6 倍 |
| 道路 | 一根圆角木梁，长宽比约 4:1，**平放俯视** | 接地阴影必须垂直在正下方、无方向性投影——代码会把它旋转到三个方向 |

**颜色（精确值，整件同色系深浅做阴影/高光，外缘一圈深色描边保证浅色棋盘上可读）**：
红 `#e74c3c` ｜ 蓝 `#3498db` ｜ 橙 `#f39c12` ｜ 白 `#ecf0f1`（白色件用暖象牙白 + 灰阶阴影，不能纯白，否则在沙色棋盘上隐身）

**交付方式（已确认）**：每种棋子交**一张 2×2 四色拼图**，共 3 张——一次生成保证四色形状风格一致，切图由代码侧处理。要求：

- 画布 2048×2048（道路那张可 2048×1024），完全透明底；
- 四个色件按 左上红、右上蓝、左下橙、右下白 排列，彼此间距充足（≥ 件宽的 40%），互不接触、不互相投影；
- 四件必须是**同一模型的换色**，姿态角度完全一致；
- 无文字、无水印、无地面（除各自的接地阴影）。
- 文件名：`piece-settlement.png`、`piece-city.png`、`piece-road.png`。

**生成提示词（可直接用）**：

村庄 `piece-settlement.png`：

```text
A 2x2 grid of four identical 3D-rendered miniature board game pieces on a fully transparent background: a chunky small settlement house carved from painted wood — one-story, steep pitched roof, tiny chimney, rounded stylized proportions like a premium wooden board game miniature. The four copies are exact same model in four colorways: top-left glossy red (#e74c3c), top-right blue (#3498db), bottom-left orange (#f39c12), bottom-right warm ivory white (#ecf0f1) with soft gray shading. Each piece shaded in darker and lighter tones of its own color, subtle painted-wood texture, thin dark outline, soft studio light from upper left, small neutral contact shadow directly beneath each piece. Style matches a dark hooded robber statue miniature from the same set. 3/4 front view, slightly elevated camera. Generous spacing between the four pieces, none touching. No text, no watermark, no ground plane.
```

城市 `piece-city.png`：

```text
A 2x2 grid of four identical 3D-rendered miniature board game pieces on a fully transparent background: a grand city piece carved from painted wood — a two-part building with a pitched-roof main hall attached to a taller square watchtower with a tiny flag on top, clearly larger and more imposing than a simple house, rounded stylized proportions like a premium wooden board game miniature. The four copies are exact same model in four colorways: top-left glossy red (#e74c3c), top-right blue (#3498db), bottom-left orange (#f39c12), bottom-right warm ivory white (#ecf0f1) with soft gray shading. Each piece shaded in darker and lighter tones of its own color, subtle painted-wood texture, thin dark outline, soft studio light from upper left, small neutral contact shadow directly beneath each piece. Style matches a dark hooded robber statue miniature from the same set. 3/4 front view, slightly elevated camera. Generous spacing between the four pieces, none touching. No text, no watermark, no ground plane.
```

道路 `piece-road.png`：

```text
A 2x2 grid of four identical 3D-rendered miniature board game pieces on a fully transparent background: a road segment piece — a single chunky rounded wooden beam lying flat, horizontal, length about 4 times its width, like a premium wooden board game road piece, painted wood texture. Viewed from directly above with a slight tilt. The four copies are exact same model in four colorways: top-left glossy red (#e74c3c), top-right blue (#3498db), bottom-left orange (#f39c12), bottom-right warm ivory white (#ecf0f1) with soft gray shading. Each piece shaded in darker and lighter tones of its own color, thin dark outline, soft neutral overhead light, small soft contact shadow directly beneath each piece with no directional cast shadow (the piece will be rotated in game). Generous spacing between the four pieces, none touching. No text, no watermark, no ground plane.
```

交付后的切图、按方向旋转、半透明放置预览等全部由代码侧处理，设计师不用管。

### 9. 游戏 Logo / 徽章

- `logo-badge.png`：512 × 512 圆形海岛徽章（小岛 + 帆船 + 缎带），用于 favicon 和首页标题旁装饰。

## 备注

- 第一期的 `sea-animated.gif / sea-animated.webp` 最终没有接入：GIF 体积太大且平铺循环感明显，静态海面纹理 + CSS 浪花动画效果已经够好，这两个文件可以从素材包里去掉。
- 交付后我这边的接入顺序：P0-1 地形板块（改棋盘渲染）→ P0-2 图标（全局替换 emoji）→ P0-3 发展卡 → P1。
