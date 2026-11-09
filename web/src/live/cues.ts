/**
 * 燈光的節奏來源：不用麥克風，改用資料。
 * - 有時間軸的歌詞：每唱到新的一句，燈亮一下（beat），再慢慢退。
 * - 副歌：從副歌開始那 30 秒能量拉高，前後 2 秒漸變。
 * - 都沒有：慢慢呼吸（breathing）。
 * 試聽（30 秒片段）時間軸對不上，呼叫端要傳空的 lines 與 null 的 chorusMs。
 */
import { breathing, type Levels } from './audio.ts';

export interface CueLine {
  t: number;
}

/** 副歌拉高能量的長度 */
export const CHORUS_SPAN_MS = 30_000;
const RAMP_MS = 2_000;

/** ms 時正在唱第幾行；還沒到第一行 = -1 */
export function lineAt(lines: readonly CueLine[], ms: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.t <= ms) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** 0–1：副歌段落的能量；沒有副歌資料 = 0 */
export function energyAt(ms: number, chorusMs: number | null | undefined): number {
  if (chorusMs == null) return 0;
  const end = chorusMs + CHORUS_SPAN_MS;
  if (ms < chorusMs - RAMP_MS || ms > end + RAMP_MS) return 0;
  if (ms < chorusMs) return (ms - (chorusMs - RAMP_MS)) / RAMP_MS;
  if (ms > end) return 1 - (ms - end) / RAMP_MS;
  return 1;
}

export class LyricPulse {
  /** -2 = 還沒對上過（剛換歌、剛跳到副歌）：第一次對上那行不算換句，免得一開播就閃 */
  private idx = -2;
  private pulse = 0;
  private key = '';

  read(now: number, dt: number, key: string, ms: number, lines: readonly CueLine[], chorusMs: number | null | undefined, playing: boolean): Levels {
    if (key !== this.key) {
      this.key = key;
      this.idx = -2;
    }
    const i = lines.length ? lineAt(lines, ms) : -1;
    // 往後跳超過一行（seek 到副歌）也不算換句
    const beat = playing && this.idx !== -2 && i === this.idx + 1;
    this.idx = i;
    this.pulse = beat ? 1 : this.pulse * Math.exp(-dt * 2.2);
    const e = playing ? energyAt(ms, chorusMs) : 0;
    const b = breathing(now);
    const p = this.pulse;
    return {
      bass: Math.min(1, b.bass + e * 0.25 + p * 0.3),
      mid: Math.min(1, b.mid + e * 0.15 + p * 0.1),
      treble: b.treble,
      level: Math.min(1, b.level + e * 0.3 + p * 0.2),
      beat,
      pulse: p,
    };
  }
}
