# 🏝️ 卡坦岛 Online

和好友一起在浏览器里玩的卡坦岛（基础版 + 城市与骑士扩展）。无需注册，创建房间把 4 位房间码发给朋友即可开玩。语音请自行使用钉钉会议等工具。

## 功能

### 基础版规则

- 标准 19 格随机地图（官方螺旋数字分布，6/8 永不相邻）、9 个港口
- 3-4 人游戏（支持 2 人便于测试），初始蛇形放置
- 掷骰产资源、强盗（弃牌 / 移动 / 偷牌）
- 建造：道路、村庄、城市；购买与使用发展卡（骑士 / 修路 / 丰收 / 垄断 / 分数）
- 玩家间自由交易、银行 4:1、港口 3:1 与 2:1
- 最长道路、最大军队，10 分获胜
- 断线重连（刷新页面自动恢复），房间内文字聊天
- 全中文界面，流畅的 CSS/SVG 动画

### 城市与骑士扩展（开局时房主选择）

- 商品牌：城市在羊 / 矿 / 木地形产 1 资源 + 1 商品（布匹 / 铸币 / 纸张）
- 事件骰与野蛮人：船到岸时比较城市数与激活骑士等级和，防御成功出「卡坦守护者」，失败则出力最少者失去城市
- 骑士棋子：招募（1羊1矿）、激活（1麦）、升级（最多 3 级）、沿路移动、驱逐强盗与低级敌方骑士；对手骑士会截断你的道路
- 城市升级：贸易 / 政治 / 科学三系，3 级解锁能力（商栈 / 城堡 / 引水渠），率先 4 级建立大都会（+2 分，免疫野蛮人，5 级可抢夺）
- 三色进步卡（54 张全实现）替代发展卡，掷出城门按红骰派发
- 城墙（2砖，手牌上限 +2）；掷 7 弃牌上限随城墙提高；野蛮人首次来袭前强盗不移动
- 无最大军队，13 分获胜
- 被驱逐的骑士由其主人沿自己路网重新安置（无处可放则移回补给区）；大都会城市由玩家自选；商业港 / 商业大亨 / 婚礼 / 间谍均为交互式选牌
- 与官方规则的差异（简化）：逃兵替换的骑士直接移回补给区（官方由受害者选择哪个骑士叛逃）

## 本地运行

```bash
npm install
npm start          # 默认端口 3000，可用 PORT=8080 npm start 指定
```

打开 <http://localhost:3000>。同一台电脑测试多个玩家时，请使用无痕窗口或在地址后加 `?new`（例如 `http://localhost:3000/?new`）以新玩家身份进入。

## 测试

```bash
npm test                  # 单元测试（棋盘生成 + 基础规则 + 城市与骑士规则）
node test/e2e-smoke.js    # 基础版端到端冒烟测试（需先启动服务器）
node test/e2e-ck.js       # 城市与骑士端到端冒烟测试（需先启动服务器）
node test/fuzz-ck.js      # 城市与骑士随机完整对局 ×30（无需服务器）
```

## 部署到服务器

只需要 Node.js ≥ 18，单进程即可，无数据库。

### 方式一：直接运行 + pm2（推荐）

```bash
# 服务器上
git clone <你的仓库> catan && cd catan   # 或用 scp 上传整个目录（不含 node_modules）
npm install --omit=dev
npm install -g pm2
PORT=3000 pm2 start server/index.js --name catan
pm2 save && pm2 startup   # 开机自启
```

### 方式二：Docker

```bash
docker build -t catan .
docker run -d --name catan -p 3000:3000 --restart unless-stopped catan
```

### 配上域名与 HTTPS（可选但推荐）

用 Nginx / Caddy 反向代理到 3000 端口即可，注意 WebSocket 需要升级头。Caddy 最简单：

```
# Caddyfile —— 自动申请 HTTPS 证书
catan.你的域名.com {
    reverse_proxy localhost:3000
}
```

Nginx 参考配置：

```nginx
server {
    listen 80;
    server_name catan.你的域名.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

没有域名也可以直接用 `http://服务器IP:3000` 玩（记得在云服务商安全组放行端口）。

## 项目结构

```
server/
  index.js        HTTP + Socket.IO 入口、房间管理、断线重连
  game.js         游戏规则状态机（服务端权威，防作弊）
  ck.js           「城市与骑士」扩展规则（骑士/野蛮人/进步卡/城市升级）
  board.js        棋盘生成：六边形几何、地形/数字/港口随机化
  longestRoad.js  最长道路算法（DFS，含对手建筑与骑士截断）
  constants.js    资源、花费、牌堆等常量
public/
  index.html      单页应用（首页 / 大厅 / 游戏三屏）
  style.css       样式与全部动画
  js/render.js    SVG 棋盘渲染与热点交互
  js/main.js      客户端状态、Socket 通信、界面逻辑
test/             单元测试与端到端冒烟测试
```

## 后续计划

- [x] 城市与骑士扩展
- [x] 城市与骑士细节打磨：被驱逐骑士由其主人重新安置、大都会自选城市、商业港等交互式选牌
