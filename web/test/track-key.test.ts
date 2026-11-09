import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Track } from '../src/core/profile.ts';
import { makeTrackKey } from '../src/core/trackkey.ts';

const tr = (id: string, name: string, by = 'honne', extra: Partial<Track> = {}): Track => ({
  id, name, artists: [{ id: by, name: by }], album: { id: `al-${id}`, name: `al-${id}` }, durationMs: 1, ...extra,
});

test('E1：同歌名同第一位歌手、不同 id（不同專輯版本）是同一首；大小寫與前後空白不影響', () => {
  const a = tr('1WH96', '3am');
  const b = tr('2lbl6', ' 3AM ');
  const key = makeTrackKey([a, b]);
  assert.equal(key(a), key(b));
});

test('E1：只去掉 remaster 這種版本註記；dream edit、Live 是不同版本，不合併', () => {
  const plain = tr('1', 'Paper Lanterns');
  const key = makeTrackKey([
    plain, tr('2', 'Paper Lanterns - 2019 Remaster'), tr('3', 'Paper Lanterns (Remastered 2011)'),
    tr('4', 'close to you - dream edit'), tr('5', 'close to you'), tr('6', 'Paper Lanterns (Live)'),
  ]);
  assert.equal(key(tr('2', 'Paper Lanterns - 2019 Remaster')), key(plain));
  assert.equal(key(tr('3', 'Paper Lanterns (Remastered 2011)')), key(plain));
  assert.notEqual(key(tr('4', 'close to you - dream edit')), key(tr('5', 'close to you')));
  assert.notEqual(key(tr('6', 'Paper Lanterns (Live)')), key(plain));
});

test('E1：同歌名但第一位歌手不同，不是同一首', () => {
  const a = tr('1', 'Intro', 'a');
  const b = tr('2', 'Intro', 'b');
  const key = makeTrackKey([a, b]);
  assert.notEqual(key(a), key(b));
});

test('E1：歌名不同但 isrc 相同（歌名後面多了影集註記）也算同一首', () => {
  const a = tr('1', '晚一點再說', 'cp', { isrc: 'TWX000000001' });
  const b = tr('2', '晚一點再說 (影集《說好的那場雨》主題曲)', 'cp', { isrc: 'TWX000000001' });
  const key = makeTrackKey([a, b]);
  assert.equal(key(a), key(b));
});
