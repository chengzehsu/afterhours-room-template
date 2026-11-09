/**
 * 後牆「燈箱牆」的版面：現代英式的 salon hang。12 個大小不一的細框燈箱緊密掛成一片，框距 5 公分，
 * 每一排的畫框沿一條水平中心線對齊、整排置中，最大的兩幅放中間（或偏上）那排。純函式，不碰 three，可單元測試。
 *
 * 大小由資料決定：我聽歌排行（一年榜）名次越前框越大，沒上榜用最小尺寸；同尺寸照 owner.json 的順序。
 * 名字直接印在框內卡紙下緣的留白（版畫題字的慣例），全牆同一字級；名字只在那裡出現一次。
 * 排數依可用區的寬高比自己選（寬扁的區塊用 2 排，高的用 3 排），選能把框放最大的那種。
 *
 * 座標：u 沿牆往觀看者右手邊增加（後牆就是世界 x），y 是高度（程式裡欄位叫 z 是沿用右牆時的名字）。
 */
import lights from '../../public/room/lights.json' with { type: 'json' };

export interface WallRect {
  zMin: number;
  zMax: number;
  yMin: number;
  yMax: number;
}

/**
 * 房間烘焙輸出的 public/room/lights.json 是燈箱凹牆與牆前遮擋物的唯一來源：建置時直接 import 進來當預設值
 * （執行時 gig-wall.ts 再 fetch 一次，以線上的檔案為準），所以這裡不另寫第二份數字。
 * 檔案還沒有這兩個欄位時才用下面的備援值（凹牆 x -1.25~1.25、y 0.35~2.25、前緣 z -3.93；遮擋物只有唱盤與兩支喇叭）。
 */
interface LightsFile {
  lightbox?: { x0: number; x1: number; y0: number; y1: number; z: number };
  occluders?: { name?: string; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[];
}
const lightsFile = lights as LightsFile;

export const DEFAULT_LIGHTBOX_RECT: { x0: number; x1: number; y0: number; y1: number; z: number } = lightsFile.lightbox ?? { x0: -1.25, x1: 1.25, y0: 0.35, y1: 2.25, z: -3.93 };

/**
 * 後牆前面會擋住燈箱區的東西，投影到牆面的矩形（u = 世界 x）：來自 lights.json 的 `occluders`
 * （唱盤架、唱盤、管機、VU 表、黑膠、喇叭…）。
 */
export const BACK_WALL_OBSTACLES: WallRect[] = lightsFile.occluders
  ? lightsFile.occluders.map((o) => ({ zMin: o.x0, zMax: o.x1, yMin: o.y0, yMax: o.y1 }))
  : [
      { zMin: -0.3, zMax: 0.3, yMin: 0, yMax: 1.0 },
      { zMin: -1.74, zMax: -1.36, yMin: 0, yMax: 1.05 },
      { zMin: 1.36, zMax: 1.74, yMin: 0, yMax: 1.05 },
    ];

/**
 * 凹牆矩形扣掉擋住下緣的東西後，真正能掛的區域：橫向跟凹牆重疊的遮擋物，下緣抬到它的頂端再加 5 公分。
 * 邊緣各縮 2 公分，框不貼著格柵。
 */
export function usableArea(rect: { x0: number; x1: number; y0: number; y1: number }, obstacles: readonly WallRect[] = BACK_WALL_OBSTACLES): WallRect {
  let yMin = rect.y0;
  for (const o of obstacles) if (o.zMax > rect.x0 && o.zMin < rect.x1) yMin = Math.max(yMin, o.yMax + 0.05);
  return { zMin: rect.x0 + 0.02, zMax: rect.x1 - 0.02, yMin, yMax: rect.y1 - 0.02 };
}

export const GIG_AREA: WallRect = usableArea(DEFAULT_LIGHTBOX_RECT);

/** 框與框、排與排之間的距離（4–6 公分） */
export const FRAME_GAP = 0.05;

export type Tier = 'XL' | 'L' | 'M' | 'S' | 'XS';
/** 款式（燈箱全用霧黑；保留白框與淺橡木給以後的牆） */
export type FrameStyle = 'black' | 'white' | 'oak';

/** 外框寬（公尺）。名次 1–3 最大、4–10、11–25、26–50，沒上榜最小 */
export const TIER_W: Record<Tier, number> = { XL: 0.46, L: 0.42, M: 0.38, S: 0.34, XS: 0.3 };
const TIER_ORDER: Tier[] = ['XL', 'L', 'M', 'S', 'XS'];
/** 框條寬（1.5–2.5 公分）、深度 */
export const BORDER: Record<FrameStyle, number> = { black: 0.018, white: 0.02, oak: 0.024 };
/** 燈箱要有箱子的厚度 */
export const DEPTH: Record<FrameStyle, number> = { black: 0.05, white: 0.05, oak: 0.05 };
/**
 * 框內露出的畫面（寬白卡紙＋照片窗＋印在卡紙下緣的名字）：高/寬。
 * 照片窗是正方形，寬 = 畫面寬的 WINDOW_K；左、右、上的留白一樣寬（各 (1 - WINDOW_K) / 2），
 * 下緣留白比較寬（版畫的慣例），名字就印在那裡，靠左對齊到照片窗左緣。
 */
export const FACE_ASPECT = 1.28;
export const WINDOW_K = 0.8;

/**
 * 全牆同一字級（物理尺寸，公尺）：每個名字都要在自己那一幅的照片窗寬內放得下，取最嚴格的那個。
 * widthEm(name) 是名字寬度（以 em 為單位，含字距）。字級小的框會被最長、框最小的那組決定，所以全牆一樣大。
 */
export function uniformNameEm(frames: readonly GigFrame[], names: readonly string[], widthEm: (name: string) => number): number {
  let em = Infinity;
  for (const f of frames) em = Math.min(em, (WINDOW_K * f.aw) / Math.max(0.5, widthEm(names[f.index] ?? '')));
  return Number.isFinite(em) ? em : 0.04;
}

export function tierOf(rankNo: number | null | undefined): Tier {
  if (!rankNo || rankNo < 1) return 'XS';
  return rankNo <= 3 ? 'XL' : rankNo <= 10 ? 'L' : rankNo <= 25 ? 'M' : rankNo <= 50 ? 'S' : 'XS';
}

export interface GigFrame {
  index: number;
  tier: Tier;
  style: FrameStyle;
  row: number;
  /** 畫框外緣中心 */
  z: number;
  y: number;
  /** 畫框外緣尺寸 */
  w: number;
  h: number;
  border: number;
  depth: number;
  /** 框內露出的畫面（aperture）尺寸 */
  aw: number;
  ah: number;
}

export interface GigRow {
  /** 這一排的上下緣、左右緣 */
  yTop: number;
  yBottom: number;
  zMin: number;
  zMax: number;
}

export interface GigLayout {
  frames: GigFrame[];
  rows: GigRow[];
  /** 整組的外框 */
  bounds: { zMin: number; zMax: number; yMin: number; yMax: number };
}

const styleOf = (): FrameStyle => 'black';

function dims(tier: Tier, style: FrameStyle, s: number) {
  const w = TIER_W[tier] * s;
  const b = BORDER[style] * Math.max(0.7, s);
  const aw = w - 2 * b;
  const ah = aw * FACE_ASPECT;
  return { w, h: ah + 2 * b, aw, ah, border: b };
}

/**
 * area 是牆上可用的矩形（z = 沿牆往觀看者右手邊增加的座標，右牆是世界 z、後牆是世界 x；y 是高度），
 * obstacles 是牆前面家具投影到牆面的矩形（先量好，見 furniture.ts）。放不下或撞到任何一個就丟錯，
 * 換牆只要換這兩個參數，演算法不用動。
 */
export function gigLayout(items: readonly { rankNo: number | null }[], area: WallRect = GIG_AREA, obstacles: readonly WallRect[] = []): GigLayout {
  // 每種排數各排一次，取框最大（scale 最大）的；一樣大就取排數少的
  let best: (GigLayout & { scale: number }) | null = null;
  for (let R = 1; R <= 4; R++) {
    const l = layoutIn(items, area, R);
    if (l && (!best || l.scale > best.scale + 1e-9)) best = l;
  }
  if (!best) throw new Error('收藏牆放不進可用區，請減少張數或換一塊可用區');
  for (const f of best.frames) {
    for (const r of [frameRect(f)]) {
      const hit = obstacles.find((o) => r.zMax > o.zMin && r.zMin < o.zMax && r.yMax > o.yMin && r.yMin < o.yMax);
      if (hit) throw new Error('收藏牆的版面撞到牆前的家具，請換一塊可用區');
    }
  }
  const { scale: _scale, ...out } = best;
  return out;
}

function layoutIn(items: readonly { rankNo: number | null }[], area: WallRect, R: number): (GigLayout & { scale: number }) | null {
  const n = items.length;
  if (!n) return { frames: [], rows: [], bounds: { zMin: 0, zMax: 0, yMin: 0, yMax: 0 }, scale: 1 };
  if (R > n) return null;
  const W = area.zMax - area.zMin;
  const H = area.yMax - area.yMin;
  const cap = Math.ceil(n / R) + 1;
  const tiers = items.map((it) => tierOf(it.rankNo));
  const styles = tiers.map(() => styleOf());
  // 由大到小，同大小照原順序
  const order = [...Array(n).keys()].sort((a, b) => TIER_ORDER.indexOf(tiers[a]!) - TIER_ORDER.indexOf(tiers[b]!) || a - b);

  for (let s = 1; s > 0.45; s *= 0.97) {
    const d = items.map((_, i) => dims(tiers[i]!, styles[i]!, s));
    const unitW = (i: number) => d[i]!.w;
    const rowsOf: number[][] = Array.from({ length: R }, () => []);
    const widthOf = (r: number) => rowsOf[r]!.reduce((a, i) => a + unitW(i), 0) + Math.max(0, rowsOf[r]!.length - 1) * FRAME_GAP;
    const mid = Math.floor((R - 1) / 2); // 最大的兩幅放中間那排（兩排時放上面那排）
    order.forEach((i, k) => {
      if (k < Math.min(2, n) && R > 1) {
        rowsOf[mid]!.push(i); // 最大的兩幅放中間那排
        return;
      }
      let best = -1;
      for (let r = 0; r < R; r++) if (rowsOf[r]!.length < cap && (best < 0 || widthOf(r) < widthOf(best) - 1e-9)) best = r;
      rowsOf[best]!.push(i);
    });
    // 每排由大到小，最大的放中間、往兩邊依序變小
    const arranged = rowsOf.map((ids) => {
      const out: number[] = [];
      ids.forEach((i, k) => (k % 2 === 0 ? out.push(i) : out.unshift(i)));
      return out;
    });
    const rowH = arranged.map((ids) => Math.max(...ids.map((i) => d[i]!.h), 0));
    const totalH = rowH.reduce((a, h) => a + h, 0) + (R - 1) * FRAME_GAP;
    const maxW = Math.max(...arranged.map((_, r) => widthOf(r)));
    if (maxW > W + 1e-9 || totalH > H + 1e-9) continue;

    const frames: GigFrame[] = new Array(n);
    const rows: GigRow[] = [];
    const zc = (area.zMin + area.zMax) / 2;
    let top = area.yMax - (H - totalH) / 2;
    arranged.forEach((ids, r) => {
      const yc = top - rowH[r]! / 2;
      const rowW = ids.reduce((a, i) => a + unitW(i), 0) + (ids.length - 1) * FRAME_GAP;
      let z = zc - rowW / 2;
      for (const i of ids) {
        const u = unitW(i);
        frames[i] = {
          index: i,
          tier: tiers[i]!,
          style: styles[i]!,
          row: r,
          z: z + u / 2,
          y: yc,
          w: d[i]!.w,
          h: d[i]!.h,
          border: d[i]!.border,
          depth: DEPTH[styles[i]!],
          aw: d[i]!.aw,
          ah: d[i]!.ah,
        };
        z += u + FRAME_GAP;
      }
      const bottom = yc - rowH[r]! / 2;
      rows.push({ yTop: yc + rowH[r]! / 2, yBottom: bottom, zMin: zc - rowW / 2, zMax: zc + rowW / 2 });
      top = bottom - FRAME_GAP;
    });
    const bounds = { zMin: Math.min(...rows.map((r) => r.zMin)), zMax: Math.max(...rows.map((r) => r.zMax)), yMin: rows[rows.length - 1]!.yBottom, yMax: rows[0]!.yTop };
    return { frames, rows, bounds, scale: s };
  }
  return null;
}

export function frameRect(f: GigFrame): { zMin: number; zMax: number; yMin: number; yMax: number } {
  return { zMin: f.z - f.w / 2, zMax: f.z + f.w / 2, yMin: f.y - f.h / 2, yMax: f.y + f.h / 2 };
}
