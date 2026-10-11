import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServer, JoinResult, ServerToClient } from '@shared/protocol';
import type { Rooms } from './game/rooms.ts';
import type { Room } from './game/room.ts';

interface SocketData {
  code?: string;
  playerId?: string;
}

export type Io = Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

const PROBE_EVERY_MS = 3000;

export function createIo(http: HttpServer, corsOrigin?: string): Io {
  return new Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>(http, {
    cors: corsOrigin ? { origin: corsOrigin } : undefined,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });
}

export function broadcast(io: Io, room: Room): void {
  io.to(room.code).emit('state', room.snapshot());
}

export function attachRealtime(io: Io, rooms: Rooms): () => void {
  io.on('connection', (socket) => {
    const current = () => {
      const { code, playerId } = socket.data;
      const room = code ? rooms.get(code) : undefined;
      return room && playerId && room.players.has(playerId) ? { room, playerId } : null;
    };

    const enter = (room: Room, playerId: string, sessionId: string): JoinResult => {
      socket.data = { code: room.code, playerId };
      void socket.join(room.code);
      socket.emit('state', room.snapshot());
      return { ok: true, code: room.code, playerId, sessionId };
    };

    const leaveCurrent = () => {
      const c = current();
      if (!c) return;
      void socket.leave(c.room.code);
      c.room.remove(c.playerId);
      socket.data = {};
    };

    socket.on('clock', (ack) => typeof ack === 'function' && ack(Date.now()));

    socket.on('room:create', ({ name }, ack) => {
      leaveCurrent();
      const room = rooms.create();
      const p = room.addPlayer(String(name ?? ''), socket.id);
      ack(enter(room, p.id, p.sessionId));
    });

    socket.on('room:join', ({ code, name, sessionId }, ack) => {
      const room = rooms.get(String(code ?? ''));
      if (!room) return ack({ ok: false, error: 'Salon introuvable' });
      if (sessionId) {
        const back = room.rejoin(String(sessionId), socket.id);
        if (back) return ack(enter(room, back.id, back.sessionId));
      }
      if (room.players.size >= 16) return ack({ ok: false, error: 'Salon complet (16 joueurs)' });
      leaveCurrent();
      const p = room.addPlayer(String(name ?? ''), socket.id);
      ack(enter(room, p.id, p.sessionId));
    });

    socket.on('room:leave', leaveCurrent);

    socket.on('room:settings', (opts, ack) => {
      const c = current();
      if (!c) return ack({ ok: false, error: 'Pas de salon' });
      c.room
        .configure(c.playerId, { theme: opts?.theme, rounds: opts?.rounds })
        .then(() => ack({ ok: true }))
        .catch((err: Error) => ack({ ok: false, error: err.message }));
    });

    socket.on('game:start', () => {
      const c = current();
      if (c) void c.room.start(c.playerId);
    });
    socket.on('game:again', () => {
      const c = current();
      if (c) c.room.again(c.playerId);
    });
    socket.on('round:ready', (round) => {
      const c = current();
      if (c) c.room.markReady(c.playerId, Number(round));
    });
    socket.on('buzz', () => {
      const c = current();
      if (c) c.room.buzzIn(c.playerId);
    });
    socket.on('answer', (text) => {
      const c = current();
      if (c) c.room.answer(c.playerId, String(text ?? ''));
    });

    socket.on('disconnect', () => {
      const c = current();
      if (c) c.room.disconnect(c.playerId);
    });
  });

  // Le serveur mesure lui-même l'aller-retour de chaque joueur : un client ne peut pas
  // se déclarer « lent » pour obtenir plus de compensation au buzzer.
  const probe = setInterval(async () => {
    for (const room of rooms.all()) {
      const sockets = await io.in(room.code).fetchSockets();
      await Promise.allSettled(
        sockets.map(async (s) => {
          const playerId = s.data.playerId;
          if (!playerId) return;
          const t0 = performance.now();
          await s.timeout(2000).emitWithAck('probe');
          room.setRtt(playerId, performance.now() - t0);
        }),
      );
      if (sockets.length) broadcast(io, room);
    }
  }, PROBE_EVERY_MS);
  probe.unref();

  return () => clearInterval(probe);
}
