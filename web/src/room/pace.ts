/**
 * 算繪節奏：房間有東西在動時每格都畫，閒置時降格率省 GPU。
 * 閒置時燭火、跑馬燈、呼吸燈還是要動，所以只降格率、不停畫。
 */

/** 閒置時兩格之間至少隔多久（毫秒），約每秒 20 格 */
export const IDLE_GAP_MS = 50;
/** 滑鼠動過之後多久內維持全速，CD 的滑過效果才跟得上 */
export const POINTER_GRACE_MS = 1500;
/** 鏡頭、唱臂等還沒追到目標的距離，小於這個就當作到位 */
const SETTLED = 1e-3;

export interface PaceState {
  /** 有一定要順的動畫在跑：開場、換片、播放中、換心情 */
  busy: boolean;
  /** 各個「往目標慢慢靠」的數值裡，離目標最遠的差距 */
  residual: number;
  now: number;
  /** 上次滑鼠移動的時間 */
  pointerAt: number;
}

/** 這一格離上一格至少要隔幾毫秒才畫；0 = 每格都畫 */
export function frameGap(s: PaceState): number {
  if (s.busy || s.residual > SETTLED) return 0;
  if (s.now - s.pointerAt < POINTER_GRACE_MS) return 0;
  return IDLE_GAP_MS;
}
