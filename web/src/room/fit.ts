/**
 * CD 牆的視角依寬高比放寬：螢幕越接近方形，水平看得越少，
 * 一年 45～50 張時最右一欄會被切（1280×800 右邊只剩 28px、1024×768 切掉 76px）。
 * 維持水平視角固定：tan(fov/2)·寬高比 = 0.842（寬高比 1.6 時 55.5°，右緣留 5%），不小於原本的視角。
 */
export const WALL_HFOV_TAN = 0.842;

export function fitWallFov(fov: number, aspect: number): number {
  const fit = (2 * Math.atan(WALL_HFOV_TAN / aspect) * 180) / Math.PI;
  return Math.max(fov, fit);
}
