import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHORUS_SPAN_MS, energyAt, lineAt, LyricPulse } from '../src/live/cues.ts';

const lines = [{ t: 1000 }, { t: 4000 }, { t: 8000 }, { t: 12000 }];

test('lineAt：第一行之前是 -1，剛好在時間點上算那一行，最後一行之後停在最後', () => {
  assert.equal(lineAt(lines, 0), -1);
  assert.equal(lineAt(lines, 1000), 0);
  assert.equal(lineAt(lines, 7999), 1);
  assert.equal(lineAt(lines, 99999), 3);
  assert.equal(lineAt([], 5000), -1);
});

test('energyAt：副歌 30 秒內是 1，前後 2 秒漸變，沒有副歌資料是 0', () => {
  assert.equal(energyAt(50000, null), 0);
  assert.equal(energyAt(10000, 60000), 0);
  assert.equal(energyAt(59000, 60000), 0.5);
  assert.equal(energyAt(70000, 60000), 1);
  assert.equal(energyAt(60000 + CHORUS_SPAN_MS + 1000, 60000), 0.5);
  assert.equal(energyAt(60000 + CHORUS_SPAN_MS + 5000, 60000), 0);
});

test('LyricPulse：唱到下一句才亮；剛換歌、跳到副歌、暫停時不亮', () => {
  const p = new LyricPulse();
  const r = (ms: number, key = 'a', playing = true) => p.read(0, 1 / 60, key, ms, lines, null, playing).beat;
  assert.equal(r(1500), false, '第一次對上不算');
  assert.equal(r(4100), true, '換到下一句');
  assert.equal(r(4200), false, '同一句');
  assert.equal(r(12100), false, '一次跳過好幾句（seek）');
  assert.equal(r(1500, 'b'), false, '換歌重新對');
  assert.equal(r(4100, 'b', false), false, '沒在放');
});

test('LyricPulse：亮過之後慢慢退，不會停在最亮', () => {
  const p = new LyricPulse();
  p.read(0, 0.016, 'a', 1500, lines, null, true);
  const hit = p.read(0, 0.016, 'a', 4100, lines, null, true).pulse;
  let v = hit;
  for (let k = 0; k < 60; k++) v = p.read(0, 0.016, 'a', 4200, lines, null, true).pulse;
  assert.equal(hit, 1);
  assert.ok(v < 0.3, `一秒後應該退到 0.3 以下，實際 ${v}`);
});
