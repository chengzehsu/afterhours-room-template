import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shareNote, parseShareData } from '../src/share/client.ts';

test('系統分享成功：提示連結已複製可貼 IG 連結貼紙', () => {
  assert.match(shareNote({ via: 'share', copied: true }), /連結已複製.*IG 的連結貼紙/);
});
test('系統分享成功但沒複製成功：不能說已複製', () => {
  assert.ok(!shareNote({ via: 'share', copied: false }).includes('已複製'));
});
test('不支援檔案分享：說圖已下載；有複製才說連結已複製', () => {
  assert.match(shareNote({ via: 'download', copied: true }), /圖已下載.*連結已複製/);
  const n = shareNote({ via: 'download', copied: false });
  assert.match(n, /圖已下載/); assert.ok(!n.includes('已複製'));
});
test('使用者取消分享：不顯示任何字', () => {
  assert.equal(shareNote({ via: 'cancelled', copied: true }), '');
});
test('parseShareData：只收 https 網址與站內相對圖路徑，其他回 null', () => {
  const ok = parseShareData('{"url":"https://a.example/","story":"share/s.jpg","filename":"s.jpg"}');
  assert.equal(ok?.story, 'share/s.jpg');
  assert.equal(parseShareData('{"url":"javascript:x","story":"share/s.jpg","filename":"s.jpg"}'), null);
  assert.equal(parseShareData('{"url":"https://a.example/","story":"https://evil/x.jpg","filename":"s.jpg"}'), null);
  assert.equal(parseShareData('{"url":"https://a.example/","story":"../share/s.jpg","filename":"s.jpg"}')?.story, '../share/s.jpg');
  assert.equal(parseShareData('{"url":"https://a.example/","story":"share/../../x.jpg","filename":"s.jpg"}'), null);
  assert.equal(parseShareData('nope'), null);
});
