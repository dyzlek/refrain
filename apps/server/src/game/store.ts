import type { RoomData } from './room.ts';

// Où vivent les salons entre deux redémarrages du serveur.
// Les minuteurs et les extraits restent en mémoire ; seul l'état nécessaire pour reprendre est sauvegardé.

export interface RoomStore {
  save(room: RoomData): Promise<void>;
  remove(code: string): Promise<void>;
  loadAll(): Promise<RoomData[]>;
  close(): Promise<void>;
}

/** Un salon sans activité pendant une heure disparaît tout seul de Redis. */
export const ROOM_TTL_SECONDS = 60 * 60;
const PREFIX = 'refrain:room:';

/** Sans Redis : rien ne survit au redémarrage. Partagé entre deux instances, il sert aussi aux tests. */
export function memoryStore(): RoomStore {
  const rooms = new Map<string, string>();
  return {
    async save(room) {
      rooms.set(room.code, JSON.stringify(room));
    },
    async remove(code) {
      rooms.delete(code);
    },
    async loadAll() {
      return [...rooms.values()].map((r) => JSON.parse(r) as RoomData);
    },
    async close() {},
  };
}

export async function redisStore(url: string, onError: (err: Error) => void = () => {}): Promise<RoomStore> {
  const { createClient } = await import('redis');
  const client = createClient({ url });
  client.on('error', onError);
  await client.connect();

  return {
    async save(room) {
      await client.setEx(PREFIX + room.code, ROOM_TTL_SECONDS, JSON.stringify(room));
    },
    async remove(code) {
      await client.del(PREFIX + code);
    },
    async loadAll() {
      const rooms: RoomData[] = [];
      for await (const keys of client.scanIterator({ MATCH: `${PREFIX}*`, COUNT: 100 })) {
        if (!keys.length) continue;
        for (const raw of await client.mGet(keys)) {
          if (!raw) continue;
          try {
            rooms.push(JSON.parse(raw) as RoomData);
          } catch {
            /* entrée illisible : ignorée */
          }
        }
      }
      return rooms;
    },
    async close() {
      await client.close();
    },
  };
}
