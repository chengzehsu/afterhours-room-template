/** 播放流程裡可以獨立測的判斷：試聽、方向鍵、載入逾時、換頁方式 */

/** 超過這個長度就當成整首；Spotify 沒登入時只給約 30 秒試聽 */
export const FULL_TRACK_MS = 45_000;
/** Spotify 播放器 API 最多等這麼久 */
export const SPOTIFY_LOAD_MS = 8000;

/** 播放器回報的長度明顯比整首短 = 30 秒試聽（試聽的位置從 0 起算，對不上整首歌詞的時間軸）。0 = 還沒回報 */
export function isPreview(durationMs: number): boolean {
  return durationMs > 0 && durationMs < FULL_TRACK_MS;
}

/** radiogroup 的方向鍵：左右上下循環，Home／End 跳頭尾；不是這些鍵回 null */
export function stepIndex(len: number, current: number, key: string): number | null {
  if (len <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return len - 1;
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (!step) return null;
  return (Math.max(0, current) + step + len) % len;
}

/** 超過 ms 還沒完成就 reject；先完成的那邊算數，計時器一定清掉 */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}逾時`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** 只在開發模式用：?spotify=fail 立刻載入失敗，?spotify=hang 永遠不回應 */
export function spotifyFault(search: string): 'fail' | 'hang' | null {
  const v = new URLSearchParams(search).get('spotify');
  return v === 'fail' || v === 'hang' ? v : null;
}

/** 到放映室的換頁方式：沒有 3D 房間（沒 WebGL、房間壞了、減少動態）就直接換頁，不跑門動畫 */
export function enterPlan(o: { ready: boolean; reduced: boolean; hasRoom: boolean; roomBroken: boolean }): 'direct' | 'animate' | 'knock' {
  if (!o.ready) return 'knock';
  return o.reduced || !o.hasRoom || o.roomBroken ? 'direct' : 'animate';
}

/** 播放器載不到時給訪客的連結（那首歌的 Spotify 頁面） */
export function spotifyTrackUrl(id: string): string {
  return `https://open.spotify.com/track/${encodeURIComponent(id)}`;
}
