import { Room, type RoomDeps } from './room.ts';
import { memoryStore, type RoomStore } from './store.ts';

// Sans I, O, 0, 1 : un code qui se dicte à voix haute sans ambiguïté.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOBBY_GRACE_MS = 30_000;
const EMPTY_ROOM_MS = 5 * 60_000;
/** Les changements d'un salon arrivent en rafale (buzz, ping, joueurs) : une écriture groupée suffit. */
const SAVE_DELAY_MS = 100;

export class Rooms {
  private rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout;
  private readonly deps: RoomDeps;
  private dirty = new Set<Room>();
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(
    deps: RoomDeps,
    private readonly store: RoomStore = memoryStore(),
  ) {
    this.deps = {
      ...deps,
      onChange: (room) => {
        deps.onChange(room);
        this.persist(room);
      },
    };
    this.sweeper = setInterval(() => this.sweep(), 10_000);
    this.sweeper.unref();
  }

  /** Recharge les salons sauvegardés : un redéploiement ne coupe pas les parties en cours. */
  async restore(): Promise<number> {
    const saved = await this.store.loadAll();
    for (const data of saved) {
      if (this.rooms.has(data.code)) continue;
      this.rooms.set(data.code, Room.restore(data, this.deps));
    }
    return saved.length;
  }

  create(): Room {
    let code: string;
    do {
      code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, this.deps);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  /** Dans le salon d'attente, un joueur parti est retiré après 30 s ; en partie, il garde sa place et son score. */
  sweep(now = Date.now()): void {
    for (const room of this.rooms.values()) {
      for (const p of room.players.values()) {
        if (room.phase === 'lobby' && p.offlineSince && now - p.offlineSince > LOBBY_GRACE_MS) room.remove(p.id);
      }
      const lastSeen = Math.max(room.lastActive, ...[...room.players.values()].map((p) => p.offlineSince ?? 0));
      const abandoned = room.online().length === 0 && now - lastSeen > EMPTY_ROOM_MS;
      if (abandoned || room.players.size === 0) this.delete(room);
    }
  }

  private delete(room: Room): void {
    room.destroy();
    this.rooms.delete(room.code);
    this.dirty.delete(room);
    void this.store.remove(room.code).catch(() => {});
  }

  private persist(room: Room): void {
    this.dirty.add(room);
    this.saveTimer ??= setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const rooms = [...this.dirty].filter((r) => this.rooms.has(r.code));
    this.dirty.clear();
    await Promise.allSettled(rooms.map((r) => this.store.save(r.serialize())));
  }

  /** Arrêt du serveur : on écrit ce qui reste, sans effacer les salons du stockage. */
  async close(): Promise<void> {
    clearInterval(this.sweeper);
    await this.flush();
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
    await this.store.close();
  }
}
