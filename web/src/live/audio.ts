/**
 * 燈光吃的音量資料格式，與沒有節奏來源時的慢呼吸。
 * 2026-11-08 拿掉麥克風（要授權、戴耳機收不到）；節奏改由歌詞換句與副歌推算，見 cues.ts。
 */

export interface Levels {
  /** 0–1，已經平滑過 */
  bass: number;
  mid: number;
  treble: number;
  level: number;
  /** 這一格是不是鼓點 */
  beat: boolean;
  /** 鼓點之後慢慢衰減的值，0–1，給燈光用 */
  pulse: number;
}

const ZERO: Levels = { bass: 0, mid: 0, treble: 0, level: 0, beat: false, pulse: 0 };


/** 沒開麥克風時的慢呼吸：不對拍，也不假裝對拍 */
export function breathing(now: number): Levels {
  const s = (Math.sin(now / 2400) + 1) / 2;
  return { bass: 0.15 + s * 0.15, mid: 0.2, treble: 0.1, level: 0.2 + s * 0.1, beat: false, pulse: 0 };
}
