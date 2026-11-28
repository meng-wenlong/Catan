---
name: verify
description: 验证本仓库（卡坦岛 Online）改动的方法：启动服务器后用 Socket.IO 客户端驱动真实协议面
---

# 验证方法

无构建步骤。表面有两层：Socket.IO 协议（服务端权威规则）和浏览器 UI（原生 JS + SVG）。

## 启动

```bash
PORT=3000 node server/index.js   # 前台启动；测试脚本默认打 3000 端口
```

## 驱动协议面（首选，无需浏览器）

真实客户端只通过 socket 事件与服务器交互（`createRoom`/`joinRoom`/`startGame`/`pickMode`/`pickColor`/`pickConfirm`/`action`），因此 socket 冒烟即端到端：

```bash
node test/e2e-smoke.js   # 基础版：两人完整开局 + 断线重连
node test/e2e-ck.js      # 城市与骑士：选模式、城市初始放置、事件骰、野蛮人、骑士
node test/fuzz-ck.js     # 直接驱动 Game 类：30 局随机 ck 完整对局，抓状态机崩溃
```

## 浏览器 UI

本机通常没有 Playwright/无头浏览器；Codex in Chrome 扩展可用时开两个标签页
`http://localhost:3000/?new`（`?new` 强制新会话，同机多开测试用）双人对战。
扩展不可用时的替代检查——核对 main.js 用到的 DOM id 都在 index.html 里：

```bash
grep -o "\$('[a-z0-9-]*')" public/js/main.js | sed "s/\$('\(.*\)')/\1/" | sort -u > /tmp/a
grep -o 'id="[a-z0-9-]*"' public/index.html | sed 's/id="\(.*\)"/\1/' | sort -u > /tmp/b
comm -23 /tmp/a /tmp/b   # 输出为空即通过（player-card-N 是动态 id，忽略）
```

## 陷阱

- 服务器占用 3000 端口时先 `pkill -f 'node server/index.js'`。
- e2e 脚本依赖房间从空开始，不要复用长期运行的开发服务器。
