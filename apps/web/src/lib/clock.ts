import { clockOffset, type ClockSample } from '@shared/timing';
import type { Socket } from './socket.ts';

// Chaque appareil a sa propre horloge, parfois décalée de plusieurs secondes.
// On estime l'heure du serveur pour que tout le monde lance l'extrait au même instant.

let offset = 0;
let samples: ClockSample[] = [];

export const serverNow = () => Date.now() + offset;

async function sample(socket: Socket): Promise<void> {
  const sent = Date.now();
  const server = await socket.timeout(2000).emitWithAck('clock');
  samples.push({ sent, received: Date.now(), serverNow: server });
  samples = samples.slice(-12);
}

export async function syncClock(socket: Socket, count = 6): Promise<void> {
  for (let i = 0; i < count; i++) {
    try {
      await sample(socket);
    } catch {
      /* échantillon perdu, on continue */
    }
  }
  offset = clockOffset(samples).offset;
}

/** Une resynchro légère de temps en temps : les horloges dérivent lentement. */
export function keepClockInSync(socket: Socket): () => void {
  const id = setInterval(() => void syncClock(socket, 2), 15_000);
  return () => clearInterval(id);
}

export function resetClock(): void {
  samples = [];
}
