/**
 * 從同步歌詞猜副歌從哪裡開始。
 * 找出「連續好幾行一起重複」的段落，依重複次數與段落長度打分，取得分最高那段第一次出現的時間。
 * 信心不夠就回傳 null：寧可從頭放，也不要跳到怪的地方。
 */
export interface ChorusLine {
  t: number; // 毫秒
  text: string;
}

/** 開頭這一段不算副歌（前奏常有重複句） */
export const INTRO_FRACTION = 0.12;
/** 少於這麼多行的歌詞，資訊不夠判斷 */
export const MIN_LINES = 8;
/** 得分（重複次數 × 段落行數）至少要到這個值 */
export const MIN_SCORE = 6;
/** 段落行數超過這個值就不再加分，避免整段主歌重複把分數撐高 */
const MAX_SEGMENT = 8;

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

interface Span {
  start: number;
  len: number;
}

export function findChorusMs(lines: readonly ChorusLine[], durationMs: number): number | null {
  const seq = lines.map((l) => ({ t: l.t, key: normalize(l.text) })).filter((l) => l.key);
  const n = seq.length;
  if (n < MIN_LINES) return null;
  const introEnd = Math.max(durationMs, seq[n - 1]!.t) * INTRO_FRACTION;
  const key = (i: number) => seq[i]!.key;

  // 每一對「從同一處開始往下重複」的段落，兩邊各算一個區間
  const spans = new Map<string, Span>();
  const pairs: [string, string][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (key(i) !== key(j) || (i > 0 && key(i - 1) === key(j - 1))) continue;
      let len = 0;
      while (j + len < n && i + len < j && key(i + len) === key(j + len)) len++;
      if (len < 2) continue;
      if (new Set(seq.slice(i, i + len).map((l) => l.key)).size < 2) continue;
      for (const start of [i, j]) spans.set(`${start}:${len}`, { start, len });
      pairs.push([`${i}:${len}`, `${j}:${len}`]);
    }
  }
  const all = [...spans.values()];

  // 互相重複的區間，以及重疊過半的區間，算同一種段落
  const parent = all.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  const index = new Map([...spans.keys()].map((k, i) => [k, i]));
  for (const [a, b] of pairs) parent[root(index.get(a)!)] = root(index.get(b)!);
  for (let a = 0; a < all.length; a++) {
    for (let b = a + 1; b < all.length; b++) {
      const x = all[a]!;
      const y = all[b]!;
      const overlap = Math.min(x.start + x.len, y.start + y.len) - Math.max(x.start, y.start);
      if (overlap * 2 >= Math.min(x.len, y.len)) parent[root(a)] = root(b);
    }
  }
  const groups = new Map<number, Span[]>();
  all.forEach((s, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), s]));

  let best: { score: number; start: number } | null = null;
  for (const group of groups.values()) {
    // 同一種段落在歌裡出現的每個位置（重疊的區間併成一個位置）
    const places: { start: number; end: number }[] = [];
    for (const s of group.sort((a, b) => a.start - b.start)) {
      const last = places.at(-1);
      if (last && s.start < last.end) last.end = Math.max(last.end, s.start + s.len);
      else places.push({ start: s.start, end: s.start + s.len });
    }
    const usable = places.filter((p) => seq[p.start]!.t >= introEnd);
    if (usable.length < 2) continue;
    const lens = usable.map((p) => p.end - p.start).sort((a, b) => a - b);
    const score = usable.length * Math.min(lens[lens.length >> 1]!, MAX_SEGMENT);
    if (!best || score > best.score || (score === best.score && usable[0]!.start < best.start)) best = { score, start: usable[0]!.start };
  }
  return best && best.score >= MIN_SCORE ? seq[best.start]!.t : null;
}
