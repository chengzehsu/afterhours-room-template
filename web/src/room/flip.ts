/** CD 牆換時段的翻牌時間表：純函式，room.ts 照這張表動，測試也只看這張表。 */

export type FlipKind = 'turn' | 'enter' | 'exit';

export interface FlipSlot {
  index: number;
  kind: FlipKind;
  /** 開始翻的時間（毫秒，從切換那一刻算） */
  start: number;
  /** 轉到側面、換面的時間 */
  swapAt: number;
  /** 結束的時間。exit 翻到側面就移除，所以等於 swapAt */
  end: number;
}

export interface FlipTiming {
  total: number;
  dur: number;
}

export const FLIP_TIMING: FlipTiming = { total: 800, dur: 360 };
/** 減少動態：不翻，但仍走同一條路（要等貼圖好了才換面） */
export const FLIP_INSTANT: FlipTiming = { total: 0, dur: 0 };

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * 翻轉進度 t（0–1）對應的繞垂直軸角度。前半 0 → 90°，後半從另一側的 -90° 轉回 0，
 * 兩個側面一樣是 CD 盒的邊，換面藏在那一刻。ease-in-out 在 t = 0.5 剛好是 0.5。
 */
export function flipAngle(t: number): number {
  const e = ease(Math.min(1, Math.max(0, t)));
  return Math.PI * e - (e >= 0.5 ? Math.PI : 0);
}

/** 從左上往右下的波浪：斜線（列＋欄）越大越晚開始 */
export function flipPlan(fromCount: number, toCount: number, cols: number, timing: FlipTiming = FLIP_TIMING): FlipSlot[] {
  const n = Math.max(fromCount, toCount);
  const diag = (i: number) => Math.floor(i / cols) + (i % cols);
  let maxDiag = 0;
  for (let i = 0; i < n; i++) maxDiag = Math.max(maxDiag, diag(i));
  const half = Math.round(timing.dur / 2);
  const out: FlipSlot[] = [];
  for (let i = 0; i < n; i++) {
    const start = maxDiag ? Math.round((diag(i) / maxDiag) * (timing.total - timing.dur)) : 0;
    const kind: FlipKind = i < Math.min(fromCount, toCount) ? 'turn' : i < toCount ? 'enter' : 'exit';
    out.push({ index: i, kind, start, swapAt: start + half, end: kind === 'exit' ? start + half : start + timing.dur });
  }
  return out;
}

/** 波浪走到一半：換面時間的中位數。文字和計數在這一刻換 */
export function flipMidpoint(plan: readonly FlipSlot[]): number {
  if (!plan.length) return 0;
  const s = plan.map((p) => p.swapAt).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
