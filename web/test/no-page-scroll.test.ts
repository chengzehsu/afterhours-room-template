import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 2026-11-09：歌詞每換一句呼叫 li.scrollIntoView()，它會連整頁一起捲，訪客捲到別段時一直被拉回唱盤。
// 執行期程式不准用 scrollIntoView；要捲某個框就直接設那個框的 scrollTop／scrollTo。
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(n) ? [p] : [];
  });

test('src/ 不用 scrollIntoView（會連整頁一起捲）', () => {
  const hits = files(new URL('../src', import.meta.url).pathname)
    .filter((f) => readFileSync(f, 'utf8').split('\n').some((l) => /\.scrollIntoView\(/.test(l) && !/^\s*\/\//.test(l)));
  assert.deepEqual(hits, []);
});
