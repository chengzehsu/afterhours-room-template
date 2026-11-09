/**
 * 「同一首歌」的比對鍵。Spotify 同一首歌常有好幾個 id（單曲、專輯、Deluxe 各一個），
 * 用 id 比會把同一首當成兩首。這裡用「正規化歌名 + 第一位歌手 id」，並用 isrc 把歌名寫法不同的版本接起來。
 * 只去掉 remaster 這種不改變歌曲本身的註記；dream edit、Live 等是不同版本，不合併。
 */
import type { MusicTaste, Track } from './profile.ts';

const REMASTER = /\s*(?:[-–]\s*(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|[(（][^)）]*remaster[^)）]*[)）])\s*$/i;

export function nameKey(t: Track): string {
  const name = t.name.normalize('NFKC').replace(REMASTER, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return `n:${name}|${t.artists[0]?.id ?? ''}`;
}

/** 依一批已知的歌建立比對函式：歌名鍵相同，或 isrc 相同，都算同一首（並查集） */
export function makeTrackKey(tracks: Iterable<Track>): (t: Track) => string {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const link = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const t of tracks) {
    const n = nameKey(t);
    if (!parent.has(n)) parent.set(n, n);
    if (t.isrc) link(n, `i:${t.isrc}`);
  }
  return (t) => find(nameKey(t));
}

/** 這份資料裡所有看得到的歌：三段榜、最近播放補的、按讚的 */
export function knownTracks(music: MusicTaste): Track[] {
  return [...Object.values(music.ranges).flatMap((r) => r.tracks), ...music.extraTracks, ...(music.saved ?? [])];
}

const cache = new WeakMap<MusicTaste, (t: Track) => string>();
export function trackKeyFor(music: MusicTaste): (t: Track) => string {
  let f = cache.get(music);
  if (!f) cache.set(music, (f = makeTrackKey(knownTracks(music))));
  return f;
}
