import { describe, expect, it } from 'vitest';
import { matchAnswer, normalize, similar } from './match.ts';

describe('normalize', () => {
  it('retire accents, ponctuation, parenthèses et featurings', () => {
    expect(normalize('Fille à Papa')).toBe('fille a papa');
    expect(normalize('Fille à Papa')).toBe('fille a papa');
    expect(normalize('Get Lucky (Radio Edit) [feat. Pharrell]')).toBe('get lucky');
    expect(normalize('One More Time - Remastered 2021')).toBe('one more time');
    expect(normalize('Tout va bien feat. Alonzo')).toBe('tout va bien');
    expect(normalize('The Weeknd')).toBe('weeknd');
  });
});

describe('similar', () => {
  it('tolère quelques fautes selon la longueur', () => {
    expect(similar('blinding ligths', 'Blinding Lights')).toBe(true);
    expect(similar('stromae', 'Stromae')).toBe(true);
    expect(similar('stromea', 'Stromae')).toBe(true);
    expect(similar('angele', 'Angèle')).toBe(true);
  });

  it('reste strict sur les noms très courts', () => {
    expect(similar('mna', 'MNO')).toBe(false);
    expect(similar('pnl', 'PNL')).toBe(true);
  });

  it('refuse les réponses éloignées ou vides', () => {
    expect(similar('daft punk', 'Justice')).toBe(false);
    expect(similar('', 'Justice')).toBe(false);
    expect(similar('lucky', 'Get Lucky')).toBe(false);
  });
});

describe('matchAnswer', () => {
  const track = { title: 'Get Lucky (Radio Edit)', titleShort: 'Get Lucky', artist: 'Daft Punk' };

  it('accepte le titre ou l’artiste', () => {
    expect(matchAnswer('get lucky', track)).toBe('title');
    expect(matchAnswer('daft punk', track)).toBe('artist');
    expect(matchAnswer('daftpunk', track)).toBe('artist');
    expect(matchAnswer('justice', track)).toBe(null);
  });

  it('accepte chaque membre d’un duo', () => {
    const duo = { title: 'La pluie', artist: 'Orelsan & Stromae' };
    expect(matchAnswer('stromae', duo)).toBe('artist');
    expect(matchAnswer('orelsan', duo)).toBe('artist');
    expect(matchAnswer('Orelsan et Stromae', duo)).toBe('artist');
  });
});
