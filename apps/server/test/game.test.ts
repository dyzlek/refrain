import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServer, GameEvent, JoinResult, RoomState, ServerToClient } from '@shared/protocol';
import { buildApp } from '../src/app.ts';
import type { Track, TrackSource } from '../src/music/deezer.ts';

// Une vraie partie de bout en bout : serveur Fastify + Socket.io, Postgres (PGlite en mémoire),
// deux clients. Seule la source musicale est simulée.

type Client = Socket<ServerToClient, ClientToServer>;

// Le tirage est aléatoire : tous les titres ont le même artiste pour qu'une réponse soit toujours juste.
const TRACKS: Track[] = Array.from({ length: 8 }, (_, i) => ({
  id: i,
  title: `Morceau numéro ${i} (Radio Edit)`,
  titleShort: `Morceau numéro ${i}`,
  artist: 'Daft Punk',
  cover: '',
  link: '',
  preview: `fake://${i}`,
}));

const source: TrackSource = {
  themes: () => [{ id: 'chart:0', label: 'Test' }],
  resolve: async (input) => ({ id: input, label: 'Test' }),
  tracks: async () => TRACKS,
};

let ctx: Awaited<ReturnType<typeof buildApp>>;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  ctx = await buildApp({
    // En CI, un second job relance ces tests contre un vrai PostgreSQL.
    databaseUrl: process.env.TEST_DATABASE_URL,
    source,
    fetchAudio: async (u) => Buffer.from(u),
    timing: { leadMs: 50, resumeLeadMs: 20, readyTimeoutMs: 500, answerMs: 300, revealMs: 100, clipSeconds: 2, buzzWindowMs: 30, hostGraceMs: 200 },
  });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await ctx.app.close();
});

function client(): Client {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true });
  c.on('probe', (ack) => ack());
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

describe('partie complète', () => {
  it('crée un salon, rejoint, buzze, répond et enregistre la partie', async () => {
    const alice = client();
    const bob = client();

    const created = await emitAck<JoinResult>((ack) => alice.emit('room:create', { name: 'Alice' }, ack));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const joined = await emitAck<JoinResult>((ack) => bob.emit('room:join', { code: created.code.toLowerCase(), name: 'Bob' }, ack));
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    // Seul l'hôte règle le salon.
    const denied = await emitAck<{ ok: boolean }>((ack) => bob.emit('room:settings', { rounds: 3 }, ack));
    expect(denied.ok).toBe(false);
    const allowed = await emitAck<{ ok: boolean }>((ack) => alice.emit('room:settings', { rounds: 3 }, ack));
    expect(allowed.ok).toBe(true);

    // Chaque client signale qu'il a chargé l'extrait ; la lecture démarre quand tout le monde est prêt.
    for (const c of [alice, bob]) {
      c.on('state', (s) => {
        if (s.phase === 'loading' && s.audioUrl) c.emit('round:ready', s.round);
      });
    }
    const loadingP = waitState(alice, (s) => s.phase === 'loading' && !!s.audioUrl);
    const playingP = waitState(bob, (s) => s.phase === 'playing');
    alice.emit('game:start');

    const loading = await loadingP;
    const audio = await fetch(url + loading.audioUrl);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/mpeg');
    // L'adresse de l'extrait ne révèle rien du titre.
    expect(loading.audioUrl).not.toContain('fake');

    const playing = await playingP;
    expect(playing.playback?.playing).toBe(true);
    await new Promise((r) => setTimeout(r, 80));

    // Bob buzze et se trompe : il est bloqué pour la manche et la musique reprend.
    const events: GameEvent[] = [];
    alice.on('event', (e) => events.push(e));
    bob.emit('buzz');
    const answering = await waitState(alice, (s) => s.phase === 'answering');
    expect(answering.buzz?.playerId).toBe(joined.playerId);
    expect(answering.playback?.playing).toBe(false);
    bob.emit('answer', 'mauvaise réponse');
    const resumed = await waitState(alice, (s) => s.phase === 'playing');
    expect(resumed.players.find((p) => p.id === joined.playerId)?.lockedOut).toBe(true);
    expect(events).toContainEqual({ kind: 'wrong', playerId: joined.playerId, text: 'mauvaise réponse' });

    // Bob ne peut plus buzzer ; Alice buzze, se trompe aussi : plus personne, la manche se termine sans gagnant.
    bob.emit('buzz');
    await new Promise((r) => setTimeout(r, 60));
    alice.emit('buzz');
    await waitState(alice, (s) => s.phase === 'answering' && s.buzz?.playerId === created.playerId);
    alice.emit('answer', 'Justice');
    const r1 = await waitState(alice, (s) => s.phase === 'reveal');
    expect(r1.reveal).toMatchObject({ round: 1, winnerId: null, artist: 'Daft Punk', points: 0 });

    // Manche 2 : Alice trouve l'artiste, avec une faute de frappe.
    await waitState(alice, (s) => s.phase === 'playing' && s.round === 2);
    await new Promise((r) => setTimeout(r, 80));
    alice.emit('buzz');
    await waitState(alice, (s) => s.phase === 'answering');
    alice.emit('answer', 'daft pnuk');
    const r2 = await waitState(alice, (s) => s.phase === 'reveal' && s.round === 2);
    expect(r2.reveal?.winnerId).toBe(created.playerId);
    expect(r2.reveal?.points).toBeGreaterThanOrEqual(150);
    expect(r2.players.find((p) => p.id === created.playerId)).toMatchObject({ score: r2.reveal?.points, found: 1 });

    // Fin de partie : enregistrée dans Postgres, visible dans le classement.
    const ended = await waitState(alice, (s) => s.phase === 'ended' && s.gameId !== null, 6000);
    expect(ended.history).toHaveLength(3);
    const board = await (await fetch(`${url}/api/leaderboard`)).json();
    expect(board.games).toBeGreaterThanOrEqual(1);
    expect(board.best.map((b: { name: string }) => b.name)).toEqual(expect.arrayContaining(['Alice', 'Bob']));
    const detail = await (await fetch(`${url}/api/games/${ended.gameId}`)).json();
    expect(detail.rounds).toHaveLength(3);
  }, 15_000);

  it('retrouve son joueur et son score après une reconnexion', async () => {
    const alice = client();
    const created = await emitAck<JoinResult>((ack) => alice.emit('room:create', { name: 'Alice' }, ack));
    if (!created.ok) throw new Error();
    alice.disconnect();

    const again = client();
    const back = await emitAck<JoinResult>((ack) =>
      again.emit('room:join', { code: created.code, name: 'Alice', sessionId: created.sessionId }, ack),
    );
    expect(back.ok && back.playerId).toBe(created.playerId);
    const s = await waitState(again, (st) => st.players.length === 1);
    expect(s.players[0]).toMatchObject({ host: true, online: true });
  });

  it('passe la main à un autre joueur quand l’hôte ne revient pas', async () => {
    const alice = client();
    const bob = client();
    const created = await emitAck<JoinResult>((ack) => alice.emit('room:create', { name: 'Alice' }, ack));
    if (!created.ok) throw new Error();
    const joined = await emitAck<JoinResult>((ack) => bob.emit('room:join', { code: created.code, name: 'Bob' }, ack));
    if (!joined.ok) throw new Error();
    const handover = waitState(bob, (s) => s.players.some((p) => p.id === joined.playerId && p.host));
    alice.disconnect();
    const s = await handover;
    expect(s.players.find((p) => p.id === created.playerId)).toMatchObject({ host: false, online: false });
  });

  it('refuse un salon inconnu', async () => {
    const c = client();
    const r = await emitAck<JoinResult>((ack) => c.emit('room:join', { code: 'ZZZZ', name: 'X' }, ack));
    expect(r).toEqual({ ok: false, error: 'Salon introuvable' });
  });
});
