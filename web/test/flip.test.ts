import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLIP_INSTANT, FLIP_TIMING, flipAngle, flipMidpoint, flipPlan } from '../src/room/flip.ts';

const COLS = 10;
const sizes: [number, number][] = [[36, 34], [34, 45], [36, 45], [45, 36], [45, 45], [0, 36]];

test('每種張數組合都在 800 毫秒內結束', () => {
  for (const [a, b] of sizes) {
    const plan = flipPlan(a, b, COLS);
    assert.ok(plan.length > 0 || a + b === 0);
    assert.ok(Math.max(...plan.map((p) => p.end)) <= FLIP_TIMING.total, `${a}->${b}`);
    assert.ok(plan.every((p) => p.start >= 0));
  }
});

test('換面在每個位子自己翻轉的中點，那一刻剛好側面朝前', () => {
  for (const p of flipPlan(36, 45, COLS)) {
    assert.equal(p.swapAt - p.start, FLIP_TIMING.dur / 2);
  }
  assert.ok(Math.abs(Math.abs(flipAngle(0.5)) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(flipAngle(0.4999)) < Math.PI / 2 && flipAngle(0.4999) > 1.5);
  assert.ok(flipAngle(0.5001) < -1.5);
});

test('角度從正面開始、回到正面，絕對值前半遞增後半遞減', () => {
  assert.equal(flipAngle(0), 0);
  assert.ok(Math.abs(flipAngle(1)) < 1e-9);
  let prev = 0;
  for (let t = 0.05; t < 0.5; t += 0.05) {
    assert.ok(Math.abs(flipAngle(t)) > prev);
    prev = Math.abs(flipAngle(t));
  }
  for (let t = 0.55; t < 1; t += 0.05) {
    assert.ok(Math.abs(flipAngle(t)) < prev);
    prev = Math.abs(flipAngle(t));
  }
});

test('從左上往右下：同一列往右、同一欄往下，開始時間不會變早', () => {
  const plan = flipPlan(45, 45, COLS);
  const at = (i: number) => plan[i]!.start;
  for (let i = 0; i < plan.length; i++) {
    if (i % COLS < COLS - 1 && i + 1 < plan.length) assert.ok(at(i + 1) >= at(i));
    if (i + COLS < plan.length) assert.ok(at(i + COLS) >= at(i));
  }
  assert.equal(at(0), 0);
  assert.ok(at(44) > at(0));
  assert.equal(at(39), Math.max(...plan.map((p) => p.start)));
});

test('變多：多出來的位子是 enter，其餘 turn', () => {
  const plan = flipPlan(34, 45, COLS);
  assert.equal(plan.length, 45);
  plan.forEach((p) => assert.equal(p.kind, p.index < 34 ? 'turn' : 'enter'));
  plan.filter((p) => p.kind === 'enter').forEach((p) => assert.equal(p.end - p.start, FLIP_TIMING.dur));
});

test('變少：多的位子是 exit，翻到側面就結束', () => {
  const plan = flipPlan(45, 36, COLS);
  assert.equal(plan.length, 45);
  plan.forEach((p) => assert.equal(p.kind, p.index < 36 ? 'turn' : 'exit'));
  plan.filter((p) => p.kind === 'exit').forEach((p) => assert.equal(p.end, p.swapAt));
});

test('一樣多：全部都是 turn', () => {
  assert.ok(flipPlan(36, 36, COLS).every((p) => p.kind === 'turn'));
});

test('波浪中點落在第一個與最後一個換面之間', () => {
  const plan = flipPlan(36, 45, COLS);
  const mid = flipMidpoint(plan);
  assert.ok(mid > Math.min(...plan.map((p) => p.swapAt)) && mid < Math.max(...plan.map((p) => p.swapAt)));
  assert.equal(flipMidpoint([]), 0);
});

test('減少動態：全部同一刻、零時長', () => {
  const plan = flipPlan(36, 45, COLS, FLIP_INSTANT);
  assert.ok(plan.every((p) => p.start === 0 && p.swapAt === 0 && p.end === 0));
});
