# 城市与骑士 DLC 美术素材交付说明

生成日期：2026-07-10

本批素材按 `docs/美术素材需求单-城市与骑士.md` 制作，源图统一放在：

`public/assets/_sources/`

文件命名均为 `<name>-key.png`。当前交付为 40 张 RGBA PNG，均带透明通道；长边在 1024px 以上，适合作为后续压缩切图和 WebP 转换的源图。

## 资源与图标

- `resource-cloth-key.png`
- `icon-cloth-key.png`
- `resource-coin-key.png`
- `icon-coin-key.png`
- `resource-paper-key.png`
- `icon-paper-key.png`

## 骑士白模

- `piece-knight1-white-key.png`
- `piece-knight2-white-key.png`
- `piece-knight3-white-key.png`

骑士白模保持白/灰金属材质，便于后续按玩家色做染色处理。

## 棋盘标记

- `barbarian-ship-key.png`
- `metropolis-key.png`
- `merchant-key.png`

## 进步卡背

- `progress-trade-key.png`
- `progress-politics-key.png`
- `progress-science-key.png`

三类卡背分别使用贸易金、政治蓝、科学绿的主色方向。

## 进步卡面

贸易：

- `progress-merchant-key.png`
- `progress-merchantFleet-key.png`
- `progress-commercialHarbor-key.png`
- `progress-masterMerchant-key.png`
- `progress-resourceMonopoly-key.png`
- `progress-tradeMonopoly-key.png`

政治：

- `progress-bishop-key.png`
- `progress-constitution-key.png`
- `progress-deserter-key.png`
- `progress-diplomat-key.png`
- `progress-intrigue-key.png`
- `progress-saboteur-key.png`
- `progress-spy-key.png`
- `progress-warlord-key.png`
- `progress-wedding-key.png`

科学：

- `progress-alchemist-key.png`
- `progress-crane-key.png`
- `progress-engineer-key.png`
- `progress-inventor-key.png`
- `progress-irrigation-key.png`
- `progress-medicine-key.png`
- `progress-mining-key.png`
- `progress-printer-key.png`
- `progress-roadBuilding-key.png`
- `progress-smith-key.png`

## 校验结果

- 需求项：40
- 已生成：40
- 缺失：0
- 文件模式：全部 RGBA PNG
- 透明通道：全部通过
- 尺寸分布：
  - 1254 x 1254：10 张
  - 1536 x 1024：1 张
  - 1024 x 1536：11 张
  - 1086 x 1448：18 张

## 后续处理建议

- 从 `*-key.png` 生成游戏运行素材：`public/assets/<name>.png`
- 同步生成 WebP：`public/assets/opt/<name>.webp`
- 卡牌可统一裁到 3:4 或保持当前透明边距后由 CSS 控制显示尺寸。
- 白模骑士建议在运行素材阶段按玩家色叠加 multiply/overlay 色层，源图不要直接改色。
