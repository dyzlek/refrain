<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { ANSWER_MS, CLIP_SECONDS } from '@shared/protocol';
  import { positionAt } from '@shared/timing';
  import { answer, app, buzz, leaveRoom } from '../lib/game.svelte.ts';
  import { serverNow } from '../lib/clock.ts';
  import Visualizer from '../components/Visualizer.svelte';
  import Scores from '../components/Scores.svelte';

  const s = $derived(app.state!);
  const me = $derived(s.players.find((p) => p.id === app.me));
  const buzzer = $derived(s.buzz ? s.players.find((p) => p.id === s.buzz!.playerId) : null);
  const myTurn = $derived(s.phase === 'answering' && s.buzz?.playerId === app.me);

  // Une horloge locale, recalée sur celle du serveur, pour les comptes à rebours et la barre de progression.
  let now = $state(serverNow());
  onMount(() => {
    let raf = requestAnimationFrame(function loop() {
      now = serverNow();
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  });

  const countdown = $derived(s.phase === 'playing' && s.playback && now < s.playback.anchor ? Math.ceil((s.playback.anchor - now) / 1000) : 0);
  const progress = $derived(s.playback ? Math.min(Math.max(positionAt(s.playback, now) / CLIP_SECONDS, 0), 1) : 0);
  const answerLeft = $derived(s.buzz ? Math.max(0, s.buzz.deadline - now) : 0);
  const canBuzz = $derived(s.phase === 'playing' && !countdown && !!me && !me.lockedOut);

  let guess = $state('');
  let input = $state<HTMLInputElement>();
  let pressed = $state(false);

  $effect(() => {
    if (myTurn) {
      guess = '';
      void tick().then(() => input?.focus());
    }
  });

  function press() {
    if (!canBuzz) return;
    pressed = true;
    setTimeout(() => (pressed = false), 180);
    buzz();
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (guess.trim()) answer(guess.trim());
  }

  function onKey(e: KeyboardEvent) {
    if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement).closest('input')) return;
    e.preventDefault();
    press();
  }

  const seconds = (ms: number) => (ms / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
</script>

<svelte:window onkeydown={onKey} />

<header class="topbar">
  <span class="mono"><span class="sq"></span>Manche {s.round}/{s.rounds} · {s.theme.label}</span>
  <span class="mono muted">{s.code}</span>
  <button class="mono" onclick={leaveRoom}>Quitter</button>
</header>

<div class="progress" style:transform="scaleX({progress})" aria-hidden="true"></div>

<main class="game">
  <section class="stage" class:dim={s.phase === 'answering' || s.phase === 'reveal'}>
    <div class="viz"><Visualizer intensity={s.phase === 'answering' ? 0.3 : 1} /></div>

    <div class="center">
      {#if s.phase === 'loading'}
        <div class="block" in:fade>
          <p class="mono muted">Chargement de l’extrait</p>
          <h2 class="display big">Manche {s.round}</h2>
        </div>
      {:else if countdown}
        {#key countdown}
          <p class="display count" in:fly={{ y: 40, duration: 300 }}>{countdown}</p>
        {/key}
      {:else if s.phase === 'playing'}
        {#if me?.lockedOut}
          <p class="mono muted" in:fade>Bloqué pour cette manche</p>
        {:else}
          <button class="buzz" class:pressed onclick={press} disabled={!canBuzz} aria-keyshortcuts="Space">
            <span class="display">Buzz</span>
            <span class="mono">espace</span>
          </button>
        {/if}
      {:else if s.phase === 'answering' && buzzer}
        <div class="block" in:fly={{ y: 30, duration: 350 }}>
          <h2 class="display big">{myTurn ? 'À toi' : buzzer.name}</h2>
          <p class="mono muted">{myTurn ? 'Titre ou artiste' : 'a buzzé'}</p>
          {#if myTurn}
            <form onsubmit={submit} class="answer">
              <input bind:this={input} bind:value={guess} class="field" maxlength="100" autocomplete="off" placeholder="Tape ta réponse" aria-label="Ta réponse" />
              <button class="btn btn--accent">Valider</button>
            </form>
          {/if}
          <div class="timer" aria-hidden="true"><span style:transform="scaleX({answerLeft / ANSWER_MS})"></span></div>
        </div>
      {:else if s.phase === 'reveal' && s.reveal}
        <div class="reveal" in:fade={{ duration: 250 }}>
          {#if s.reveal.cover}<img src={s.reveal.cover} alt="" width="500" height="500" />{/if}
          <div>
            <p class="mono muted">{s.reveal.artist}</p>
            <h2 class="display title">{s.reveal.title}</h2>
            {#if s.reveal.winnerName}
              <p class="mono">
                <span class="accent">{s.reveal.winnerName}</span> en {seconds(s.reveal.reactionMs ?? 0)} s · +{s.reveal.points}
              </p>
            {:else}
              <p class="mono muted">Personne n’a trouvé</p>
            {/if}
            <a class="mono muted" href={s.reveal.link} target="_blank" rel="noreferrer">Écouter sur Deezer ↗</a>
          </div>
        </div>
      {/if}
    </div>
  </section>

  <aside class="side">
    <Scores players={s.players} me={app.me} buzzer={s.phase === 'answering' ? (s.buzz?.playerId ?? null) : null} compact />
    {#if s.history.length}
      <ol class="history">
        {#each [...s.history].reverse() as h (h.round)}
          <li>
            <span class="mono muted">{String(h.round).padStart(2, '0')}</span>
            <span class="track"><b>{h.title}</b> <span class="muted">{h.artist}</span></span>
            <span class="mono" class:muted={!h.winnerName}>{h.winnerName ?? '—'}</span>
          </li>
        {/each}
      </ol>
    {/if}
  </aside>
</main>

<style>
  .progress {
    height: 3px;
    background: var(--accent);
    transform-origin: left;
  }
  .game {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
    min-height: 0;
  }
  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-height: min(78vh, 760px);
    overflow: hidden;
    border-right: 1px solid var(--line);
  }
  .viz { position: absolute; inset: 0; transition: opacity 0.4s; }
  .dim .viz { opacity: 0.25; }
  .center { position: relative; display: grid; place-items: center; text-align: center; padding: var(--gutter); width: 100%; }
  .block { display: flex; flex-direction: column; align-items: center; gap: 12px; width: min(100%, 560px); }
  .big { font-size: clamp(4.5rem, 14vw, 11rem); overflow-wrap: anywhere; }
  .count { font-size: clamp(10rem, 30vw, 22rem); color: var(--accent); }

  .buzz {
    width: clamp(180px, 34vmin, 300px);
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 50%, transparent);
    animation: halo 1.6s infinite;
    transition: transform 0.12s var(--ease-out);
    touch-action: manipulation;
  }
  .buzz .display { font-size: clamp(3.5rem, 10vmin, 6rem); }
  .buzz:hover:not(:disabled) { transform: scale(1.04); }
  .buzz.pressed { transform: scale(0.92); }
  @keyframes halo {
    70% { box-shadow: 0 0 0 28px color-mix(in srgb, var(--accent) 0%, transparent); }
    100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent); }
  }

  .answer { display: flex; gap: 12px; width: 100%; align-items: end; margin-top: 8px; }
  .answer .field { font-size: 1.4rem; }
  .timer { width: 100%; height: 2px; background: var(--line); margin-top: 8px; }
  .timer span { display: block; height: 100%; background: var(--accent); transform-origin: left; }

  .reveal { display: grid; grid-template-columns: minmax(0, 260px) 1fr; gap: 28px; align-items: end; text-align: left; width: min(100%, 860px); }
  .reveal img { width: 100%; height: auto; aspect-ratio: 1; object-fit: cover; }
  .reveal > div { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .reveal .title { font-size: clamp(3rem, 8vw, 7rem); overflow-wrap: anywhere; }

  .side { padding: 20px var(--gutter); display: flex; flex-direction: column; gap: 28px; overflow-y: auto; }
  .history { display: flex; flex-direction: column; gap: 10px; font-size: 0.85rem; }
  .history li { display: grid; grid-template-columns: 2em 1fr auto; gap: 10px; align-items: baseline; }
  .track { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track b { font-weight: 500; }

  @media (max-width: 860px) {
    .game { grid-template-columns: 1fr; }
    .stage { min-height: 62vh; border-right: 0; border-bottom: 1px solid var(--line); }
    .reveal { grid-template-columns: 1fr; justify-items: center; text-align: center; }
    .reveal img { width: min(60vw, 240px); }
    .reveal > div { align-items: center; }
  }
</style>
