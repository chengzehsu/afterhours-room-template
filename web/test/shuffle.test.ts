import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endWatcher, nextShuffle, trackEnded } from '../src/core/shuffle.ts';

test('不挑最近放過的', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'];
  for (let k = 0; k < 50; k++) {
    const n = nextShuffle(pool, ['a', 'b', 'c'], Math.random, 3)!;
    assert.ok(['d', 'e'].includes(n));
  }
});

test('牆很小也能換一首，不會一直同一首', () => {
  assert.equal(nextShuffle(['a', 'b'], ['a'], () => 0), 'b');
  assert.equal(nextShuffle(['a', 'b'], ['a', 'b', 'a'], () => 0.9), 'b');
  assert.equal(nextShuffle(['a'], ['a'], () => 0), 'a');
  assert.equal(nextShuffle([], [], () => 0), null);
});

test('播完的判斷：最後 1 秒內才算；太短的（還沒載好）不算', () => {
  assert.equal(trackEnded(29500, 30000), true);
  assert.equal(trackEnded(28000, 30000), false);
  assert.equal(trackEnded(0, 0), false);
  assert.equal(trackEnded(3000, 3000), false);
});

test('續播：同一首播完連續回報只接一次；重放同一首再播完要再接一次（舊版旗標不清，第二次就停了）', () => {
  const w = endWatcher();
  assert.equal(w(10_000, 30_000), false);
  assert.equal(w(29_500, 30_000), true);
  assert.equal(w(29_800, 30_000), false);
  assert.equal(w(30_000, 30_000), false);
  assert.equal(w(500, 30_000), false); // 同一首從頭再放
  assert.equal(w(29_600, 30_000), true);
});
