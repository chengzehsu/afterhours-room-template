/**
 * data/raw/spotify.json → src/data/profile.json，並把圖片下載到 public/media/。
 * 圖片放本機：唱盤貼圖要讀像素取色，也方便離線與發佈。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromSpotifyApi, type SpotifyApiRaw } from '../src/adapters/spotify-api.ts';
import type { Picture, TasteProfile } from '../src/core/profile.ts';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = resolve(WEB, '../data/raw/spotify.json');
const OUT = resolve(WEB, 'src/data/profile.json');
const MEDIA = resolve(WEB, 'public/media');

async function localize(url: string): Promise<string> {
  const name = `${url.split('/').pop()}.jpg`;
  const file = resolve(MEDIA, name);
  if (!existsSync(file)) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        break;
      } catch (err) {
        if (attempt >= 3) throw new Error(`下載失敗 ${url}: ${err}`);
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  return `media/${name}`;
}

async function localizePicture(p: Picture | undefined): Promise<Picture | undefined> {
  if (!p) return p;
  return { sm: await localize(p.sm), lg: await localize(p.lg) };
}

async function main(): Promise<void> {
  const profile: TasteProfile = fromSpotifyApi(JSON.parse(readFileSync(RAW, 'utf8')) as SpotifyApiRaw);
  mkdirSync(MEDIA, { recursive: true });
  // 使用者頭貼可能是社群網站的私人照片，頁面不使用
  delete profile.owner.picture;
  const music = profile.music!;
  const jobs: Promise<void>[] = [];
  const seen = new Map<string, Promise<Picture | undefined>>();
  const once = (p: Picture | undefined) => {
    if (!p) return Promise.resolve(p);
    const key = p.lg;
    if (!seen.has(key)) seen.set(key, localizePicture(p));
    return seen.get(key)!;
  };
  for (const r of Object.values(music.ranges)) {
    for (const a of r.artists) jobs.push(once(a.picture).then((p) => void (a.picture = p)));
    for (const t of r.tracks) jobs.push(once(t.album.picture).then((p) => void (t.album.picture = p)));
  }
  for (const t of music.extraTracks) jobs.push(once(t.album.picture).then((p) => void (t.album.picture = p)));
  await Promise.all(jobs);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(profile, null, 1));
  console.log(`寫入 ${OUT}，圖片組 ${seen.size}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
