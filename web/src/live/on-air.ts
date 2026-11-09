/** ON AIR 燈箱亮度倍率：0 = 沒通電的暗紅玻璃，1 = 全亮。上限 ON_AIR_PEAK：米白字乘上去約 0.98，剛過泛光門檻 0.86，不爆白 */
export const ON_AIR_DARK = 0.22;
export const ON_AIR_PEAK = 1.05;
export function onAirScale(glow: number): number {
  return ON_AIR_DARK + Math.min(1, Math.max(0, glow)) * (ON_AIR_PEAK - ON_AIR_DARK);
}
