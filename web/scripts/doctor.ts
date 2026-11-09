/**
 * npm run doctor：換成自己的版本做到哪一步、下一步打什麼。
 * 只看檔案在不在、是不是範例資料；權杖檔只檢查欄位齊不齊，絕不印出內容。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Status = 'ok' | 'todo' | 'optional';
export interface Check { group: string; title: string; status: Status; detail?: string; next?: string }

const readJson = (f: string): any => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return undefined;
  }
};
const filled = (o: any, keys: string[]) => !!o && typeof o === 'object' && keys.every((k) => typeof o[k] === 'string' && o[k].length > 0);
export const PLACEHOLDER = /your-room|your-subdomain/;

export function diagnose(root: string, env: Record<string, string | undefined> = {}): Check[] {
  const web = resolve(root, 'web');
  const out: Check[] = [];
  const site = readJson(resolve(web, 'site.config.json')) ?? {};
  const owner = readJson(resolve(web, 'src/data/owner.json')) ?? {};
  const profileText = existsSync(resolve(web, 'src/data/profile.json')) ? readFileSync(resolve(web, 'src/data/profile.json'), 'utf8') : '';
  const sampleProfile = !profileText || profileText.includes('media/sample-');
  const profile = profileText ? JSON.parse(profileText) : {};

  // 播放室（必要）
  const nameSample = !owner.name || owner.name === '阿明';
  out.push({ group: '播放室', title: '主人名字', status: nameSample ? 'todo' : 'ok', detail: nameSample ? '還是範例的「阿明」' : owner.name, next: 'npm run setup' });
  const siteBad = !site.url || !site.worker || PLACEHOLDER.test(`${site.url} ${site.worker}`);
  out.push({ group: '播放室', title: '網站網址與 Worker 名稱', status: siteBad ? 'todo' : 'ok', detail: siteBad ? '還是佔位值' : site.url, next: 'npm run setup' });
  const envCreds = !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET && env.SPOTIFY_REFRESH_TOKEN);
  const localCreds = filled(readJson(resolve(web, '.spotify-readonly-token.json')), ['clientId', 'clientSecret', 'refreshToken']);
  const mcpCreds = existsSync(resolve(root, 'tools/spotify-mcp-server/spotify-config.json'));
  out.push({
    group: '播放室', title: 'Spotify 授權', status: envCreds || localCreds || mcpCreds ? 'ok' : 'todo',
    detail: envCreds ? '環境變數' : localCreds ? 'web/.spotify-readonly-token.json' : mcpCreds ? 'MCP 設定檔' : '還沒授權（要先建 Spotify app，見 README 5.1）',
    next: 'npm run spotify:login',
  });
  out.push({ group: '播放室', title: '聽歌資料', status: sampleProfile ? 'todo' : 'ok', detail: sampleProfile ? '還是範例資料' : `${profile.owner?.name ?? ''} 的 Spotify 資料`, next: 'npm run data' });

  // 最愛與演唱會牆（選用）
  const gigs: { name: string; spotify: string }[] = owner.favorites?.gigs ?? [];
  const known = new Set<string>(Object.values(profile.music?.ranges ?? {}).flatMap((r: any) => (r.artists ?? []).map((a: any) => a.id)));
  const stillSample = !sampleProfile && gigs.length > 0 && gigs.every((g) => !known.has(g.spotify));
  out.push({
    group: '最愛（選用）', title: '最愛的片與演唱會清單', status: sampleProfile || stillSample ? 'optional' : 'ok',
    detail: stillSample ? '看起來還是範例清單' : `${owner.favorites?.screen?.length ?? 0} 部片、${gigs.length} 場演唱會`,
    next: '編輯 web/src/data/owner.json 的 favorites（README 第 4 節）',
  });
  const noPhoto = gigs.filter((g) => !existsSync(resolve(web, 'public/gigs', `${g.spotify}.jpg`)));
  if (gigs.length) out.push({ group: '最愛（選用）', title: '演唱會照片', status: noPhoto.length ? 'optional' : 'ok', detail: noPhoto.length ? `缺 ${noPhoto.length} 張` : `${gigs.length} 張`, next: 'npm run data:gigs' });

  // 放映室（選用）
  const story = existsSync(resolve(web, 'public/screening/story.js')) ? readFileSync(resolve(web, 'public/screening/story.js'), 'utf8') : '';
  const sampleStory = !story || story.includes('make-sample-data');
  const csv = existsSync(resolve(root, 'data/raw/NetflixViewingHistory.csv'));
  const rules = existsSync(resolve(root, 'data/netflix-rules.json'));
  const tmdb = !!env.TMDB_READ_TOKEN || existsSync(resolve(root, 'tools/tmdb-config.json'));
  const s = (ok: boolean): Status => (ok ? 'ok' : 'optional');
  out.push({ group: '放映室（選用）', title: 'Netflix 觀看紀錄', status: s(csv || !sampleStory), detail: csv ? 'data/raw/NetflixViewingHistory.csv' : '放到 data/raw/NetflixViewingHistory.csv', next: '從 Netflix 帳號頁下載（README 第 6 節）' });
  out.push({ group: '放映室（選用）', title: '分類規則', status: s(rules || !sampleStory), next: 'cp tools/netflix/rules.example.json data/netflix-rules.json（在 repo 根目錄）' });
  out.push({ group: '放映室（選用）', title: 'TMDB 權杖', status: s(tmdb || !sampleStory), detail: tmdb ? undefined : 'export TMDB_READ_TOKEN=... 或建立 tools/tmdb-config.json', next: '申請方式見 README 7.1' });
  out.push({
    group: '放映室（選用）', title: '放映室資料', status: s(!sampleStory), detail: sampleStory ? '還是範例片單' : undefined,
    next: 'python3 -I tools/netflix/enrich.py data/raw/NetflixViewingHistory.csv && python3 -I prototypes/screening-room/home/build_story.py --out web/public/screening --fetch-trailers --fetch-overviews（在 repo 根目錄）',
  });

  // 外觀（選用）
  const font = ['400', '500', '600'].every((w) => existsSync(resolve(web, `public/fonts/switzer-${w}.woff2`)));
  out.push({ group: '外觀（選用）', title: 'Switzer 字型', status: s(font), detail: font ? undefined : '沒有就用系統字型', next: '從 fontshare.com 下載放到 web/public/fonts/（README 第 2 節）' });
  return out;
}

const MARK: Record<Status, string> = { ok: '✓', todo: '✗', optional: '·' };

export function report(checks: Check[]): string {
  const lines: string[] = ['換成你自己的版本：檢查結果', ''];
  let group = '';
  for (const c of checks) {
    if (c.group !== group) lines.push((group ? '\n' : '') + c.group), (group = c.group);
    lines.push(`  ${MARK[c.status]} ${c.title}${c.detail ? `：${c.detail}` : ''}`);
    if (c.status !== 'ok' && c.next) lines.push(`      → ${c.next}`);
  }
  const first = checks.find((c) => c.status === 'todo');
  lines.push('', first ? `下一步：${first.next}` : '必要的步驟都完成了。部署見 README 第 9 節（GitHub secret 要自己到 repo 設定確認）。');
  lines.push('（✓ 完成　✗ 要做　· 選用）');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(report(diagnose(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), process.env)));
}
