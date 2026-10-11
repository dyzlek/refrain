import { integer, pgTable, serial, text, timestamp, index } from 'drizzle-orm/pg-core';

export const games = pgTable('games', {
  id: serial('id').primaryKey(),
  roomCode: text('room_code').notNull(),
  theme: text('theme').notNull(),
  rounds: integer('rounds').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull().defaultNow(),
});

export const results = pgTable(
  'results',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    score: integer('score').notNull(),
    rank: integer('rank').notNull(),
    found: integer('found').notNull(),
  },
  (t) => [index('results_score_idx').on(t.score)],
);

export const rounds = pgTable(
  'rounds',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    trackId: text('track_id').notNull(),
    title: text('title').notNull(),
    artist: text('artist').notNull(),
    winner: text('winner'),
    reactionMs: integer('reaction_ms'),
  },
  (t) => [index('rounds_reaction_idx').on(t.reactionMs)],
);
