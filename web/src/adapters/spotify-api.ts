/** Spotify Web API 原始回應 → TasteProfile。純函式，瀏覽器與 Node 都能跑。 */
import type { Album, Artist, MusicTaste, Picture, RangeKey, TasteProfile, Track } from '../core/profile.ts';

interface SpImage { url: string; width: number | null; height: number | null }
interface SpArtist { id: string; name: string; images?: SpImage[]; external_urls?: { spotify?: string } }
interface SpTrack {
  id: string;
  name: string;
  duration_ms: number;
  artists: { id: string; name: string }[];
  album: { id: string; name: string; release_date?: string; total_tracks?: number; images?: SpImage[] };
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
}

export interface SpotifyApiRaw {
  fetchedAt: string;
  me: { display_name?: string; id: string; country?: string; images?: SpImage[]; external_urls?: { spotify?: string } };
  topArtists: Record<'short_term' | 'medium_term' | 'long_term', SpArtist[]>;
  topTracks: Record<'short_term' | 'medium_term' | 'long_term', SpTrack[]>;
  recentlyPlayed: { played_at: string; track: SpTrack }[];
  followed?: { total?: number };
  /** items 是按讚的歌（fetch 階段分頁抓完）；舊資料只有 total */
  saved?: { total?: number; items?: { track: SpTrack }[] };
}

const RANGE_MAP: Record<RangeKey, keyof SpotifyApiRaw['topArtists']> = {
  month: 'short_term',
  half: 'medium_term',
  all: 'long_term',
};

/** 依寬度挑最接近的兩個尺寸 */
export function pickPicture(images: SpImage[] | undefined): Picture | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const lg = sorted[0]!;
  const sm = sorted.find((i) => (i.width ?? 0) <= 320 && (i.width ?? 0) >= 160) ?? lg;
  return { sm: sm.url, lg: lg.url };
}

function toArtist(a: SpArtist): Artist {
  return { id: a.id, name: a.name, picture: pickPicture(a.images), url: a.external_urls?.spotify };
}

function toAlbum(a: SpTrack['album']): Album {
  const year = Number.parseInt(a.release_date?.slice(0, 4) ?? '', 10);
  return { id: a.id, name: a.name, year: Number.isFinite(year) ? year : undefined, totalTracks: a.total_tracks, picture: pickPicture(a.images) };
}

function toTrack(t: SpTrack): Track {
  return {
    id: t.id,
    name: t.name,
    artists: t.artists.map(({ id, name }) => ({ id, name })),
    album: toAlbum(t.album),
    durationMs: t.duration_ms,
    isrc: t.external_ids?.isrc,
    url: t.external_urls?.spotify,
  };
}

export function fromSpotifyApi(raw: SpotifyApiRaw): TasteProfile {
  const ranges = Object.fromEntries(
    (Object.keys(RANGE_MAP) as RangeKey[]).map((k) => [
      k,
      { artists: raw.topArtists[RANGE_MAP[k]].map(toArtist), tracks: raw.topTracks[RANGE_MAP[k]].map(toTrack) },
    ]),
  ) as MusicTaste['ranges'];

  const known = new Set(Object.values(ranges).flatMap((r) => r.tracks.map((t) => t.id)));
  const extra = new Map<string, Track>();
  for (const p of raw.recentlyPlayed) if (!known.has(p.track.id)) extra.set(p.track.id, toTrack(p.track));

  return {
    version: 1,
    generatedAt: raw.fetchedAt,
    owner: {
      name: raw.me.display_name || raw.me.id,
      country: raw.me.country,
      url: raw.me.external_urls?.spotify,
      picture: pickPicture(raw.me.images),
    },
    music: {
      source: 'spotify-api',
      ranges,
      recent: raw.recentlyPlayed.map((p) => ({ trackId: p.track.id, playedAt: p.played_at })),
      extraTracks: [...extra.values()],
      saved: (raw.saved?.items ?? []).filter((i) => i.track?.id).map((i) => ({ ...toTrack(i.track), album: { ...toAlbum(i.track.album), picture: undefined } })),
      totals: { saved: raw.saved?.total, followed: raw.followed?.total },
    },
  };
}
