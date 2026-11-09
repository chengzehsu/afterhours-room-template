import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  describeRefreshFailure,
  resolveCredentialSource,
  rotatedTokenToPersist,
  writeLocalCredentials,
  writeRotatedToken,
} from '../scripts/spotify-credentials.ts';

const full = { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'sec', SPOTIFY_REFRESH_TOKEN: 'rt' };

test('三個變數齊全：走環境變數，不帶 access token', () => {
  const s = resolveCredentialSource({ ...full, SPOTIFY_ROTATED_TOKEN_FILE: '/x/rot' });
  assert.deepEqual(s, {
    kind: 'env',
    config: { clientId: 'id', clientSecret: 'sec', refreshToken: 'rt' },
    rotatedTokenFile: '/x/rot',
  });
});

test('缺一個或空字串：走 MCP 設定檔', () => {
  assert.equal(resolveCredentialSource({}).kind, 'file');
  assert.equal(resolveCredentialSource({ ...full, SPOTIFY_REFRESH_TOKEN: undefined }).kind, 'file');
  assert.equal(resolveCredentialSource({ ...full, SPOTIFY_CLIENT_SECRET: '' }).kind, 'file');
  assert.equal(resolveCredentialSource({ SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'sec' }).kind, 'file');
});

test('換發失敗訊息只留狀態與 error 代碼', () => {
  const body = JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token revoked' });
  const msg = describeRefreshFailure(400, body);
  assert.equal(msg, '換發權杖失敗 HTTP 400 (invalid_grant)');
  assert.ok(!msg.includes('revoked'));
});

test('換發失敗：body 不是 JSON 或 error 不是短代碼，只留狀態', () => {
  assert.equal(describeRefreshFailure(500, '<html>oops secret=abc</html>'), '換發權杖失敗 HTTP 500');
  assert.equal(describeRefreshFailure(400, JSON.stringify({ error: 'Has Spaces And Token abc' })), '換發權杖失敗 HTTP 400');
  assert.equal(describeRefreshFailure(400, JSON.stringify({ error: { message: 'x' } })), '換發權杖失敗 HTTP 400');
});

test('輪替：只有回了不同的新 token 才要寫', () => {
  assert.equal(rotatedTokenToPersist('old', 'new'), 'new');
  assert.equal(rotatedTokenToPersist('old', 'old'), undefined);
  assert.equal(rotatedTokenToPersist('old', undefined), undefined);
  assert.equal(rotatedTokenToPersist('old', ''), undefined);
});

test('輪替檔：內容只有 token（無換行）、權限 600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rot-'));
  const f = join(dir, 'rot');
  writeRotatedToken(f, 'newtoken');
  assert.equal(readFileSync(f, 'utf8'), 'newtoken');
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.ok(!existsSync(`${f}.tmp`));
});

const local = { clientId: 'lid', clientSecret: 'lsec', refreshToken: 'lrt' };

test('本機權杖檔三樣齊全、環境變數不齊：走本機權杖檔（clone 的人 npm run spotify:login 之後）', () => {
  assert.deepEqual(resolveCredentialSource({}, local), { kind: 'local', config: local });
  assert.deepEqual(resolveCredentialSource({ SPOTIFY_CLIENT_ID: 'id' }, local), { kind: 'local', config: local });
});

test('環境變數齊全時優先於本機權杖檔（CI 行為不變）', () => {
  assert.equal(resolveCredentialSource(full, local).kind, 'env');
});

test('本機權杖檔缺欄位、是舊格式（只有 refreshToken）或不是物件：照舊走 MCP 設定檔', () => {
  assert.equal(resolveCredentialSource({}, { refreshToken: 'rt' }).kind, 'file');
  assert.equal(resolveCredentialSource({}, { ...local, clientSecret: '' }).kind, 'file');
  assert.equal(resolveCredentialSource({}, null).kind, 'file');
  assert.equal(resolveCredentialSource({}, 'x').kind, 'file');
  assert.equal(resolveCredentialSource({}, undefined).kind, 'file');
});

test('本機權杖檔寫入：只有三個欄位、權限 600、原子寫入', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loc-'));
  const f = join(dir, 'tok.json');
  writeLocalCredentials(f, { ...local, accessToken: 'at', expiresAt: 1 });
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), local);
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.ok(!existsSync(`${f}.tmp`));
});
