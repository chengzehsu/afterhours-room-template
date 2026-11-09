/**
 * 從 Spotify Web API 抓個人聽歌原始資料，存到 data/raw/spotify.json。
 * 憑證來源（依序）：環境變數（CI）→ web/.spotify-readonly-token.json（npm run spotify:login 寫的）
 * → spotify-mcp-server 的設定檔（業主本機；換發後寫回，避免 refresh token 輪替後 MCP 失效）。
 * CI 用環境變數 SPOTIFY_CLIENT_ID／SPOTIFY_CLIENT_SECRET／SPOTIFY_REFRESH_TOKEN（只讀權杖），
 * 此時不讀也不寫 MCP 設定檔，輪替的新 refresh token 寫到 SPOTIFY_ROTATED_TOKEN_FILE。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describeRefreshFailure,
  resolveCredentialSource,
  rotatedTokenToPersist,
  writeLocalCredentials,
  writeRotatedToken,
  type Config,
  type CredentialSource,
} from './spotify-credentials.ts';
import { fetchAllSaved, spotifyHeaders } from './spotify-request.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = resolve(ROOT, 'tools/spotify-mcp-server/spotify-config.json');
const LOCAL = resolve(ROOT, 'web/.spotify-readonly-token.json');
const RAW = resolve(ROOT, 'data/raw/spotify.json');
const RANGES = ['short_term', 'medium_term', 'long_term'] as const;

function saveConfig(cfg: Config): void {
  const tmp = `${CONFIG}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, CONFIG);
}

async function accessToken(cfg: Config, source: CredentialSource): Promise<string> {
  if (cfg.accessToken && (cfg.expiresAt ?? 0) > Date.now() + 120_000) return cfg.accessToken;
  if (!cfg.refreshToken) throw new Error('沒有 refresh token：先在 web/ 跑 npm run spotify:login');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken }),
  });
  if (!res.ok) throw new Error(describeRefreshFailure(res.status, await res.text()));
  const data = (await res.json()) as { access_token: string; expires_in?: number; refresh_token?: string };
  cfg.accessToken = data.access_token;
  cfg.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  const rotated = rotatedTokenToPersist(cfg.refreshToken, data.refresh_token);
  if (rotated) cfg.refreshToken = rotated;
  if (source.kind === 'file') {
    saveConfig(cfg);
  } else if (source.kind === 'local') {
    if (rotated) writeLocalCredentials(LOCAL, cfg); // 新 token 存回同一個檔，下次照樣能用
  } else if (rotated) {
    // 環境變數模式不碰 MCP 設定檔；新 token 交給 CI 寫回 secret。絕不印出 token
    if (source.rotatedTokenFile) writeRotatedToken(source.rotatedTokenFile, rotated);
    else console.warn('Spotify 回了新的 refresh token，但沒設 SPOTIFY_ROTATED_TOKEN_FILE，新 token 沒有保存');
  }
  return cfg.accessToken;
}

async function get<T = any>(token: string, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const url = `https://api.spotify.com/v1/${path}${qs.size ? `?${qs}` : ''}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: spotifyHeaders(token) });
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 2) * 1000 + 500));
        continue;
      }
      if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`); // 不印回應內容：CI 日誌在公開 repo 是公開的
      return (await res.json()) as T;
    } catch (err) {
      // 網路中斷或回應被截斷：重試，HTTP 錯誤則直接拋出
      if (attempt >= 3 || (err instanceof Error && err.message.includes('→ HTTP'))) throw err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

async function main(): Promise<void> {
  let local: unknown;
  try {
    local = existsSync(LOCAL) ? JSON.parse(readFileSync(LOCAL, 'utf8')) : undefined;
  } catch {
    local = undefined; // 壞掉的檔案當作沒有；不印內容
  }
  const source = resolveCredentialSource(process.env, local);
  if (source.kind === 'file' && !existsSync(CONFIG)) {
    throw new Error('沒有 Spotify 憑證：先在 web/ 跑 npm run spotify:login（見 README「串接 Spotify」）');
  }
  const cfg = source.kind === 'file' ? (JSON.parse(readFileSync(CONFIG, 'utf8')) as Config) : source.config;
  const token = await accessToken(cfg, source);
  const topArtists: Record<string, unknown[]> = {};
  const topTracks: Record<string, unknown[]> = {};
  for (const r of RANGES) {
    topArtists[r] = (await get(token, 'me/top/artists', { time_range: r, limit: 50 })).items;
    topTracks[r] = (await get(token, 'me/top/tracks', { time_range: r, limit: 50 })).items;
  }
  const out = {
    source: 'spotify-api',
    fetchedAt: new Date().toISOString(),
    me: await get(token, 'me'),
    topArtists,
    topTracks,
    recentlyPlayed: (await get(token, 'me/player/recently-played', { limit: 50 })).items,
    followed: (await get(token, 'me/following', { type: 'artist', limit: 50 })).artists,
    // 按讚的歌分頁抓完（約 25 次請求），算專輯聽過幾首要用
    saved: await fetchAllSaved((path, params) => get(token, path, params)),
  };
  mkdirSync(dirname(RAW), { recursive: true });
  writeFileSync(RAW, JSON.stringify(out, null, 1));
  console.log(`寫入 ${RAW}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
