// HTTP 静态服务 + Socket.IO 房间管理
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { Game } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

// code -> { code, hostToken, players: [{token, name, socketId}], game, createdAt }
const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function roomLobbyState(room) {
  return {
    code: room.code,
    started: !!room.game,
    players: room.players.map((p, i) => ({
      name: p.name,
      connected: !!p.socketId,
      isHost: p.token === room.hostToken,
      index: i,
    })),
  };
}

function broadcastLobby(room) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('lobby', roomLobbyState(room));
  }
}

function broadcastGame(room) {
  if (!room.game) return;
  const pub = room.game.publicState();
  room.players.forEach((p, i) => {
    if (p.socketId) {
      io.to(p.socketId).emit('state', { ...pub, you: room.game.privateState(i) });
    }
  });
}

// 公开的「正在等待玩家」的房间：未开始、未满、且至少有一名在线玩家
function openRoomsList() {
  const list = [];
  for (const room of rooms.values()) {
    if (room.game) continue;
    if (room.players.length >= 4) continue;
    if (!room.players.some((p) => p.socketId)) continue;
    const host = room.players.find((p) => p.token === room.hostToken) || room.players[0];
    list.push({ code: room.code, hostName: host ? host.name : '房间', count: room.players.length });
  }
  return list;
}

function broadcastOpenRooms() {
  io.emit('openRooms', openRoomsList());
}

// 定期清理超过 24 小时的房间
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > 24 * 3600 * 1000) rooms.delete(code);
  }
}, 3600 * 1000);

io.on('connection', (socket) => {
  let myRoom = null;
  let myToken = null;

  const fail = (msg) => socket.emit('gameError', { msg });

  // 彻底离开当前（未开始的）房间：房主离开则移交，房间空了则删除
  function leaveCurrentRoom() {
    const room = myRoom;
    if (!room || room.game) return;
    const leftToken = myToken;
    const idx = room.players.findIndex((p) => p.token === leftToken);
    if (idx >= 0) room.players.splice(idx, 1);
    myRoom = null;
    myToken = null;
    if (room.players.length === 0) {
      rooms.delete(room.code);
    } else {
      if (room.hostToken === leftToken) room.hostToken = room.players[0].token;
      broadcastLobby(room);
    }
  }

  socket.on('listRooms', () => socket.emit('openRooms', openRoomsList()));

  socket.on('createRoom', ({ name }) => {
    name = String(name || '').trim().slice(0, 12);
    if (!name) return fail('请输入昵称');
    const code = makeCode();
    const token = crypto.randomUUID();
    const room = {
      code, hostToken: token, game: null, createdAt: Date.now(),
      players: [{ token, name, socketId: socket.id }],
    };
    rooms.set(code, room);
    myRoom = room;
    myToken = token;
    socket.emit('joined', { code, token, index: 0 });
    broadcastLobby(room);
    broadcastOpenRooms();
  });

  socket.on('joinRoom', ({ code, name, token }) => {
    code = String(code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return fail('房间不存在');

    // 重连：token 匹配已有玩家
    const existing = token && room.players.find((p) => p.token === token);
    if (existing) {
      existing.socketId = socket.id;
      myRoom = room;
      myToken = existing.token;
      if (room.game) room.game.players[room.players.indexOf(existing)].connected = true;
      socket.emit('joined', { code, token: existing.token, index: room.players.indexOf(existing) });
      broadcastLobby(room);
      broadcastGame(room);
      broadcastOpenRooms();
      return;
    }

    if (room.game) return fail('游戏已开始，无法加入');
    if (room.players.length >= 4) return fail('房间已满（最多 4 人）');
    name = String(name || '').trim().slice(0, 12);
    if (!name) return fail('请输入昵称');
    if (room.players.some((p) => p.name === name)) return fail('昵称已被使用');

    // 从大厅切换到别人的房间：先退出原房间
    if (myRoom && myRoom !== room && !myRoom.game) leaveCurrentRoom();

    const newToken = crypto.randomUUID();
    room.players.push({ token: newToken, name, socketId: socket.id });
    myRoom = room;
    myToken = newToken;
    socket.emit('joined', { code, token: newToken, index: room.players.length - 1 });
    broadcastLobby(room);
    broadcastOpenRooms();
  });

  socket.on('startGame', () => {
    const room = myRoom;
    if (!room) return fail('尚未加入房间');
    if (room.hostToken !== myToken) return fail('只有房主可以开始游戏');
    if (room.game) return fail('游戏已开始');
    if (room.players.length < 2) return fail('至少需要 2 名玩家（标准为 3-4 人）');
    room.game = new Game(room.players.map((p) => ({ name: p.name })));
    broadcastLobby(room);
    broadcastGame(room);
    broadcastOpenRooms();
  });

  socket.on('action', (data) => {
    const room = myRoom;
    if (!room || !room.game) return fail('游戏尚未开始');
    const p = room.players.findIndex((pl) => pl.token === myToken);
    if (p < 0) return fail('你不在该房间中');
    const g = room.game;
    try {
      switch (data?.type) {
        case 'setupSettlement': g.placeSetupSettlement(p, data.vertex); break;
        case 'setupRoad': g.placeSetupRoad(p, data.edge); break;
        case 'roll': g.roll(p); break;
        case 'discard': g.discard(p, data.resources || {}); break;
        case 'moveRobber': g.moveRobber(p, data.hex); break;
        case 'steal': g.steal(p, data.target); break;
        case 'buildRoad': g.buildRoad(p, data.edge); break;
        case 'buildSettlement': g.buildSettlement(p, data.vertex); break;
        case 'buildCity': g.buildCity(p, data.vertex); break;
        case 'buyDev': g.buyDev(p); break;
        case 'playDev': g.playDev(p, data.card, data.payload || {}); break;
        case 'bankTrade': g.bankTrade(p, data.give, data.get); break;
        case 'offerTrade': g.offerTrade(p, data.give, data.get); break;
        case 'cancelTrade': g.cancelTrade(p); break;
        case 'respondTrade': g.respondTrade(p, !!data.accept); break;
        case 'acceptTradeWith': g.acceptTradeWith(p, data.target); break;
        case 'endTurn': g.endTurn(p); break;
        default: return fail('未知操作');
      }
      broadcastGame(room);
    } catch (e) {
      if (e.isGameError) fail(e.message);
      else {
        console.error(e);
        fail('服务器内部错误');
      }
    }
  });

  socket.on('chat', ({ text }) => {
    const room = myRoom;
    if (!room) return;
    const p = room.players.find((pl) => pl.token === myToken);
    text = String(text || '').trim().slice(0, 200);
    if (!p || !text) return;
    for (const pl of room.players) {
      if (pl.socketId) io.to(pl.socketId).emit('chat', { name: p.name, text });
    }
  });

  socket.on('disconnect', () => {
    const room = myRoom;
    if (!room) return;
    const idx = room.players.findIndex((p) => p.token === myToken);
    if (idx < 0) return;
    room.players[idx].socketId = null;
    if (room.game) {
      room.game.players[idx].connected = false;
      broadcastGame(room);
    } else if (room.hostToken === myToken && room.players.length === 1) {
      rooms.delete(room.code); // 空的未开始房间直接清理
    }
    broadcastLobby(room);
    broadcastOpenRooms();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`卡坦岛服务器已启动: http://localhost:${PORT}`);
});
