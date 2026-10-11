<script lang="ts">
  import { onMount } from 'svelte';
  import { app, navigate } from '../lib/game.svelte.ts';

  interface Board {
    games: number;
    best: { name: string; score: number; found: number; theme: string; date: string }[];
    fastest: { name: string | null; reactionMs: number; title: string; artist: string }[];
  }

  let board = $state<Board | null>(null);
  let failed = $state(false);

  onMount(async () => {
    try {
      const res = await fetch('/api/leaderboard');
      if (!res.ok) throw new Error();
      board = await res.json();
    } catch {
      failed = true;
    }
  });

  function back() {
    navigate(app.state ? { name: 'room', code: app.state.code } : { name: 'home' });
  }

  const seconds = (ms: number) => (ms / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
</script>

<header class="topbar">
  <button class="mono" onclick={back}>← {app.state ? 'Retour au salon' : 'Accueil'}</button>
  <span class="mono muted">{board ? `${board.games} partie${board.games > 1 ? 's' : ''} jouée${board.games > 1 ? 's' : ''}` : ''}</span>
</header>

<main class="board">
  <h1 class="display">Classement</h1>

  {#if failed}
    <p class="mono accent">Classement indisponible</p>
  {:else if !board}
    <p class="mono muted">Chargement…</p>
  {:else}
    <section>
      <h2 class="mono muted"><span class="sq"></span>Meilleurs scores</h2>
      {#if !board.best.length}<p class="muted">Aucune partie terminée pour l’instant.</p>{/if}
      <ol>
        {#each board.best as b, i}
          <li>
            <span class="mono muted">{String(i + 1).padStart(2, '0')}</span>
            <span>{b.name} <span class="muted">· {b.theme}</span></span>
            <span class="mono muted">{date(b.date)}</span>
            <span class="display n">{b.score}</span>
          </li>
        {/each}
      </ol>
    </section>

    <section>
      <h2 class="mono muted"><span class="sq"></span>Buzz les plus rapides</h2>
      {#if !board.fastest.length}<p class="muted">Personne n’a encore trouvé de titre.</p>{/if}
      <ol>
        {#each board.fastest as f, i}
          <li>
            <span class="mono muted">{String(i + 1).padStart(2, '0')}</span>
            <span>{f.name} <span class="muted">· {f.title}, {f.artist}</span></span>
            <span></span>
            <span class="display n">{seconds(f.reactionMs)}<small>s</small></span>
          </li>
        {/each}
      </ol>
    </section>
  {/if}
</main>

<style>
  .board { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px var(--gutter); padding: clamp(24px, 4vw, 56px) var(--gutter); align-content: start; }
  h1 { grid-column: 1 / -1; font-size: clamp(5rem, 18vw, 16rem); }
  section { display: flex; flex-direction: column; gap: 14px; }
  ol { border-top: 1px solid var(--line); }
  li { display: grid; grid-template-columns: 2.2em 1fr auto auto; gap: 12px; align-items: baseline; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .n { font-size: 1.9rem; min-width: 2.4em; text-align: right; }
  small { font-size: 0.5em; margin-left: 2px; }
  @media (max-width: 760px) { .board { grid-template-columns: 1fr; } }
</style>
