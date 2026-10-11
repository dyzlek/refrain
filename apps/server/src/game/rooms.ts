import { Room, type RoomDeps } from './room.ts';

// Sans I, O, 0, 1 : un code qui se dicte à voix haute sans ambiguïté.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOBBY_GRACE_MS = 30_000;
const EMPTY_ROOM_MS = 5 * 60_000;

export class Rooms {
  private rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout;

  constructor(private readonly deps: RoomDeps) {
    this.sweeper = setInterval(() => this.sweep(), 10_000);
    this.sweeper.unref();
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
      const empty = room.online().length === 0;
      if (empty && now - Math.max(room.lastActive, ...[...room.players.values()].map((p) => p.offlineSince ?? 0)) > EMPTY_ROOM_MS) {
        room.destroy();
        this.rooms.delete(room.code);
      }
      if (room.players.size === 0) {
        room.destroy();
        this.rooms.delete(room.code);
      }
    }
  }

  close(): void {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }
}
