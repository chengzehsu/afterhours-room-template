import test from 'node:test';
import assert from 'node:assert/strict';
import { embedUrl, netflixSearchUrl, parseYtMessage, command, linkVisible, ytError } from '../screening/trailer.ts';

const ORIGIN = 'https://example.com';

test('embedUrl 只接受 11 碼 YouTube id', () => {
  assert.equal(embedUrl('abc', { origin: ORIGIN, reduced: false }), null);
  assert.equal(embedUrl('abcdefghij"><', { origin: ORIGIN, reduced: false }), null);
  assert.equal(embedUrl('', { origin: ORIGIN, reduced: false }), null);
  assert.equal(embedUrl(null, { origin: ORIGIN, reduced: false }), null);
});

test('embedUrl 走 youtube-nocookie，預設靜音自動播', () => {
  const u = new URL(embedUrl('dQw4w9WgXcQ', { origin: ORIGIN, reduced: false })!);
  assert.equal(u.origin, 'https://www.youtube-nocookie.com');
  assert.equal(u.pathname, '/embed/dQw4w9WgXcQ');
  assert.equal(u.searchParams.get('autoplay'), '1');
  assert.equal(u.searchParams.get('mute'), '1');
  assert.equal(u.searchParams.get('playsinline'), '1');
  assert.equal(u.searchParams.get('enablejsapi'), '1');
  assert.equal(u.searchParams.get('origin'), ORIGIN);
});

test('reduced motion 時不自動播', () => {
  const u = new URL(embedUrl('dQw4w9WgXcQ', { origin: ORIGIN, reduced: true })!);
  assert.equal(u.searchParams.get('autoplay'), '0');
});

test('netflixSearchUrl 編碼 & 與空白與中文', () => {
  const u = new URL(netflixSearchUrl('Law & Order: 重案組'));
  assert.equal(u.origin, 'https://www.netflix.com');
  assert.equal(u.pathname, '/search');
  assert.equal(u.searchParams.get('q'), 'Law & Order: 重案組');
  assert.ok(!netflixSearchUrl('a&b=c').includes('a&b'));
});

test('parseYtMessage 讀 onStateChange，忽略其他', () => {
  assert.equal(parseYtMessage(JSON.stringify({ event: 'onStateChange', info: 0 })), 0);
  assert.equal(parseYtMessage(JSON.stringify({ event: 'infoDelivery', info: { playerState: 2 } })), 2);
  assert.equal(parseYtMessage(JSON.stringify({ event: 'onReady' })), null);
  assert.equal(parseYtMessage('not json'), null);
  assert.equal(parseYtMessage({ nope: 1 }), null);
  assert.equal(parseYtMessage(undefined), null);
});

test('command 產生 YouTube postMessage 指令', () => {
  assert.deepEqual(JSON.parse(command('unMute')), { event: 'command', func: 'unMute', args: [] });
  assert.deepEqual(JSON.parse(command('pauseVideo')), { event: 'command', func: 'pauseVideo', args: [] });
});

test('linkVisible：暫停(2)與結束(0)才顯示', () => {
  assert.equal(linkVisible(0), true);
  assert.equal(linkVisible(2), true);
  assert.equal(linkVisible(1), false);
  assert.equal(linkVisible(3), false);
  assert.equal(linkVisible(-1), false);
});

test('ytError：onError 事件代表這支嵌入放不了', () => {
  assert.equal(ytError(JSON.stringify({ event: 'onError', info: 101 })), true);
  assert.equal(ytError(JSON.stringify({ event: 'onStateChange', info: 1 })), false);
  assert.equal(ytError('x'), false);
});
