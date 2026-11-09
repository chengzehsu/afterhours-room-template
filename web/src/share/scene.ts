/**
 * 分享圖與分享標籤的純函式：挑封面／海報、兩句話、縮字、版面座標、SVG 與 og 標籤字串。
 * 只吃資料、不碰檔案與 DOM；合成圖片在 render.ts（sharp）。換成別人的資料也要成立。
 */

import site from '../../site.config.json' with { type: 'json' };

/** 網站網址：改 web/site.config.json 的 url（建置時也可以用環境變數 SITE_URL 蓋過） */
export const SITE_DEFAULT = site.url;
export const FONT_FAMILY = 'Noto Sans TC, Noto Sans CJK TC, PingFang TC, sans-serif';
export const FOOTER_LINE = '推開門，聽我聽的歌、看我看的片';
export const SITE_NAME = '聽歌的地方・看劇的地方';

const WARM_TEXT = '#e8c99a';
const COOL_TEXT = '#b9c6e0';
const CREAM = '#f4e6cd';
const MUTED = '#9d8c78';

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** 網站網域：只收 https，去掉尾斜線；其他一律用預設 */
export function siteUrl(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  return /^https:\/\/[^\s/]+[^\s]*$/.test(v) ? v.replace(/\/+$/, '') : SITE_DEFAULT;
}

export interface TrackLike { album: { id?: string; picture?: { lg?: string } | undefined } }
export interface ShelfItem { title: string; days: number; poster: string | null | undefined }

/** 播放室封面：依序取專輯大圖，同一張專輯只取一次，沒圖的略過 */
export function pickCovers(tracks: readonly TrackLike[], n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tracks) {
    const src = t.album.picture?.lg;
    if (!src) continue;
    const key = t.album.id ?? src;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(src);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * 放映室海報：回來看最多天的在前（同天數維持片櫃順序），沒海報的略過。
 * swap：主人指定「這部換成那部」（owner.json 的 share.posterSwap），換在原本的位置；要換成的片不在或沒海報就只拿掉、往後補
 */
export function pickPosters(shelf: readonly ShelfItem[], n: number, swap: Readonly<Record<string, string>> = {}): (ShelfItem & { poster: string })[] {
  const hasPoster = (s: ShelfItem): s is ShelfItem & { poster: string } => !!s.poster;
  const sorted = shelf.map((s, i) => ({ s, i })).sort((a, b) => b.s.days - a.s.days || a.i - b.i).map((x) => x.s).filter(hasPoster);
  const into = new Set(Object.values(swap));
  const out: (ShelfItem & { poster: string })[] = [];
  for (const s of sorted) {
    if (into.has(s.title)) continue; // 會被換進來的片，只出現在被換掉的位置
    const to = swap[s.title];
    if (to === undefined) { out.push(s); continue; }
    const repl = shelf.find((x) => x.title === to);
    if (repl && hasPoster(repl)) out.push(repl);
  }
  return out.slice(0, n);
}

/** 放映室那句：第一名；只回來看過一天不算「回來看」，沒資料也回 null */
export function screeningLine(shelf: readonly ShelfItem[]): string | null {
  const top = [...shelf].sort((a, b) => b.days - a.days)[0];
  if (!top || top.days < 2) return null;
  return `《${top.title}》我回來看了 ${top.days} 天`;
}

export interface StoryLike { shelf: ShelfItem[] }

/** 讀 `window.STORY = {...};`（build_story.py 產生），壞檔回 null */
export function parseStory(src: string): StoryLike | null {
  const a = src.indexOf('{');
  const b = src.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try {
    const v = JSON.parse(src.slice(a, b + 1)) as { shelf?: unknown };
    return Array.isArray(v.shelf) ? (v as StoryLike) : null;
  } catch { return null; }
}

/** 估字寬：全形（CJK、全形標點）1em，其他約 0.56em */
export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += /[ -ÿ]/.test(ch) ? 0.56 : 1;
  return Math.round(w * size * 100) / 100;
}

/** 太寬就縮字（不小於 minSize），還是太寬就截斷加刪節號 */
export function fitText(text: string, size: number, maxW: number, minSize = 18): { text: string; size: number } {
  let s = size;
  while (s > minSize && textWidth(text, s) > maxW) s -= 1;
  if (textWidth(text, s) <= maxW) return { text, size: s };
  const chars = [...text];
  while (chars.length > 1 && textWidth(chars.join('') + '…', s) > maxW) chars.pop();
  return { text: chars.join('') + '…', size: s };
}

// ───────── 版面 ─────────

export interface SceneText { text: string; x: number; y: number; size: number; weight: number; fill: string; spacing?: number }
export interface SceneImage { src: string; x: number; y: number; w: number; h: number }
export interface Scene {
  w: number; h: number;
  /** both：左暖右冷加門縫；warm／cool：單一房間 */
  mood: 'both' | 'warm' | 'cool';
  images: SceneImage[];
  texts: SceneText[];
}

export interface SceneInput {
  name: string;
  personaTitle: string;
  covers: readonly string[];
  posters: readonly string[];
  screeningLine: string | null;
}

export interface Scenes {
  ogHome: Scene; ogScreening?: Scene;
  storyHome: Scene; storyScreening?: Scene;
  postHome: Scene; postScreening?: Scene;
}

/** 一排一排置中；每排 cols 張，最後一排不滿也置中 */
function grid(srcs: readonly string[], cols: number, w: number, h: number, gap: number, cx: number, top: number): SceneImage[] {
  const out: SceneImage[] = [];
  for (let i = 0; i < srcs.length; i += cols) {
    const row = srcs.slice(i, i + cols);
    const left = cx - (row.length * w + (row.length - 1) * gap) / 2;
    row.forEach((src, j) => out.push({ src, x: left + j * (w + gap), y: top + (i / cols) * (h + gap), w, h }));
  }
  return out;
}

const text = (t: string, x: number, y: number, size: number, weight: number, fill: string, spacing?: number): SceneText =>
  spacing === undefined ? { text: t, x, y, size, weight, fill } : { text: t, x, y, size, weight, fill, spacing };

function line(t: string, x: number, y: number, size: number, maxW: number, fill: string): SceneText {
  const f = fitText(t, size, maxW);
  return text(f.text, x, y, f.size, 400, fill);
}

/**
 * 由上往下排一組段落（字或一排圖），整組在 [areaTop, areaBottom] 裡上下置中。
 * 每段給高度與「跟上一段的距離」；回傳每段的頂端 y。間距固定，版面節奏才一致
 */
interface Seg { h: number; gap: number }
function stack(areaTop: number, areaBottom: number, segs: readonly Seg[]): number[] {
  const total = segs.reduce((n, s, k) => n + s.h + (k ? s.gap : 0), 0);
  let y = areaTop + (areaBottom - areaTop - total) / 2;
  return segs.map((s, k) => { if (k) y += s.gap; const top = y; y += s.h; return Math.round(top); });
}
/** 文字段的中心 y（SceneText 的 y 是垂直中心） */
const mid = (top: number, size: number) => top + size / 2;

function ogHome(i: SceneInput): Scene {
  const both = i.posters.length > 0 && i.screeningLine !== null;
  const lx = both ? 360 : 600;
  const imgH = both ? 156 : 130; // 海報比封面高，整排以較高的那邊為準、封面在其中上下置中
  //         名字            房間名            圖               那句話           底部那行
  const [yName, yRoom, yImg, yLine, yFoot] = stack(0, 630, [{ h: 34, gap: 0 }, { h: 48, gap: 40 }, { h: imgH, gap: 30 }, { h: 22, gap: 30 }, { h: 20, gap: 46 }]);
  const texts = [text(i.name, 600, mid(yName!, 34), 34, 500, CREAM), text(both ? '聽歌' : '聽歌的地方', lx, mid(yRoom!, 48), 48, 600, CREAM)] // 左右並排時用兩個字：5 個字 48px 寬 240，從中間裁成正方形會被切掉;
  const images = grid(i.covers.slice(0, 3), 3, 130, 130, 12, lx, yImg! + (imgH - 130) / 2);
  texts.push(line(i.personaTitle, lx, mid(yLine!, 22), 22, 470, WARM_TEXT));
  if (both) {
    texts.push(text('看劇', 840, mid(yRoom!, 48), 48, 600, CREAM));
    images.push(...grid(i.posters.slice(0, 3), 3, 104, 156, 12, 840, yImg!));
    texts.push(line(i.screeningLine!, 840, mid(yLine!, 22), 22, 470, COOL_TEXT));
  }
  texts.push(text(FOOTER_LINE, 600, mid(yFoot!, 20), 20, 400, MUTED));
  return { w: 1200, h: 630, mood: both ? 'both' : 'warm', images, texts };
}

function ogScreening(i: SceneInput): Scene {
  const sentence = i.screeningLine ?? '';
  const segs: Seg[] = [{ h: 36, gap: 0 }, { h: 64, gap: 24 }, { h: 225, gap: 34 }];
  if (sentence) segs.push({ h: 26, gap: 32 });
  const [yName, yTitle, yImg, yLine] = stack(0, 630, segs);
  const texts = [text(i.name, 600, mid(yName!, 36), 36, 500, CREAM), text('看劇的地方', 600, mid(yTitle!, 64), 64, 600, CREAM)];
  if (sentence) texts.push(line(sentence, 600, mid(yLine!, 26), 26, 900, COOL_TEXT));
  return { w: 1200, h: 630, mood: 'cool', images: grid(i.posters.slice(0, 5), 5, 150, 225, 18, 600, yImg!), texts };
}

type Room = 'home' | 'screening';
function vertical(room: Room, kind: 'story' | 'post', i: SceneInput): Scene {
  const story = kind === 'story';
  const home = room === 'home';
  const w = 1080;
  const h = story ? 1920 : 1350;
  const srcs = home ? i.covers.slice(0, 4) : i.posters.slice(0, 6);
  const cell = home ? (story ? { w: 400, h: 400, gap: 24, cols: 2 } : { w: 330, h: 330, gap: 20, cols: 2 })
    : (story ? { w: 270, h: 405, gap: 24, cols: 3 } : { w: 220, h: 330, gap: 20, cols: 3 });
  const rows = Math.max(1, Math.ceil(srcs.length / cell.cols));
  const gridH = rows * cell.h + (rows - 1) * cell.gap;
  const sentence = home ? i.personaTitle : (i.screeningLine ?? '');
  const f = story ? { name: 44, room: 96, line: 40, foot: 30, g1: 32, g2: 56, g3: 52, g4: 40 } : { name: 36, room: 84, line: 36, foot: 26, g1: 32, g2: 44, g3: 44, g4: 34 };
  const segs: Seg[] = [{ h: f.name, gap: 0 }, { h: f.room, gap: f.g1 }, { h: gridH, gap: f.g2 }];
  if (sentence) segs.push({ h: f.line, gap: f.g3 });
  segs.push({ h: f.foot, gap: sentence ? f.g4 : f.g3 });
  // 限時動態上下各約 250px 會被 IG／Threads 的介面蓋住，只在中間排；貼文留 60px 邊
  const ys = story ? stack(250, 1670, segs) : stack(60, 1290, segs);
  const [yName, yRoom, yGrid] = ys;
  const texts = [
    text(i.name, 540, mid(yName!, f.name), f.name, 500, CREAM),
    text(home ? '聽歌的地方' : '看劇的地方', 540, mid(yRoom!, f.room), f.room, 600, CREAM),
  ];
  if (sentence) texts.push(line(sentence, 540, mid(ys[3]!, f.line), f.line, 900, home ? WARM_TEXT : COOL_TEXT));
  texts.push(text(FOOTER_LINE, 540, mid(ys[ys.length - 1]!, f.foot), f.foot, 400, MUTED));
  return { w, h, mood: home ? 'warm' : 'cool', images: grid(srcs, cell.cols, cell.w, cell.h, cell.gap, 540, yGrid!), texts };
}

export function buildScenes(i: SceneInput): Scenes {
  const hasScreening = i.posters.length > 0;
  const r: Scenes = { ogHome: ogHome(i), storyHome: vertical('home', 'story', i), postHome: vertical('home', 'post', i) };
  if (hasScreening) {
    r.ogScreening = ogScreening(i);
    r.storyScreening = vertical('screening', 'story', i);
    r.postScreening = vertical('screening', 'post', i);
  }
  return r;
}

// ───────── SVG ─────────

const COLORS = { base: '#1a120d', warm: '#6b4220', cool: '#2a3550', door: '#ffd9a8' };

/** 底色、放射漸層、門縫光、封面／海報底下的模糊黑影（圖片與文字另外疊） */
export function sceneBackgroundSvg(s: Scene): string {
  const { w, h } = s;
  const glow = (id: string, cx: number, cy: number, color: string, op: number) =>
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="0.62" gradientTransform="translate(${cx} ${cy}) scale(${w >= h ? 1 : h / w} ${w >= h ? w / h : 1}) translate(${-cx} ${-cy})"><stop offset="0" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
  const defs: string[] = [];
  const layers: string[] = [`<rect width="${w}" height="${h}" fill="${COLORS.base}"/>`];
  if (s.mood === 'both') {
    defs.push(glow('gw', 0.3, 0.55, COLORS.warm, 0.9), glow('gc', 0.7, 0.55, COLORS.cool, 0.9));
    layers.push(`<rect width="${w}" height="${h}" fill="url(#gw)"/>`, `<rect width="${w}" height="${h}" fill="url(#gc)"/>`);
    defs.push(
      `<linearGradient id="dh" x1="0" x2="1"><stop offset="0" stop-color="${COLORS.door}" stop-opacity="0"/><stop offset="0.5" stop-color="${COLORS.door}" stop-opacity="0.95"/><stop offset="1" stop-color="${COLORS.door}" stop-opacity="0"/></linearGradient>`,
      `<linearGradient id="dv" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="0.14" stop-color="#000"/><stop offset="0.3" stop-color="#fff"/><stop offset="0.7" stop-color="#fff"/><stop offset="0.9" stop-color="#000"/><stop offset="1" stop-color="#000"/></linearGradient>`,
      `<mask id="dm"><rect x="0" y="0" width="${w}" height="${h}" fill="url(#dv)"/></mask>`,
    );
    layers.push(`<rect x="${w / 2 - 10}" y="0" width="20" height="${h}" fill="url(#dh)" mask="url(#dm)"/>`);
  } else {
    const c = s.mood === 'warm' ? COLORS.warm : COLORS.cool;
    defs.push(glow('g1', 0.5, 0.45, c, 0.9));
    layers.push(`<rect width="${w}" height="${h}" fill="url(#g1)"/>`);
  }
  if (s.images.length) {
    const blur = w > 1200 ? 14 : 9;
    defs.push(`<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur}"/></filter>`);
    layers.push(`<g filter="url(#sh)" fill="#000" fill-opacity="0.6">${s.images.map((m) => `<rect x="${m.x}" y="${m.y + blur * 0.7}" width="${m.w}" height="${m.h}"/>`).join('')}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs.join('')}</defs>${layers.join('')}</svg>`;
}

/** 文字層：y 是文字垂直中心；第三方字串一律跳脫 */
export function sceneTextSvg(s: Scene): string {
  const body = s.texts
    .map((t) => `<text x="${t.x}" y="${Math.round((t.y + t.size * 0.35) * 10) / 10}" font-size="${t.size}" font-weight="${t.weight}" fill="${t.fill}" text-anchor="middle"${t.spacing ? ` letter-spacing="${t.spacing}"` : ''}>${xmlEscape(t.text)}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s.w}" height="${s.h}" viewBox="0 0 ${s.w} ${s.h}"><g font-family="${FONT_FAMILY}">${body}</g></svg>`;
}

/** 180×180 圖示：暖房、冷房中間一道門縫 */
export function iconSvg(size: number): string {
  const s = size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><defs><radialGradient id="a" cx="0.25" cy="0.5" r="0.7"><stop offset="0" stop-color="#8a5a2c"/><stop offset="1" stop-color="#1a120d"/></radialGradient><radialGradient id="b" cx="0.75" cy="0.5" r="0.7"><stop offset="0" stop-color="#3a4a70"/><stop offset="1" stop-color="#1a120d"/></radialGradient></defs><rect width="${s}" height="${s}" fill="#1a120d"/><rect width="${s / 2}" height="${s}" fill="url(#a)"/><rect x="${s / 2}" width="${s / 2}" height="${s}" fill="url(#b)"/><rect x="${s * 0.47}" y="${s * 0.12}" width="${s * 0.06}" height="${s * 0.76}" rx="${s * 0.02}" fill="#ffd9a8"/></svg>`;
}

// ───────── 標籤 ─────────

export interface TagOptions {
  title: string; description: string; url: string; image: string; imageAlt: string;
  icon32: string; icon180: string; imageWidth?: number; imageHeight?: number;
}

const attr = (v: string) => xmlEscape(v);

export function shareTags(o: TagOptions): string {
  const m = (k: string, v: string | number, name = 'property') => `<meta ${name}="${k}" content="${attr(String(v))}">`;
  return [
    m('og:type', 'website'), m('og:site_name', SITE_NAME), m('og:locale', 'zh_TW'),
    m('og:title', o.title), m('og:description', o.description), m('og:url', o.url),
    m('og:image', o.image), m('og:image:width', o.imageWidth ?? 1200), m('og:image:height', o.imageHeight ?? 630), m('og:image:alt', o.imageAlt),
    m('twitter:card', 'summary_large_image', 'name'), m('twitter:title', o.title, 'name'), m('twitter:description', o.description, 'name'), m('twitter:image', o.image, 'name'),
    `<link rel="icon" type="image/png" sizes="32x32" href="${attr(o.icon32)}">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${attr(o.icon180)}">`,
  ].join('\n    ');
}
