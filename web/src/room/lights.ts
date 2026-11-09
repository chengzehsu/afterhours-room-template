// 房間開燈：暗場 → 開燈各盞燈的增益。純函式，可單元測試（比照 live/flicker.ts）。
import { IGNITE_MS, ignite } from '../live/flicker.ts';

/** 暗場亮度：沒被光照到的地方剩原本的 40%（「暗一點」，不是全黑） */
export const DARK_LEVEL = 0.4;

export type LightStyle = 'cascade' | 'fade' | 'flicker';

export interface LightGains {
  /** CD 牆主燈：暗場也維持 1（渲染器沒有色調映射，不能再加強） */
  wall: number;
  deck: number;
  lamp: number;
  frame: number;
  hemi: number;
  marquee: number;
  /** 烘焙表面（牆、櫃子、地板）：shader 裡光池以外的亮度 */
  room: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** 0 → 暗場亮度，1 → 全亮 */
const lift = (level: number): number => DARK_LEVEL + (1 - DARK_LEVEL) * clamp01(level);
const window01 = (p: number, from: number, to: number): number => smooth((p - from) / (to - from));

/** 唱盤燈 → 檯燈 → 相框燈（含招牌）→ 全室，各佔進度的一段，前後重疊 */
const CASCADE = { deck: [0, 0.35], lamp: [0.2, 0.55], frame: [0.4, 0.75], room: [0.6, 1] } as const;

const DURATION_MS: Record<LightStyle, number> = { cascade: 1200, fade: 1200, flicker: IGNITE_MS };

/** 開燈要多久（毫秒）：power 從 0 線性推到 1 的時間 */
export function lightsDuration(style: LightStyle): number {
  return DURATION_MS[style];
}

/** 網址參數轉樣式；不認得的一律用預設 cascade */
export function parseLightStyle(value: string | null): LightStyle {
  return value === 'fade' || value === 'flicker' ? value : 'cascade';
}

/** power：0 = 暗場，1 = 開燈（線性進度）。回傳每盞燈的增益 */
export function lightGains(power: number, style: LightStyle): LightGains {
  const p = clamp01(power);
  const g = (a: readonly [number, number]) => lift(window01(p, a[0], a[1]));
  let deck: number, lamp: number, frame: number, room: number;
  if (style === 'cascade') {
    deck = g(CASCADE.deck);
    lamp = g(CASCADE.lamp);
    frame = g(CASCADE.frame);
    room = g(CASCADE.room);
  } else if (style === 'fade') {
    deck = lamp = frame = room = lift(smooth(p));
  } else {
    // 日光燈通電：沿用 ON AIR 的點亮節奏；兩端固定在暗場與全亮
    deck = lamp = frame = room = p <= 0 ? DARK_LEVEL : p >= 1 ? 1 : lift(ignite(p * IGNITE_MS));
  }
  return { wall: 1, deck, lamp, frame, hemi: room, marquee: frame, room };
}
