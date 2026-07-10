# 卡坦岛 Online

浏览器多人卡坦岛（基础版 + 城市与骑士扩展）。Node.js + Express + Socket.IO，前端原生 JS + SVG（无构建步骤），界面全中文。

## 常用命令

- `npm start` — 启动服务器（PORT 环境变量可改端口，默认 3000）
- `npm test` — 单元测试（node:test）
- `node test/e2e-smoke.js` — 基础版端到端冒烟测试，需要服务器已在 3000 端口运行
- `node test/e2e-ck.js` — 城市与骑士端到端冒烟测试（同上）
- `node test/fuzz-ck.js` — 城市与骑士随机对局模糊测试（直接驱动 Game 类，无需服务器）

## 架构要点

- **服务端权威**：所有规则在 `server/game.js` 的 `Game` 类中校验执行；客户端只发送意图（`action` 事件），收到完整状态后渲染。手牌等私密信息只发给对应玩家（`privateState`）。
- **坐标系**：`server/board.js` 用轴向坐标生成尖顶六边形，顶点/边通过像素坐标取整去重编号；客户端 SVG 直接使用同一套单位坐标（viewBox 缩放）。
- **断线重连**：玩家身份靠 `token`（UUID），客户端存 sessionStorage（优先）+ localStorage；URL 加 `?new` 强制新会话（同机多开测试用）。
- **动画**：状态里带 `events` 序列（自增 seq），客户端只播放未见过的事件；棋子出现用 CSS 动画类（`piece-pop` 等）。
- **规则实现注意**：本回合买的发展卡不能用（`boughtTurn` 判断）；每回合限一张发展卡；骑士可在掷骰前打；银行资源不足且多人应得时该资源全员不发；最长道路被截断且并列时奖励空置。

## 城市与骑士（`mode: 'ck'`）

- 扩展规则集中在 `server/ck.js`（常量 + 方法，`Object.assign(Game.prototype, ckMethods)` 挂载）；`game.js` 内用 `this.ck` 分支。开局时房主在选颜色界面选模式。
- 商品（布匹/铸币/纸张）直接存放在 `player.hand` 里（与资源同构），`cardTypes()` 返回本模式全部牌类型——弃牌/偷牌/交易/银行全部自动覆盖商品。
- 掷骰流程：`roll()` → 事件骰（3/6 船）→ 野蛮人前进/来袭结算 → `finishRoll()`（产出/弃牌/进步卡/引水渠）。来袭需玩家选择时（选被毁城市 `barbarianLoss`、防御并列选进步卡 `defenderPick`）掷骰结算暂停，选完续跑 `finishRoll`。
- 新增回合状态：`aqueduct`（引水渠选资源）、`barbarianLoss`（选被毁城市）、`defenderPick`（防御并列第一各自选颜色抽进步卡）、`displace`（骑士待安置：被驱逐由主人安置 / 逃兵卡放置所获骑士，`reason` 区分）、`deserterPick`（逃兵卡受害者选交出的骑士）、`metropolis`（大都会选城）、`pickCards`/`pickProgress`（商业大亨/间谍选牌）、`wedding`（送礼方选牌）、`harbor`（商业港逐个交换）。这些选择类状态的数据都挂在 `this.turn` 上，提示经 `ckHints` 只发给该选择的玩家。
- 骑士记录在 `this.knights`（vertexId → {player, level, active, builtTurn, promotedTurn, activatedTurn, actedTurn}）：激活当回合不能行动、行动后休整（active=false）、每回合限一次行动/一次升级、本回合招募不能升级、三级需政治 3；对手骑士会截断最长道路与修路。被驱逐的骑士由其主人沿自己路网重新安置，无处可放则移回补给区。
- 进步卡从牌堆顶抽（`pop`）、用掉放回堆底（`unshift`）。ck 模式 `initBoard` 会把 viewBox 向左多扩 `CK_PANEL_W` 的海面，放三列常驻面板：上排三摞进步卡牌堆（`updateProgressDecks`），下方对应颜色的城市升级轨道（`updateImproveBoard`，5 个等级格 + 直接购买按钮，替代了原来的升级弹窗）。抽/打出进步卡时客户端播放飞牌动画（`flyProgressCard`，依赖事件里的 `deck` 字段）。
