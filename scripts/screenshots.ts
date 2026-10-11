// Génère les captures du README avec une vraie partie : vrais extraits Deezer, l'hôte dans un Chrome
// sans fenêtre (piloté par le protocole DevTools) et trois joueurs robots via socket.io-client.
//   npm run build && npx tsx scripts/screenshots.ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import type { RoomState } from '@shared/protocol';
import { buildApp } from '../apps/server/src/app.ts';
import { deezer, fetchAudio, type Track } from '../apps/server/src/music/deezer.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'docs');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------ serveur, avec la réponse visible pour les robots */

const source = deezer();
const byPreview = new Map<string, Track>();
let answer: Track | null = null;
const { app } = await buildApp({
  clientDir: path.join(root, 'apps/web/dist'),
  source: {
    ...source,
    async tracks(id) {
      const list = await source.tracks(id);
      for (const t of list) byPreview.set(t.preview, t);
      return list;
    },
  },
  fetchAudio: async (url) => {
    answer = byPreview.get(url) ?? answer;
    return fetchAudio(url);
  },
});
await app.listen({ port: 3100, host: '127.0.0.1' });
const base = 'http://127.0.0.1:3100';

/* ------------------------------------------------ Chrome sans fenêtre */

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
if (!chrome) throw new Error('Chrome introuvable');
const port = 9400 + Math.floor(Math.random() * 400);
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-shot-'))}`,
  '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

let target: { webSocketDebuggerUrl: string } | undefined;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  target = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).then((l) => l.find((t: { type: string }) => t.type === 'page')).catch(() => undefined);
}
if (!target) throw new Error('Chrome ne répond pas');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map<number, (v: any) => void>();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(String(e.data));
  pending.get(msg.id)?.(msg.result);
  pending.delete(msg.id);
});
const send = (method: string, params: object = {}) =>
  new Promise<any>((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = (expression: string) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then((r) => r?.result?.value);

const viewport = (width: number, height: number, mobile = false) =>
  send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });

async function shot(name: string) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(data, 'base64'));
  console.log('capture', name);
}

const click = (text: string) =>
  evaluate(`[...document.querySelectorAll('button, a')].find((b) => b.textContent.trim().toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())}))?.click()`);

await send('Page.enable');
await viewport(1440, 900);

/* ------------------------------------------------ la partie */

await send('Page.navigate', { url: base });
await sleep(2500);
await shot('accueil');

await evaluate(`(() => { const i = document.querySelector('#name'); i.value = 'Dylan'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await click('Créer un salon');
await sleep(1000);
const code: string = await evaluate('location.pathname.slice(1)');

const bots = ['Léa', 'Nico', 'Sam'].map((name) => {
  const s = io(base, { transports: ['websocket'] });
  const bot = { name, s, state: null as RoomState | null };
  s.on('probe', (ack) => ack());
  s.on('state', (st: RoomState) => {
    if (st.phase === 'loading' && st.audioUrl && bot.state?.audioUrl !== st.audioUrl) setTimeout(() => s.emit('round:ready', st.round), 200);
    bot.state = st;
  });
  s.emit('room:join', { code, name }, () => {});
  return bot;
});
const [lea, nico, sam] = bots;

await sleep(1500);
await click('Chanson française');
await sleep(800);
await click('5');
await sleep(4000); // le temps que les pings s'affichent
await shot('salon');

const host = () => bots[0].state!;
const waitPhase = async (phase: string, round?: number) => {
  for (let i = 0; i < 300; i++) {
    const s = host();
    if (s?.phase === phase && (round === undefined || s.round === round)) return;
    await sleep(100);
  }
  throw new Error(`phase ${phase} jamais atteinte`);
};
const win = async (bot: (typeof bots)[number], after: number, useTitle = false) => {
  await sleep(after);
  bot.s.emit('buzz');
  await waitPhase('answering');
  await sleep(700);
  bot.s.emit('answer', useTitle ? answer!.titleShort : answer!.artist);
};

await click('Lancer la partie');

// Manche 1 : l'écoute, une mauvaise réponse, un buzz, puis la révélation.
await waitPhase('playing', 1);
await sleep(5500);
await shot('ecoute');
lea.s.emit('buzz');
await waitPhase('answering');
await sleep(900);
lea.s.emit('answer', 'Angèle ?');
await waitPhase('playing');
await sleep(2500);
nico.s.emit('buzz');
await waitPhase('answering');
await sleep(1200);
await shot('buzz');
nico.s.emit('answer', answer!.artist);
await waitPhase('reveal', 1);
await sleep(2000);
await shot('revelation');

await waitPhase('playing', 2);
await win(sam, 2500, true);

// Manche 3 : capture mobile pendant l'écoute.
await waitPhase('playing', 3);
await viewport(390, 844, true);
await sleep(5000);
await shot('mobile');
await viewport(1440, 900);
await win(lea, 500);

await waitPhase('playing', 4);
await win(nico, 3000, true);
await waitPhase('playing', 5);
await win(lea, 4000);

await waitPhase('ended');
await sleep(2500);
await shot('fin');

await click('Classement général');
await sleep(2000);
await shot('classement');

for (const b of bots) b.s.disconnect();
ws.close();
proc.kill();
await app.close();
process.exit(0);
