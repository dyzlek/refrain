import { describe, expect, it } from 'vitest';
import { arbitrate, clockOffset, compensated, MAX_COMPENSATION_MS, pointsFor, positionAt } from './timing.ts';

describe('clockOffset', () => {
  it('garde l’échantillon au plus court aller-retour', () => {
    // Le serveur a 5 000 ms d'avance. Le 2e échantillon est rapide et symétrique.
    const r = clockOffset([
      { sent: 0, received: 300, serverNow: 5250 },
      { sent: 1000, received: 1040, serverNow: 6020 },
      { sent: 2000, received: 2200, serverNow: 7050 },
    ]);
    expect(r.rtt).toBe(40);
    expect(r.offset).toBe(5000);
  });

  it('renvoie zéro sans échantillon', () => {
    expect(clockOffset([])).toEqual({ offset: 0, rtt: 0 });
  });
});

describe('arbitrate', () => {
  it('donne le buzz à celui qui a appuyé le plus tôt, pas au premier arrivé', () => {
    // A arrive en premier mais avec 20 ms de ping ; B arrive 30 ms après avec 120 ms de ping :
    // B a appuyé vers 1000 − 60 + 30 = 970, A vers 1000 − 10 = 990.
    const w = arbitrate([
      { playerId: 'A', receivedAt: 1000, rtt: 20 },
      { playerId: 'B', receivedAt: 1030, rtt: 120 },
    ]);
    expect(w?.playerId).toBe('B');
    expect(w?.at).toBe(970);
  });

  it('plafonne la compensation', () => {
    expect(compensated({ playerId: 'X', receivedAt: 1000, rtt: 2000 })).toBe(1000 - MAX_COMPENSATION_MS);
    const w = arbitrate([
      { playerId: 'lent', receivedAt: 1200, rtt: 5000 },
      { playerId: 'rapide', receivedAt: 1000, rtt: 10 },
    ]);
    expect(w?.playerId).toBe('rapide');
  });

  it('ne renvoie personne sans candidat', () => {
    expect(arbitrate([])).toBeNull();
  });
});

describe('positionAt', () => {
  it('avance avec le temps quand ça joue, reste figé en pause', () => {
    expect(positionAt({ anchor: 1000, position: 2, playing: true }, 3500)).toBe(4.5);
    expect(positionAt({ anchor: 1000, position: 2, playing: false }, 3500)).toBe(2);
    expect(positionAt({ anchor: 1000, position: 0, playing: true }, 500)).toBe(-0.5);
  });
});

describe('pointsFor', () => {
  it('récompense la rapidité', () => {
    expect(pointsFor(0, 30)).toBe(200);
    expect(pointsFor(15_000, 30)).toBe(125);
    expect(pointsFor(30_000, 30)).toBe(50);
    expect(pointsFor(60_000, 30)).toBe(50);
  });
});
