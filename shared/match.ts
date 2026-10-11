// Une réponse tapée vite au clavier n'est jamais exacte : on compare des formes nettoyées,
// avec une tolérance aux fautes de frappe proportionnelle à la longueur.

const ARTICLES = /^(the|le|la|les|l)\s+/;

export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\b(feat|ft|featuring)\b.*$/, '')
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(ARTICLES, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similar(guess: string, target: string): boolean {
  const g = normalize(guess);
  const t = normalize(target);
  if (!g || !t) return false;
  if (g === t) return true;
  // Trop court pour tolérer une faute : « up » ne doit pas valider « ub ».
  if (t.length <= 3) return false;
  const allowed = t.length <= 6 ? 1 : t.length <= 12 ? 2 : 3;
  return levenshtein(g, t) <= allowed;
}

export type MatchResult = 'title' | 'artist' | null;

/** Le titre ou l'artiste suffit. « Daft Punk » et « Get Lucky » marchent tous les deux. */
export function matchAnswer(guess: string, track: { title: string; titleShort?: string; artist: string }): MatchResult {
  if ([track.title, track.titleShort ?? ''].some((t) => t && similar(guess, t))) return 'title';
  // Les duos (« Orelsan & Stromae », « X, Y ») : chaque nom vaut pour l'artiste.
  const artists = [track.artist, ...track.artist.split(/\s*(?:,|&|\bx\b|\bet\b|\band\b)\s*/i)];
  if (artists.some((a) => a && similar(guess, a))) return 'artist';
  return null;
}
