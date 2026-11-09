import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diveEnd, entryRoute, withoutReturnParam } from '../src/core/opening.ts';

const CINEMA_WIDE = { pos: [1.55, 1.62, -1.1], look: [3.25, 1.5, -4], fov: 50 } as const;
const CINEMA_PHONE = { pos: [1.9, 1.6, -0.6], look: [3.25, 1.5, -4], fov: 70 } as const;

test('沒有參數：一般開場', () => {
  assert.equal(entryRoute('', false), 'opening');
  assert.equal(entryRoute('?from=elsewhere', false), 'opening');
  assert.equal(entryRoute('?opener=abc', true), 'opening');
});

test('?from=screening：回到出口；減少動態時不動畫', () => {
  assert.equal(entryRoute('?from=screening', false), 'return');
  assert.equal(entryRoute('?from=screening', true), 'return-still');
  assert.equal(entryRoute('?x=1&from=screening', false), 'return');
});

test('推近終點：寬螢幕與手機都對上 room.ts dive() 的結果', () => {
  const w = diveEnd(CINEMA_WIDE);
  assert.deepEqual(w.pos.map((n) => +n.toFixed(2)), [2.6, 1.55, -2.03]);
  assert.deepEqual(w.look, [3.25, 1.3, -4.4]);
  assert.equal(+w.fov.toFixed(1), 43);
  const p = diveEnd(CINEMA_PHONE);
  assert.deepEqual(p.pos.map((n) => +n.toFixed(3)), [2.737, 1.538, -1.84]);
  assert.deepEqual(p.look, [3.25, 1.3, -4.4]);
  assert.equal(+p.fov.toFixed(1), 60.2);
});

test('拿掉 from=screening，保留其他參數', () => {
  assert.equal(withoutReturnParam('?from=screening'), '');
  assert.equal(withoutReturnParam('?from=screening&opener=a'), '?opener=a');
  assert.equal(withoutReturnParam('?x=1'), '?x=1');
});
