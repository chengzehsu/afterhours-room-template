// ON AIR 燈箱：日光燈剛通電那種不規則閃爍。純函式，可重現（seed 偽亂數，不用 Math.random）。

/** 暗的時候留的底光，讓人知道燈箱在那裡 */
export const BASE_GLOW = 0.08;
/** 減少動態：等待中的恆亮亮度 */
export const CALM_GLOW = 0.8;
/** 點亮動畫長度（毫秒） */
export const IGNITE_MS = 600;

export type FlickerRound = {
  /** 連閃：亮、暗交錯，每段 40～120ms，共 2～5 段（= 切換次數） */
  segments: { ms: number; level: number }[];
  /** 連閃後的停頓 1.5～3.5 秒 */
  pauseMs: number;
  /** 停頓時的亮度：多半是底光，偶爾微亮 */
  pauseLevel: number;
};

/** mulberry32：同一個 seed 永遠同一串數字 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 第 i 輪的節奏；每輪獨立，由 (seed, i) 決定 */
export function flickerRound(seed: number, i: number): FlickerRound {
  const r = rng((seed * 2654435761 + (i + 1) * 40503) >>> 0);
  r(); // 丟掉第一個，避開相鄰 seed 的相關性
  const count = 2 + Math.floor(r() * 4); // 2～5
  const segments: FlickerRound['segments'] = [];
  for (let k = 0; k < count; k++) {
    const ms = 40 + r() * 80;
    const bright = k % 2 === 0; // 先亮、再暗、再亮……
    segments.push({ ms, level: bright ? 0.6 + r() * 0.4 : BASE_GLOW });
  }
  return {
    segments,
    pauseMs: 1500 + r() * 2000,
    pauseLevel: r() < 0.6 ? BASE_GLOW : 0.14 + r() * 0.12,
  };
}

const roundLength = (r: FlickerRound): number => r.segments.reduce((n, s) => n + s.ms, 0) + r.pauseMs;

// 每個 seed 累積回合起點，避免每格從頭算
let cacheSeed = NaN;
let starts: number[] = [0];
let rounds: FlickerRound[] = [];

/** 等待中的亮度（0～1）。t：從開始等待算起的毫秒 */
export function flicker(t: number, seed: number, reducedMotion = false): number {
  if (reducedMotion) return CALM_GLOW;
  if (cacheSeed !== seed) {
    cacheSeed = seed;
    starts = [0];
    rounds = [];
  }
  const tt = Math.max(0, t);
  while (starts[starts.length - 1]! <= tt) {
    const r = flickerRound(seed, rounds.length);
    rounds.push(r);
    starts.push(starts[starts.length - 1]! + roundLength(r));
  }
  // 二分找所在回合
  let lo = 0;
  let hi = rounds.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= tt) lo = mid;
    else hi = mid - 1;
  }
  const round = rounds[lo]!;
  let local = tt - starts[lo]!;
  for (const s of round.segments) {
    if (local < s.ms) return s.level;
    local -= s.ms;
  }
  return round.pauseLevel;
}

// 啪、啪啪、穩定：[結束時間 ms, 亮度]
const IGNITE_STEPS: [number, number][] = [
  [60, 1],
  [130, 0.15],
  [190, 1],
  [240, 0.2],
  [290, 1],
  [350, 0.45],
];

/** 按下去開播那一刻的點亮動畫。tSinceStart：毫秒；IGNITE_MS 之後恆為 1 */
export function ignite(tSinceStart: number, reducedMotion = false): number {
  if (reducedMotion || tSinceStart >= IGNITE_MS) return 1;
  if (tSinceStart < 0) return BASE_GLOW;
  for (const [end, level] of IGNITE_STEPS) if (tSinceStart < end) return level;
  // 最後一段：從 0.45 緩緩推到 1，接上播放中的恆亮
  const from = IGNITE_STEPS[IGNITE_STEPS.length - 1]![0];
  const k = (tSinceStart - from) / (IGNITE_MS - from);
  return 0.45 + 0.55 * k * k * (3 - 2 * k);
}
