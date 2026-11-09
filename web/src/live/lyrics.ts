/** 歌詞：播放時才向 LRCLIB 查（開放、免費、不用金鑰），不存進網站。 */

export interface LyricLine {
  t: number; // 毫秒
  text: string;
}

export type Lyrics =
  | { kind: 'synced'; lines: LyricLine[] }
  | { kind: 'plain'; lines: string[] }
  | { kind: 'instrumental' }
  | { kind: 'none' };

export interface LyricQuery {
  name: string;
  artist: string;
  durationMs: number;
}

/** 解析 LRC：[01:23.45] 歌詞 */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0;
      out.push({ t: Number(m[1]) * 60_000 + Number(m[2]) * 1000 + frac, text });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** 目前播到哪一行（-1 = 第一行還沒開始） */
export function currentLine(lines: LyricLine[], ms: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.t <= ms) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

interface LrclibHit {
  duration: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

const cache = new Map<string, Promise<Lyrics>>();

/** 名稱裡的中文部分（「晚風樂團 Evening Breeze」→「晚風樂團」） */
const zhPart = (s: string) => s.match(/^([一-鿿㐀-䶿]+)\s+[A-Za-z]/)?.[1] ?? s;

export function findLyrics(q: LyricQuery): Promise<Lyrics> {
  const key = `${q.name}|${q.artist}`;
  if (!cache.has(key)) cache.set(key, lookup(q));
  return cache.get(key)!;
}

async function lookup(q: LyricQuery): Promise<Lyrics> {
  const sec = q.durationMs / 1000;
  const tries: Record<string, string>[] = [
    { track_name: q.name, artist_name: q.artist },
    { track_name: q.name, artist_name: zhPart(q.artist) },
    { q: `${q.name} ${q.artist}` },
  ];
  for (const params of tries) {
    const res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams(params)}`).catch(() => null);
    if (!res?.ok) continue;
    const hits = (await res.json()) as LrclibHit[];
    const close = (h: LrclibHit) => Math.abs(h.duration - sec) < 4;
    const synced = hits.find((h) => h.syncedLyrics && close(h)) ?? hits.find((h) => h.syncedLyrics);
    if (synced?.syncedLyrics) return { kind: 'synced', lines: parseLrc(synced.syncedLyrics) };
    if (hits.some((h) => h.instrumental && close(h))) return { kind: 'instrumental' };
    const plain = hits.find((h) => h.plainLyrics);
    if (plain?.plainLyrics) return { kind: 'plain', lines: plain.plainLyrics.split(/\r?\n/) };
  }
  return { kind: 'none' };
}
