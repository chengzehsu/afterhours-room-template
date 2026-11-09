import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fullestAlbum } from '../src/core/albums.ts';
import type { MusicTaste, Track } from '../src/core/profile.ts';
import { albumsOf } from '../src/core/stories.ts';

const tr = (id: string, name: string, album: string, total?: number, by = 'a', year = 2020): Track => ({
  id, name, artists: [{ id: by, name: by.toUpperCase() }], album: { id: album, name: `專輯${album}`, year, totalTracks: total }, durationMs: 1,
});
const music = (o: { all?: Track[]; half?: Track[]; month?: Track[]; recent?: string[]; extra?: Track[]; saved?: Track[] }): MusicTaste => ({
  source: 'spotify-api',
  ranges: { month: { artists: [], tracks: o.month ?? [] }, half: { artists: [], tracks: o.half ?? [] }, all: { artists: [], tracks: o.all ?? [] } },
  recent: (o.recent ?? []).map((trackId) => ({ trackId, playedAt: '2026-11-08T00:00:00Z' })),
  extraTracks: o.extra ?? [],
  saved: o.saved,
  totals: {},
});

test('專輯照 Spotify 名次排（最前面那首歌的名次），不用名次加分排序；分數照算、留給同分比較', () => {
  // Spotify API 沒有播放次數，名次加總只會讓收錄首數多的專輯佔便宜（業主 2026-11-09 否決加分排序）
  const list = [tr('1', 'x', 'A'), tr('2', 'y', 'B'), tr('3', 'z', 'B')];
  const out = albumsOf(list);
  assert.deepEqual(out.map((a) => [a.id, a.score]), [['A', 50], ['B', 49 + 48]]);
  assert.equal(out[1]!.lead.id, '2');
});

test('M3：同一首歌的不同版本只算一次，不會把分數灌高', () => {
  const list = [tr('1', 'x', 'A'), tr('2', 'dup', 'B'), tr('3', 'DUP', 'B')];
  const out = albumsOf(list);
  assert.deepEqual(out.map((a) => a.id), ['A', 'B']);
  assert.equal(out[1]!.score, 49);
});

test('M3：同分時維持原本榜上先出現的順序', () => {
  const out = albumsOf([tr('1', 'a1', 'A'), tr('2', 'b1', 'B')]);
  assert.deepEqual(out.map((a) => a.id), ['A', 'B']);
});

test('M2：聽過的不同歌曲 = 三段榜 ∪ 最近播放 ∪ 按讚；同一首（跨版本）只算一次；完成度不到 100% 照實講', () => {
  const m = music({
    all: [tr('1', 'one', 'X', 10), tr('2', 'two', 'X', 10)],
    month: [tr('1b', 'ONE', 'X', 10)], // 同歌不同 id：不重複算
    extra: [tr('3', 'three', 'X', 10)],
    recent: ['3'],
    saved: [tr('4', 'four', 'X', 10), tr('5', 'five', 'X', 10), tr('6', 'six', 'X', 10)],
  });
  const f = fullestAlbum(m)!;
  assert.equal(f.id, 'X');
  assert.equal(f.heard, 6);
  assert.equal(f.total, 10);
  assert.equal(f.complete, false);
});

test('M2：挑完成度最高的；曲目數不到 3 的單曲／EP 不參選', () => {
  const m = music({
    all: [tr('1', 'one', 'X', 10), tr('2', 'two', 'X', 10), tr('3', 'three', 'X', 10), tr('s', 'single', 'S', 1)],
    saved: [tr('4', 'a', 'Y', 4), tr('5', 'b', 'Y', 4), tr('6', 'c', 'Y', 4), tr('7', 'd', 'Y', 4)],
  });
  const f = fullestAlbum(m)!;
  assert.equal(f.id, 'Y');
  assert.equal(f.complete, true);
});

test('M2：完成度相同取一年榜分數高的', () => {
  const m = music({
    all: [tr('1', 'a1', 'P', 3), tr('2', 'b1', 'Q', 3), tr('3', 'b2', 'Q', 3)],
    saved: [tr('4', 'a2', 'P', 3), tr('5', 'a3', 'P', 3), tr('6', 'b3', 'Q', 3)],
  });
  // P 與 Q 都 3/3；Q 在一年榜有兩首（49+48）> P 一首（50）
  assert.equal(fullestAlbum(m)!.id, 'Q');
});

test('M2：沒有曲目數資料（舊 profile）或沒有任何專輯聽過 3 首，就不顯示', () => {
  assert.equal(fullestAlbum(music({ all: [tr('1', 'a', 'X'), tr('2', 'b', 'X'), tr('3', 'c', 'X')] })), null);
  assert.equal(fullestAlbum(music({ all: [tr('1', 'a', 'X', 10), tr('2', 'b', 'X', 10)] })), null);
});
