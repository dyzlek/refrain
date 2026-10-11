<script lang="ts">
  import { app, unlockAudio } from './lib/game.svelte.ts';
  import Home from './views/Home.svelte';
  import Lobby from './views/Lobby.svelte';
  import Game from './views/Game.svelte';
  import End from './views/End.svelte';
  import Board from './views/Board.svelte';

  const phase = $derived(app.state?.phase);
</script>

{#if app.route.name === 'board'}
  <Board />
{:else if app.route.name === 'room' && app.state}
  {#if phase === 'lobby'}
    <Lobby />
  {:else if phase === 'ended'}
    <End />
  {:else}
    <Game />
  {/if}
{:else if app.route.name === 'room'}
  <div class="wait">
    <p class="mono muted"><span class="sq"></span>Reconnexion au salon {app.route.code}…</p>
  </div>
{:else}
  <Home />
{/if}

{#if !app.connected}
  <div class="offline mono" role="status">Connexion perdue · reconnexion…</div>
{/if}

{#if app.audioLocked && app.state}
  <button class="unlock" onclick={unlockAudio}>
    <span class="display">Activer le son</span>
    <span class="mono muted">Le navigateur attend un geste avant de jouer de la musique</span>
  </button>
{/if}

<ol class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <li class="mono">{t.text}</li>
  {/each}
</ol>

<style>
  .wait { flex: 1; display: grid; place-items: center; padding: var(--gutter); }
  .offline {
    position: fixed; top: 0; left: 0; right: 0; z-index: 50;
    background: var(--accent); color: var(--on-accent); text-align: center; padding: 6px;
  }
  .unlock {
    position: fixed; inset: 0; z-index: 40;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    padding: var(--gutter);
    text-align: center;
  }
  .unlock .display { font-size: clamp(4rem, 14vw, 10rem); color: var(--accent); }
  .toasts {
    position: fixed; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom)); z-index: 45;
    transform: translateX(-50%);
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    width: min(92vw, 520px);
    pointer-events: none;
  }
  .toasts li {
    background: var(--fg); color: var(--bg); padding: 10px 14px; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    animation: pop 0.35s var(--ease-out);
  }
  @keyframes pop { from { transform: translateY(12px); opacity: 0; } }
</style>
