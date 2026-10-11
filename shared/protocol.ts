// Contrat entre le serveur et le client : tout ce qui passe sur le socket est typé ici.

export type Phase = 'lobby' | 'loading' | 'playing' | 'answering' | 'reveal' | 'ended';

export interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  host: boolean;
  online: boolean;
  /** Aller-retour mesuré par le serveur, en ms. */
  rtt: number;
  lockedOut: boolean;
  found: number;
}

export interface Theme {
  id: string;
  label: string;
}

/**
 * Lecture partagée. À l'heure serveur `anchor` (ms), l'extrait est à `position` (s).
 * Chaque client en déduit où il doit en être, quel que soit le moment où il arrive.
 */
export interface Playback {
  url: string;
  anchor: number;
  position: number;
  playing: boolean;
}

export interface Reveal {
  round: number;
  title: string;
  artist: string;
  cover: string;
  link: string;
  winnerId: string | null;
  winnerName: string | null;
  points: number;
  /** Position dans l'extrait au moment du buzz gagnant, en ms. */
  reactionMs: number | null;
}

export interface Buzz {
  playerId: string;
  deadline: number;
}

export interface RoomState {
  code: string;
  phase: Phase;
  players: PublicPlayer[];
  theme: Theme;
  rounds: number;
  round: number;
  /** Fourni pendant le chargement pour que chacun précharge l'extrait. */
  audioUrl: string | null;
  playback: Playback | null;
  buzz: Buzz | null;
  reveal: Reveal | null;
  history: Reveal[];
  gameId: number | null;
}

export type JoinResult =
  | { ok: true; code: string; playerId: string; sessionId: string }
  | { ok: false; error: string };

export type GameEvent =
  | { kind: 'wrong'; playerId: string; text: string }
  | { kind: 'timeout'; playerId: string }
  | { kind: 'error'; message: string };

export interface ClientToServer {
  'room:create': (p: { name: string }, ack: (r: JoinResult) => void) => void;
  'room:join': (p: { code: string; name: string; sessionId?: string }, ack: (r: JoinResult) => void) => void;
  'room:leave': () => void;
  'room:settings': (p: { theme?: string; rounds?: number }, ack: (r: { ok: boolean; error?: string }) => void) => void;
  'game:start': () => void;
  'game:again': () => void;
  'round:ready': (round: number) => void;
  buzz: () => void;
  answer: (text: string) => void;
  clock: (ack: (serverNow: number) => void) => void;
}

export interface ServerToClient {
  state: (s: RoomState) => void;
  event: (e: GameEvent) => void;
  probe: (ack: () => void) => void;
}

export const CLIP_SECONDS = 29;
export const ANSWER_MS = 10_000;
export const ROUND_OPTIONS = [5, 10, 15, 20] as const;
