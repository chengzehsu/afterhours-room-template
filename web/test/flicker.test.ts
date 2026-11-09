import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE_GLOW, IGNITE_MS, flicker, flickerRound, ignite } from '../src/live/flicker.ts';

const ROUNDS = 40;

test('flicker 輸出永遠在底光到 1 之間', () => {
  for (const seed of [1, 7, 12345]) {
    for (let t = 0; t < 120_000; t += 7) {
      const v = flicker(t, seed);
      assert.ok(v >= BASE_GLOW && v <= 1, `t=${t} v=${v}`);
    }
  }
  assert.equal(BASE_GLOW, 0.08);
});

test('同一個 seed 結果固定，不同 seed 節奏不同', () => {
  const a = Array.from({ length: 500 }, (_, i) => flicker(i * 37, 42));
  const b = Array.from({ length: 500 }, (_, i) => flicker(i * 37, 42));
  const c = Array.from({ length: 500 }, (_, i) => flicker(i * 37, 43));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(flickerRound(5, 3), flickerRound(5, 3));
});

test('每輪亮暗切換 2～5 次，每段 40～120ms，間隔長短不一', () => {
  const lengths = new Set<number>();
  for (let i = 0; i < ROUNDS; i++) {
    const r = flickerRound(9, i);
    assert.ok(r.segments.length >= 2 && r.segments.length <= 5, `round ${i}: ${r.segments.length}`);
    for (const s of r.segments) {
      assert.ok(s.ms >= 40 && s.ms <= 120, `ms=${s.ms}`);
      lengths.add(Math.round(s.ms));
    }
  }
  assert.ok(lengths.size > 10, '段長要不一樣');
  const first = flickerRound(9, 0).segments.map((s) => s.ms);
  assert.ok(new Set(first).size > 1, '同一輪內的段長不全相同');
});

test('輪與輪之間的停頓 1.5～3.5 秒，且每輪節奏不同', () => {
  const pauses = new Set<number>();
  for (let i = 0; i < ROUNDS; i++) {
    const r = flickerRound(9, i);
    assert.ok(r.pauseMs >= 1500 && r.pauseMs <= 3500, `pause=${r.pauseMs}`);
    assert.ok(r.pauseLevel >= BASE_GLOW && r.pauseLevel <= 0.3);
    pauses.add(Math.round(r.pauseMs));
  }
  assert.ok(pauses.size > 10);
});

test('flicker(t) 與回合表一致：段中取樣等於該段亮度，停頓取樣等於停頓亮度', () => {
  let start = 0;
  for (let i = 0; i < 6; i++) {
    const r = flickerRound(3, i);
    let t = start;
    for (const s of r.segments) {
      assert.equal(flicker(t + s.ms / 2, 3), s.level);
      t += s.ms;
    }
    assert.equal(flicker(t + r.pauseMs / 2, 3), r.pauseLevel);
    start = t + r.pauseMs;
  }
});

test('ignite 約 700ms 後恆為 1，中途至少掉暗一次，起點不是恆亮', () => {
  assert.ok(IGNITE_MS >= 400 && IGNITE_MS <= 700);
  let dipped = false;
  for (let t = 0; t < 1500; t++) {
    const v = ignite(t);
    assert.ok(v >= BASE_GLOW && v <= 1, `t=${t} v=${v}`);
    if (t >= 700) assert.equal(v, 1, `t=${t}`);
    if (t > 0 && t < IGNITE_MS && v < 0.5) dipped = true;
  }
  assert.ok(dipped, '點亮中途要有暗下去的瞬間');
  assert.ok(ignite(0) >= BASE_GLOW);
  assert.ok(ignite(-50) <= 0.2, '還沒開始時不是恆亮');
});

test('減少動態：flicker 恆亮 0.8，ignite 恆亮 1', () => {
  for (let t = 0; t < 10_000; t += 13) {
    assert.equal(flicker(t, 11, true), 0.8);
    assert.equal(ignite(t % 800, true), 1);
  }
});
