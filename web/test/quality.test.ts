import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LEVELS,
  SLOW_P90_MS,
  STRIKES_TO_DROP,
  WARMUP_MS,
  WINDOW_FRAMES,
  effective,
  forcedLevel,
  initialQuality,
  percentile,
  stepQuality,
  type QualityState,
} from '../src/room/quality.ts';

const p90Of = (ms: number) => Array.from({ length: WINDOW_FRAMES }, () => ms);
const fast = Array.from({ length: WINDOW_FRAMES }, () => 16.7);
const slow = Array.from({ length: WINDOW_FRAMES }, () => SLOW_P90_MS + 15);
const base = { frames: fast, hidden: false, sinceLoadMs: WARMUP_MS + 1, dpr: 2 };
const run = (s: QualityState, windows: number[][], extra = {}) =>
  windows.reduce((st, frames) => stepQuality(st, { ...base, ...extra, frames }), s);

test('等級表：由全畫質排到最低，每級都比上一級省', () => {
  assert.equal(LEVELS[0]!.name, 'full');
  for (let i = 1; i < LEVELS.length; i++) {
    const a = LEVELS[i - 1]!;
    const b = LEVELS[i]!;
    assert.ok(b.pixelRatio <= a.pixelRatio && b.shadowMap <= a.shadowMap, b.name);
    assert.ok(!(b.bloom && !a.bloom), b.name);
    assert.notDeepEqual(effective(b, 2), effective(a, 2), b.name);
  }
});

test('百分位：n=50 的 p99 不是最大值，而是插值', () => {
  const xs = [...Array.from({ length: 49 }, () => 10), 500];
  const p = percentile(xs, 0.99);
  assert.ok(p < 500 && p > 10, String(p));
});

test('百分位：n=100 剛好落在邊界也不越界', () => {
  const xs = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.ok(Math.abs(percentile(xs, 0.9) - 90.1) < 1e-9);
  assert.equal(percentile(xs, 1), 100);
  assert.equal(percentile(xs, 0), 1);
});

test('百分位：只有一個極端值時 p90 看不到它', () => {
  const xs = [...Array.from({ length: 99 }, () => 16), 3000];
  assert.equal(percentile(xs, 0.9), 16);
});

test('百分位：單一筆資料與未排序輸入', () => {
  assert.equal(percentile([7], 0.9), 7);
  assert.equal(percentile([30, 10, 20], 0.5), 20);
});

test('開場暖機期間不量：再慢也不降', () => {
  const s = run(initialQuality(), [slow, slow, slow, slow], { sinceLoadMs: WARMUP_MS - 1 });
  assert.equal(s.level, 0);
  assert.equal(s.strikes, 0);
});

test('分頁在背景不量', () => {
  const s = run(initialQuality(), [slow, slow, slow, slow], { hidden: true });
  assert.equal(s.level, 0);
});

test('一個窗口慢不降，連續幾個窗口都慢才降一級', () => {
  let s = initialQuality();
  for (let i = 0; i < STRIKES_TO_DROP - 1; i++) s = run(s, [slow]);
  assert.equal(s.level, 0);
  s = run(s, [slow]);
  assert.equal(s.level, 1);
  assert.equal(s.strikes, 0);
});

test('中間夾一個正常窗口，慢的計數歸零', () => {
  const s = run(initialQuality(), [slow, slow, fast, slow, slow]);
  assert.equal(s.level, 0);
});

test('單一超長畫格（切分頁、GC）不會觸發降級', () => {
  const spiky = [...fast.slice(1), 4000];
  const s = run(initialQuality(), [spiky, spiky, spiky, spiky, spiky]);
  assert.equal(s.level, 0);
});

test('只降不升：之後畫格再順也不會回頭', () => {
  let s = run(initialQuality(), [slow, slow, slow]);
  assert.equal(s.level, 1);
  s = run(s, [fast, fast, fast, fast, fast, fast]);
  assert.equal(s.level, 1);
});

test('到了最低一級就停，不會越界', () => {
  // 每降一級 p90 都減半（降得有用），但一直高於門檻，一路降到底
  let s = initialQuality();
  for (let i = 0; i < 60; i++) s = run(s, [p90Of(Math.max(4000 / 2 ** s.level, SLOW_P90_MS + 1))]);
  assert.equal(s.level, LEVELS.length - 1);
});

test('畫格數不足一個窗口：不下判斷', () => {
  const s = run(initialQuality(), [slow.slice(0, 10), slow.slice(0, 10), slow.slice(0, 10)]);
  assert.equal(s.strikes, 0);
  assert.equal(s.level, 0);
});

test('像素密度上限已被螢幕本身壓住時，降級會跳到真的有差別的那一級', () => {
  const s = run(initialQuality(), [slow, slow, slow], { dpr: 1 });
  const before = effective(LEVELS[0]!, 1);
  const after = effective(LEVELS[s.level]!, 1);
  assert.notDeepEqual(after, before);
  assert.ok(s.level >= 1);
});

test('網址參數：指定等級；未知或沒給就是 null', () => {
  assert.equal(forcedLevel('?quality=minimal'), LEVELS.length - 1);
  assert.equal(forcedLevel('?x=1&quality=full'), 0);
  assert.equal(forcedLevel('?quality=nope'), null);
  assert.equal(forcedLevel(''), null);
});


test('降級沒換到流暢度（卡在 CPU）：退回上一級，之後不再降', () => {
  const dropped = run(initialQuality(), Array.from({ length: STRIKES_TO_DROP }, () => p90Of(40)));
  assert.equal(dropped.level, 1);
  const back = run(dropped, [p90Of(39)]);
  assert.equal(back.level, 0, '降了沒變快就退回');
  const after = run(back, Array.from({ length: STRIKES_TO_DROP * 3 }, () => p90Of(40)));
  assert.equal(after.level, 0, '退回後鎖住，不會再來回試');
});

test('降級有效（p90 明顯變小）就留在新等級，還慢可以繼續降', () => {
  const dropped = run(initialQuality(), Array.from({ length: STRIKES_TO_DROP }, () => p90Of(60)));
  const kept = run(dropped, [p90Of(40)]);
  assert.equal(kept.level, 1);
  // kept 那個窗口本身也算一次慢，再兩個慢窗口就降下一級
  const further = run(kept, Array.from({ length: STRIKES_TO_DROP - 1 }, () => p90Of(40)));
  assert.equal(further.level, 2);
});
