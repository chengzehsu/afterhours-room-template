import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SCOPES,
  buildAuthorizeUrl,
  checkGrantedScopes,
  parseCallback,
  tokenFileBody,
} from '../scripts/authorize-spotify-readonly.ts';

test('scope 恰好是只讀的五個，沒有寫入或 email', () => {
  assert.deepEqual(
    [...SCOPES].sort(),
    ['user-follow-read', 'user-library-read', 'user-read-private', 'user-read-recently-played', 'user-top-read'],
  );
  assert.ok(SCOPES.every((s) => /-read|-read-/.test(s) || s === 'user-read-private' || s === 'user-read-recently-played'));
  assert.ok(!SCOPES.some((s) => /modify|write|email|playback/.test(s)));
});

test('授權網址帶 state、redirect 與全部 scope', () => {
  const u = new URL(buildAuthorizeUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:8888/callback', state: 'st' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(u.searchParams.get('state'), 'st');
  assert.equal(u.searchParams.get('client_id'), 'cid');
  assert.equal(u.searchParams.get('scope'), SCOPES.join(' '));
});

test('callback：state 不符就拒絕，且不先看 error 或 code', () => {
  assert.throws(() => parseCallback('/callback?state=bad&error=access_denied', 'good'), /state/);
  assert.throws(() => parseCallback('/callback?state=bad&code=abc', 'good'), /state/);
});

test('callback：state 對了才處理 error、缺 code、取 code', () => {
  assert.throws(() => parseCallback('/callback?state=good&error=access_denied', 'good'), /access_denied/);
  assert.throws(() => parseCallback('/callback?state=good', 'good'), /code/);
  assert.equal(parseCallback('/callback?state=good&code=abc', 'good'), 'abc');
});

test('授權到的 scope 必須與要求的完全相同（順序不拘）', () => {
  checkGrantedScopes([...SCOPES].reverse().join(' '));
  assert.throws(() => checkGrantedScopes(`${SCOPES.join(' ')} playlist-modify-public`), /scope/);
  assert.throws(() => checkGrantedScopes(SCOPES.slice(1).join(' ')), /scope/);
  assert.throws(() => checkGrantedScopes(undefined), /scope/);
});

test('輸出檔只含 refresh token', () => {
  assert.deepEqual(JSON.parse(tokenFileBody({ clientId: 'id', clientSecret: 'sec', refreshToken: 'rt' })), { clientId: 'id', clientSecret: 'sec', refreshToken: 'rt' });
});
