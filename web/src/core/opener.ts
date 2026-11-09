export const OPENER_KEY = 'room:last-opener';

/** 開場落針就是副歌，所以優先只挑有副歌資料的；一首都沒有就維持原清單 */
export function onlyWithChorus(ids: readonly string[], hasChorus: (id: string) => boolean): string[] {
  const some = ids.filter(hasChorus);
  return some.length ? some : [...ids];
}

export function pickOpener(ids: readonly string[], last: string | null, rand: () => number): string | null {
  if (!ids.length) return null;
  const pool = last !== null && ids.length > 1 ? ids.filter((id) => id !== last) : ids;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]!;
}

export function readLast(store: Pick<Storage, 'getItem'> | undefined): string | null {
  try {
    return store?.getItem(OPENER_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeLast(store: Pick<Storage, 'setItem'> | undefined, id: string): void {
  try {
    store?.setItem(OPENER_KEY, id);
  } catch {}
}

export const OPENER_ARTIST_KEY = 'room:last-opener-artist';

export function readLastArtist(store: Pick<Storage, 'getItem'> | undefined): string | null {
  try {
    return store?.getItem(OPENER_ARTIST_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeLastArtist(store: Pick<Storage, 'setItem'> | undefined, artist: string): void {
  try {
    store?.setItem(OPENER_ARTIST_KEY, artist);
  } catch {}
}

export interface OpenerTrack {
  id: string;
  /** 主唱：第一位歌手 */
  artist: string;
  chorusMs: number | null;
}

/**
 * 從指定歌手名單挑開場：先在有歌的歌手間平均抽一位（不跟上次同一位），
 * 再從那位的歌挑一首（有副歌優先、盡量不跟上次同一首）。名單挑不出歌時回傳 null，由呼叫端退回原本的挑法。
 * tracks 以 id 為鍵，同一首歌在不同排行重複出現也只算一次。
 */
export function pickArtistOpener(
  tracks: Readonly<Record<string, OpenerTrack>>,
  artists: readonly string[],
  last: { id: string | null; artist: string | null },
  rand: () => number,
): { id: string; artist: string } | null {
  const byArtist = new Map<string, string[]>();
  for (const name of new Set(artists)) byArtist.set(name, []);
  for (const t of Object.values(tracks)) byArtist.get(t.artist)?.push(t.id);
  const names = [...byArtist].filter(([, ids]) => ids.length).map(([name]) => name);
  const artist = pickOpener(names, last.artist, rand);
  if (artist === null) return null;
  const ids = onlyWithChorus(byArtist.get(artist)!, (id) => !!tracks[id]?.chorusMs);
  const id = pickOpener(ids, last.id, rand);
  return id === null ? null : { id, artist };
}

/**
 * 開場轉盤的候選：光在這幾張 CD 之間跳，訪客點一下停在哪張就放哪張。
 * 指定歌手名單裡的歌優先；不到 min 張時，用有副歌秒數的補（開場落針放副歌）；再不夠就照牆上順序補。
 * wall 是牆上的順序（一張專輯一首代表曲），只回傳牆上有的，不重複。
 */
export function rouletteCandidates(
  wall: readonly string[],
  tracks: Readonly<Record<string, OpenerTrack>>,
  artists: readonly string[],
  min = 6,
): string[] {
  const names = new Set(artists);
  const on = wall.filter((id) => tracks[id]);
  const out = on.filter((id) => names.has(tracks[id]!.artist));
  const add = (ids: readonly string[]) => {
    for (const id of ids) if (out.length < min && !out.includes(id)) out.push(id);
  };
  add(on.filter((id) => !!tracks[id]!.chorusMs));
  add(on);
  return out;
}
