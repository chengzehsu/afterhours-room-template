import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchAllSaved, spotifyHeaders } from '../scripts/spotify-request.ts';

test('M4：每個請求都帶 Accept-Language: zh-TW（要求中文歌手名），權杖照舊', () => {
  assert.deepEqual(spotifyHeaders('tok'), { Authorization: 'Bearer tok', 'Accept-Language': 'zh-TW' });
});

test('M2：按讚的歌分頁抓完（每頁 50），合成 { total, items }', async () => {
  const all = Array.from({ length: 120 }, (_, i) => ({ track: { id: `t${i}` } }));
  const calls: Record<string, number>[] = [];
  const get = async (_path: string, params: Record<string, number>) => {
    calls.push(params);
    return { total: 120, items: all.slice(params.offset!, params.offset! + params.limit!) };
  };
  const out = await fetchAllSaved(get);
  assert.deepEqual(calls.map((c) => [c.offset, c.limit]), [[0, 50], [50, 50], [100, 50]]);
  assert.equal(out.total, 120);
  assert.equal(out.items.length, 120);
});

test('M2：伺服器回空頁就停，不無限迴圈', async () => {
  let n = 0;
  const get = async () => (++n === 1 ? { total: 500, items: [{ track: { id: 'a' } }] } : { total: 500, items: [] });
  const out = await fetchAllSaved(get, 50, 10);
  assert.equal(out.items.length, 1);
  assert.equal(n, 2);
});
