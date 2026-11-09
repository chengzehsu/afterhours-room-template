import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moodByClock, pickMood } from '../src/core/mood.ts';

const at = (h: number, day = 8) => new Date(2026, 10, day, h, 30);

test('照裝置當地時間：白天午後、傍晚微醺、深夜', () => {
  assert.equal(moodByClock(at(9)), 'afternoon');
  assert.equal(moodByClock(at(15)), 'afternoon');
  assert.equal(moodByClock(at(18)), 'tipsy');
  assert.equal(moodByClock(at(23)), 'night');
  assert.equal(moodByClock(at(3)), 'night');
});

test('沒選過就照時間', () => {
  assert.equal(pickMood(at(10), null), 'afternoon');
});

test('同一天、同一個時段裡自己選的，照選的', () => {
  const saved = { mood: 'night' as const, slot: 'afternoon' as const, day: at(10).toDateString() };
  assert.equal(pickMood(at(14), saved), 'night');
});

test('晚上選了深夜，隔天白天打開要回到午後', () => {
  const saved = { mood: 'night' as const, slot: 'night' as const, day: at(23, 7).toDateString() };
  assert.equal(pickMood(at(10, 8), saved), 'afternoon');
});

test('同一天但時段已經換了，回到照時間', () => {
  const saved = { mood: 'night' as const, slot: 'afternoon' as const, day: at(10).toDateString() };
  assert.equal(pickMood(at(18), saved), 'tipsy');
});

test('存的東西壞掉就照時間', () => {
  assert.equal(pickMood(at(10), { mood: 'x', slot: 'afternoon', day: at(10).toDateString() } as never), 'afternoon');
});
