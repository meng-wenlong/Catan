# 卡坦岛 Online

浏览器多人卡坦岛（基础版）。Node.js + Express + Socket.IO，前端原生 JS + SVG（无构建步骤），界面全中文。

## 常用命令

- `npm start` — 启动服务器（PORT 环境变量可改端口，默认 3000）
- `npm test` — 单元测试（node:test）
- `node test/e2e-smoke.js` — 端到端冒烟测试，需要服务器已在 3000 端口运行

## 架构要点

- **服务端权威**：所有规则在 `server/game.js` 的 `Game` 类中校验执行；客户端只发送意图（`action` 事件），收到完整状态后渲染。手牌等私密信息只发给对应玩家（`privateState`）。
- **坐标系**：`server/board.js` 用轴向坐标生成尖顶六边形，顶点/边通过像素坐标取整去重编号；客户端 SVG 直接使用同一套单位坐标（viewBox 缩放）。
- **断线重连**：玩家身份靠 `token`（UUID），客户端存 sessionStorage（优先）+ localStorage；URL 加 `?new` 强制新会话（同机多开测试用）。
- **动画**：状态里带 `events` 序列（自增 seq），客户端只播放未见过的事件；棋子出现用 CSS 动画类（`piece-pop` 等）。
- **规则实现注意**：本回合买的发展卡不能用（`boughtTurn` 判断）；每回合限一张发展卡；骑士可在掷骰前打；银行资源不足且多人应得时该资源全员不发；最长道路被截断且并列时奖励空置。

## 计划

基础版测试稳定后再加「城市与骑士」扩展。
