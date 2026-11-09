import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forcedOpener, planIntro, tempStart } from '../src/core/opening.ts';

test('歌在牆上、一般動態：飛牆上那張', () => {
  assert.deepEqual(planIntro(true, false), { source: 'wall', animate: true, endsOnGesture: true });
});

test('歌不在牆上：用臨時 CD 飛，不走備援，開場等互動才結束', () => {
  const p = planIntro(false, false);
  assert.equal(p.source, 'temp');
  assert.equal(p.animate, true);
  assert.equal(p.endsOnGesture, true);
});

test('減少動態：不飛，但開場照樣等互動才結束（不論歌在不在牆上）', () => {
  for (const onWall of [true, false]) {
    const p = planIntro(onWall, true);
    assert.equal(p.animate, false);
    assert.equal(p.endsOnGesture, true);
  }
});

test('臨時 CD 起點在第一格附近、往房間內且抬高', () => {
  const s = tempStart([1, 2, 3]);
  assert.ok(s[0] > 1 && s[1] > 2 && s[2] === 3);
});

test('?opener 只收曲目表裡有的 id', () => {
  const tracks = { abc: {} };
  assert.equal(forcedOpener('?opener=abc', tracks), 'abc');
  assert.equal(forcedOpener('?opener=nope', tracks), null);
  assert.equal(forcedOpener('?opener=toString', tracks), null);
  assert.equal(forcedOpener('', tracks), null);
});
