import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPersona, scriptOf } from '../src/core/persona.ts';
import type { MusicTaste, RangeChart, Track } from '../src/core/profile.ts';
import { albumsOf } from '../src/core/stories.ts';

const tr = (id: string, name: string, by: string, album = `al-${id}`, year = 2020): Track => ({
  id, name, artists: [{ id: by, name: by }], album: { id: album, name: album, year }, durationMs: 1,
});
const chart = (artists: string[], tracks: Track[]): RangeChart => ({ artists: artists.map((id) => ({ id, name: id })), tracks });
/** 台灣時間 h 點播的一首（UTC 往回 8 小時） */
const at = (h: number, i = 0) => ({ trackId: 'x', playedAt: new Date(Date.UTC(2026, 10, 8 - i * 3, h - 8)).toISOString() });
const music = (month: RangeChart, half: RangeChart, all: RangeChart, hours: number[] = []): MusicTaste => ({
  source: 'spotify-api', ranges: { month, half, all }, recent: hours.map((h, i) => at(h, i)), extraTracks: [], totals: {},
});
const TZ = { timeZone: 'Asia/Taipei' };

test('歌名的文字判斷', () => {
  assert.equal(scriptOf('沒有人像我這樣'), 'zh');
  assert.equal(scriptOf('旋律と硝子'), 'ja');
  assert.equal(scriptOf('3am'), 'latin');
});

// 「排行榜眼中的我」用歌和人講：一整年都在循環的歌、整張聽完的專輯、聽歌時間、輪流的歌手
const year = [
  tr('loop1', 'by my side', 'NOVA'),
  tr('loop2', 'Imaginary Isle', '晚風樂團 Evening Breeze'),
  tr('s1', '01', 'Wavy Wander', 'Spring Rain'),
  tr('s2', '02', 'Wavy Wander', 'Spring Rain'),
  tr('s3', '03', 'Wavy Wander', 'Spring Rain'),
  ...Array.from({ length: 5 }, (_, i) => tr(`o${i}`, `Song ${i}`, `x${i}`)),
];
const artists = ['NOVA', 'Jon Mallow', '晚風樂團 Evening Breeze', 'Wavy Wander'];

test('標題：第 1 名和第一位不同語言的歌手，講人不講時段（時段交給聽歌時間那格）；名字只留中文', () => {
  const p = buildPersona(music(chart(artists, [year[0]!, year[1]!]), chart(artists, [year[0]!, year[1]!]), chart(artists, year), [12, 12, 13, 20, 20]), TZ);
  assert.equal(p.title, 'NOVA 和晚風樂團，我一整年都在聽');
});

test('四格：循環的歌（附歌名）、整張聽完的專輯、聽歌時間、輪流的歌手', () => {
  const m = music(chart(artists, [year[0]!, year[1]!]), chart(artists, [year[0]!, year[1]!]), chart(artists, year), [12, 12, 13, 20, 20]);
  m.saved = [tr('s4', '04', 'Wavy Wander', 'Spring Rain')]; // 這張共 4 首，第 4 首是按讚的
  year.slice(2, 5).forEach((t) => (t.album.totalTracks = 4));
  m.saved[0]!.album.totalTracks = 4;
  const p = buildPersona(m, TZ);
  assert.deepEqual(p.traits.map((t) => t.key), ['loop', 'album', 'hours', 'spread']);
  const [loop, album, hours, spread] = p.traits;
  assert.equal(loop!.figure, '2 首');
  assert.match(loop!.proof, /NOVA〈by my side〉/);
  assert.match(loop!.proof, /晚風樂團〈Imaginary Isle〉/);
  assert.equal(album!.label, '從頭聽到尾的專輯');
  assert.equal(album!.figure, '4 首');
  assert.match(album!.proof, /Wavy Wander《Spring Rain》/);
  assert.equal(hours!.figure, '中午・晚上');
  assert.match(hours!.proof, /凌晨一首都沒有/);
  assert.equal(spread!.figure, '8 位');
  assert.match(spread!.proof, /來自 8 位歌手，Wavy Wander最多。/);
});

test('沒有循環的歌就講一直都在的歌手；沒有整張聽的專輯就不寫那格；有凌晨就寫幾首', () => {
  const spreadYear = Array.from({ length: 10 }, (_, i) => tr(`y${i}`, `Song ${i}`, `a${i % 5}`));
  const p = buildPersona(music(chart(['a0', 'a1'], [tr('m', 'M', 'z')]), chart(['a0'], [tr('h', 'H', 'z')]), chart(['a0', 'a1'], spreadYear), [1, 2, 15, 15]), TZ);
  assert.deepEqual(p.traits.map((t) => t.key), ['loyal', 'hours', 'spread']);
  assert.equal(p.traits[0]!.figure, '1 位');
  assert.match(p.traits[0]!.proof, /a0/);
  assert.match(p.traits[1]!.proof, /2 首在凌晨/);
});

test('一位歌手佔掉一年前 10 首的 6 首以上：最後一格是一頭栽進去', () => {
  const deep = Array.from({ length: 10 }, (_, i) => tr(`d${i}`, `歌${i}`, i < 7 ? '陳曉' : `b${i}`));
  const p = buildPersona(music(chart(['陳曉'], []), chart(['陳曉'], []), chart(['陳曉', 'b8'], deep)), TZ);
  assert.equal(p.traits.at(-1)!.key, 'deep');
  assert.equal(p.traits.at(-1)!.figure, '7 首');
});

test('沒有最近播放紀錄：不寫聽歌時間，標題照樣講人', () => {
  const p = buildPersona(music(chart(artists, []), chart(artists, []), chart(artists, year)), TZ);
  assert.ok(!p.traits.some((t) => t.key === 'hours'));
  assert.match(p.title, /，我一整年都在聽$/);
});

test('同一張專輯合併成一張 CD，排在最前面那首的位置', () => {
  const list = albumsOf([tr('1', 'a', 'x', 'A'), tr('2', 'b', 'y', 'B'), tr('3', 'c', 'x', 'A')]);
  assert.deepEqual(list.map((a) => [a.id, a.lead.id, a.tracks.length]), [['A', '1', 2], ['B', '2', 1]]);
});

test('E1：一年、半年、4 週的同一首歌換了 id（不同專輯版本）仍算「一整年都在循環」，而且只算一首', () => {
  const v1 = tr('id-year', '3am', 'NOVA', 'Gone With the Days');
  const v2 = tr('id-half', '3am', 'NOVA', 'Warm in a Cold Room');
  const v3 = tr('id-month', '3AM', 'NOVA', 'Warm in a Cold Room (Deluxe)');
  const p = buildPersona(music(chart([], [v3]), chart([], [v2]), chart([], [v1, { ...v1, id: 'dup' }])), TZ);
  const loop = p.traits.find((t) => t.key === 'loop')!;
  assert.equal(loop.figure, '1 首');
  assert.match(loop.proof, /NOVA〈3am〉/);
});

test('專輯格：沒聽滿整張就不出現（分享品味，不報「至少聽過幾首」）', () => {
  const t = (i: number) => tr(`w${i}`, `歌${i}`, '林小晴', '專輯', 2020);
  const all = [t(1), t(2), t(3)].map((x) => ({ ...x, album: { ...x.album, totalTracks: 10 } }));
  const p = buildPersona(music(chart([], []), chart([], []), chart([], all)), TZ);
  assert.equal(p.traits.find((x) => x.key === 'album'), undefined);
  assert.doesNotMatch(JSON.stringify(p), /至少聽過/);
});

test('M1：最近播放不到 7 天就不顯示「我聽歌的時間」；滿 7 天才顯示', () => {
  const span = (days: number) => ({ ...music(chart(artists, []), chart(artists, []), chart(artists, year)), recent: [
    { trackId: 'x', playedAt: new Date(Date.UTC(2026, 10, 8, 4)).toISOString() },
    { trackId: 'y', playedAt: new Date(Date.UTC(2026, 10, 8, 4) - days * 86_400_000).toISOString() },
  ] });
  assert.ok(!buildPersona(span(6.9), TZ).traits.some((t) => t.key === 'hours'));
  assert.ok(!buildPersona(span(1), TZ).traits.some((t) => t.key === 'hours'));
  assert.ok(buildPersona(span(7), TZ).traits.some((t) => t.key === 'hours'));
});
