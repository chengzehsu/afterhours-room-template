/**
 * 執行期自動調畫質：頁面自己量全速畫格的時間，連續幾個窗口都慢就降一級，只降不升。
 * 這裡只放資料與純函式，不碰 DOM 與 three，套用在 room.ts。
 */

export interface QualityLevel {
  name: string;
  /** 像素密度上限，實際取 min(裝置密度, 這個值) */
  pixelRatio: number;
  bloom: boolean;
  /** 聚光燈陰影貼圖邊長。縮尺寸不用換陰影類型，不會讓材質重新編譯 */
  shadowMap: number;
}

/** 由全畫質排到最低 */
export const LEVELS: readonly QualityLevel[] = [
  { name: 'full', pixelRatio: 1.75, bloom: true, shadowMap: 1024 },
  { name: 'high', pixelRatio: 1.4, bloom: true, shadowMap: 1024 },
  { name: 'medium', pixelRatio: 1.15, bloom: true, shadowMap: 512 },
  { name: 'low', pixelRatio: 1, bloom: false, shadowMap: 512 },
  { name: 'minimal', pixelRatio: 0.75, bloom: false, shadowMap: 256 },
];

/** 載入後多久內不量（毫秒），開場有 shader 編譯的長任務 */
export const WARMUP_MS = 6000;
/** 一個窗口要收多少格全速畫格 */
export const WINDOW_FRAMES = 90;
/** 窗口內的 p90 超過這個毫秒數算慢（推測值：約 40fps，60Hz 螢幕上偶爾掉格不會碰到） */
export const SLOW_P90_MS = 25;
/** 連續幾個慢窗口才降一級 */
export const STRIKES_TO_DROP = 3;
/** 降一級後 p90 至少要變小這個比例，才算降得有用；否則瓶頸不在顯示卡（例如卡在 CPU），退回並停止 */
export const MIN_GAIN = 0.15;

export interface QualityState {
  level: number;
  strikes: number;
  /** 剛降級時，降之前那個窗口的 p90；下一個窗口拿來比有沒有變快 */
  droppedFromP90?: number;
  /** 降級證實沒用之後鎖住，不再來回試 */
  locked?: boolean;
}

export interface QualityInput {
  /** 這個窗口內全速畫格的間隔（毫秒），閒置降格的畫格不能放進來 */
  frames: readonly number[];
  hidden: boolean;
  /** 頁面載入至今（毫秒） */
  sinceLoadMs: number;
  /** 裝置像素密度 */
  dpr: number;
}

export const initialQuality = (): QualityState => ({ level: 0, strikes: 0 });

/** 線性插值的百分位，index 不會越界；n 小時 p99 不會直接變成最大值 */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = Math.min(Math.max(p, 0), 1) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** 在這個螢幕密度下，這一級實際生效的設定 */
export function effective(l: QualityLevel, dpr: number) {
  return { pixelRatio: Math.min(dpr, l.pixelRatio), bloom: l.bloom, shadowMap: l.shadowMap };
}

const same = (a: QualityLevel, b: QualityLevel, dpr: number): boolean => {
  const x = effective(a, dpr);
  const y = effective(b, dpr);
  return x.pixelRatio === y.pixelRatio && x.bloom === y.bloom && x.shadowMap === y.shadowMap;
};

/** 往回找上一個在這個螢幕密度下實際有差別的等級 */
function previous(level: number, dpr: number): number {
  let l = level - 1;
  while (l > 0 && same(LEVELS[l - 1]!, LEVELS[l]!, dpr)) l--;
  return Math.max(l, 0);
}

export function stepQuality(s: QualityState, i: QualityInput): QualityState {
  if (i.hidden || i.sinceLoadMs < WARMUP_MS || i.frames.length < WINDOW_FRAMES) return s;
  if (s.locked) return s;
  const p90 = percentile(i.frames, 0.9);
  if (s.droppedFromP90 !== undefined) {
    const helped = p90 <= s.droppedFromP90 * (1 - MIN_GAIN);
    if (!helped) return { level: previous(s.level, i.dpr), strikes: 0, locked: true };
    s = { level: s.level, strikes: 0 };
  }
  if (s.level >= LEVELS.length - 1) return s;
  if (p90 <= SLOW_P90_MS) return s.strikes === 0 ? s : { ...s, strikes: 0 };
  if (s.strikes + 1 < STRIKES_TO_DROP) return { ...s, strikes: s.strikes + 1 };
  let level = s.level + 1;
  while (level < LEVELS.length - 1 && same(LEVELS[level]!, LEVELS[s.level]!, i.dpr)) level++;
  return { level, strikes: 0, droppedFromP90: p90 };
}

/** 網址 `?quality=<等級>`：回傳等級索引，沒給或不認得就是 null */
export function forcedLevel(search: string): number | null {
  const name = new URLSearchParams(search).get('quality');
  const i = LEVELS.findIndex((l) => l.name === name);
  return i < 0 ? null : i;
}
