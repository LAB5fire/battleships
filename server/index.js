// HTTP + Socket.IO server. Serves the web client and manages private rooms.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { Room } from './room.js';
import { GameError } from './game.js';
import { sanitizeSettings } from '../shared/config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const EMPTY_ROOM_TTL = 15 * 60 * 1000; // delete rooms 15 min after everyone left
const IDLE_ROOM_TTL = 3 * 60 * 60 * 1000; // ...or after 3 h without any action

const cleanName = (n) => String(n ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16) || 'Captain';
const cleanId = (id) => (typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null);
const cleanCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

export function startServer(port = process.env.PORT || 3000) {
  const app = express();
  const rooms = new Map();
  app.disable('x-powered-by');

  app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use(express.static(path.join(ROOT, 'public')));

  const server = http.createServer(app);
  const io = new Server(server, {
    pingInterval: 20000,
    pingTimeout: 30000,
    maxHttpBufferSize: 64 * 1024,
  });

  function newCode() {
    let code;
    do {
      code = Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  function closeRoom(room, reason, exceptSocketId = null) {
    room.clearTimer();
    for (const p of room.players) {
      if (!p.socketId) continue;
      const s = io.sockets.sockets.get(p.socketId);
      if (s) s.data.roomCode = null;
      if (p.socketId !== exceptSocketId) io.to(p.socketId).emit('roomClosed', { reason });
    }
    rooms.delete(room.code);
  }

  io.on('connection', (socket) => {
    const handle = (fn) => (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const out = fn(payload && typeof payload === 'object' ? payload : {});
        reply({ ok: true, ...(out || {}) });
      } catch (err) {
        if (err instanceof GameError) reply({ ok: false, error: err.message });
        else {
          console.error(err);
          reply({ ok: false, error: 'Something went wrong on the server.' });
        }
      }
    };

    const current = () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) throw new GameError('You are not in a room.');
      const seat = room.seatOfSocket(socket.id);
      if (seat < 0) throw new GameError('You are not in this room.');
      return { room, seat };
    };

    const leaveCurrent = () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return;
      const seat = room.seatOfSocket(socket.id);
      socket.data.roomCode = null;
      if (seat >= 0) room.onDisconnect(socket.id);
    };

    socket.on('room:create', handle(({ name, playerId, settings }) => {
      const pid = cleanId(playerId);
      if (!pid) throw new GameError('Invalid player id. Reload the page.');
      leaveCurrent();
      const room = new Room(newCode(), sanitizeSettings(settings), io);
      rooms.set(room.code, room);
      room.join(socket, pid, cleanName(name));
      return { code: room.code };
    }));

    socket.on('room:join', handle(({ code, name, playerId }) => {
      const pid = cleanId(playerId);
      if (!pid) throw new GameError('Invalid player id. Reload the page.');
      const room = rooms.get(cleanCode(code));
      if (!room) throw new GameError('Room not found. Check the code.');
      if (socket.data.roomCode && socket.data.roomCode !== room.code) leaveCurrent();
      room.join(socket, pid, cleanName(name));
      return { code: room.code };
    }));

    socket.on('room:leave', handle(() => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return;
      const seat = room.seatOfSocket(socket.id);
      const name = seat >= 0 ? room.players[seat].name : 'Your opponent';
      closeRoom(room, `${name} left the room.`, socket.id);
    }));

    socket.on('prep:buy', handle(({ itemId }) => { const { room, seat } = current(); room.buy(seat, itemId); }));
    socket.on('prep:refund', handle(({ itemId }) => { const { room, seat } = current(); room.refund(seat, itemId); }));
    socket.on('prep:ready', handle(({ layout }) => { const { room, seat } = current(); room.setReady(seat, layout); }));
    socket.on('prep:unready', handle(() => { const { room, seat } = current(); room.unready(seat); }));
    socket.on('battle:act', handle((action) => { const { room, seat } = current(); room.battleAction(seat, action); }));
    socket.on('round:continue', handle(() => { const { room, seat } = current(); room.continueRound(seat); }));
    socket.on('match:rematch', handle(() => { const { room, seat } = current(); room.rematch(seat); }));
    socket.on('chat', handle(({ text }) => { const { room, seat } = current(); room.sendChat(seat, text); }));
    socket.on('emote', handle(({ emoji }) => { const { room, seat } = current(); room.sendEmote(seat, emoji); }));

    socket.on('disconnect', () => {
      const room = rooms.get(socket.data.roomCode);
      if (room) room.onDisconnect(socket.id);
    });
  });

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      const empty = room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL;
      const idle = now - room.lastActive > IDLE_ROOM_TTL;
      if (empty || idle) closeRoom(room, 'This room expired.');
    }
  }, 60 * 1000);
  sweeper.unref();

  return new Promise((resolve) => {
    server.listen(port, () => {
      const { port: actual } = server.address();
      resolve({
        port: actual,
        rooms,
        io,
        close: () => new Promise((done) => {
          clearInterval(sweeper);
          for (const room of rooms.values()) room.clearTimer();
          io.close();
          server.close(() => done());
        }),
      });
    });
  });
}

// Start when run directly (node server/index.js), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().then(({ port }) => console.log(`⚓ Fleet Fury running on http://localhost:${port}`));
}
