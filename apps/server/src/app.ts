import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { GameEvent } from '@shared/protocol';
import { Rooms } from './game/rooms.ts';
import type { Timing } from './game/room.ts';
import { deezer, fetchAudio as fetchDeezerAudio, type TrackSource } from './music/deezer.ts';
import { gameDetail, leaderboard, openDatabase, saveGame } from './db/index.ts';
import { attachRealtime, broadcast, createIo } from './realtime.ts';

export interface AppOptions {
  databaseUrl?: string;
  databaseDir?: string;
  clientDir?: string;
  corsOrigin?: string;
  source?: TrackSource;
  fetchAudio?: (url: string) => Promise<Buffer>;
  timing?: Partial<Timing>;
  logger?: boolean;
}

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  const database = await openDatabase({ url: opts.databaseUrl, dir: opts.databaseDir });
  const source = opts.source ?? deezer();
  const io = createIo(app.server, opts.corsOrigin);

  const rooms = new Rooms({
    source,
    fetchAudio: opts.fetchAudio ?? fetchDeezerAudio,
    timing: opts.timing,
    onChange: (room) => broadcast(io, room),
    onEvent: (room, e: GameEvent) => io.to(room.code).emit('event', e),
    onGameEnd: async (summary) => {
      try {
        return await saveGame(database.db, summary);
      } catch (err) {
        app.log.error(err, 'Enregistrement de la partie impossible');
        return null;
      }
    },
  });
  const stopRealtime = attachRealtime(io, rooms);

  app.get('/api/health', async () => ({ ok: true, rooms: rooms.all().length }));
  app.get('/api/themes', async () => source.themes());
  app.get('/api/leaderboard', async () => leaderboard(database.db));
  app.get<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    const game = await gameDetail(database.db, Number(req.params.id));
    return game ?? reply.code(404).send({ error: 'Partie introuvable' });
  });

  app.get<{ Params: { code: string; token: string } }>('/audio/:code/:token', async (req, reply) => {
    const audio = rooms.get(req.params.code)?.audio(req.params.token);
    if (!audio) return reply.code(404).send({ error: 'Extrait expiré' });
    return reply.header('content-type', 'audio/mpeg').header('cache-control', 'private, max-age=600').send(audio);
  });

  if (opts.clientDir && existsSync(opts.clientDir)) {
    await app.register(fastifyStatic, { root: opts.clientDir });
    // Une seule page : toute adresse inconnue (hors API) renvoie l'app.
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api') ? reply.code(404).send({ error: 'Introuvable' }) : reply.sendFile('index.html'),
    );
  }

  app.addHook('onClose', async () => {
    stopRealtime();
    rooms.close();
    io.close();
    await database.close();
  });

  return { app, io, rooms };
}
