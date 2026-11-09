import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameGap, IDLE_GAP_MS, POINTER_GRACE_MS } from '../src/room/pace.ts';

const idle = { busy: false, residual: 0, now: 10_000, pointerAt: 0 };

test('什麼都沒在動：降到閒置格率', () => {
  assert.equal(frameGap(idle), IDLE_GAP_MS);
});

test('有動畫在跑（開場、換片、播放中）：每格都畫', () => {
  assert.equal(frameGap({ ...idle, busy: true }), 0);
});

test('鏡頭或唱臂還沒到位：每格都畫', () => {
  assert.equal(frameGap({ ...idle, residual: 0.01 }), 0);
});

test('殘差小到看不出來：算閒置', () => {
  assert.equal(frameGap({ ...idle, residual: 0.0001 }), IDLE_GAP_MS);
});

test('滑鼠剛動過：寬限期內每格都畫，過了才降', () => {
  assert.equal(frameGap({ ...idle, pointerAt: idle.now - 100 }), 0);
  assert.equal(frameGap({ ...idle, pointerAt: idle.now - POINTER_GRACE_MS - 1 }), IDLE_GAP_MS);
});
