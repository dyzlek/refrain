<script lang="ts">
  import { app, createRoom, joinRoom, navigate } from '../lib/game.svelte.ts';
  import Visualizer from '../components/Visualizer.svelte';

  let name = $state(app.name);
  let code = $state(app.route.name === 'home' ? (app.route.code ?? '') : '');
  const invited = app.route.name === 'home' && !!app.route.code;
  const canPlay = $derived(name.trim().length > 0 && !app.busy && app.connected);

  function create(e: SubmitEvent) {
    e.preventDefault();
    if (canPlay) void createRoom(name);
  }

  function join(e: SubmitEvent) {
    e.preventDefault();
    if (canPlay && code.trim().length === 4) void joinRoom(code.trim().toUpperCase(), name);
  }
</script>

<main class="home">
  <div class="viz" aria-hidden="true"><Visualizer idle /></div>

  <h1 class="display title">Re<span class="accent">frain</span></h1>
  <p class="lede">Blind test multijoueur en temps réel. La musique démarre au même instant chez tout le monde : le premier qui buzze répond.</p>

  <div class="panel">
    <label class="mono muted" for="name">Ton pseudo</label>
    <input id="name" class="field" maxlength="20" autocomplete="nickname" placeholder="Dylan" bind:value={name} />

    {#if invited}
      <form onsubmit={join}>
        <p class="mono muted">Invitation au salon <span class="accent">{code}</span></p>
        <button class="btn btn--accent" disabled={!canPlay}>Rejoindre <span>→</span></button>
      </form>
    {:else}
      <form onsubmit={create}>
        <button class="btn btn--accent" disabled={!canPlay}>Créer un salon <span>→</span></button>
      </form>
      <form class="join" onsubmit={join}>
        <input
          class="field code"
          maxlength="4"
          placeholder="CODE"
          aria-label="Code du salon"
          autocapitalize="characters"
          bind:value={code}
        />
        <button class="btn" disabled={!canPlay || code.trim().length !== 4}>Rejoindre</button>
      </form>
    {/if}

    {#if app.error}<p class="error mono" role="alert">{app.error}</p>{/if}
  </div>

  <ol class="rules mono muted">
    <li><span>01</span>Crée un salon, partage le code</li>
    <li><span>02</span>Choisis un style ou colle une playlist Deezer</li>
    <li><span>03</span>Buzze (espace) et tape le titre ou l’artiste</li>
  </ol>
  <a class="board mono" href="/classement" onclick={(e) => { e.preventDefault(); navigate({ name: 'board' }); }}>Classement →</a>
</main>

<style>
  .home {
    position: relative;
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    grid-template-rows: auto 1fr auto;
    gap: 32px var(--gutter);
    padding: clamp(24px, 5vw, 64px) var(--gutter) 32px;
    overflow: hidden;
  }
  .viz {
    position: absolute;
    right: -12vw;
    top: 50%;
    width: min(80vw, 900px);
    aspect-ratio: 1;
    transform: translateY(-50%);
    opacity: 0.55;
    pointer-events: none;
  }
  .title {
    position: relative;
    grid-column: 1 / -1;
    font-size: clamp(4rem, 24vw, 22rem);
  }
  .lede { position: relative; max-width: 34ch; font-size: 1.1rem; align-self: start; }
  .panel {
    position: relative;
    grid-row: 2 / 4;
    grid-column: 2;
    display: flex;
    flex-direction: column;
    gap: 14px;
    align-self: start;
    background: var(--bg);
    padding: 20px 0;
  }
  .panel form { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
  .join { flex-direction: row !important; align-items: end; }
  .join .code { flex: 1; text-transform: uppercase; letter-spacing: 0.3em; font-family: var(--font-mono); }
  .error { color: var(--accent); }
  .rules { position: relative; display: flex; flex-direction: column; gap: 6px; align-self: end; }
  .rules span { color: var(--accent); margin-right: 12px; }
  .board { position: relative; align-self: end; justify-self: start; text-decoration: none; border-bottom: 1px solid var(--accent); padding-bottom: 2px; }

  @media (max-width: 760px) {
    .home { grid-template-columns: 1fr; grid-template-rows: auto; }
    .panel { grid-row: auto; grid-column: auto; }
    .viz { right: -40vw; top: 18%; width: 120vw; opacity: 0.35; }
  }
</style>
