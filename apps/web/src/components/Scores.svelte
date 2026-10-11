<script lang="ts">
  import { flip } from 'svelte/animate';
  import type { PublicPlayer } from '@shared/protocol';

  let { players, me, buzzer = null, compact = false }: {
    players: PublicPlayer[];
    me: string;
    buzzer?: string | null;
    compact?: boolean;
  } = $props();

  const sorted = $derived([...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)));

  // Le ping est affiché : c'est lui qui décide de la compensation au buzzer.
  const ping = (p: PublicPlayer) => (p.online ? (p.rtt ? `${p.rtt} ms` : '…') : 'hors ligne');
</script>

<ol class="scores" class:compact>
  {#each sorted as p, i (p.id)}
    <li class:me={p.id === me} class:off={!p.online} class:buzzer={p.id === buzzer} class:locked={p.lockedOut} animate:flip={{ duration: 400 }}>
      <span class="rank mono">{String(i + 1).padStart(2, '0')}</span>
      <span class="name">
        <span class="label">{p.name}</span>{#if p.host}<span class="tag mono">hôte</span>{/if}
      </span>
      <span class="ping mono muted">{ping(p)}</span>
      <span class="score display">{p.score}</span>
    </li>
  {/each}
</ol>

<style>
  .scores { display: flex; flex-direction: column; border-top: 1px solid var(--line); }
  li {
    display: grid;
    grid-template-columns: 2.2em 1fr auto 3.2em;
    align-items: baseline;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
    transition: opacity 0.3s, background 0.3s;
  }
  .compact li { padding: 8px 0; }
  .rank { color: var(--muted); }
  /* Le pseudo se tronque, jamais l'étiquette. Le joueur courant est en couleur d'accent. */
  .name { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { flex-shrink: 0; font-size: 0.62rem; color: var(--muted); border: 1px solid var(--line); padding: 1px 5px; vertical-align: 0.15em; }
  .score { font-size: 1.9rem; text-align: right; }
  .me .name { color: var(--accent); }
  .off { opacity: 0.4; }
  .locked .name { text-decoration: line-through; text-decoration-color: var(--accent); }
  .buzzer { background: var(--accent); color: var(--on-accent); box-shadow: -8px 0 0 var(--accent), 8px 0 0 var(--accent); }
  .buzzer .rank, .buzzer .ping, .buzzer .name, .buzzer .tag { color: var(--on-accent); border-color: currentColor; }
</style>
