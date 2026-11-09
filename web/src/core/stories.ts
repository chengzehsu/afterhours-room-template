/** 從 MusicTaste 算出頁面要講的故事。純函式，資料換人照樣成立。 */
import type { Artist, MusicTaste, RangeKey, Track } from './profile.ts';
import { DEFAULT_RANGE, RANGE_KEYS } from './profile.ts';
import { makeTrackKey, trackKeyFor } from './trackkey.ts';

export interface Dominance {
  range: RangeKey;
  artist: string;
  artistId: string;
  count: number;
  of: number;
}

export interface Ranked<T> {
  item: T;
  ranks: Record<RangeKey, number | null>;
}

export interface MusicStories {
  dominance: Dominance | null;
  loyal: Ranked<Artist>[];
  newcomers: Ranked<Artist>[];
  faded: Ranked<Artist>[];
  signature: Ranked<Track> | null;
  distinctArtists: number;
  newestShare: { range: RangeKey; since: number; share: number } | null;
}

function ranksOf(music: MusicTaste, id: string, kind: 'artists'): Record<RangeKey, number | null> {
  const out = {} as Record<RangeKey, number | null>;
  for (const k of RANGE_KEYS) {
    const i = music.ranges[k][kind].findIndex((a) => a.id === id);
    out[k] = i < 0 ? null : i + 1;
  }
  return out;
}

/** 一首歌在三段榜的名次；用「同一首歌」比對，不同專輯版本的 id 不同也對得上 */
export function trackRanksOf(music: MusicTaste, track: Track): Record<RangeKey, number | null> {
  const key = trackKeyFor(music);
  const k = key(track);
  const out = {} as Record<RangeKey, number | null>;
  for (const r of RANGE_KEYS) {
    const i = music.ranges[r].tracks.findIndex((t) => key(t) === k);
    out[r] = i < 0 ? null : i + 1;
  }
  return out;
}

/** 某段時間前 N 首歌裡，被同一位歌手佔走最多的那個時段 */
export function findDominance(music: MusicTaste, topN = 10, ranges: readonly RangeKey[] = RANGE_KEYS): Dominance | null {
  let best: Dominance | null = null;
  for (const range of ranges) {
    const top = music.ranges[range].tracks.slice(0, topN);
    if (top.length < Math.min(topN, 5)) continue;
    const counts = new Map<string, { name: string; n: number }>();
    for (const t of top) {
      // 所有掛名的歌手都算（合唱、feat. 也是他的歌），跟「牆上亮著的 N 張」同一個算法
      for (const a of new Map(t.artists.map((x) => [x.id, x])).values()) {
        const c = counts.get(a.id) ?? { name: a.name, n: 0 };
        c.n++;
        counts.set(a.id, c);
      }
    }
    for (const [id, c] of counts) {
      if (!best || c.n > best.count) best = { range, artist: c.name, artistId: id, count: c.n, of: top.length };
    }
  }
  // 只有一首不算故事
  return best && best.count >= 3 ? best : null;
}

export function buildStories(music: MusicTaste): MusicStories {
  const { month, half, all } = music.ranges;
  const inTop = (list: Artist[], n: number, id: string) => list.slice(0, n).some((a) => a.id === id);

  const loyal = all.artists
    .filter((a) => inTop(month.artists, 15, a.id) && inTop(half.artists, 15, a.id) && inTop(all.artists, 15, a.id))
    .slice(0, 8)
    .map((a) => ({ item: a, ranks: ranksOf(music, a.id, 'artists') }));

  const newcomers = month.artists
    .slice(0, 20)
    // 最近常聽：這 4 週前 20，而且一年榜上還沒有他們（業主：不是比賽，是我最近比較常聽他們；不另加半年榜條件）
    .filter((a) => !all.artists.some((b) => b.id === a.id))
    .slice(0, 3)
    .map((a) => ({ item: a, ranks: ranksOf(music, a.id, 'artists') }));

  const faded = all.artists
    .slice(0, 15)
    .filter((a) => !month.artists.some((b) => b.id === a.id))
    .slice(0, 3)
    .map((a) => ({ item: a, ranks: ranksOf(music, a.id, 'artists') }));

  const top = all.tracks[0];
  const signature = top ? { item: top, ranks: trackRanksOf(music, top) } : null;

  const ids = new Set(RANGE_KEYS.flatMap((k) => music.ranges[k].artists.map((a) => a.id)));

  // 這 4 週的歌有多少是近兩年發行的
  const since = new Date(music.recent[0]?.playedAt ?? Date.now()).getUTCFullYear() - 1;
  const recentTracks = month.tracks.filter((t) => t.album.year !== undefined);
  const share = recentTracks.length ? recentTracks.filter((t) => t.album.year! >= since).length / recentTracks.length : 0;

  return {
    // 看預設那一段（跟 CD 牆同一段，鏡頭推近時亮的 CD 才對得上）：前 10 首有人佔 3 首以上就講前 10 首，
    // 太分散就看前 50 首（2026-11-08：牆預設一年後，原本挑到 4 週的 9/10，牆上亮的卻是一年的專輯，兜不起來）
    dominance: findDominance(music, 10, [DEFAULT_RANGE]) ?? findDominance(music, 50, [DEFAULT_RANGE]),
    loyal,
    newcomers,
    faded,
    signature,
    distinctArtists: ids.size,
    newestShare: recentTracks.length ? { range: 'month', since, share } : null,
  };
}

/** 某位歌手在某段時間排最前面的歌；這段沒有就是沒有，不借別段（榜單上寫的歌要跟那一段對得上） */
export function topTrackOf(music: MusicTaste, range: RangeKey, artistId: string): Track | undefined {
  return music.ranges[range].tracks.find((t) => t.artists.some((a) => a.id === artistId));
}

export interface AlbumEntry {
  id: string;
  name: string;
  by: string;
  /** 這張專輯在這段時間排最前面的歌 */
  lead: Track;
  tracks: Track[];
  /** 專輯分數：這張專輯每首歌的 (51 − 名次) 加總 */
  score: number;
}

/** 榜單第 1 名拿 50 分、第 50 名拿 1 分 */
const TOP_POINTS = 51;

/**
 * 把歌依專輯合併：同一張專輯只出現一次，依專輯分數由高到低排（同分維持榜上先出現的順序）。
 * 同一首歌的不同版本只算一次，才不會把分數灌高。
 */
export function albumsOf(tracks: Track[]): AlbumEntry[] {
  const key = makeTrackKey(tracks);
  const seen = new Set<string>();
  const out = new Map<string, AlbumEntry>();
  tracks.forEach((t, i) => {
    if (seen.has(key(t))) return;
    seen.add(key(t));
    const pts = Math.max(TOP_POINTS - (i + 1), 0);
    const hit = out.get(t.album.id);
    if (hit) {
      hit.tracks.push(t);
      hit.score += pts;
    } else out.set(t.album.id, { id: t.album.id, name: t.album.name, by: t.artists[0]?.name ?? '', lead: t, tracks: [t], score: pts });
  });
  // 照 Spotify 自己的排名：專輯排在它最前面那首歌的名次（Map 依第一次出現的順序）。
  // 不用 score 排：Spotify API 沒有播放次數，名次加總只會讓收錄首數多的專輯佔便宜，不等於「最常聽」（業主 2026-11-09）。
  // score 保留給「從頭聽到尾」同分時比較；之後有串流紀錄就改用實際播放時間。
  return [...out.values()];
}
