/**
 * 後牆（ON AIR 底下、格柵牆凹牆裡）的「燈箱牆」：業主挑的 12 組表演人，每組一個霧黑細框背光燈箱，
 * 內容是 risograph（孔版印刷）風格的雙色印刷（寬白卡紙＋照片）；每個燈箱下方貼一張說明卡（名字只在這裡出現一次，不寫名次）。
 *  - 版面見 gig-layout.ts（純函式，可測，吃可用矩形與遮擋物）
 *  - drawAtlas：用 canvas 把所有畫面與說明卡畫在同一張貼圖
 *  - posters：燈箱框（合併成一個 mesh）、自發光的畫面與說明卡、框後面一圈羽化的光暈
 * 發光全是假的：畫面是 MeshBasicMaterial 自己亮，不新增 Three.js 燈（燈數是 shader program key，會讓所有材質重編）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PosterLook } from './poster-light.ts';
import { BACK_WALL_OBSTACLES, DEFAULT_LIGHTBOX_RECT, FACE_ASPECT, type FrameStyle, type GigFrame, GIG_AREA, gigLayout, uniformNameEm, WINDOW_K, type WallRect } from './gig-layout.ts';

/**
 * 收藏牆貼在哪面牆。版面用牆面座標（u 沿牆往觀看者右手邊、y 高度、d 從牆面往房間內），
 * 整組物件建在這個座標裡，最後用 group 的位置與轉向放到世界裡，所以換牆只要換 GigWall。
 *  - 右牆：面向 -x，u = 世界 z，牆面 x = at
 *  - 後牆：面向 +z，u = 世界 x，牆面 z = at（燈箱凹牆；可用區來自 gig-wall.ts）
 */
export interface GigWall {
  kind: 'right' | 'back';
  /** 牆面沿法線軸的位置（略內縮，避免跟烘焙的牆面搶深度） */
  at: number;
  area: WallRect;
  obstacles: WallRect[];
}

/** 預設：後牆燈箱凹牆（前緣 -3.93，箱子往凹牆裡縮 3 公分，前面凸出 2 公分） */
export const BACK_WALL: GigWall = { kind: 'back', at: DEFAULT_LIGHTBOX_RECT.z - 0.03, area: GIG_AREA, obstacles: BACK_WALL_OBSTACLES };

/* ---------- 畫面（canvas） ---------- */

/**
 * 畫面用邏輯座標畫：每格寬 LW = 640、高 LH = 640 × FACE_ASPECT；實際像素 = 邏輯 × 縮放。
 * high 以上畫質每格 640 寬，medium 以下 512 寬（cellWidthFor）；atlas 一律不超過 4096（MAX_ATLAS）。
 */
const LW = 640;
const LH = Math.round(LW * FACE_ASPECT);
const ATLAS_COLS = 4;
const WIN = Math.round(LW * WINDOW_K); // 照片窗邊長（正方形）
const WIN_X = (LW - WIN) / 2; // 左右與上緣留白一樣寬；下緣留白比較寬，名字印在那裡
const WIN_Y = WIN_X;
export const MAX_ATLAS = 4096;

/** 畫質等級（quality.ts 的 LEVELS 索引：0 full、1 high、2 medium…）→ 每格像素寬 */
export const cellWidthFor = (level: number): number => (level <= 1 ? 640 : 512);

/** atlas 的像素尺寸（每格同比例，剛好填滿） */
export function atlasSize(n: number, cellW: number): { w: number; h: number; cols: number; rows: number } {
  const cols = Math.max(1, Math.min(ATLAS_COLS, n));
  const rows = Math.max(1, Math.ceil(n / ATLAS_COLS));
  return { w: cols * cellW, h: rows * Math.round(cellW * FACE_ASPECT), cols, rows };
}

export interface Ink {
  /** 深色油墨：負責臉和輪廓 */
  a: string;
  /** 淺色油墨：大面積的底色 */
  b: string;
  /** 油墨濃度，柔和粉彩的用低一點 */
  k: number;
}

/**
 * 孔版印刷的雙特別色。一半鮮豔（體育場巡演海報那種滿版彩色），一半柔和粉彩（獨立樂團的留白與粉色），
 * 兩種交錯排，整面牆才調和。
 */
export const INKS: Ink[] = [
  { a: '#2640c8', b: '#ff6b57', k: 1 },
  { a: '#2f8a66', b: '#f4a9bc', k: 0.9 },
  { a: '#17624a', b: '#f5b82e', k: 1 },
  { a: '#3f6fb0', b: '#f7d56a', k: 0.9 },
  { a: '#ff7a1a', b: '#b79cf0', k: 1 },
  { a: '#8a4a8a', b: '#f8b48c', k: 0.9 },
  { a: '#ff3d86', b: '#1fc2c0', k: 1 },
  { a: '#2d5aa0', b: '#8fdcc0', k: 0.9 },
];

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
/** 卡紙用略暖的米白，不是純白：沒有色調映射，純白很容易過曝（見 poster-light.ts 的亮度表，最終輸出任一通道 ≤ 0.85） */
export const PAPER_HEX = '#efe9dd';
export const PAPER = hex(PAPER_HEX);
/** 名字是印刷油墨（深色），不是發光字 */
export const INK_TEXT = '#3a3631';
/** 髮絲線：照片窗下方、名字上方，約 1 atlas px、長度等於照片窗寬 */
export const HAIRLINE = 'rgba(58,54,49,0.35)';

function rng(seed: number): () => number {
  let a = seed * 2654435761 + 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * 孔版印刷：先把照片的亮度拉開（2%–98% 百分位），再分兩版：
 * 深色油墨印暗部（臉、輪廓都靠它，所以臉看得清楚），淺色油墨印大範圍的中間調，往右下偏 3px（套印偏移），
 * 兩版都帶顆粒和少量漏印的白點。最後油墨疊印（相乘）在米白紙上。
 */
function riso(img: HTMLImageElement | null, size: number, ink: Ink, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  if (img) {
    const s = Math.max(size / img.naturalWidth, size / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    g.drawImage(img, (size - dw) / 2, -(dh - size) * 0.3, dw, dh);
  }
  const d = g.getImageData(0, 0, size, size);
  const n = size * size;
  const L = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const l = 0.299 * d.data[i * 4]! + 0.587 * d.data[i * 4 + 1]! + 0.114 * d.data[i * 4 + 2]!;
    L[i] = l;
    hist[Math.min(255, Math.round(l))]!++;
  }
  let acc = 0;
  let p2 = 0;
  let p98 = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc < n * 0.02) p2 = v;
    if (acc <= n * 0.98) p98 = v;
  }
  const span = Math.max(40, p98 - p2);
  for (let i = 0; i < n; i++) L[i] = Math.min(1, Math.max(0, (L[i]! - p2) / span));
  const r = rng(seed);
  const A = hex(ink.a);
  const B = hex(ink.b);
  const dx = 3;
  const dy = 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const l = L[i]!;
      let dA = smooth((1 - l) * 1.7 - 0.55) * ink.k; // 深色油墨只印暗部：臉的輪廓與眼睛
      // 淺色油墨：套印偏移，取偏移後位置的亮度
      const xb = Math.min(size - 1, Math.max(0, x - dx));
      const yb = Math.min(size - 1, Math.max(0, y - dy));
      const lb = L[yb * size + xb]!;
      let dB = smooth((1 - lb) * 1.6 - 0.05) * ink.k; // 淺色油墨印中間調，亮部留紙白
      dA *= 0.8 + 0.4 * r();
      dB *= 0.86 + 0.28 * r();
      if (r() < 0.012) dA *= 0.3;
      if (r() < 0.012) dB *= 0.3;
      for (let j = 0; j < 3; j++) d.data[i * 4 + j] = PAPER[j]! * (1 - dA * (1 - A[j]! / 255)) * (1 - dB * (1 - B[j]! / 255));
      d.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(d, 0, 0);
  return c;
}

const CJK = /[⺀-鿿＀-￯]/;
const LATIN_SPACING = 0.04;
const CJK_SPACING = 0.06;
const spacingOf = (name: string) => (CJK.test(name) ? CJK_SPACING : LATIN_SPACING);

/**
 * 字型：拉丁字用網站的 Switzer 400（styles.css 已宣告），中文用頁面已載入的思源黑體 400（main.ts 的 opts.font）；
 * 保留原本大小寫（例如 Lumenfield、NOVA、Green Ray、ZÜRA）。
 */
export const nameFont = (name: string, px: number, font: string): string => (CJK.test(name) ? `400 ${px}px ${font}` : `400 ${px}px Switzer, ${font}`);

/** 名字寬度的估計（em，含字距）：測試與還沒載好字型時用；實際畫的時候用 measureNameEm 量 */
export function estimateNameEm(name: string): number {
  let w = 0;
  const sp = spacingOf(name);
  for (const ch of Array.from(name)) w += (CJK.test(ch) ? 1 : ch === ' ' ? 0.28 : /[A-Z]/.test(ch) ? 0.66 : 0.56) + sp;
  return w - sp;
}

type SpacedCtx = CanvasRenderingContext2D & { letterSpacing?: string };

/** 在 g 上量名字寬度（em，不含最後一個字後面的字距）。有 letterSpacing 就用，沒有就逐字 */
export function measureNameEm(g: CanvasRenderingContext2D, name: string, font: string): number {
  const c = g as SpacedCtx;
  const px = 100;
  g.font = nameFont(name, px, font);
  const sp = spacingOf(name) * px;
  if ('letterSpacing' in c) {
    c.letterSpacing = `${sp}px`;
    const w = g.measureText(name).width - sp;
    c.letterSpacing = '0px';
    return w / px;
  }
  let w = 0;
  for (const ch of Array.from(name)) w += g.measureText(ch).width + sp;
  return (w - sp) / px;
}

/** 靠左畫名字（x 是左緣、y 是基線）；字距 CJK 0.06em、拉丁 0.04em */
function drawName(g: CanvasRenderingContext2D, name: string, x: number, y: number, px: number, font: string): void {
  const c = g as SpacedCtx;
  g.font = nameFont(name, px, font);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = INK_TEXT;
  const sp = spacingOf(name) * px;
  if ('letterSpacing' in c) {
    c.letterSpacing = `${sp}px`;
    g.fillText(name, x, y);
    c.letterSpacing = '0px';
    return;
  }
  let cx = x;
  for (const ch of Array.from(name)) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + sp;
  }
}

/**
 * 框內畫面：寬白卡紙、孔版印刷照片窗、下緣留白裡一條髮絲線加名字（靠左對齊照片窗左緣，像版畫的題字）。
 * emPx 是這一幅的字級（邏輯像素）：全牆物理上同一字級，所以每幅的 emPx 隨框大小不同。
 * 髮絲線在名字上方 0.6 個字高處。
 */
function drawFace(g: CanvasRenderingContext2D, img: HTMLImageElement | null, ink: Ink, seed: number, name: string, emPx: number, font: string, scale: number): void {
  g.fillStyle = PAPER_HEX;
  g.fillRect(0, 0, LW, LH);
  const r = rng(seed + 50);
  for (let k = 0; k < 900; k++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.3)' : 'rgba(120,100,70,0.05)';
    g.fillRect(r() * LW, r() * LH, 1.5, 1.5);
  }
  // 開窗：卡紙厚度造成的細陰影
  g.fillStyle = 'rgba(60,45,25,0.2)';
  g.fillRect(WIN_X - 2, WIN_Y - 2, WIN + 4, WIN + 4);
  if (img) g.drawImage(riso(img, Math.round(WIN * scale), ink, seed), WIN_X, WIN_Y, WIN, WIN);
  else {
    // 沒有照片：兩色油墨的大圓，不留白
    const b = hex(ink.b);
    const a = hex(ink.a);
    g.fillStyle = `rgb(${b.join(',')})`;
    g.fillRect(WIN_X, WIN_Y, WIN, WIN);
    g.fillStyle = `rgb(${a.join(',')})`;
    g.beginPath();
    g.arc(WIN_X + WIN / 2 + 6, WIN_Y + WIN / 2 + 4, WIN * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  // 名字與髮絲線：基線離卡紙下緣 0.55 個字高，髮絲線在字頂（約 0.72 字高）再往上 0.6 個字高；不侵入照片窗
  const baseline = LH - 0.55 * emPx;
  const hair = Math.max(WIN_Y + WIN + 24, baseline - 0.72 * emPx - 0.6 * emPx);
  g.fillStyle = HAIRLINE;
  g.fillRect(WIN_X, hair, WIN, 1);
  drawName(g, name, WIN_X, baseline, emPx, font);
  // 框的內緣陰影（上、左較深）
  const top = g.createLinearGradient(0, 0, 0, 26);
  top.addColorStop(0, 'rgba(0,0,0,0.2)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = top;
  g.fillRect(0, 0, LW, 26);
  const left = g.createLinearGradient(0, 0, 20, 0);
  left.addColorStop(0, 'rgba(0,0,0,0.14)');
  left.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = left;
  g.fillRect(0, 0, 20, LH);
}

export interface GigIn {
  name: string;
  img: string | null;
  /** 一年榜名次，只用來決定框的大小，畫面上不寫出來；沒上榜是 null */
  rankNo?: number | null;
}

/** 某一幅的字級（邏輯像素）：全牆同一物理字級 emM（公尺）÷ 這一幅每邏輯像素對應的公尺（aw / LW）。上限 110，免得髮絲線頂到照片窗 */
export const nameEmPx = (f: GigFrame, emM: number): number => Math.min(110, (emM * LW) / f.aw);

/** 把所有畫面（含名字）畫進 atlas。photos 與 gigs 同序；cellW 是每格像素寬；emPxOf(i) 是第 i 幅的字級 */
export function drawAtlas(canvas: HTMLCanvasElement, gigs: readonly GigIn[], photos: (HTMLImageElement | null)[], font: string, cellW: number, emPxOf: (i: number) => number): void {
  const { w, h } = atlasSize(gigs.length, cellW);
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const cellH = Math.round(cellW * FACE_ASPECT);
  const scale = cellW / LW;
  gigs.forEach((gig, i) => {
    g.save();
    g.translate((i % ATLAS_COLS) * cellW, Math.floor(i / ATLAS_COLS) * cellH);
    g.beginPath();
    g.rect(0, 0, cellW, cellH);
    g.clip();
    g.scale(cellW / LW, cellH / LH);
    drawFace(g, photos[i] ?? null, INKS[i % INKS.length]!, i + 1, gig.name, emPxOf(i), font, scale);
    g.restore();
  });
}

/* ---------- 3D 物件 ---------- */

function loadImage(url: string, ms: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(null), ms);
    img.onload = () => {
      clearTimeout(t);
      void (img.decode?.() ?? Promise.resolve()).catch(() => {}).then(() => resolve(img));
    };
    img.onerror = () => {
      clearTimeout(t);
      resolve(null);
    };
    img.src = url;
  });
}

function canvasTex(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 接觸陰影：中間實心、往外柔化到 0（貼圖四邊的 alpha 都是 0） */
function shadowTexture(): THREE.CanvasTexture {
  return canvasTex(128, 144, (g) => {
    g.shadowColor = 'rgba(0,0,0,1)';
    g.shadowBlur = 12;
    g.fillStyle = '#000';
    g.fillRect(26, 28, 76, 88);
  });
}

/**
 * 光暈：橢圓徑向漸層，alpha 從中心平滑降到 0，在橢圓邊緣之前就是 0，貼圖四邊一定是 0（沒有硬邊）。
 * 放在每個燈箱後面（牆與箱子之間），所以只在箱子外圈露出來，像背光溢出來。
 */
export function poolAlpha(d: number): number {
  const t = Math.min(1, Math.max(0, 1 - d));
  return t * t * (3 - 2 * t) * t;
}
function spillTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 128;
  return canvasTex(W, H, (g) => {
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = (x / (W - 1) - 0.5) / 0.5;
        const dy = (y / (H - 1) - 0.5) / 0.5;
        const a = poolAlpha(Math.hypot(dx, dy));
        const i = (y * W + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
  });
}

export interface PosterRig {
  group: THREE.Group;
  /** 照片載好、atlas 畫好（有逾時，失敗的照片畫兩色油墨的圓）。之後才能放進場景 */
  ready: Promise<void>;
  frames: GigFrame[];
  /** 全牆同一物理字級（公尺） */
  readonly nameEm: number;
  /** atlas 的像素尺寸 */
  atlas: { w: number; h: number; cols: number; rows: number };
  look(l: PosterLook): void;
}

const std = (color: number, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
/** 燈箱底牆是深墨藍灰泥：框用極深的暖炭色（不是冷黑），跟冷色的藍牆分得開，框後面一圈琥珀背光再把輪廓勾出來 */
const FRAME_COLOR: Record<FrameStyle, number> = { black: 0x181513, white: 0xd6d1c6, oak: 0xc9a97a };

export interface PosterOpts {
  /** 每格像素寬（cellWidthFor）；預設 640 */
  cellW?: number;
  /** 貼圖各向異性：renderer 上限與 8 的較小值 */
  anisotropy?: number;
}

export function posters(gigs: readonly GigIn[], font: string, baseUrl: string, wall: GigWall = BACK_WALL, opts: PosterOpts = {}): PosterRig {
  const cellW = opts.cellW ?? 640;
  const group = new THREE.Group();
  group.name = 'gig-wall';
  // 牆面座標 → 世界：右牆繞 y 轉 -90 度（本地 +z 朝房間 = 世界 -x）；後牆不轉（本地 +z = 世界 +z）
  if (wall.kind === 'right') {
    group.rotation.y = -Math.PI / 2;
    group.position.set(wall.at, 0, 0);
  } else {
    group.position.set(0, 0, wall.at);
  }
  const layout = gigLayout(gigs.map((g) => ({ rankNo: g.rankNo ?? null })), wall.area, wall.obstacles);
  const frames = layout.frames;
  const canvas = document.createElement('canvas');
  const { cols: colsN, rows } = atlasSize(gigs.length, cellW);
  const names = gigs.map((g) => g.name);
  const scratch = document.createElement('canvas').getContext('2d')!;
  let nameEmM = 0;
  /** 全牆同一物理字級：每個名字都要在自己那幅的照片窗寬內放得下，取最嚴格的；字型載好後重量一次 */
  const paint = (photos: (HTMLImageElement | null)[], measured: boolean) => {
    const widthEm = (n: string) => (measured ? measureNameEm(scratch, n, font) : estimateNameEm(n));
    nameEmM = uniformNameEm(frames, names, widthEm);
    const byIndex = new Map(frames.map((f) => [f.index, f]));
    drawAtlas(canvas, gigs, photos, font, cellW, (i) => nameEmPx(byIndex.get(i)!, nameEmM));
  };
  paint([], false); // 先畫沒照片、用估計字寬的版，atlas 的尺寸與貼圖物件先備好
  const atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.anisotropy = opts.anisotropy ?? 4;

  const faceMat = new THREE.MeshBasicMaterial({ map: atlas });
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
  const spillMat = new THREE.MeshBasicMaterial({ map: spillTexture(), color: 0xffb070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const frameMats: Record<FrameStyle, THREE.MeshStandardMaterial> = { black: std(FRAME_COLOR.black, 0.55), white: std(FRAME_COLOR.white, 0.6), oak: std(FRAME_COLOR.oak, 0.7) };

  /** 平面（朝房間）：d 是離牆面多遠 */
  const plane = (geo: THREE.PlaneGeometry, mat: THREE.Material, d: number, y: number, u: number, order = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(u, y, d);
    m.renderOrder = order;
    group.add(m);
    return m;
  };
  const uvOf = (geo: THREE.PlaneGeometry, i: number) => {
    // 這幅在 atlas 的範圍（每格同比例、剛好填滿；canvas 由上往下，uv 的 v 由下往上）
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    const u0 = col / colsN;
    const u1 = (col + 1) / colsN;
    const v1 = 1 - row / rows;
    const v0 = 1 - (row + 1) / rows;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < 4; k++) uv.setXY(k, uv.getX(k) ? u1 : u0, uv.getY(k) ? v1 : v0);
  };

  // 畫框：四條細框條加一圈內唇，依款式合併成三個 mesh（三次繪製）
  const strips: Record<FrameStyle, THREE.BufferGeometry[]> = { black: [], white: [], oak: [] };
  const box = (style: FrameStyle, w: number, h: number, depth: number, d: number, y: number, u: number) => {
    const geo = new THREE.BoxGeometry(w, h, depth);
    geo.translate(u, y, d);
    strips[style].push(geo);
  };
  for (const f of frames) {
    const d0 = 0.004 + f.depth / 2;
    const b = f.border;
    box(f.style, f.w, b, f.depth, d0, f.y + f.h / 2 - b / 2, f.z);
    box(f.style, f.w, b, f.depth, d0, f.y - f.h / 2 + b / 2, f.z);
    box(f.style, b, f.h - 2 * b, f.depth, d0, f.y, f.z - f.w / 2 + b / 2);
    box(f.style, b, f.h - 2 * b, f.depth, d0, f.y, f.z + f.w / 2 - b / 2);
    // 內唇：貼著開窗、比框低一階，在房間這一側凸出一點點
    const lip = 0.006;
    const dl = d0 + f.depth / 2 - 0.002;
    box(f.style, f.aw + 2 * lip, lip, 0.006, dl, f.y + f.ah / 2 - lip / 2, f.z);
    box(f.style, f.aw + 2 * lip, lip, 0.006, dl, f.y - f.ah / 2 + lip / 2, f.z);
    box(f.style, lip, f.ah - 2 * lip, 0.006, dl, f.y, f.z - f.aw / 2 + lip / 2);
    box(f.style, lip, f.ah - 2 * lip, 0.006, dl, f.y, f.z + f.aw / 2 - lip / 2);
  }
  for (const style of ['black', 'white', 'oak'] as const) {
    if (!strips[style].length) continue;
    group.add(new THREE.Mesh(mergeGeometries(strips[style])!, frameMats[style]));
  }

  frames.forEach((f) => {
    const i = f.index;
    // 背光溢出：箱子後面一圈羽化的暖光（只在箱子外圈露出來）
    plane(new THREE.PlaneGeometry(f.w * 1.7, f.h * 1.55), spillMat, 0.0015, f.y, f.z, 1);
    // 接觸陰影：框後面，比框大一圈、略往下偏
    plane(new THREE.PlaneGeometry(f.w * 1.12, f.h * 1.1), shadowMat, 0.002, f.y - 0.008, f.z, 1);
    // 框內畫面（含印在卡紙下緣的名字）：貼近箱口，邊框的內唇略高於它
    const fg = new THREE.PlaneGeometry(f.aw, f.ah);
    uvOf(fg, i);
    plane(fg, faceMat, f.depth - 0.012, f.y, f.z);
  });

  const ready = (async () => {
    // 兩種字型與所有名字的字元都要先載好，載好後重畫一次（不然會先用系統字）
    const latin = names.filter((n) => !CJK.test(n)).join('');
    const cjk = names.filter((n) => CJK.test(n)).join('');
    await Promise.race([
      Promise.all([document.fonts?.load(`400 40px Switzer`, latin || 'A'), document.fonts?.load(`400 40px ${font}`, cjk || '字')]).catch(() => {}),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    const photos = await Promise.all(gigs.map((g) => (g.img ? loadImage(new URL(g.img, baseUrl).href, 4000) : Promise.resolve(null))));
    paint(photos, true);
    atlas.needsUpdate = true;
  })();

  return {
    group,
    ready,
    frames,
    get nameEm() {
      return nameEmM;
    },
    atlas: atlasSize(gigs.length, cellW),
    look(l) {
      faceMat.color.setRGB(...l.k);
      shadowMat.opacity = l.shadow;
      spillMat.opacity = l.spill;
      spillMat.color.setRGB(...l.tint);
      for (const style of ['black', 'white', 'oak'] as const) frameMats[style].color.setHex(FRAME_COLOR[style]);
    },
  };
}
