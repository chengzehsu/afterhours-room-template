import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findChorusMs, type ChorusLine } from '../src/core/chorus.ts';

/** 編的假歌詞：每個段落是一組行，行距 4 秒，段落之間多隔 8 秒（間奏） */
function song(sections: string[][], start = 12_000): { lines: ChorusLine[]; at: number[]; end: number } {
  const lines: ChorusLine[] = [];
  const at: number[] = [];
  let t = start;
  for (const sec of sections) {
    at.push(t);
    for (const text of sec) {
      lines.push({ t, text });
      t += 4000;
    }
    t += 8000;
  }
  return { lines, at, end: t + 10_000 };
}

const uniq = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `${tag}獨特第${i}句詞`);
const C = ['月光灑滿整條街', '我們還在原地等', '風吹過沒有回答', '就讓這一夜很長'];

test('主歌、副歌、主歌、副歌：回傳第一個副歌的起點', () => {
  const s = song([uniq('甲', 4), C, uniq('乙', 4), C, uniq('丙', 3), C]);
  assert.equal(findChorusMs(s.lines, s.end), s.at[1]);
});

test('正規化：標點、大小寫、空白不同的重複句仍算重複', () => {
  const s = song([uniq('甲', 4), C, uniq('乙', 4), C.map((x) => ` ${x}， `), uniq('丙', 4), C.map((x) => `${x}!`)]);
  assert.equal(findChorusMs(s.lines, s.end), s.at[1]);
});

test('主歌第二段重複主歌第一段幾行，但次數比副歌少：不挑主歌', () => {
  const v1 = ['走過長長的巷口', '想起那年的夏天', '你說過的那些話', '都留在口袋裡面'];
  const v2 = [v1[0]!, v1[1]!, '這次換我先離開', '不用再回頭看看'];
  const s = song([v1, C, v2, C, uniq('丙', 3), C]);
  assert.equal(findChorusMs(s.lines, s.end), s.at[1]);
});

test('只有主歌第二段重複主歌兩行（沒有真正的副歌）：回傳 null', () => {
  const v1 = ['走過長長的巷口', '想起那年的夏天', ...uniq('甲', 3)];
  const v2 = [v1[0]!, v1[1]!, ...uniq('乙', 3)];
  const s = song([v1, uniq('丁', 4), v2, uniq('丙', 4)]);
  assert.equal(findChorusMs(s.lines, s.end), null);
});

test('前奏有重複句：不把前奏當副歌，仍找到後面的副歌', () => {
  const intro = ['啦啦啦開場', '嗚嗚嗚開場', '啦啦啦開場', '嗚嗚嗚開場'];
  const s = song([intro, uniq('甲', 4), C, uniq('乙', 4), C, C], 1000);
  assert.equal(findChorusMs(s.lines, s.end), s.at[2]);
});

test('只有前奏重複、後面沒有重複：回傳 null', () => {
  const intro = ['啦啦啦開場', '嗚嗚嗚開場', '啦啦啦開場', '嗚嗚嗚開場'];
  const s = song([intro, uniq('甲', 6), uniq('乙', 6), uniq('丙', 6)], 1000);
  assert.equal(findChorusMs(s.lines, s.end), null);
});

test('單行口號一直重複：不算副歌', () => {
  const slogan = ['我們一起搖擺搖擺'];
  const s = song([uniq('甲', 4), slogan, slogan, slogan, uniq('乙', 4), slogan, slogan, slogan, uniq('丙', 4)]);
  assert.equal(findChorusMs(s.lines, s.end), null);
});

test('完全沒有重複：回傳 null', () => {
  const s = song([uniq('甲', 6), uniq('乙', 6), uniq('丙', 6)]);
  assert.equal(findChorusMs(s.lines, s.end), null);
});

test('歌詞很少：回傳 null', () => {
  const s = song([['一句', '兩句'], ['一句', '兩句']]);
  assert.equal(findChorusMs(s.lines, s.end), null);
  assert.equal(findChorusMs([], 200_000), null);
});

test('空白行（間奏標記）不影響判斷，也不會被當成副歌起點', () => {
  const s = song([uniq('甲', 4), C, uniq('乙', 4), C, C]);
  const withBlanks = s.lines.flatMap((l, i) => (i % 3 === 0 ? [l, { t: l.t + 1000, text: '' }] : [l]));
  assert.equal(findChorusMs(withBlanks, s.end), s.at[1]);
});

test('不知道歌曲長度（0）時用最後一行的時間估', () => {
  const s = song([uniq('甲', 4), C, uniq('乙', 4), C, C]);
  assert.equal(findChorusMs(s.lines, 0), s.at[1]);
});
