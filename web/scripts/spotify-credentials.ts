/**
 * fetch-spotify.ts 的憑證來源與權杖處理（純函式＋一個寫檔）。
 * 優先順序：環境變數三個齊全（CI）→ 本機權杖檔 web/.spotify-readonly-token.json 三樣齊全（npm run spotify:login 寫的）
 * → MCP 設定檔（業主本機）。
 */
import { chmodSync, renameSync, writeFileSync } from 'node:fs';

export interface Config {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export type CredentialSource =
  | { kind: 'env'; config: Config; rotatedTokenFile?: string }
  | { kind: 'local'; config: Config }
  | { kind: 'file' };

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** local：本機權杖檔讀出來的 JSON（沒有檔案就傳 undefined） */
export function resolveCredentialSource(env: Record<string, string | undefined>, local?: unknown): CredentialSource {
  const clientId = env.SPOTIFY_CLIENT_ID;
  const clientSecret = env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = env.SPOTIFY_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    const l = (local && typeof local === 'object' ? local : {}) as Record<string, unknown>;
    if (str(l.clientId) && str(l.clientSecret) && str(l.refreshToken)) {
      return { kind: 'local', config: { clientId: l.clientId, clientSecret: l.clientSecret, refreshToken: l.refreshToken } };
    }
    return { kind: 'file' };
  }
  return {
    kind: 'env',
    config: { clientId, clientSecret, refreshToken },
    rotatedTokenFile: env.SPOTIFY_ROTATED_TOKEN_FILE || undefined,
  };
}

/** 失敗訊息只留 HTTP 狀態與 error 代碼；回應全文可能帶描述或其他敏感內容 */
export function describeRefreshFailure(status: number, bodyText: string): string {
  const base = `換發權杖失敗 HTTP ${status}`;
  try {
    const code = (JSON.parse(bodyText) as { error?: unknown }).error;
    if (typeof code === 'string' && /^[a-z_]{1,40}$/.test(code)) return `${base} (${code})`;
  } catch {
    /* 不是 JSON：只回狀態 */
  }
  return base;
}

/** Spotify 換發時可能回新的 refresh token；只有「不同的新值」才需要保存 */
export function rotatedTokenToPersist(current: string | undefined, returned: string | undefined): string | undefined {
  return returned && returned !== current ? returned : undefined;
}

/** 原子寫入，權限 600，不加換行（gh secret set 讀 stdin 時換行會變成 token 的一部分） */
export function writeRotatedToken(file: string, token: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, token, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/** 本機權杖檔：只存 client id／secret／refresh token（不存 access token），原子寫入、權限 600 */
export function writeLocalCredentials(file: string, cfg: Config): void {
  const tmp = `${file}.tmp`;
  const body = { clientId: cfg.clientId, clientSecret: cfg.clientSecret, refreshToken: cfg.refreshToken };
  writeFileSync(tmp, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}
