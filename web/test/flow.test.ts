import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enterPlan, FULL_TRACK_MS, isPreview, spotifyFault, spotifyTrackUrl, stepIndex, withTimeout } from '../src/core/flow.ts';

test('試聽：長度明顯比整首短才算，0 = 還沒回報', () => {
  assert.equal(isPreview(0), false);
  assert.equal(isPreview(30_000), true);
  assert.equal(isPreview(FULL_TRACK_MS - 1), true);
  assert.equal(isPreview(FULL_TRACK_MS), false);
  assert.equal(isPreview(212_000), false);
});

test('方向鍵：左右上下循環，Home／End 跳頭尾，其他鍵不處理', () => {
  assert.equal(stepIndex(4, 0, 'ArrowRight'), 1);
  assert.equal(stepIndex(4, 3, 'ArrowRight'), 0);
  assert.equal(stepIndex(4, 0, 'ArrowLeft'), 3);
  assert.equal(stepIndex(4, 2, 'ArrowDown'), 3);
  assert.equal(stepIndex(4, 2, 'ArrowUp'), 1);
  assert.equal(stepIndex(4, 2, 'Home'), 0);
  assert.equal(stepIndex(4, 0, 'End'), 3);
  assert.equal(stepIndex(4, 0, 'Tab'), null);
  assert.equal(stepIndex(0, 0, 'ArrowRight'), null);
  assert.equal(stepIndex(4, -1, 'ArrowRight'), 1);
});

test('載入逾時：沒回應就 reject，先完成的算數', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'Spotify 播放器'), /逾時/);
  assert.equal(await withTimeout(Promise.resolve(7), 20, 'x'), 7);
  await assert.rejects(withTimeout(Promise.reject(new Error('擋掉了')), 20, 'x'), /擋掉了/);
});

test('?spotify= 只認 fail、hang', () => {
  assert.equal(spotifyFault('?spotify=fail'), 'fail');
  assert.equal(spotifyFault('?a=1&spotify=hang'), 'hang');
  assert.equal(spotifyFault('?spotify=ok'), null);
  assert.equal(spotifyFault(''), null);
});

test('換頁方式：沒 3D 房間照樣直接換頁，放映室沒好才敲門', () => {
  const base = { ready: true, reduced: false, hasRoom: true, roomBroken: false };
  assert.equal(enterPlan(base), 'animate');
  assert.equal(enterPlan({ ...base, hasRoom: false }), 'direct');
  assert.equal(enterPlan({ ...base, roomBroken: true }), 'direct');
  assert.equal(enterPlan({ ...base, reduced: true }), 'direct');
  assert.equal(enterPlan({ ...base, ready: false, hasRoom: false }), 'knock');
});

test('Spotify 連結', () => {
  assert.equal(spotifyTrackUrl('abc123'), 'https://open.spotify.com/track/abc123');
});
