import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { diagnose, report } from '../scripts/doctor.ts';
import { applySetup, toUrl, validWorker } from '../scripts/setup.ts';

/** 假的 repo：範例主人、佔位網址、範例 profile */
function fakeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'setup-'));
  mkdirSync(join(root, 'web/src/data'), { recursive: true });
  writeFileSync(join(root, 'web/src/data/owner.json'), JSON.stringify({ name: '阿明', alias: 'Ming', favorites: { screen: ['片'], gigs: [] } }));
  writeFileSync(join(root, 'web/site.config.json'), JSON.stringify({ url: 'https://your-room.your-subdomain.workers.dev', worker: 'your-room' }));
  writeFileSync(join(root, 'web/src/data/profile.json'), JSON.stringify({ owner: { name: 'Alex' }, music: { ranges: {} }, img: 'media/sample-a.jpg' }));
  return root;
}

test('setup：子網域自動組成 workers.dev 網址；完整網址照用；亂填擋下', () => {
  assert.equal(toUrl('ming', 'ming-room'), 'https://ming-room.ming.workers.dev');
  assert.equal(toUrl('https://room.example.com/', 'x'), 'https://room.example.com');
  assert.equal(toUrl('http://room.example.com', 'x'), null);
  assert.equal(toUrl('有空格 的', 'x'), null);
  assert.ok(validWorker('ming-room') && !validWorker('Ming') && !validWorker('-a') && !validWorker(''));
});

test('setup：只改名字、別名、網址，最愛清單等其他欄位不動；別名留空就拿掉', () => {
  const root = fakeRepo();
  applySetup(join(root, 'web'), { name: ' 小明 ', alias: '', worker: 'ming-room', url: 'ming' });
  const owner = JSON.parse(readFileSync(join(root, 'web/src/data/owner.json'), 'utf8'));
  assert.deepEqual(owner, { name: '小明', favorites: { screen: ['片'], gigs: [] } });
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'web/site.config.json'), 'utf8')), { url: 'https://ming-room.ming.workers.dev', worker: 'ming-room' });
  assert.throws(() => applySetup(join(root, 'web'), { name: '小明', alias: '', worker: 'Bad Name', url: 'ming' }), /Worker 名稱/);
});

test('doctor：剛 clone 的狀態，下一步是 setup；setup 完換成 Spotify 授權', () => {
  const root = fakeRepo();
  const first = diagnose(root, {});
  assert.match(report(first), /下一步：npm run setup/);
  applySetup(join(root, 'web'), { name: '小明', alias: '', worker: 'ming-room', url: 'ming' });
  assert.match(report(diagnose(root, {})), /下一步：npm run spotify:login/);
});

test('doctor：本機權杖檔三樣齊全就算授權完成，但輸出絕不含權杖值', () => {
  const root = fakeRepo();
  applySetup(join(root, 'web'), { name: '小明', alias: '', worker: 'ming-room', url: 'ming' });
  writeFileSync(join(root, 'web/.spotify-readonly-token.json'), JSON.stringify({ clientId: 'CID-SECRET-1', clientSecret: 'CSEC-SECRET-2', refreshToken: 'RT-SECRET-3' }));
  const text = report(diagnose(root, {}));
  assert.match(text, /下一步：npm run data/);
  assert.doesNotMatch(text, /SECRET/);
  // 環境變數也一樣不印
  assert.doesNotMatch(report(diagnose(root, { SPOTIFY_CLIENT_ID: 'E-SECRET', SPOTIFY_CLIENT_SECRET: 'E-SECRET', SPOTIFY_REFRESH_TOKEN: 'E-SECRET', TMDB_READ_TOKEN: 'T-SECRET' })), /SECRET/);
});
