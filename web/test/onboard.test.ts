import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onboardLines } from '../src/core/onboard.ts';

test('開場對話：名字、別名、歌手數、放映室', () => {
  const l = onboardLines({ name: '阿明', alias: 'Ming' }, 68, true);
  assert.equal(l.length, 4);
  assert.equal(l[0], '嗨，我是阿明，也可以叫我 Ming。');
  assert.match(l[1]!, /這一年常聽的歌手有 68 位/);
  assert.match(l[1]!, /隔壁是我看劇的地方/);
  assert.equal(l[2], '我想讓認識我的人知道，我平常都在聽什麼、看什麼。');
  assert.equal(l[3], '先從我的架上，挑一張你喜歡的專輯吧。');
});

test('沒有別名、沒有放映室時不硬講', () => {
  const l = onboardLines({ name: '小明' }, 1234, false);
  assert.equal(l[0], '嗨，我是小明。');
  assert.match(l[1]!, /這一年常聽的歌手有 1,234 位/);
  assert.doesNotMatch(l.join(''), /看劇的地方|看什麼/);
});
