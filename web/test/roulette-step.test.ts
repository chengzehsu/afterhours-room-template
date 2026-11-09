// 回歸：開場選片時光快速跳過很多張專輯（業主 2026-11-09，「這問題很嚴重」）。
// 原因：光每 1.8 秒自己往下走，加上鏡頭從門口滑到 CD 牆時滑鼠底下的 CD 每格都在變。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLit } from '../src/room/roulette-step.ts';

test('滑鼠沒指著任何一張：光停在原本那張，不管過多久都不自己換', () => {
  let lit = 'a';
  for (let frame = 0; frame < 600; frame++) lit = nextLit(lit, null, false); // 約 10 秒
  assert.equal(lit, 'a');
});

test('鏡頭還在滑動：滑鼠底下的 CD 一直變，光也不跟', () => {
  let lit = 'a';
  for (const under of ['b', 'c', 'd', 'e', 'f', 'g']) lit = nextLit(lit, under, true);
  assert.equal(lit, 'a');
});

test('鏡頭停好後，滑鼠指到別張才跟過去；移開後停在最後指的那張', () => {
  let lit = nextLit('a', 'c', false);
  assert.equal(lit, 'c');
  lit = nextLit(lit, null, false);
  assert.equal(lit, 'c');
});
