/**
 * 每週自動更新用的一次性授權：只要只讀 scope，不含任何寫入權限（不要用 MCP 那把有寫入權限的權杖放進 CI）。
 *
 *   npm run spotify:login        # 會問 Client ID 與 Client secret（secret 輸入時不顯示）
 *   （也可以先 export SPOTIFY_CLIENT_ID／SPOTIFY_CLIENT_SECRET，就不會問）
 *
 * 先在 Spotify 開發者後台把 http://127.0.0.1:8888/callback 加進這個 app 的 Redirect URIs。
 * client id、secret、refresh token 寫到 web/.spotify-readonly-token.json（權限 600、已列入 .gitignore），
 * 之後 npm run data 直接讀它；
 * 這支腳本不會印出權杖，也不會讀取任何現有權杖檔。
 */
import { chmodSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ask, closePrompt } from './prompt.ts';
import { describeRefreshFailure } from './spotify-credentials.ts';

/** fetch-spotify.ts 打的端點所需：top、recently-played、following、tracks；user-read-private 讓 me 回 country（人設時區用） */
export const SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'user-follow-read',
  'user-library-read',
  'user-read-private',
] as const;
const REDIRECT = 'http://127.0.0.1:8888/callback';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../.spotify-readonly-token.json');

export function buildAuthorizeUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    scope: SCOPES.join(' '),
    state: o.state,
    show_dialog: 'true',
  });
  return `https://accounts.spotify.com/authorize?${p}`;
}

/** 先比對 state（擋偽造的 callback），再看 error，最後取 code */
export function parseCallback(pathAndQuery: string, expectedState: string): string {
  const q = new URL(pathAndQuery, 'http://127.0.0.1').searchParams;
  if (q.get('state') !== expectedState) throw new Error('state 不符，已忽略這次 callback');
  const err = q.get('error');
  if (err) throw new Error(`Spotify 回報授權失敗：${err}`);
  const code = q.get('code');
  if (!code) throw new Error('callback 沒有 code');
  return code;
}

/** 授權到的 scope 必須與要求的完全相同：多了（例如寫入）或少了都不收 */
export function checkGrantedScopes(granted: string | undefined): void {
  const got = new Set((granted ?? '').split(/\s+/).filter(Boolean));
  const want = new Set<string>(SCOPES);
  const same = got.size === want.size && [...want].every((s) => got.has(s));
  if (!same) throw new Error(`授權到的 scope 與預期不同：${[...got].join(' ') || '(空)'}`);
}

export const tokenFileBody = (c: { clientId: string; clientSecret: string; refreshToken: string }): string =>
  JSON.stringify({ clientId: c.clientId, clientSecret: c.clientSecret, refreshToken: c.refreshToken }, null, 2) + '\n';

async function main(): Promise<void> {
  console.log('先在 https://developer.spotify.com/dashboard 建 app，Redirect URI 填 http://127.0.0.1:8888/callback（見 README 5.1）。');
  const clientId = process.env.SPOTIFY_CLIENT_ID || (await ask('Client ID：'));
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || (await ask('Client secret（輸入時不顯示）：', { hidden: true }));
  closePrompt();
  if (!clientId || !clientSecret) throw new Error('需要 Client ID 與 Client secret（在 app 的 Settings 頁）');
  const state = randomBytes(16).toString('hex');

  const code = await new Promise<string>((ok, fail) => {
    const server = createServer((req, res) => {
      try {
        const c = parseCallback(req.url ?? '', state);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8'); // 沒標編碼時瀏覽器會把中文顯示成亂碼
        res.end('OK，可以關掉這個分頁了。');
        server.close();
        ok(c);
      } catch (e) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8'); // 沒標編碼時瀏覽器會把中文顯示成亂碼
        res.end('授權沒有完成，回終端機看訊息。');
        if (String(e).includes('state')) return; // 偽造的請求不終止流程
        server.close();
        fail(e);
      }
    });
    server.listen(8888, '127.0.0.1', () => {
      console.log('用瀏覽器打開這個網址授權：\n' + buildAuthorizeUrl({ clientId, redirectUri: REDIRECT, state }));
    });
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }),
  });
  if (!res.ok) {
    // 只印 Spotify 的錯誤代碼與對應處理方式（代碼不含權杖），不印回應全文
    const reason = describeRefreshFailure(res.status, await res.text().catch(() => ''));
    throw new Error(`換權杖失敗：${reason.replace('換發權杖失敗 ', '')}\n${exchangeHint(reason)}`);
  }
  const body = (await res.json()) as { refresh_token?: string; scope?: string };
  if (!body.refresh_token) throw new Error('Spotify 沒有回 refresh token');
  checkGrantedScopes(body.scope);
  writeFileSync(OUT, tokenFileBody({ clientId, clientSecret, refreshToken: body.refresh_token }), { mode: 0o600 });
  chmodSync(OUT, 0o600);
  console.log(`已寫入 ${OUT}（權限 600，不會進版本控制）。下一步：npm run data

要讓 GitHub Actions 每週自動更新的話，把三個值設成 repo 的 secret（見 README 9.1）：
  node -p "require('./.spotify-readonly-token.json').clientId" | tr -d '\\n' | gh secret set SPOTIFY_CLIENT_ID
  node -p "require('./.spotify-readonly-token.json').clientSecret" | tr -d '\\n' | gh secret set SPOTIFY_CLIENT_SECRET
  node -p "require('./.spotify-readonly-token.json').refreshToken" | tr -d '\\n' | gh secret set SPOTIFY_REFRESH_TOKEN`);
}

/** 換授權碼失敗時，依 Spotify 的錯誤代碼告訴業主下一步 */
export function exchangeHint(reason: string): string {
  if (reason.includes('invalid_client')) return '→ Client ID 或 Client secret 不對：到後台重新複製，再重跑 npm run spotify:login。';
  if (reason.includes('invalid_grant')) return '→ 授權碼失效或 Redirect URI 不一致：確認後台是 http://127.0.0.1:8888/callback，然後重跑腳本、用新印出的網址重新同意（授權碼只能用一次）。';
  if (reason.includes('unsupported_grant_type') || reason.includes('invalid_request')) return '→ 請求格式被拒：把這行訊息貼給 Claude。';
  return '→ 把這行訊息貼給 Claude（不要貼權杖）。';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
