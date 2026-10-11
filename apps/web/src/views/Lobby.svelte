<script lang="ts">
  import { onMount } from 'svelte';
  import { ROUND_OPTIONS, type Theme } from '@shared/protocol';
  import { app, leaveRoom, start, updateSettings } from '../lib/game.svelte.ts';
  import Scores from '../components/Scores.svelte';

  const s = $derived(app.state!);
  const host = $derived(s.players.find((p) => p.id === app.me)?.host ?? false);

  let themes = $state<Theme[]>([]);
  let playlist = $state('');
  let pending = $state(false);
  let error = $state('');
  let copied = $state(false);

  onMount(async () => {
    try {
      themes = await (await fetch('/api/themes')).json();
    } catch {
      themes = [];
    }
  });

  async function set(opts: { theme?: string; rounds?: number }) {
    pending = true;
    error = (await updateSettings(opts)) ?? '';
    pending = false;
    if (!error && opts.theme === playlist) playlist = '';
  }

  async function share() {
    const url = `${location.origin}/${s.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Refrain', text: `Rejoins mon blind test : ${s.code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        copied = true;
        setTimeout(() => (copied = false), 2000);
      }
    } catch {
      /* partage annulé */
    }
  }

  const isCustom = $derived(s.theme.id.startsWith('playlist:'));
</script>

<header class="topbar">
  <span class="mono"><span class="sq"></span>Salon d’attente</span>
  <button class="mono" onclick={leaveRoom}>Quitter</button>
</header>

<main class="lobby">
  <section class="code">
    <p class="mono muted">Code du salon</p>
    <h1 class="display">{s.code}</h1>
    <button class="btn" onclick={share}>{copied ? 'Lien copié' : 'Inviter des joueurs'} <span>↗</span></button>
  </section>

  <section class="players">
    <p class="mono muted">{s.players.length} joueur{s.players.length > 1 ? 's' : ''}</p>
    <Scores players={s.players} me={app.me} />
  </section>

  <section class="settings">
    <div>
      <p class="mono muted">Style</p>
      <div class="chips">
        {#each themes as t (t.id)}
          <button class="chip" aria-pressed={s.theme.id === t.id} disabled={!host || pending} onclick={() => set({ theme: t.id })}>{t.label}</button>
        {/each}
        {#if isCustom}
          <button class="chip" aria-pressed="true" disabled>{s.theme.label}</button>
        {/if}
      </div>
    </div>

    {#if host}
      <form class="playlist" onsubmit={(e) => { e.preventDefault(); if (playlist.trim()) void set({ theme: playlist.trim() }); }}>
        <input class="field" placeholder="ou colle un lien de playlist Deezer" bind:value={playlist} />
        <button class="btn" disabled={pending || !playlist.trim()}>OK</button>
      </form>
    {/if}

    <div>
      <p class="mono muted">Manches</p>
      <div class="chips">
        {#each ROUND_OPTIONS as n (n)}
          <button class="chip" aria-pressed={s.rounds === n} disabled={!host || pending} onclick={() => set({ rounds: n })}>{n}</button>
        {/each}
      </div>
    </div>

    {#if error}<p class="mono accent" role="alert">{error}</p>{/if}

    {#if host}
      <button class="btn btn--accent go" onclick={start} disabled={pending}>Lancer la partie <span>→</span></button>
    {:else}
      <p class="mono muted wait"><span class="sq"></span>{s.players.find((p) => p.host)?.name ?? 'L’hôte'} lance la partie quand tout le monde est là</p>
    {/if}
  </section>
</main>

<style>
  .lobby {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 40px var(--gutter);
    padding: clamp(24px, 4vw, 56px) var(--gutter);
    align-content: start;
  }
  .code { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: end; gap: 12px 32px; }
  .code p { width: 100%; }
  .code h1 { font-size: clamp(7rem, 30vw, 24rem); letter-spacing: 0.02em; color: var(--accent); }
  .players, .settings { display: flex; flex-direction: column; gap: 14px; }
  .settings { gap: 28px; }
  .settings > div { display: flex; flex-direction: column; gap: 12px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .playlist { display: flex; gap: 12px; align-items: end; }
  .playlist .field { font-size: 0.95rem; }
  .go { min-height: 64px; font-size: 0.95rem; }
  .wait { line-height: 1.8; }

  @media (max-width: 760px) {
    .lobby { grid-template-columns: 1fr; }
  }
</style>
