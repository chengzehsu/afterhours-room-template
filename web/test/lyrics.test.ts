import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentLine, parseLrc } from '../src/live/lyrics.ts';

test('LRC：時間、多重時間標記、空白行', () => {
  const lines = parseLrc('[ar:NOVA]\n[00:12.50]第一行\n[00:20.1]\n[01:02.345][01:30.00]副歌');
  assert.deepEqual(lines, [
    { t: 12_500, text: '第一行' },
    { t: 20_100, text: '' },
    { t: 62_345, text: '副歌' },
    { t: 90_000, text: '副歌' },
  ]);
});

test('目前播到哪一行', () => {
  const lines = parseLrc('[00:01.00]a\n[00:05.00]b\n[00:09.00]c');
  assert.equal(currentLine(lines, 0), -1);
  assert.equal(currentLine(lines, 1000), 0);
  assert.equal(currentLine(lines, 7000), 1);
  assert.equal(currentLine(lines, 99_000), 2);
  assert.equal(currentLine([], 5000), -1);
});
