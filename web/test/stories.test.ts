import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Artist, MusicTaste, RangeChart, Track } from '../src/core/profile.ts';
import { buildStories, findDominance, topTrackOf } from '../src/core/stories.ts';

const artist = (id: string): Artist => ({ id, name: id.toUpperCase() });
const track = (id: string, by: string, year = 2020): Track => ({
  id,
  name: id,
  artists: [{ id: by, name: by.toUpperCase() }],
  album: { id: `al-${id}`, name: id, year },
  durationMs: 200_000,
});
const chart = (artists: string[], tracks: [string, string, number?][]): RangeChart => ({
  artists: artists.map(artist),
  tracks: tracks.map(([id, by, y]) => track(id, by, y)),
});
const music = (month: RangeChart, half: RangeChart, all: RangeChart): MusicTaste => ({
  source: 'spotify-api',
  ranges: { month, half, all },
  recent: [{ trackId: 't1', playedAt: '2026-11-08T00:00:00Z' }],
  extraTracks: [],
  totals: {},
});

test('霸榜：挑出同一位歌手佔最多首的時段', () => {
  const tenByA = Array.from({ length: 10 }, (_, i) => [`m${i}`, i < 9 ? 'a' : 'b'] as [string, string]);
  const mixed = Array.from({ length: 10 }, (_, i) => [`h${i}`, `x${i % 5}`] as [string, string]);
  const m = music(chart(['a'], tenByA), chart(['a'], mixed), chart(['a'], mixed));
  assert.deepEqual(findDominance(m), { range: 'month', artist: 'A', artistId: 'a', count: 9, of: 10 });
});

test('霸榜：每位歌手最多一兩首時不成故事', () => {
  const spread = Array.from({ length: 10 }, (_, i) => [`t${i}`, `x${i}`] as [string, string]);
  const m = music(chart([], spread), chart([], spread), chart([], spread));
  assert.equal(findDominance(m), null);
});

test('霸榜：歌太少時不硬算', () => {
  const m = music(chart([], [['t1', 'a'], ['t2', 'a']]), chart([], []), chart([], []));
  assert.equal(findDominance(m), null);
});

test('一直都在、新來的、淡出的', () => {
  const m = music(
    chart(['a', 'b', 'new1', 'new2'], [['t1', 'a']]),
    chart(['b', 'a', 'c'], [['t1', 'a']]),
    chart(['a', 'b', 'c', 'old'], [['t1', 'a']]),
  );
  const s = buildStories(m);
  assert.deepEqual(s.loyal.map((r) => r.item.id), ['a', 'b']);
  assert.deepEqual(s.loyal[0]!.ranks, { month: 1, half: 2, all: 1 });
  assert.deepEqual(s.newcomers.map((r) => r.item.id), ['new1', 'new2']);
  assert.deepEqual(s.faded.map((r) => r.item.id), ['c', 'old']);
  assert.equal(s.distinctArtists, 6);
});

test('招牌歌：全期第一名，並帶出其他時段的名次', () => {
  const m = music(chart([], [['x', 'b'], ['top', 'a']]), chart([], [['y', 'b']]), chart([], [['top', 'a'], ['x', 'b']]));
  const s = buildStories(m);
  assert.equal(s.signature?.item.id, 'top');
  assert.deepEqual(s.signature?.ranks, { month: 2, half: null, all: 1 });
});

test('M7：某位歌手的代表歌只看本時段，本時段沒有就是沒有（不借別段）', () => {
  const m = music(chart([], [['x', 'b']]), chart([], [['y', 'a']]), chart([], [['z', 'a']]));
  assert.equal(topTrackOf(m, 'month', 'a'), undefined);
  assert.equal(topTrackOf(m, 'half', 'a')?.id, 'y');
  assert.equal(topTrackOf(m, 'all', 'a')?.id, 'z');
  assert.equal(topTrackOf(m, 'month', 'zzz'), undefined);
});

test('空資料不會爆', () => {
  const s = buildStories(music(chart([], []), chart([], []), chart([], [])));
  assert.equal(s.signature, null);
  assert.equal(s.dominance, null);
  assert.equal(s.newestShare, null);
  assert.deepEqual(s.loyal, []);
});

test('中英文之間補空格，但不動標籤', async () => {
  const { spaceMixed } = await import('../src/page/copy.ts');
  assert.equal(spaceMixed('<b class="x1">Cosmo Folks霸榜</b>有9首'), '<b class="x1">Cosmo Folks 霸榜</b>有 9 首');
  assert.equal(spaceMixed('<a href="#top">回到門口</a>'), '<a href="#top">回到門口</a>');
});

test('唱盤標題的下半句依名次產生', async () => {
  const { deckHeadline } = await import('../src/page/copy.ts');
  assert.equal(deckHeadline({ all: 1, half: null, month: null }), '是我這一年聽最多的一首');
  assert.equal(deckHeadline({ all: 12, half: 30, month: 3 }), '這 4 週第 3 名');
  assert.equal(deckHeadline({ all: null, half: 7, month: null }), '這半年第 7 名');
  assert.equal(deckHeadline({ all: null, half: null, month: null }), '最近有在聽');
});

test('唱盤那句：只講我有多常放，不報名次、不講少聽或衝到（分享品味，業主 2026-11-09）', async () => {
  const { rankLine } = await import('../src/page/copy.ts');
  assert.equal(rankLine({ all: 1, half: 1, month: 1 }), '這一年我最常放的一首。');
  assert.equal(rankLine({ all: 1, half: 12, month: 33 }), '這一年我最常放的一首。', '最近名次掉了也不講少聽');
  assert.equal(rankLine({ all: 9, half: 4, month: 1 }), '這陣子最常放的就是它。');
  assert.equal(rankLine({ all: 3, half: 2, month: 4 }), '這一年我很常放。');
  assert.equal(rankLine({ all: 28, half: 32, month: 15 }), '這一年常常會放到。');
  assert.equal(rankLine({ all: null, half: 12, month: null }), '這一年常常會放到。');
  assert.equal(rankLine({ all: null, half: null, month: 7 }), '最近很常放。');
  assert.equal(rankLine({ all: null, half: null, month: null }), '', '都沒上榜就不寫');
  for (const r of [{ all: 1, half: 3, month: 9 }, { all: 5, half: null, month: null }, { all: 40, half: 30, month: 6 }])
    assert.doesNotMatch(rankLine(r), /第 \d|少聽|衝到|爬到|排第/, JSON.stringify(r));
});

test('霸榜那段只看預設的一年（跟 CD 牆同一段）：4 週再集中也不算；一年前 10 首太分散就看前 50 首', () => {
  const month = chart([], Array.from({ length: 10 }, (_, i) => [`m${i}`, 'cp'] as [string, string]));
  const yearTracks: [string, string][] = Array.from({ length: 50 }, (_, i) => [`y${i}`, i % 6 === 0 ? 'honne' : `x${i}`]);
  const s = buildStories(music(month, chart([], []), chart([], yearTracks)));
  assert.equal(s.dominance?.range, 'all');
  assert.equal(s.dominance?.artistId, 'honne');
  assert.equal(s.dominance?.of, 50);
  assert.equal(s.dominance?.count, 9);
});

const multi = (id: string, ...by: string[]): Track => ({ ...track(id, by[0]!), artists: by.map((b) => ({ id: b, name: b.toUpperCase() })) });

test('E1：同一首歌在不同時段換了 id，名次照樣對得上', () => {
  const v = (id: string) => ({ ...track(id, 'honne'), name: '3am' });
  const m = music(
    { artists: [], tracks: [v('month-id')] },
    { artists: [], tracks: [track('o', 'x'), v('half-id')] },
    { artists: [], tracks: [v('year-id')] },
  );
  assert.deepEqual(buildStories(m).signature?.ranks, { month: 1, half: 2, all: 1 });
});

test('M5：霸榜算所有掛名歌手，不只第一位', () => {
  const tracks = [multi('a1', 'x1', 'honne'), multi('a2', 'x2', 'honne'), multi('a3', 'x3', 'honne'), ...Array.from({ length: 7 }, (_, i) => multi(`o${i}`, `y${i}`))];
  const m = music(chart([], []), chart([], []), { artists: [], tracks });
  const d = findDominance(m, 10, ['all']);
  assert.equal(d?.artistId, 'honne');
  assert.equal(d?.count, 3);
});

test('最近常聽：4 週前 20 名、一年榜上還沒有（不另加半年榜條件，業主：不是比賽）', () => {
  const m = music(
    chart(['a', 'new1', 'new2', 'new3'], []),
    chart(['a', 'new1'], []),
    chart(['a', 'new2'], []),
  );
  assert.deepEqual(buildStories(m).newcomers.map((r) => r.item.id), ['new1', 'new3']);
});

test('S1：一直都在的最多顯示 8 位，數字就是實際顯示的人數', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `a${i}`);
  const m = music(chart(ids, []), chart(ids, []), chart(ids, []));
  assert.equal(buildStories(m).loyal.length, 8);
});
