/**
 * 「整張聽完的專輯」：每張專輯聽過的不同歌曲數 ÷ 專輯曲目數。
 * 聽過 = 三段榜 ∪ 最近播放 ∪ 按讚的歌（同一首跨版本只算一次）。API 看不到完整播放紀錄，所以是「至少聽過」。
 */
import type { MusicTaste, Track } from './profile.ts';
import { albumsOf } from './stories.ts';
import { knownTracks, trackKeyFor } from './trackkey.ts';

export interface HeardAlbum {
  id: string;
  name: string;
  /** 這張專輯第一位歌手 */
  artist: string;
  heard: number;
  total: number;
  complete: boolean;
  /** 一年榜分數（挑選同分時用） */
  score: number;
}

/** 曲目數太少的單曲／EP 不參選：1 首的單曲永遠 100% */
const MIN_ALBUM_TRACKS = 3;
const MIN_HEARD = 3;

export function fullestAlbum(music: MusicTaste): HeardAlbum | null {
  const key = trackKeyFor(music);
  const byId = new Map(knownTracks(music).map((t) => [t.id, t]));
  const heardTracks: Track[] = [
    ...Object.values(music.ranges).flatMap((r) => r.tracks),
    ...music.recent.map((p) => byId.get(p.trackId)).filter((t): t is Track => !!t),
    ...(music.saved ?? []),
  ];
  const albums = new Map<string, { first: Track; keys: Set<string> }>();
  for (const t of heardTracks) {
    const a = albums.get(t.album.id) ?? { first: t, keys: new Set<string>() };
    a.keys.add(key(t));
    albums.set(t.album.id, a);
  }
  const score = new Map(albumsOf(music.ranges.all.tracks).map((a) => [a.id, a.score]));
  const out: HeardAlbum[] = [];
  for (const [id, { first, keys }] of albums) {
    const total = first.album.totalTracks;
    if (!total || total < MIN_ALBUM_TRACKS || keys.size < MIN_HEARD) continue;
    const heard = Math.min(keys.size, total);
    out.push({ id, name: first.album.name, artist: first.artists[0]?.name ?? '', heard, total, complete: heard >= total, score: score.get(id) ?? 0 });
  }
  out.sort((a, b) => b.heard / b.total - a.heard / a.total || b.score - a.score || b.heard - a.heard);
  return out[0] ?? null;
}
