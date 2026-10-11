import { randomBytes, randomUUID } from 'node:crypto';
import { CLIP_SECONDS, ANSWER_MS } from '@shared/protocol';
import type { Buzz, GameEvent, Phase, Playback, PublicPlayer, Reveal, RoomState, Theme } from '@shared/protocol';
import { matchAnswer } from '@shared/match';
import { arbitrate, positionAt, pointsFor, BUZZ_WINDOW_MS, type BuzzCandidate } from '@shared/timing';
import type { Track, TrackSource } from '../music/deezer.ts';
import type { GameSummary } from '../db/index.ts';

export interface Timing {
  /** Délai entre l'annonce du départ et la première note : le temps que l'ordre arrive partout. */
  leadMs: number;
  resumeLeadMs: number;
  readyTimeoutMs: number;
  answerMs: number;
  revealMs: number;
  clipSeconds: number;
  buzzWindowMs: number;
  /** Un hôte qui recharge sa page garde la main s'il revient avant ce délai. */
  hostGraceMs: number;
}

export const DEFAULT_TIMING: Timing = {
  leadMs: 1500,
  resumeLeadMs: 600,
  readyTimeoutMs: 6000,
  answerMs: ANSWER_MS,
  revealMs: 7000,
  clipSeconds: CLIP_SECONDS,
  buzzWindowMs: BUZZ_WINDOW_MS,
  hostGraceMs: 10_000,
};

export interface RoomDeps {
  source: TrackSource;
  fetchAudio(url: string): Promise<Buffer>;
  onChange(room: Room): void;
  onEvent(room: Room, e: GameEvent): void;
  onGameEnd(summary: GameSummary): Promise<number | null>;
  timing?: Partial<Timing>;
  now?: () => number;
}

export interface Player {
  id: string;
  sessionId: string;
  name: string;
  score: number;
  found: number;
  host: boolean;
  socketId: string | null;
  offlineSince: number | null;
  rtt: number;
  lockedOut: boolean;
}

interface Current {
  track: Track;
  audio: Buffer;
  token: string;
}

type HistoryEntry = Reveal & { trackId: string };

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Room {
  readonly players = new Map<string, Player>();
  phase: Phase = 'lobby';
  theme: Theme;
  rounds = 10;
  round = 0;
  lastActive: number;

  private queue: Track[] = [];
  private spare: Track[] = [];
  private current: Current | null = null;
  private playback: Playback | null = null;
  private buzz: (Buzz & { reactionMs: number }) | null = null;
  private reveal: Reveal | null = null;
  private history: HistoryEntry[] = [];
  private ready = new Set<string>();
  private pending: BuzzCandidate[] = [];
  private timers = new Map<string, NodeJS.Timeout>();
  private hostTimer?: NodeJS.Timeout;
  private startedAt = new Date();
  private gameId: number | null = null;
  /** Incrémenté à chaque remise à zéro : une suite asynchrone d'une partie abandonnée s'arrête d'elle-même. */
  private generation = 0;
  private readonly t: Timing;
  private readonly now: () => number;

  constructor(
    readonly code: string,
    private readonly deps: RoomDeps,
  ) {
    this.t = { ...DEFAULT_TIMING, ...deps.timing };
    this.now = deps.now ?? Date.now;
    this.theme = deps.source.themes()[0];
    this.lastActive = this.now();
  }

  /* ------------------------------------------------------------ joueurs */

  addPlayer(name: string, socketId: string): Player {
    const player: Player = {
      id: randomUUID(),
      sessionId: randomBytes(16).toString('hex'),
      name: name.trim().slice(0, 20) || 'Anonyme',
      score: 0,
      found: 0,
      host: ![...this.players.values()].some((p) => p.host),
      socketId,
      offlineSince: null,
      rtt: 0,
      lockedOut: false,
    };
    this.players.set(player.id, player);
    this.touch();
    this.changed();
    return player;
  }

  /** Reconnexion : on retrouve le joueur, son score et sa place, et le client se recale sur la lecture. */
  rejoin(sessionId: string, socketId: string): Player | null {
    const player = [...this.players.values()].find((p) => p.sessionId === sessionId);
    if (!player) return null;
    player.socketId = socketId;
    player.offlineSince = null;
    this.ensureHost();
    this.touch();
    this.changed();
    return player;
  }

  disconnect(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.socketId = null;
    p.offlineSince = this.now();
    if (p.host) {
      // Minuteur à part : les minuteurs de jeu sont remis à zéro à chaque manche.
      clearTimeout(this.hostTimer);
      this.hostTimer = setTimeout(() => {
        this.ensureHost();
        this.changed();
      }, this.t.hostGraceMs);
    }
    this.ready.delete(playerId);
    this.changed();
    this.checkReady();
  }

  remove(playerId: string): void {
    if (!this.players.delete(playerId)) return;
    this.ready.delete(playerId);
    this.ensureHost();
    this.changed();
    this.checkReady();
    if (this.phase === 'answering' && this.buzz?.playerId === playerId) this.wrong(playerId, null);
  }

  setRtt(playerId: string, rtt: number): void {
    const p = this.players.get(playerId);
    if (p) p.rtt = p.rtt ? Math.round(p.rtt * 0.7 + rtt * 0.3) : Math.round(rtt);
  }

  online(): Player[] {
    return [...this.players.values()].filter((p) => p.socketId);
  }

  isHost(playerId: string): boolean {
    return this.players.get(playerId)?.host ?? false;
  }

  private ensureHost(): void {
    const all = [...this.players.values()];
    const host = all.find((p) => p.host);
    if (host?.socketId) return;
    const next = all.find((p) => p.socketId);
    if (!next) return;
    if (host) host.host = false;
    next.host = true;
  }

  /* ------------------------------------------------------------ réglages */

  async configure(by: string, opts: { theme?: string; rounds?: number }): Promise<void> {
    if (!this.isHost(by) || this.phase !== 'lobby') throw new Error('Seul l’hôte peut régler le salon');
    if (opts.rounds !== undefined) this.rounds = Math.min(Math.max(Math.round(opts.rounds), 3), 30);
    if (opts.theme) this.theme = await this.deps.source.resolve(opts.theme);
    this.changed();
  }

  /* ------------------------------------------------------------ partie */

  async start(by: string): Promise<void> {
    if (!this.isHost(by) || this.phase !== 'lobby') return;
    const gen = ++this.generation;
    this.resetGame();
    this.phase = 'loading';
    this.changed();

    try {
      const seen = new Set<string>();
      const tracks = shuffle(await this.deps.source.tracks(this.theme.id)).filter((t) => {
        const key = `${t.artist}|${t.titleShort}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (tracks.length < this.rounds) throw new Error(`Pas assez de titres (${tracks.length}) pour ${this.rounds} manches`);
      this.queue = tracks.slice(0, this.rounds);
      this.spare = tracks.slice(this.rounds, this.rounds + 10);
    } catch (err) {
      if (gen !== this.generation) return;
      this.phase = 'lobby';
      this.deps.onEvent(this, { kind: 'error', message: (err as Error).message });
      this.changed();
      return;
    }
    if (gen !== this.generation) return;
    this.startedAt = new Date(this.now());
    await this.nextRound(gen);
  }

  private async nextRound(gen: number): Promise<void> {
    this.clearTimers();
    this.round++;
    if (this.round > this.rounds) return this.finish();

    this.phase = 'loading';
    this.current = null;
    this.playback = null;
    this.buzz = null;
    this.reveal = null;
    this.pending = [];
    this.ready.clear();
    for (const p of this.players.values()) p.lockedOut = false;
    this.changed();

    // L'extrait est chargé par le serveur puis servi sous une adresse aléatoire :
    // l'URL Deezer (et donc le titre) n'arrive jamais jusqu'aux joueurs.
    let track: Track | undefined = this.queue[this.round - 1];
    let audio: Buffer | null = null;
    while (track && !audio) {
      try {
        audio = await this.deps.fetchAudio(track.preview);
      } catch {
        track = this.spare.shift();
      }
    }
    if (gen !== this.generation) return;
    if (!track || !audio) {
      this.deps.onEvent(this, { kind: 'error', message: 'Impossible de charger les extraits' });
      return this.finish();
    }

    this.queue[this.round - 1] = track;
    this.current = { track, audio, token: randomBytes(12).toString('hex') };
    this.timer('ready', this.t.readyTimeoutMs, () => this.beginPlayback());
    this.changed();
    this.checkReady();
  }

  markReady(playerId: string, round: number): void {
    if (this.phase !== 'loading' || round !== this.round || !this.current) return;
    this.ready.add(playerId);
    this.checkReady();
  }

  private checkReady(): void {
    if (this.phase !== 'loading' || !this.current) return;
    const online = this.online();
    if (online.length && online.every((p) => this.ready.has(p.id))) this.beginPlayback();
  }

  private beginPlayback(): void {
    if (this.phase !== 'loading' || !this.current) return;
    this.play(0, this.t.leadMs);
  }

  private play(position: number, lead: number): void {
    if (!this.current) return;
    this.phase = 'playing';
    this.buzz = null;
    this.playback = { url: this.audioUrl()!, anchor: this.now() + lead, position, playing: true };
    this.timer('clip', lead + (this.t.clipSeconds - position) * 1000, () => this.endRound(null));
    this.changed();
  }

  buzzIn(playerId: string): void {
    const p = this.players.get(playerId);
    const now = this.now();
    if (this.phase !== 'playing' || !p || p.lockedOut || !this.playback || now < this.playback.anchor) return;
    if (this.pending.some((c) => c.playerId === playerId)) return;
    this.pending.push({ playerId, receivedAt: now, rtt: p.rtt });
    // On n'attribue pas le buzz au premier arrivé : on attend un court instant
    // un buzz parti plus tôt d'une connexion plus lente.
    if (this.pending.length === 1) this.timer('buzz', this.t.buzzWindowMs, () => this.resolveBuzz());
  }

  private resolveBuzz(): void {
    const winner = arbitrate(this.pending);
    this.pending = [];
    if (this.phase !== 'playing' || !this.playback || !winner) return;
    const now = this.now();
    this.clearTimer('clip');
    const reactionMs = Math.max(0, Math.round(positionAt(this.playback, winner.at) * 1000));
    this.playback = { ...this.playback, anchor: now, position: positionAt(this.playback, now), playing: false };
    this.phase = 'answering';
    this.buzz = { playerId: winner.playerId, deadline: now + this.t.answerMs, reactionMs };
    this.timer('answer', this.t.answerMs, () => this.wrong(winner.playerId, null));
    this.changed();
  }

  answer(playerId: string, text: string): void {
    if (this.phase !== 'answering' || this.buzz?.playerId !== playerId || !this.current) return;
    if (matchAnswer(text.slice(0, 100), this.current.track)) {
      const p = this.players.get(playerId)!;
      const points = pointsFor(this.buzz.reactionMs, this.t.clipSeconds);
      p.score += points;
      p.found++;
      this.endRound({ playerId, points, reactionMs: this.buzz.reactionMs });
    } else {
      this.wrong(playerId, text.slice(0, 100));
    }
  }

  private wrong(playerId: string, text: string | null): void {
    if (this.phase !== 'answering' || this.buzz?.playerId !== playerId || !this.playback) return;
    this.clearTimer('answer');
    const p = this.players.get(playerId);
    if (p) p.lockedOut = true;
    this.deps.onEvent(this, text === null ? { kind: 'timeout', playerId } : { kind: 'wrong', playerId, text });
    const remaining = this.online().filter((pl) => !pl.lockedOut);
    if (!remaining.length) return this.endRound(null);
    this.play(this.playback.position, this.t.resumeLeadMs);
  }

  private endRound(win: { playerId: string; points: number; reactionMs: number } | null): void {
    if (!this.current || (this.phase !== 'playing' && this.phase !== 'answering')) return;
    this.clearTimers();
    this.pending = [];
    const now = this.now();
    const { track } = this.current;
    const winner = win ? this.players.get(win.playerId) : null;

    this.reveal = {
      round: this.round,
      title: track.titleShort || track.title,
      artist: track.artist,
      cover: track.cover,
      link: track.link,
      winnerId: winner?.id ?? null,
      winnerName: winner?.name ?? null,
      points: win?.points ?? 0,
      reactionMs: win?.reactionMs ?? null,
    };
    this.history.push({ ...this.reveal, trackId: String(track.id) });
    this.phase = 'reveal';
    this.buzz = null;

    // Pendant la révélation, la musique reprend pour tout le monde là où elle s'était arrêtée.
    if (this.playback) {
      const pos = positionAt(this.playback, now);
      this.playback = pos < this.t.clipSeconds - 1
        ? { ...this.playback, anchor: now + this.t.resumeLeadMs, position: pos, playing: true }
        : null;
    }
    const gen = this.generation;
    this.timer('reveal', this.t.revealMs, () => void this.nextRound(gen));
    this.changed();
  }

  private finish(): void {
    this.clearTimers();
    this.phase = 'ended';
    this.current = null;
    this.playback = null;
    this.buzz = null;
    this.changed();

    const gen = this.generation;
    const summary: GameSummary = {
      roomCode: this.code,
      theme: this.theme.label,
      rounds: this.history.length,
      startedAt: this.startedAt,
      players: [...this.players.values()].map((p) => ({ name: p.name, score: p.score, found: p.found })),
      history: this.history.map((h) => ({
        trackId: h.trackId,
        title: h.title,
        artist: h.artist,
        winner: h.winnerName,
        reactionMs: h.reactionMs,
      })),
    };
    if (!summary.history.length) return;
    this.deps
      .onGameEnd(summary)
      .then((id) => {
        if (gen !== this.generation || id === null) return;
        this.gameId = id;
        this.changed();
      })
      .catch(() => {});
  }

  again(by: string): void {
    if (!this.isHost(by) || this.phase !== 'ended') return;
    this.generation++;
    this.resetGame();
    this.changed();
  }

  private resetGame(): void {
    this.clearTimers();
    this.phase = 'lobby';
    this.round = 0;
    this.current = null;
    this.playback = null;
    this.buzz = null;
    this.reveal = null;
    this.history = [];
    this.gameId = null;
    this.pending = [];
    this.ready.clear();
    for (const p of this.players.values()) {
      p.score = 0;
      p.found = 0;
      p.lockedOut = false;
    }
  }

  /* ------------------------------------------------------------ sorties */

  audio(token: string): Buffer | null {
    return this.current && this.current.token === token ? this.current.audio : null;
  }

  private audioUrl(): string | null {
    return this.current ? `/audio/${this.code}/${this.current.token}` : null;
  }

  snapshot(): RoomState {
    const players: PublicPlayer[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      host: p.host,
      online: !!p.socketId,
      rtt: p.rtt,
      lockedOut: p.lockedOut,
      found: p.found,
    }));
    return {
      code: this.code,
      phase: this.phase,
      players,
      theme: this.theme,
      rounds: this.rounds,
      round: this.round,
      audioUrl: this.audioUrl(),
      playback: this.playback,
      buzz: this.buzz && { playerId: this.buzz.playerId, deadline: this.buzz.deadline },
      reveal: this.reveal,
      history: this.history.map(({ trackId: _, ...r }) => r),
      gameId: this.gameId,
    };
  }

  destroy(): void {
    this.generation++;
    clearTimeout(this.hostTimer);
    this.clearTimers();
  }

  private touch(): void {
    this.lastActive = this.now();
  }

  private changed(): void {
    this.deps.onChange(this);
  }

  private timer(name: string, ms: number, fn: () => void): void {
    this.clearTimer(name);
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name);
        fn();
      }, ms),
    );
  }

  private clearTimer(name: string): void {
    const t = this.timers.get(name);
    if (t) clearTimeout(t);
    this.timers.delete(name);
  }

  private clearTimers(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
