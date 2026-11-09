import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromSpotifyApi, type SpotifyApiRaw } from '../src/adapters/spotify-api.ts';

const sp = (id: string, name: string, album = 'al', total = 10, isrc?: string) => ({
  id, name, duration_ms: 1, artists: [{ id: 'a', name: 'A' }],
  album: { id: album, name: album, release_date: '2020-01-01', total_tracks: total, images: [{ url: 'http://x/y', width: 640, height: 640 }] },
  ...(isrc ? { external_ids: { isrc } } : {}),
});
const raw = (): SpotifyApiRaw => ({
  fetchedAt: '2026-11-08T00:00:00Z',
  me: { id: 'u' },
  topArtists: { short_term: [], medium_term: [], long_term: [] },
  topTracks: { short_term: [sp('t1', 'One', 'al', 10, 'ISRC1')], medium_term: [], long_term: [] },
  recentlyPlayed: [],
  saved: { total: 1224, items: [{ track: sp('s1', 'Saved', 'al2', 12) }] },
});

test('M2：adapter 保留專輯曲目數與 isrc；按讚的歌帶進來（不留圖片網址，避免下載上千張圖）', () => {
  const m = fromSpotifyApi(raw()).music!;
  assert.equal(m.ranges.month.tracks[0]!.album.totalTracks, 10);
  assert.equal(m.ranges.month.tracks[0]!.isrc, 'ISRC1');
  assert.equal(m.saved!.length, 1);
  assert.equal(m.saved![0]!.album.totalTracks, 12);
  assert.equal(m.saved![0]!.album.picture, undefined);
  assert.equal(m.totals.saved, 1224);
});

test('M2：舊格式（saved 只有 total、沒有 items）照樣能轉', () => {
  const r = raw();
  r.saved = { total: 5 };
  const m = fromSpotifyApi(r).music!;
  assert.deepEqual(m.saved, []);
  assert.equal(m.totals.saved, 5);
});
