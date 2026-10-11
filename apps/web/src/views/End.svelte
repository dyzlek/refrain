<script lang="ts">
  import { again, app, leaveRoom, navigate } from '../lib/game.svelte.ts';

  const s = $derived(app.state!);
  const host = $derived(s.players.find((p) => p.id === app.me)?.host ?? false);
  const ranked = $derived([...s.players].sort((a, b) => b.score - a.score));
  const podium = $derived(ranked.slice(0, 3));
  const fastest = $derived(
    s.history.filter((h) => h.reactionMs !== null).sort((a, b) => a.reactionMs! - b.reactionMs!)[0] ?? null,
  );
  const found = $derived(s.history.filter((h) => h.winnerId).length);
  const seconds = (ms: number) => (ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
</script>

<header class="topbar">
  <span class="mono"><span class="sq"></span>Fin de partie · {s.theme.label}</span>
  <button class="mono" onclick={leaveRoom}>Quitter</button>
</header>

<main class="end">
  <section class="podium">
    {#each podium as p, i (p.id)}
      <div class="step" class:first={i === 0} style:--d="{i * 120}ms">
        <span class="mono muted">{['1er', '2e', '3e'][i]}</span>
        <h2 class="display" class:accent={p.id === app.me}>{p.name}</h2>
        <p class="display score">{p.score}</p>
        <p class="mono muted">{p.found} trouvé{p.found > 1 ? 's' : ''}</p>
      </div>
    {/each}
  </section>

  <section class="stats mono">
    <p><span class="muted">Trouvés</span> {found}/{s.history.length}</p>
    {#if fastest}
      <p><span class="muted">Plus rapide</span> {fastest.winnerName} sur « {fastest.title} » en {seconds(fastest.reactionMs!)} s</p>
    {/if}
    <p class="muted">{s.gameId ? `Partie n° ${s.gameId} enregistrée` : 'Enregistrement…'}</p>
  </section>

  <ol class="tracks">
    {#each s.history as h (h.round)}
      <li>
        {#if h.cover}<img src={h.cover} alt="" width="56" height="56" loading="lazy" />{/if}
        <span><b>{h.title}</b><br /><span class="muted">{h.artist}</span></span>
        <span class="mono" class:muted={!h.winnerName}>{h.winnerName ?? '—'}</span>
      </li>
    {/each}
  </ol>

  <div class="actions">
    {#if host}
      <button class="btn btn--accent" onclick={again}>Rejouer <span>↻</span></button>
    {:else}
      <p class="mono muted"><span class="sq"></span>L’hôte peut relancer une partie</p>
    {/if}
    <button class="btn" onclick={() => navigate({ name: 'board' })}>Classement général <span>→</span></button>
  </div>
</main>

<style>
  .end { flex: 1; display: flex; flex-direction: column; gap: 40px; padding: clamp(24px, 4vw, 56px) var(--gutter); }
  .podium { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gutter); align-items: end; }
  .step { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--line); padding-top: 14px; animation: rise 0.7s var(--ease-out) both; animation-delay: var(--d); }
  .step h2 { font-size: clamp(2.6rem, 7vw, 5rem); overflow-wrap: anywhere; }
  .first { border-top: 3px solid var(--accent); }
  .first h2 { font-size: clamp(4rem, 12vw, 10rem); }
  .score { font-size: clamp(2rem, 4vw, 3rem); }
  @keyframes rise { from { transform: translateY(30px); opacity: 0; } }
  .stats { display: flex; flex-wrap: wrap; gap: 8px 32px; }
  .tracks { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px var(--gutter); }
  .tracks li { display: grid; grid-template-columns: 56px 1fr auto; gap: 12px; align-items: center; font-size: 0.9rem; }
  .tracks img { width: 56px; height: 56px; object-fit: cover; }
  .tracks b { font-weight: 500; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  @media (max-width: 640px) {
    .podium { grid-template-columns: 1fr; }
  }
</style>
