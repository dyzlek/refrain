import type { JoinResult, RoomState } from '@shared/protocol';
import { socket } from './socket.ts';
import { keepClockInSync, syncClock } from './clock.ts';
import { audio } from './audio.ts';

export type Route = { name: 'home'; code?: string } | { name: 'room'; code: string } | { name: 'board' };

interface Session {
  code: string;
  sessionId: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : on jouera sans reprise après rechargement */
  }
}

function parseRoute(): Route {
  const path = location.pathname.replace(/^\/+|\/+$/g, '');
  if (path === 'classement') return { name: 'board' };
  if (/^[A-Za-z0-9]{4}$/.test(path)) return { name: 'home', code: path.toUpperCase() };
  return { name: 'home' };
}

export const app = $state({
  route: parseRoute() as Route,
  state: null as RoomState | null,
  me: '',
  connected: false,
  busy: false,
  error: '',
  audioLocked: false,
  toasts: [] as { id: number; text: string }[],
  name: read<string>('refrain:name') ?? '',
});

export function navigate(route: Route, replace = false): void {
  app.route = route;
  const path = route.name === 'room' ? `/${route.code}` : route.name === 'board' ? '/classement' : route.code ? `/${route.code}` : '/';
  if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState'](null, '', path);
}

window.addEventListener('popstate', () => {
  const r = parseRoute();
  if (app.state && r.name !== 'board') return navigate({ name: 'room', code: app.state.code }, true);
  app.route = r;
});

let toastId = 0;
export function toast(text: string): void {
  const id = ++toastId;
  app.toasts = [...app.toasts.slice(-3), { id, text }];
  setTimeout(() => (app.toasts = app.toasts.filter((t) => t.id !== id)), 3500);
}

const playerName = (id: string) => app.state?.players.find((p) => p.id === id)?.name ?? 'Quelqu’un';

/* ------------------------------------------------------------ socket */

let readyRound = -1;
let stopSync: (() => void) | null = null;

socket.on('connect', async () => {
  app.connected = true;
  await syncClock(socket);
  stopSync?.();
  stopSync = keepClockInSync(socket);
  const session = read<Session>('refrain:session');
  if (session && (app.route.name !== 'home' || !app.route.code || app.route.code === session.code)) {
    const r = await socket.emitWithAck('room:join', { code: session.code, name: app.name, sessionId: session.sessionId });
    if (r.ok) enter(r);
    else write('refrain:session', null);
  }
  app.audioLocked = !!app.state && audio.locked;
});

socket.on('disconnect', () => {
  app.connected = false;
});

socket.on('state', (s) => {
  const prev = app.state;
  app.state = s;
  void audio.apply(s.playback);

  // Préchargement : on prévient le serveur quand l'extrait est décodé et prêt à partir.
  if (s.phase === 'loading' && s.audioUrl && readyRound !== s.round) {
    readyRound = s.round;
    const round = s.round;
    audio
      .load(s.audioUrl)
      .then(() => socket.emit('round:ready', round))
      .catch(() => socket.emit('round:ready', round));
  }
  if (s.phase === 'lobby') readyRound = -1;
  if (s.phase === 'answering' && prev?.phase !== 'answering') audio.blip(s.buzz?.playerId === app.me ? 1320 : 660);
  if (s.phase === 'reveal' && prev?.phase !== 'reveal' && s.reveal?.winnerId) audio.blip(1760, 0.25);
});

socket.on('event', (e) => {
  if (e.kind === 'wrong') toast(`${playerName(e.playerId)} : « ${e.text} »`);
  else if (e.kind === 'timeout') toast(`${playerName(e.playerId)} n’a pas répondu`);
  else toast(e.message);
});

/* ------------------------------------------------------------ actions */

function enter(r: Extract<JoinResult, { ok: true }>): void {
  app.me = r.playerId;
  app.error = '';
  write('refrain:session', { code: r.code, sessionId: r.sessionId } satisfies Session);
  navigate({ name: 'room', code: r.code }, true);
}

function rememberName(name: string): string {
  const clean = name.trim().slice(0, 20);
  app.name = clean;
  write('refrain:name', clean);
  return clean;
}

async function run(fn: () => Promise<JoinResult>): Promise<void> {
  app.busy = true;
  app.error = '';
  try {
    await audio.unlock();
    app.audioLocked = false;
    const r = await fn();
    if (r.ok) enter(r);
    else app.error = r.error;
  } catch {
    app.error = 'Serveur injoignable';
  } finally {
    app.busy = false;
  }
}

export function createRoom(name: string): Promise<void> {
  const n = rememberName(name);
  return run(() => socket.timeout(5000).emitWithAck('room:create', { name: n }));
}

export function joinRoom(code: string, name: string): Promise<void> {
  const n = rememberName(name);
  const session = read<Session>('refrain:session');
  const sessionId = session?.code === code.toUpperCase() ? session.sessionId : undefined;
  return run(() => socket.timeout(5000).emitWithAck('room:join', { code, name: n, sessionId }));
}

export function leaveRoom(): void {
  socket.emit('room:leave');
  write('refrain:session', null);
  app.state = null;
  app.me = '';
  void audio.apply(null);
  navigate({ name: 'home' });
}

export async function updateSettings(opts: { theme?: string; rounds?: number }): Promise<string | null> {
  const r = await socket.timeout(8000).emitWithAck('room:settings', opts).catch(() => ({ ok: false, error: 'Pas de réponse' }));
  return r.ok ? null : (r.error ?? 'Erreur');
}

export async function unlockAudio(): Promise<void> {
  await audio.unlock();
  app.audioLocked = false;
  if (app.state) void audio.apply(app.state.playback);
}

export const start = () => socket.emit('game:start');
export const again = () => socket.emit('game:again');
export const buzz = () => socket.emit('buzz');
export const answer = (text: string) => socket.emit('answer', text);
