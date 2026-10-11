import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { desc, eq, isNotNull, asc, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  close(): Promise<void>;
}

// Le dossier des migrations n'est pas au même endroit selon qu'on lance src/ (tsx) ou dist/ (build).
function migrationsFolder(): string {
  const candidates = ['../../drizzle', '../drizzle'].map((p) => fileURLToPath(new URL(p, import.meta.url)));
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Dossier drizzle/ introuvable');
  return found;
}

/**
 * Avec DATABASE_URL : un vrai PostgreSQL (prod, Docker).
 * Sans : PGlite, le même Postgres compilé en WebAssembly, en mémoire ou dans un dossier.
 * Même schéma, mêmes requêtes, et aucun service à installer pour développer.
 */
export async function openDatabase(opts: { url?: string; dir?: string } = {}): Promise<Database> {
  if (opts.url) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({ connectionString: opts.url });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    return { db: db as unknown as Db, close: () => pool.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite(opts.dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return { db: db as unknown as Db, close: () => client.close() };
}

export interface GameSummary {
  roomCode: string;
  theme: string;
  rounds: number;
  startedAt: Date;
  players: { name: string; score: number; found: number }[];
  history: { trackId: string; title: string; artist: string; winner: string | null; reactionMs: number | null }[];
}

export async function saveGame(db: Db, g: GameSummary): Promise<number> {
  return db.transaction(async (tx) => {
    const [game] = await tx
      .insert(schema.games)
      .values({ roomCode: g.roomCode, theme: g.theme, rounds: g.rounds, startedAt: g.startedAt })
      .returning({ id: schema.games.id });
    const ranked = [...g.players].sort((a, b) => b.score - a.score);
    if (ranked.length) {
      await tx.insert(schema.results).values(
        ranked.map((p, i) => ({ gameId: game.id, name: p.name, score: p.score, found: p.found, rank: i + 1 })),
      );
    }
    if (g.history.length) {
      await tx.insert(schema.rounds).values(g.history.map((r, i) => ({ ...r, gameId: game.id, position: i + 1 })));
    }
    return game.id;
  });
}

export async function leaderboard(db: Db) {
  const best = await db
    .select({
      name: schema.results.name,
      score: schema.results.score,
      found: schema.results.found,
      theme: schema.games.theme,
      date: schema.games.endedAt,
    })
    .from(schema.results)
    .innerJoin(schema.games, eq(schema.results.gameId, schema.games.id))
    .orderBy(desc(schema.results.score))
    .limit(10);

  const fastest = await db
    .select({
      name: schema.rounds.winner,
      reactionMs: schema.rounds.reactionMs,
      title: schema.rounds.title,
      artist: schema.rounds.artist,
    })
    .from(schema.rounds)
    .where(isNotNull(schema.rounds.reactionMs))
    .orderBy(asc(schema.rounds.reactionMs))
    .limit(10);

  const [totals] = await db
    .select({ games: sql<number>`count(*)::int` })
    .from(schema.games);

  return { best, fastest, games: totals?.games ?? 0 };
}

export async function gameDetail(db: Db, id: number) {
  const game = await db.query.games.findFirst({ where: eq(schema.games.id, id) });
  if (!game) return null;
  const players = await db.select().from(schema.results).where(eq(schema.results.gameId, id)).orderBy(asc(schema.results.rank));
  const history = await db.select().from(schema.rounds).where(eq(schema.rounds.gameId, id)).orderBy(asc(schema.rounds.position));
  return { ...game, players, rounds: history };
}
