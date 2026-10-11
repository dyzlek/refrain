// Les deux problèmes du temps réel : savoir quelle heure il est chez le serveur,
// et départager deux buzz qui arrivent à quelques millisecondes d'écart.

export interface ClockSample {
  /** Envoi et réception côté client (Date.now()). */
  sent: number;
  received: number;
  serverNow: number;
}

/**
 * Décalage horloge serveur − horloge client, façon NTP : on garde l'échantillon
 * au plus court aller-retour, c'est celui où l'hypothèse « trajet aller = trajet retour » est la moins fausse.
 */
export function clockOffset(samples: ClockSample[]): { offset: number; rtt: number } {
  if (!samples.length) return { offset: 0, rtt: 0 };
  const best = samples.reduce((a, b) => (b.received - b.sent < a.received - a.sent ? b : a));
  const rtt = best.received - best.sent;
  return { offset: best.serverNow - (best.sent + rtt / 2), rtt };
}

export interface BuzzCandidate {
  playerId: string;
  /** Heure de réception sur le serveur. */
  receivedAt: number;
  /** Aller-retour mesuré pour ce joueur. */
  rtt: number;
}

/** Au-delà, on ne compense plus : une connexion très lente ne doit pas devenir un avantage. */
export const MAX_COMPENSATION_MS = 150;
/** Fenêtre pendant laquelle on attend d'éventuels buzz plus rapides mais partis de plus loin. */
export const BUZZ_WINDOW_MS = 120;

export function compensated(c: BuzzCandidate): number {
  return c.receivedAt - Math.min(Math.max(c.rtt, 0) / 2, MAX_COMPENSATION_MS);
}

/** Le gagnant est celui qui a appuyé le plus tôt, estimé en retirant son temps de trajet. */
export function arbitrate(candidates: BuzzCandidate[]): { playerId: string; at: number } | null {
  let winner: { playerId: string; at: number } | null = null;
  for (const c of candidates) {
    const at = compensated(c);
    if (!winner || at < winner.at) winner = { playerId: c.playerId, at };
  }
  return winner;
}

/** Position dans l'extrait (s) à l'heure serveur donnée. */
export function positionAt(p: { anchor: number; position: number; playing: boolean }, serverNow: number): number {
  return p.playing ? p.position + (serverNow - p.anchor) / 1000 : p.position;
}

/** Plus on trouve tôt, plus on gagne : de 200 points dans la première seconde à 50 à la fin. */
export function pointsFor(reactionMs: number, clipSeconds: number): number {
  const ratio = Math.min(Math.max(reactionMs / (clipSeconds * 1000), 0), 1);
  return Math.round(50 + 150 * (1 - ratio));
}
