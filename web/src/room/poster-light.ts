/**
 * 燈箱牆的光（全是假的，不加 Three.js 燈）。純函式，可單元測試（亮度表見 test/gigs.test.ts）。
 *
 * 燈箱是自發光（MeshBasicMaterial），不吃房間的燈，所以最終亮度算得出來：
 *   最終線性值 = 貼圖線性值 × k，k = 時段基準 × 開燈係數 × 放歌係數
 * 渲染器沒有色調映射，算出來超過 1 就直接變白、超過泛光門檻 0.86 還會讓整面糊開，所以任何表面最終輸出的任一通道
 * （sRGB）都壓在 0.85 以下（業主看過過曝，一律保守），卡紙用略暖的米白而不是純白；燈箱畫面不用加法混合疊在白色上
 * （背光溢出的光暈在箱子後面，被箱子擋住，只出現在箱子外圈的牆上）。
 */
import type { Mood } from '../core/mood.ts';
import { DARK_LEVEL } from './lights.ts';

export interface PosterLook {
  /** 燈箱畫面與說明卡的亮度（乘上去的顏色，線性） */
  k: [number, number, number];
  /** 框後面背光溢出來的暖光不透明度 */
  spill: number;
  /** 接觸陰影不透明度 */
  shadow: number;
  /** 暖光的顏色 */
  tint: [number, number, number];
}

/** 放歌時（房間調暗、ON AIR 亮）燈箱降到這個比例，讓唱片與 ON AIR 當主角 */
export const PLAY_LEVEL = 0.3;
/** 暗場（開燈動畫前）燈箱的亮度比例：燈箱自己會亮，但比開燈後暗一些 */
export const DARK_BOX = 0.7;

/**
 * 三個時段的基準。午後整間已經很亮，燈箱比較淡、光暈幾乎看不到；微醺、深夜是主角，光暈最明顯。
 */
export const BOX_LOOK: Record<Mood, PosterLook> = {
  afternoon: { k: [0.72, 0.71, 0.69], spill: 0.04, shadow: 0.35, tint: [1.0, 0.55, 0.2] },
  tipsy: { k: [0.79, 0.76, 0.72], spill: 0.17, shadow: 0.5, tint: [1.0, 0.5, 0.15] },
  night: { k: [0.79, 0.8, 0.83], spill: 0.2, shadow: 0.55, tint: [1.0, 0.54, 0.18] },
};

/**
 * 燈箱的底牆是深墨藍灰泥（#33465c，類似 Hague Blue）。暖色光暈疊在藍牆上，色調偏白的話會變灰綠，
 * 所以光暈色調偏深琥珀（綠、藍通道壓低）、不透明度也降低：疊上去後仍是 R > G > B 的暖色，不是灰綠。
 */
export const WALL_HEX = '#33465c';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * 某個時段、某個相框燈增益（g.frame：暗場 DARK_LEVEL → 全亮 1）、放歌程度（0–1，Room 的 wake）下實際寫進材質的值。
 * 暗場是 DARK_BOX，開燈後漸亮到 1；放歌時降到 PLAY_LEVEL。
 */
export function boxLook(mood: Mood, frameGain: number, play = 0): PosterLook {
  const l = BOX_LOOK[mood];
  const lit = clamp01((frameGain - DARK_LEVEL) / (1 - DARK_LEVEL));
  const f = (DARK_BOX + (1 - DARK_BOX) * lit) * (1 - (1 - PLAY_LEVEL) * clamp01(play));
  return { k: [l.k[0] * f, l.k[1] * f, l.k[2] * f], spill: l.spill * f, shadow: l.shadow, tint: l.tint };
}

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** 一個貼圖顏色（sRGB 0–1）在這組光下的最終線性值 */
export function finalLinear(texSrgb: [number, number, number], look: PosterLook): [number, number, number] {
  return [0, 1, 2].map((i) => srgbToLinear(texSrgb[i]!) * look.k[i]!) as [number, number, number];
}
