import type { Theme } from '@shared/protocol';

// L'API publique de Deezer donne, sans clé, un extrait de 30 s pour chaque titre.

export interface Track {
  id: number;
  title: string;
  titleShort: string;
  artist: string;
  cover: string;
  link: string;
  preview: string;
}

export interface TrackSource {
  themes(): Theme[];
  /** Accepte un id de thème ou un lien de playlist Deezer. */
  resolve(input: string): Promise<Theme>;
  tracks(themeId: string): Promise<Track[]>;
  /** Nouveau lien d'extrait pour un titre, quand l'ancien a expiré. */
  freshPreview?(trackId: number): Promise<string>;
}

const GENRES: Theme[] = [
  { id: 'chart:0', label: 'Top du moment' },
  { id: 'chart:52', label: 'Chanson française' },
  { id: 'chart:116', label: 'Rap' },
  { id: 'chart:132', label: 'Pop' },
  { id: 'chart:152', label: 'Rock' },
  { id: 'chart:113', label: 'Dance' },
  { id: 'chart:106', label: 'Electro' },
  { id: 'chart:165', label: 'R&B' },
  { id: 'chart:173', label: 'Films & jeux vidéo' },
  { id: 'chart:464', label: 'Metal' },
  { id: 'chart:169', label: 'Soul & funk' },
  { id: 'chart:197', label: 'Latino' },
];

const API = 'https://api.deezer.com';

interface DeezerTrack {
  id: number;
  title: string;
  title_short: string;
  link: string;
  preview: string;
  readable?: boolean;
  artist: { name: string };
  album: { cover_xl?: string; cover_big?: string };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(API + path, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Deezer ${res.status}`);
  const body = (await res.json()) as T & { error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body;
}

function toTrack(t: DeezerTrack): Track {
  return {
    id: t.id,
    title: t.title,
    titleShort: t.title_short,
    artist: t.artist.name,
    cover: t.album.cover_xl ?? t.album.cover_big ?? '',
    link: t.link,
    preview: t.preview,
  };
}

export function playlistId(input: string): string | null {
  const m = input.trim().match(/(?:playlist[/:])?(\d{4,})/);
  return m ? m[1] : null;
}

export function deezer(): TrackSource {
  const labels = new Map(GENRES.map((g) => [g.id, g.label]));

  return {
    themes: () => GENRES,

    async resolve(input) {
      if (labels.has(input)) return { id: input, label: labels.get(input)! };
      const id = playlistId(input);
      if (!id) throw new Error('Lien de playlist Deezer invalide');
      const p = await get<{ title: string; nb_tracks: number }>(`/playlist/${id}`);
      if (p.nb_tracks < 5) throw new Error('Playlist trop courte (5 titres minimum)');
      const theme = { id: `playlist:${id}`, label: p.title };
      labels.set(theme.id, theme.label);
      return theme;
    },

    async tracks(themeId) {
      const [kind, id] = themeId.split(':');
      const path = kind === 'chart' ? `/chart/${id}/tracks?limit=100` : `/playlist/${id}/tracks?limit=200`;
      const { data } = await get<{ data: DeezerTrack[] }>(path);
      return data.filter((t) => t.preview && t.readable !== false).map(toTrack);
    },

    async freshPreview(trackId) {
      const t = await get<DeezerTrack>(`/track/${trackId}`);
      if (!t.preview) throw new Error('Extrait indisponible');
      return t.preview;
    },
  };
}

export async function fetchAudio(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Extrait indisponible (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
