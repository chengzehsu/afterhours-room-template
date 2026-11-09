import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPage, roomData } from '../src/page/render.ts';
import type { TasteProfile } from '../src/core/profile.ts';

const profile = JSON.parse(readFileSync(new URL('../src/data/profile.json', import.meta.url), 'utf8')) as TasteProfile;
const html = renderPage(profile);

test('整頁只有一組時段 radiogroup，內有三顆 radio', () => {
  const groups = html.match(/<div class="seg range" role="radiogroup"[^>]*>[\s\S]*?<\/div>/g) ?? [];
  assert.equal(groups.length, 1);
  assert.equal((groups[0]!.match(/role="radio"/g) ?? []).length, 3);
  assert.deepEqual([...groups[0]!.matchAll(/data-range-opt="(\w+)"/g)].map((m) => m[1]), ['month', 'half', 'all']);
});

test('預設只有一年那顆 aria-checked=true，一年的封面牆與榜單顯示、其他兩段藏著', () => {
  const group = html.match(/<div class="seg range"[\s\S]*?<\/div>/)![0];
  assert.equal((group.match(/aria-checked="true"/g) ?? []).length, 1);
  assert.match(group, /data-range-opt="all" aria-checked="true"/);
  assert.match(html, /<ol class="shelf__covers" data-range="all" aria-label/);
  assert.match(html, /<ol class="shelf__covers" data-range="month" hidden/);
  assert.match(html, /<div class="sheet" data-range="all">/);
});

test('舊的 when__opt 與 lineup 已清除', () => {
  assert.ok(!html.includes('when__opt'));
  assert.ok(!html.includes('lineup'));
});

test('roomData 把副歌秒數帶進曲目；沒資料或是 null 的曲目沒有 chorusMs', () => {
  const ids = Object.keys(roomData(profile).tracks);
  assert.ok(ids.length >= 3);
  const d = roomData(profile, { [ids[0]!]: 61_000, [ids[1]!]: null });
  assert.equal(d.tracks[ids[0]!]!.chorusMs, 61_000);
  assert.equal(d.tracks[ids[1]!]!.chorusMs, null);
  assert.equal(d.tracks[ids[2]!]!.chorusMs, null);
  assert.equal(roomData(profile).tracks[ids[0]!]!.chorusMs, null);
});

test('roomData 帶開場歌手名單，沒給時是空陣列；曲目有主唱欄位', () => {
  assert.deepEqual(roomData(profile).openerArtists, []);
  assert.deepEqual(roomData(profile, {}, false, ['A', 'B']).openerArtists, ['A', 'B']);
  const t = Object.values(roomData(profile).tracks)[0]!;
  assert.equal(typeof t.artist, 'string');
});

test('出口的主連結是 screening/，頁尾有「看劇的地方」，Spotify 降成次要連結', () => {
  const exit = html.match(/<section id="next"[\s\S]*?<\/section>/)![0];
  assert.match(exit, /<a class="btn btn--bulb" href="screening\/"[^>]*data-enter="screening\/"[^>]*>推開門，過去看劇<\/a>/);
  assert.match(exit, /btn--amp[^>]*>先到 Spotify 找我/);
  assert.match(exit, /role="status"/);
  const foot = html.match(/<footer class="postcard">[\s\S]*?<\/footer>/)![0];
  assert.match(foot, /<a href="screening\/"[^>]*>看劇的地方<\/a>/);
});

test('放映室還沒建好：主按鈕與頁尾不指向會 404 的網址，但仍帶 data-enter 讓腳本接手', () => {
  const pending = renderPage(profile, { screeningReady: false });
  assert.ok(!pending.includes('href="screening/"'));
  assert.equal((pending.match(/data-enter="screening\/"/g) ?? []).length, 2);
  assert.match(pending, /data-note="投影還在架，下次來就開門。"/);
});

test('roomData 帶 screeningReady，預設 false', () => {
  assert.equal(roomData(profile).screeningReady, false);
  assert.equal(roomData(profile, {}, true).screeningReady, true);
});

test('CD 牆片名：〈〉跟片名在同一個元素的文字裡', async () => {
  const { quoteTitle } = await import('../src/page/copy.ts');
  assert.equal(quoteTitle('沒有人像我這樣'), '〈沒有人像我這樣〉');
  const span = `<span class="shelf__title">${quoteTitle('如果每天都是 happy happy 誰想要 blue:))')}</span>`;
  assert.match(span, /^<span class="shelf__title">〈[^<>]+〉<\/span>$/);
});

import { formatUpdated } from '../src/page/render.ts';
import { albumsOf } from '../src/core/stories.ts';

test('E2：更新日期用主人國家的時區，不受建置機器時區影響（CI 跑在 UTC）', () => {
  // UTC 11/9 16:30 = 台北 11/10 00:30
  assert.equal(formatUpdated('2026-11-09T16:30:00Z', 'TW'), '2026年11月10日');
  assert.equal(formatUpdated('2026-11-09T16:30:00Z', 'GB'), '2026年11月9日');
});

test('E2：整頁的更新日期取台北日期', () => {
  const h = renderPage({ ...profile, generatedAt: '2026-11-09T16:30:00Z', owner: { ...profile.owner, country: 'TW' } });
  assert.match(h, /<span>2026 年 11 月 10 日<\/span>/);
});

test('M7：榜單每位歌手旁的歌一定出自該時段的榜，不借別段', () => {
  for (const k of ['month', 'half', 'all'] as const) {
    const sheet = html.match(new RegExp(`<div class="sheet" data-range="${k}"[\\s\\S]*?(?=<div class="sheet"|</section>)`))![0];
    const ids = new Set(profile.music!.ranges[k].tracks.map((t) => t.id));
    for (const m of sheet.matchAll(/class="song" data-play="([^"]+)"/g)) assert.ok(ids.has(m[1]!), `${k} 榜借了別段的歌 ${m[1]}`);
  }
});

test('盒子：「這一年常放的歌，都在這 4 張裡」＝ CD 牆一年榜前 4 張（照 Spotify 名次，不用名次加分排序）', () => {
  assert.match(html, /<p class="cdbox__cap">這一年常放的歌，都在這 4 張裡<\/p>/);
  const box = html.match(/class="cdbox"[\s\S]*?<p class="cdbox__cap"/)![0];
  const alts = [...box.matchAll(/alt="([^"]*)"/g)].map((m) => m[1]);
  const wall = albumsOf(profile.music!.ranges.all.tracks).slice(0, 4).map((a) => a.name);
  assert.deepEqual(alts, wall);
  const d = roomData(profile);
  assert.deepEqual(d.ranges.all.slice(0, 4).map((id) => d.tracks[id]!.album), wall);
  // 照名次：第一張就是一年榜第 1 首歌的專輯
  assert.equal(wall[0], profile.music!.ranges.all.tracks[0]!.album.name);
});

test('S1：「一直都在的 N 位」的 N 等於畫面上實際的拍立得張數', () => {
  const block = html.match(/<h2 class="line-title">一直都在的 (\d+) 位[\s\S]*?<div class="pols">([\s\S]*?)<\/div>\s*<\/div>/)!;
  assert.equal(Number(block[1]), (block[2]!.match(/<figure class="pol"/g) ?? []).length);
});

test('E1：roomData 的名次，同一首歌的不同 id 拿到同樣的名次', () => {
  const t = (id: string) => ({ id, name: '3am', artists: [{ id: 'h', name: 'NOVA' }], album: { id: `al-${id}`, name: id }, durationMs: 1 });
  const rc = (tracks: ReturnType<typeof t>[]) => ({ artists: [], tracks });
  const p = { version: 1 as const, generatedAt: '2026-11-08T00:00:00Z', owner: { name: 'x' }, music: {
    source: 'spotify-api' as const, ranges: { month: rc([t('B')]), half: rc([t('B')]), all: rc([t('A')]) }, recent: [], extraTracks: [], totals: {},
  } };
  const d = roomData(p);
  assert.deepEqual(d.ranks.A, { month: 1, half: 1, all: 1 });
  assert.deepEqual(d.ranks.B, { month: 1, half: 1, all: 1 });
});
