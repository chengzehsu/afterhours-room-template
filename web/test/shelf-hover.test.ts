import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOVER_SETTLE_MS, hoverPick, type HoverMemo } from '../src/room/shelf-hover.ts';

const fresh = (): HoverMemo => ({ stable: null, changedAt: -Infinity });

test('滑鼠指到另一張：同一格就選它，不用等', () => {
  const m = fresh();
  assert.equal(hoverPick(m, { current: 'a', over: 'b', onRoom: true, now: 1000 }), 'b');
});

test('快速掃過一排：每一格都跟著滑鼠底下那張', () => {
  const m = fresh();
  let cur: string | null = 'a';
  for (const [i, id] of ['b', 'c', 'd', 'e'].entries()) {
    cur = hoverPick(m, { current: cur, over: id, onRoom: true, now: 1000 + i * 16 });
    assert.equal(cur, id);
  }
});

test('路過幾張就離開房間去按按鈕：退回原本停著的那張', () => {
  const m = fresh();
  let cur = hoverPick(m, { current: 'a', over: null, onRoom: true, now: 0 });
  cur = hoverPick(m, { current: cur, over: null, onRoom: true, now: 500 }); // a 停夠久，成為穩定的
  cur = hoverPick(m, { current: cur, over: 'b', onRoom: true, now: 600 });
  cur = hoverPick(m, { current: cur, over: 'c', onRoom: true, now: 630 });
  cur = hoverPick(m, { current: cur, over: null, onRoom: false, now: 660 });
  assert.equal(cur, 'a');
});

test('在一張上停夠久再離開：留著那張', () => {
  const m = fresh();
  let cur = hoverPick(m, { current: 'a', over: 'b', onRoom: true, now: 0 });
  cur = hoverPick(m, { current: cur, over: 'b', onRoom: true, now: HOVER_SETTLE_MS + 1 });
  cur = hoverPick(m, { current: cur, over: null, onRoom: false, now: HOVER_SETTLE_MS + 20 });
  assert.equal(cur, 'b');
});

test('掃過 CD 之間的空隙（還在房間上）：不退回', () => {
  const m = fresh();
  let cur = hoverPick(m, { current: 'a', over: null, onRoom: true, now: 0 });
  cur = hoverPick(m, { current: cur, over: null, onRoom: true, now: 500 });
  cur = hoverPick(m, { current: cur, over: 'b', onRoom: true, now: 600 });
  cur = hoverPick(m, { current: cur, over: null, onRoom: true, now: 610 });
  assert.equal(cur, 'b');
});

test('鍵盤或捲動換張（不是滑鼠選的）：馬上算穩定，離開也不退', () => {
  const m = fresh();
  let cur = hoverPick(m, { current: 'a', over: null, onRoom: true, now: 0 });
  cur = hoverPick(m, { current: 'k', over: null, onRoom: true, now: 50 }); // 外部換成 k
  cur = hoverPick(m, { current: cur, over: null, onRoom: false, now: 60 });
  assert.equal(cur, 'k');
});

test('滑鼠停在一張上不動、按方向鍵換張：不被滑鼠底下那張搶回去', () => {
  // 桌機用左右鍵換張；滑鼠剛好靜止在 CD 牆上時，只有「移到另一張」才算滑鼠選片
  const m = { stable: null, changedAt: -Infinity };
  let cur = hoverPick(m, { current: 'a', over: 'a', onRoom: true, now: 0 });
  cur = hoverPick(m, { current: 'b', over: 'a', onRoom: true, now: 500 }); // 按 → 換成 b，滑鼠還停在 a
  assert.equal(cur, 'b');
  cur = hoverPick(m, { current: cur, over: 'a', onRoom: true, now: 520 });
  assert.equal(cur, 'b');
  cur = hoverPick(m, { current: cur, over: 'c', onRoom: true, now: 600 }); // 滑鼠真的移到 c：照樣馬上跟
  assert.equal(cur, 'c');
});
