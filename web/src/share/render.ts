/**
 * 建置時合成分享圖（node 端，吃 sharp）：只讀 profile、story.js 與 public/ 底下已有的圖，不連網。
 * 版面在 scene.ts（純函式）；這裡只負責讀圖、疊層、控制檔案大小、用內容雜湊命名。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import sharp, { type OverlayOptions, type Sharp } from 'sharp';
import type { TasteProfile } from '../core/profile.ts';
import { personaOf } from '../page/render.ts';
import { buildScenes, iconSvg, parseStory, pickCovers, pickPosters, screeningLine, sceneBackgroundSvg, sceneTextSvg, type Scene } from './scene.ts';

export const OG_LIMIT = 300 * 1024;
export const VERTICAL_LIMIT = 1024 * 1024;

export interface ShareAsset { fileName: string; source: Buffer }
export interface ShareAssets {
  files: ShareAsset[];
  /** 'share/xxx-<hash>.jpg'；放映室沒資料時沒有 screening／story／post 那幾張 */
  names: { ogHome: string; ogScreening?: string; storyHome: string; storyScreening?: string; postHome: string; postScreening?: string; icon32: string; icon180: string };
  ownerName: string;
  personaTitle: string;
  screeningLine: string | null;
}

async function encodeUnder(img: Sharp, limit: number): Promise<Buffer> {
  let last: Buffer = Buffer.alloc(0);
  for (const quality of [88, 82, 76, 70, 62, 54, 46]) {
    last = await img.clone().jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer();
    if (last.length < limit) return last;
  }
  throw new Error(`分享圖壓到最低品質仍超過 ${limit} bytes`);
}

async function renderScene(scene: Scene, limit: number): Promise<Buffer> {
  const radius = scene.w > 1200 ? 8 : 4;
  const layers: OverlayOptions[] = [];
  for (const im of scene.images) {
    const input = await sharp(readFileSync(im.src))
      .resize(im.w, im.h, { fit: 'cover' })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${im.w}" height="${im.h}"><rect width="${im.w}" height="${im.h}" rx="${radius}" fill="#fff"/></svg>`), blend: 'dest-in' }])
      .png()
      .toBuffer();
    layers.push({ input, left: Math.round(im.x), top: Math.round(im.y) });
  }
  layers.push({ input: Buffer.from(sceneTextSvg(scene)), left: 0, top: 0 });
  const base = sharp(Buffer.from(sceneBackgroundSvg(scene))).composite(layers).flatten({ background: '#1a120d' });
  return encodeUnder(base, limit);
}

const hash = (b: Buffer) => createHash('sha1').update(b).digest('hex').slice(0, 10);

export interface ShareSource { profile: TasteProfile; publicDir: string; ownerName?: string; /** 分享圖的海報換片（owner.json 的 share.posterSwap） */ posterSwap?: Record<string, string> }

export async function buildShareAssets(src: ShareSource): Promise<ShareAssets> {
  const { profile, publicDir } = src;
  const tracks = profile.music?.ranges.all?.tracks ?? [];
  const storyFile = join(publicDir, 'screening/story.js');
  const story = existsSync(storyFile) ? parseStory(readFileSync(storyFile, 'utf8')) : null;
  // 檔案不在就略過，不要讓缺一張圖毀掉整次建置
  const covers = pickCovers(tracks, 4).map((p) => join(publicDir, p)).filter((p) => existsSync(p));
  const posterItems = story ? pickPosters(story.shelf, 6, src.posterSwap).filter((p) => existsSync(join(publicDir, 'screening', p.poster))) : [];
  const posters = posterItems.map((p) => join(publicDir, 'screening', p.poster));
  const line = story ? screeningLine(story.shelf) : null;
  const name = src.ownerName ?? profile.owner.name;
  const personaTitle = personaOf(profile).title;
  const scenes = buildScenes({ name, personaTitle, covers, posters, screeningLine: line });

  const files: ShareAsset[] = [];
  const names = {} as ShareAssets['names'];
  const add = async (key: keyof ShareAssets['names'], prefix: string, scene: Scene | undefined, limit: number) => {
    if (!scene) return;
    const buf = await renderScene(scene, limit);
    const fileName = `share/${prefix}-${hash(buf)}.jpg`;
    files.push({ fileName, source: buf });
    names[key] = fileName;
  };
  await add('ogHome', 'og-home', scenes.ogHome, OG_LIMIT);
  await add('ogScreening', 'og-screening', scenes.ogScreening, OG_LIMIT);
  await add('storyHome', 'story-home', scenes.storyHome, VERTICAL_LIMIT);
  await add('storyScreening', 'story-screening', scenes.storyScreening, VERTICAL_LIMIT);
  await add('postHome', 'post-home', scenes.postHome, VERTICAL_LIMIT);
  await add('postScreening', 'post-screening', scenes.postScreening, VERTICAL_LIMIT);
  for (const [key, size] of [['icon32', 32], ['icon180', 180]] as const) {
    const buf = await sharp(Buffer.from(iconSvg(size))).png().toBuffer();
    const fileName = `share/icon-${size}.png`;
    files.push({ fileName, source: buf });
    names[key] = fileName;
  }
  return { files, names, ownerName: name, personaTitle, screeningLine: line };
}

export const shareFileName = (path: string) => basename(path);
