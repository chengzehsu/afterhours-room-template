// 放映室「最愛」燈箱牆的純函式：鏡頭、文案、片櫃排序（不碰 DOM／three，好測）。
// 燈箱在左牆（x = 0.7），3×3，每格海報 0.30×0.45，下方 0.16 的片名牌（片名最多兩行＋回來看了幾天），格與格之間 0.04 的深色金屬條。

export const FAV_WALL = { x: 0.7, y: 1.66, z: -5.45 };
export const FAV_CELL = { w: 0.3, h: 0.45, cap: 0.16, bar: 0.04 };
/** 片名牌貼圖的字級（貼圖格寬 342px 對應 FAV_CELL.w）：固定不縮，放不下就換行、再放不下用「…」 */
export const FAV_TITLE_PX = 56;
export const FAV_SUB_PX = 30;
export const FAV_TEX_W = 342;
/** 整座燈箱（格與格之間的條含在內）的寬、高，公尺 */
export const FAV_BOX = {
  w: 3 * FAV_CELL.w + 4 * FAV_CELL.bar,
  h: 3 * (FAV_CELL.h + FAV_CELL.cap) + 4 * FAV_CELL.bar,
};
/** 燈箱外框（含邊條）半寬／半高，鏡頭要框進去的範圍 */
export const FAV_HALF = {
  w: (3 * FAV_CELL.w + 4 * FAV_CELL.bar) / 2 + 0.02,
  h: (3 * (FAV_CELL.h + FAV_CELL.cap) + 4 * FAV_CELL.bar) / 2 + 0.02,
};
/** 燈箱正面離牆多遠（鏡頭要框的是正面四角） */
export const FAV_FRONT = 0.12;

/** 第 r 排（0 起算，由上往下）海報＋片名牌的中心高度 */
export function favRowY(r: number): number {
  const chh = FAV_CELL.h + FAV_CELL.cap;
  return FAV_WALL.y + FAV_BOX.h / 2 - FAV_CELL.bar - r * (chh + FAV_CELL.bar) - chh / 2;
}

/** 九格海報（含片名牌）正面的 36 個角，世界座標：視線不能被擋住的目標點 */
export function favCellCorners(): [number, number, number][] {
  const chh = FAV_CELL.h + FAV_CELL.cap, bar = FAV_CELL.bar;
  const out: [number, number, number][] = [];
  for (let n = 0; n < 9; n++) {
    const c = n % 3, r = Math.floor(n / 3);
    const x0 = -FAV_BOX.w / 2 + bar + c * (FAV_CELL.w + bar), y1 = FAV_BOX.h / 2 - bar - r * (chh + bar);
    for (const lx of [x0, x0 + FAV_CELL.w]) for (const ly of [y1 - chh, y1]) out.push([FAV_WALL.x + 0.072, FAV_WALL.y + ly, FAV_WALL.z - lx]);  // 局部 +x 對應世界 -z
  }
  return out;
}

export type Pose = { pos: [number, number, number]; look: [number, number, number]; fov: number };

/**
 * 桌機：文案在左、燈箱在右。鏡頭站在大廳正對燈箱中心（z = -5.45，離牆 3.3 公尺），視線往 +z（畫面左）偏約 18 度，
 * 燈箱就落在畫面右半；站這裡所有視線都從門板末端（開到底時佔 x 2.57～2.80、z -4.92～-3.96）的外側經過，不會被它切到（test/screening-favorites-occlusion.test.ts 驗證）。
 * 16:9 時燈箱落在畫面 x 約 +0.25～+0.78、y 約 ±0.80（NDC），
 * 比 16:9 窄的視窗把垂直 fov 放寬，讓燈箱在畫面上的寬度比例不變。
 */
export function favWidePose(aspect: number): Pose {
  const tanV = Math.tan((24 * Math.PI) / 180) * Math.max(1, 1.78 / aspect);
  return { pos: [4.0, 1.66, -5.45], look: [0.8, 1.66, -4.35], fov: (2 * Math.atan(tanV) * 180) / Math.PI };
}

/**
 * 手機（直式）：燈箱在上半、字在下半。fov 固定 60，鏡頭正對燈箱中心，
 * 距離由「頂列以下、文案以上」可用的高度（或寬度）決定，再把視線壓低讓燈箱落在那一塊。
 * 短螢幕（高 < 720，例 375×667）文案收掉最後一句提示，下方留 290px，其餘 330px。
 */
export function favPhonePose(width: number, height: number): Pose {
  const top = 72, bottom = height < 720 ? 290 : 330, gap = 8;
  const availH = Math.max(120, height - top - bottom - gap * 2);
  const tanV = Math.tan((30 * Math.PI) / 180);
  const dH = (2 * FAV_HALF.h * height) / (2 * tanV * availH);
  const dW = (2 * FAV_HALF.w * height) / (2 * tanV * width * 0.94);
  const d = Math.max(dH, dW);
  const cy = top + gap + availH / 2;                 // 燈箱中心想落在畫面哪個 y（px）
  const ndc = 1 - (2 * cy) / height;                 // 對應的 NDC（正＝在畫面中心之上）
  return {
    pos: [FAV_WALL.x + FAV_FRONT + d, FAV_WALL.y, FAV_WALL.z],
    look: [FAV_WALL.x, FAV_WALL.y - ndc * d * tanV, FAV_WALL.z],
    fov: 60,
  };
}

/** 逐排推近（手機直式）：鏡頭正對第 r 排，三格寬度填滿畫面寬（左右各留 16px 給外框），排落在畫面上方約 30% */
export const FAV_ROW_MARGIN = 16;
export function favRowPose(r: number, width: number, height: number): Pose {
  const tanV = Math.tan((25 * Math.PI) / 180);
  const need = (FAV_BOX.w + 0.06) * (width / (width - 2 * FAV_ROW_MARGIN));  // 畫面要看到的牆寬（公尺），0.06 是外框
  const d = need / 2 / (tanV * (width / height));
  const y = favRowY(r) - 0.3 * d * tanV;                                       // 排的中心在畫面中心之上 0.3（NDC）
  return { pos: [FAV_WALL.x + FAV_FRONT + d, y, FAV_WALL.z], look: [FAV_WALL.x, y, FAV_WALL.z], fov: 50 };
}

type Item = { title: string; days: number };

/** 文案：全由資料算出。items 是依業主順序的最愛。 */
export function favCopy(items: Item[]): { titleTop: string; titleBottom: string; lead: string; hint: string } {
  const n = items.length;
  const top = [...items].sort((a, b) => b.days - a.days)[0]!;
  const count = n === 1 ? '這一部，' : `這 ${n} 部，`;
  const lead = n === 1
    ? `貼在左牆這面燈箱上。我前後回來看了 ${top.days} 天。`
    : `貼在左牆這面燈箱上。其中《${top.title}》我前後回來看了 ${top.days} 天，是這幾部裡最多的。`;
  return { titleTop: count, titleBottom: '是我最愛的。', lead, hint: '往下是片櫃，這幾部我排在最前面。' };
}

/** 片櫃海報條：最愛依業主順序排最前，其餘照原順序（range 內才收）；回傳 SHELF 索引 */
export function stripOrder(total: number, favs: number[], inRange: (i: number) => boolean): number[] {
  const f = new Set(favs);
  const rest: number[] = [];
  for (let i = 0; i < total; i++) if (!f.has(i) && inRange(i)) rest.push(i);
  return [...favs, ...rest];
}

/** story.favorites（片櫃 id）換成 SHELF 索引；找不到就跳過 */
export function favIndexes(ids: unknown, shelf: { id: string }[]): number[] {
  if (!Array.isArray(ids)) return [];
  const out: number[] = [];
  for (const id of ids) {
    const i = shelf.findIndex((s) => s.id === id);
    if (i >= 0 && !out.includes(i)) out.push(i);
  }
  return out;
}

/** 「我放我的」的候選：有最愛就只從最愛裡挑，沒有就用回來看最多天的前 30 部 */
export function hostPool(shelf: { days: number }[], favs: number[]): number[] {
  if (favs.length) return favs;
  return shelf.map((s, i) => [s.days, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 30).map(([, i]) => i);
}
