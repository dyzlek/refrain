import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServer, JoinResult, RoomState, ServerToClient } from '@shared/protocol';
import { buildApp } from '../src/app.ts';
import { memoryStore, redisStore, type RoomStore } from '../src/game/store.ts';
import type { Track, TrackSource } from '../src/music/deezer.ts';

type Client = Socket<ServerToClient, ClientToServer>;

const TRACKS: Track[] = Array.from({ length: 6 }, (_, i) => ({
  id: i,
  title: `Morceau ${i}`,
  titleShort: `Morceau ${i}`,
  artist: 'Daft Punk',
  cover: '',
  link: '',
  // Les liens fournis au tirage sont « expirés » : seul un lien redemandé fonctionne.
  preview: `expired://${i}`,
}));

const refreshed: number[] = [];
const source: TrackSource = {
  themes: () => [{ id: 'chart:0', label: 'Test' }],
  resolve: async (input) => ({ id: input, label: 'Test' }),
  tracks: async () => TRACKS.map((t) => ({ ...t })),
  freshPreview: async (id) => {
    refreshed.push(id);
    return `fresh://${id}`;
  },
};

const fetchAudio = async (url: string) => {
  if (!url.startsWith('fresh://')) throw new Error('403');
  return Buffer.from(url);
};

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  for (const a of apps.splice(0)) await a.app.close().catch(() => {});
  refreshed.length = 0;
});

async function server(store: RoomStore) {
  const ctx = await buildApp({
    source,
    fetchAudio,
    store,
    timing: { leadMs: 50, resumeLeadMs: 20, readyTimeoutMs: 300, answerMs: 300, revealMs: 100, clipSeconds: 3, buzzWindowMs: 30, hostGraceMs: 200 },
  });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  apps.push(ctx);
  return { ...ctx, url: `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}` };
}

function client(url: string): Client {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  c.on('probe', (ack) => ack());
  c.on('state', (s) => {
    if (s.phase === 'loading' && s.audioUrl) c.emit('round:ready', s.round);
  });
  clients.push(c);
  return c;
}

function waitState(c: Client, pred: (s: RoomState) => boolean, ms = 3000): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('état attendu jamais reçu')), ms);
    const on = (s: RoomState) => {
      if (!pred(s)) return;
      clearTimeout(timer);
      c.off('state', on);
      resolve(s);
    };
    c.on('state', on);
  });
}

const emitAck = <T>(fn: (ack: (r: T) => void) => void) => new Promise<T>((resolve) => fn(resolve));

describe('redémarrage du serveur', () => {
  it('reprend une partie en cours avec les mêmes joueurs et les mêmes scores', async () => {
    const store = memoryStore();
    const first = await server(store);

    const alice = client(first.url);
    const created = await emitAck<JoinResult>((ack) => alice.emit('room:create', { name: 'Alice' }, ack));
    if (!created.ok) throw new Error();
    await emitAck((ack) => alice.emit('room:settings', { rounds: 3 }, ack));

    // Manche 1 gagnée par Alice, puis le serveur s'arrête pendant la manche 2.
    const playing1 = waitState(alice, (s) => s.phase === 'playing' && s.round === 1);
    alice.emit('game:start');
    await playing1;
    await new Promise((r) => setTimeout(r, 80));
    alice.emit('buzz');
    await waitState(alice, (s) => s.phase === 'answering');
    alice.emit('answer', 'daft punk');
    const scored = await waitState(alice, (s) => s.phase === 'reveal');
    const score = scored.players[0].score;
    expect(score).toBeGreaterThan(0);
    await waitState(alice, (s) => s.phase === 'playing' && s.round === 2);
    await first.app.close();

    // Nouveau processus, même stockage : le salon est là, Alice revient avec son sessionId.
    const second = await server(store);
    const back = client(second.url);
    const resumed = waitState(back, (s) => s.phase === 'playing' && s.round === 2);
    const rejoined = await emitAck<JoinResult>((ack) =>
      back.emit('room:join', { code: created.code, name: 'Alice', sessionId: created.sessionId }, ack),
    );
    expect(rejoined.ok && rejoined.playerId).toBe(created.playerId);

    const s = await resumed;
    expect(s.players[0]).toMatchObject({ name: 'Alice', score, found: 1, host: true });
    expect(s.history).toHaveLength(1);
    expect(s.rounds).toBe(3);
  }, 15_000);

  it('garde les réglages d’un salon d’attente', async () => {
    const store = memoryStore();
    const first = await server(store);
    const alice = client(first.url);
    const created = await emitAck<JoinResult>((ack) => alice.emit('room:create', { name: 'Alice' }, ack));
    if (!created.ok) throw new Error();
    await emitAck((ack) => alice.emit('room:settings', { rounds: 15 }, ack));
    await first.app.close();

    const second = await server(store);
    const back = client(second.url);
    const state = waitState(back, () => true);
    const r = await emitAck<JoinResult>((ack) =>
      back.emit('room:join', { code: created.code, name: 'Alice', sessionId: created.sessionId }, ack),
    );
    expect(r.ok).toBe(true);
    const s = await state;
    expect(s).toMatchObject({ phase: 'lobby', rounds: 15 });
  });

  it('redemande un lien d’extrait quand le premier a expiré', async () => {
    const { url } = await server(memoryStore());
    const alice = client(url);
    await emitAck<JoinResult>((ack) => alice.emit('room:create', { name: 'Alice' }, ack));
    await emitAck((ack) => alice.emit('room:settings', { rounds: 3 }, ack));
    const playing = waitState(alice, (s) => s.phase === 'playing');
    alice.emit('game:start');
    await playing;
    expect(refreshed).toHaveLength(1);
  });
});

// Lancé en CI contre un vrai Redis (service Docker) ; ignoré en local sans TEST_REDIS_URL.
describe.skipIf(!process.env.TEST_REDIS_URL)('stockage Redis', () => {
  it('sauvegarde, relit et supprime un salon', async () => {
    const store = await redisStore(process.env.TEST_REDIS_URL!);
    const room = {
      code: 'TEST',
      phase: 'lobby' as const,
      theme: { id: 'chart:0', label: 'Test' },
      rounds: 10,
      round: 0,
      players: [],
      queue: [],
      spare: [],
      history: [],
      startedAt: new Date(0).toISOString(),
      gameId: null,
      lastActive: 0,
    };
    await store.save(room);
    expect((await store.loadAll()).find((r) => r.code === 'TEST')).toEqual(room);
    await store.remove('TEST');
    expect((await store.loadAll()).find((r) => r.code === 'TEST')).toBeUndefined();
    await store.close();
  });
});
