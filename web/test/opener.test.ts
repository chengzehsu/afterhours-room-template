import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onlyWithChorus, pickOpener } from '../src/core/opener.ts';

const ids = ['a', 'b', 'c', 'd'];

test('不重複上次挑的', () => {
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) assert.notEqual(pickOpener(ids, 'b', () => r), 'b');
});

test('只有 1 張時就挑那張，即使上次也是它', () => {
  assert.equal(pickOpener(['a'], 'a', () => 0.5), 'a');
});

test('沒有上次紀錄時可以挑任何一張', () => {
  const got = new Set([0, 0.3, 0.6, 0.99].map((r) => pickOpener(ids, null, () => r)));
  assert.deepEqual([...got].sort(), ids);
});

test('上次紀錄的 id 不在清單裡時當作沒有紀錄', () => {
  assert.equal(pickOpener(ids, 'zzz', () => 0), 'a');
  assert.equal(pickOpener(ids, 'zzz', () => 0.99), 'd');
});

test('固定亂數來源時結果可預測', () => {
  assert.equal(pickOpener(ids, 'a', () => 0), 'b');
  assert.equal(pickOpener(ids, 'a', () => 0.99), 'd');
  assert.equal(pickOpener(ids, 'd', () => 0.99), 'c');
});

test('空清單回傳 null', () => {
  assert.equal(pickOpener([], null, () => 0.5), null);
});

test('localStorage 讀寫丟例外時照樣能挑', async () => {
  const { readLast, writeLast } = await import('../src/core/opener.ts');
  const broken = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  assert.equal(readLast(broken), null);
  assert.doesNotThrow(() => writeLast(broken, 'a'));
  assert.equal(readLast(undefined), null);
});

test('開場只挑有副歌資料的曲目', () => {
  const withChorus = onlyWithChorus(ids, (id) => id === 'b' || id === 'd');
  assert.deepEqual(withChorus, ['b', 'd']);
  for (const r of [0, 0.5, 0.99]) assert.ok(['b', 'd'].includes(pickOpener(withChorus, null, () => r)!));
});

test('沒有任何曲目有副歌資料時退回全部清單', () => {
  assert.deepEqual(onlyWithChorus(ids, () => false), ids);
  assert.deepEqual(onlyWithChorus([], () => true), []);
});

/* ---------- 指定歌手名單的開場挑法 ---------- */
import { pickArtistOpener, readLastArtist, writeLastArtist, type OpenerTrack } from '../src/core/opener.ts';

const T = (id: string, artist: string, chorusMs: number | null = 1000): OpenerTrack => ({ id, artist, chorusMs });
const pool = (...ts: OpenerTrack[]) => Object.fromEntries(ts.map((t) => [t.id, t]));
const NONE = { id: null, artist: null };
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};

test('只會挑到名單歌手當主唱的歌', () => {
  const tracks = pool(T('x1', 'Nobody'), T('h1', 'NOVA'), T('x2', 'Other'), T('w1', 'Nana Lee'));
  for (let i = 0; i < 100; i++) {
    const got = pickArtistOpener(tracks, ['NOVA', 'Nana Lee'], NONE, Math.random)!;
    assert.ok(['h1', 'w1'].includes(got.id));
    assert.equal(tracks[got.id]!.artist, got.artist);
  }
});

test('合唱裡名單歌手不是主唱的不算', () => {
  // artist 欄位是第一位歌手；Jeff Chang 領銜的歌即使 NOVA 有參與也不在這裡
  const tracks = pool(T('live', 'Jeff Chang'), T('h1', 'NOVA'));
  for (const r of [0, 0.5, 0.99]) assert.equal(pickArtistOpener(tracks, ['NOVA'], NONE, () => r)!.id, 'h1');
  assert.equal(pickArtistOpener(pool(T('live', 'Jeff Chang')), ['NOVA'], NONE, () => 0), null);
});

test('歌手名稱用完全相等比對', () => {
  const tracks = pool(T('a', 'NOVA feat. X'), T('b', 'honne'), T('c', 'Wavy Wander Band'));
  assert.equal(pickArtistOpener(tracks, ['NOVA', 'Wavy Wander'], NONE, () => 0), null);
});

test('跟上次同一位歌手時會換人', () => {
  const tracks = pool(T('h1', 'NOVA'), T('h2', 'NOVA'), T('w1', 'Nana Lee'));
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const got = pickArtistOpener(tracks, ['NOVA', 'Nana Lee'], { id: 'h1', artist: 'NOVA' }, () => r)!;
    assert.equal(got.artist, 'Nana Lee');
  }
});

test('只有一位歌手有歌時，即使跟上次同一位也照挑', () => {
  const tracks = pool(T('s1', 'Sunny Mo', null));
  assert.equal(pickArtistOpener(tracks, ['Sunny Mo', 'Nana Lee'], { id: 's1', artist: 'Sunny Mo' }, () => 0)!.id, 's1');
});

test('歌手機會均等：NOVA 歌很多也不會比較常被抽到', () => {
  const honne = Array.from({ length: 19 }, (_, i) => T(`h${i}`, 'NOVA'));
  const tracks = pool(...honne, T('c1', 'Coral Chen'), T('w1', 'Nana Lee'), T('s1', 'Sunny Mo', null));
  const names = ['Coral Chen', 'NOVA', 'Nana Lee', 'Sunny Mo'];
  // 固定亂數序列：第一個數字選歌手，第二個選歌
  const counts: Record<string, number> = {};
  for (let i = 0; i < 4; i++) {
    const got = pickArtistOpener(tracks, names, NONE, seq((i + 0.5) / 4, 0.5))!;
    counts[got.artist] = (counts[got.artist] ?? 0) + 1;
  }
  assert.deepEqual(Object.values(counts), [1, 1, 1, 1]);
  // 大量抽樣
  let s = 12345;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const n: Record<string, number> = {};
  for (let i = 0; i < 8000; i++) {
    const a = pickArtistOpener(tracks, names, NONE, rand)!.artist;
    n[a] = (n[a] ?? 0) + 1;
  }
  for (const a of names) assert.ok(Math.abs(n[a]! - 2000) < 200, `${a} ${n[a]}`);
});

test('同一位歌手裡優先挑有副歌的歌', () => {
  const tracks = pool(T('p1', 'Peggy Tan', null), T('p2', 'Peggy Tan', 54000), T('p3', 'Peggy Tan', null));
  for (const r of [0, 0.5, 0.99]) assert.equal(pickArtistOpener(tracks, ['Peggy Tan'], NONE, () => r)!.id, 'p2');
});

test('歌手的歌都沒有副歌時任一首都可以', () => {
  const tracks = pool(T('s1', 'Sunny Mo', null), T('s2', 'Sunny Mo', null));
  const got = new Set([0, 0.99].map((r) => pickArtistOpener(tracks, ['Sunny Mo'], NONE, () => r)!.id));
  assert.deepEqual([...got].sort(), ['s1', 's2']);
});

test('同一位歌手有多首有副歌時盡量不跟上次同一首', () => {
  const tracks = pool(T('g1', 'GG'), T('g2', 'GG'));
  for (const r of [0, 0.99]) assert.equal(pickArtistOpener(tracks, ['GG'], { id: 'g1', artist: 'GG' }, () => r)!.id, 'g2');
});

test('名單是空的，或名單歌手都不在資料裡時回傳 null 讓呼叫端退回原本行為', () => {
  const tracks = pool(T('a', 'X'));
  assert.equal(pickArtistOpener(tracks, [], NONE, () => 0), null);
  assert.equal(pickArtistOpener(tracks, ['Y'], NONE, () => 0), null);
  assert.equal(pickArtistOpener({}, ['Y'], NONE, () => 0), null);
});

test('上次歌手的 localStorage 讀寫丟例外時照樣能挑', () => {
  const broken = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  assert.equal(readLastArtist(broken), null);
  assert.doesNotThrow(() => writeLastArtist(broken, 'NOVA'));
  assert.equal(readLastArtist(undefined), null);
  const tracks = pool(T('h1', 'NOVA'));
  assert.equal(pickArtistOpener(tracks, ['NOVA'], { id: readLastArtist(broken), artist: readLastArtist(broken) }, () => 0)!.id, 'h1');
});

test('上次歌手可以寫入再讀回', () => {
  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  writeLastArtist(store, 'Nana Lee');
  assert.equal(readLastArtist(store), 'Nana Lee');
});

test('rouletteCandidates：名單歌手優先，不夠用有副歌的補，再不夠照牆上順序補，不重複', async () => {
  const { rouletteCandidates } = await import('../src/core/opener.ts');
  const tracks = {
    a: { id: 'a', artist: 'Nana Lee', chorusMs: null },
    b: { id: 'b', artist: '路人', chorusMs: 50000 },
    c: { id: 'c', artist: '路人', chorusMs: null },
    d: { id: 'd', artist: 'NOVA', chorusMs: 40000 },
    e: { id: 'e', artist: '路人', chorusMs: 30000 },
  };
  const wall = ['a', 'b', 'c', 'd', 'e', 'x'];
  assert.deepEqual(rouletteCandidates(wall, tracks, ['Nana Lee', 'NOVA'], 4), ['a', 'd', 'b', 'e']);
  assert.deepEqual(rouletteCandidates(wall, tracks, ['Nana Lee', 'NOVA'], 5), ['a', 'd', 'b', 'e', 'c']);
  assert.deepEqual(rouletteCandidates(wall, tracks, [], 2), ['b', 'd']);
  assert.deepEqual(rouletteCandidates(wall, tracks, ['NOVA', 'Nana Lee', '路人'], 2), ['a', 'b', 'c', 'd', 'e'], '名單本身超過 min 就全收');
});
