CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_code" text NOT NULL,
	"theme" text NOT NULL,
	"rounds" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"name" text NOT NULL,
	"score" integer NOT NULL,
	"rank" integer NOT NULL,
	"found" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"position" integer NOT NULL,
	"track_id" text NOT NULL,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"winner" text,
	"reaction_ms" integer
);
--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "results_score_idx" ON "results" USING btree ("score");--> statement-breakpoint
CREATE INDEX "rounds_reaction_idx" ON "rounds" USING btree ("reaction_ms");