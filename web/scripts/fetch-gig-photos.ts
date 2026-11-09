/**
 * owner.json 的 favorites.gigs → 歌手照片 → public/gigs/<id>.jpg（演唱會海報用）。
 * 走 Spotify oEmbed（不需要權杖）：取 thumbnail_url 再下載。已經有檔案的略過；失敗只印 HTTP 狀態，不中斷。
 * 需要網路：NODE_USE_ENV_PROXY=1 node scripts/fetch-gig-photos.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(WEB, 'public/gigs');
const owner = JSON.parse(readFileSync(resolve(WEB, 'src/data/owner.json'), 'utf8')) as { favorites?: { gigs?: { name: string; spotify: string }[] } };
mkdirSync(OUT, { recursive: true });

for (const g of owner.favorites?.gigs ?? []) {
  // id 只接受英數字，才不會拿來拼出奇怪的檔案路徑或網址
  if (!/^[A-Za-z0-9]+$/.test(g.spotify)) {
    console.log(`略過 ${g.name}：artist id 格式不對`);
    continue;
  }
  const file = resolve(OUT, `${g.spotify}.jpg`);
  if (existsSync(file)) {
    console.log(`已有   ${g.name}`);
    continue;
  }
  try {
    const meta = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/artist/${g.spotify}`)}`);
    if (!meta.ok) {
      console.log(`失敗 oEmbed HTTP ${meta.status}  ${g.name}`);
      continue;
    }
    const { thumbnail_url: thumb } = (await meta.json()) as { thumbnail_url?: string };
    if (!thumb) {
      console.log(`失敗 沒有 thumbnail_url  ${g.name}`);
      continue;
    }
    const res = await fetch(thumb);
    if (!res.ok) {
      console.log(`失敗 圖片 HTTP ${res.status}  ${g.name}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(file, buf);
    console.log(`下載   ${g.name}  ${(buf.length / 1024).toFixed(0)} KB  ${new URL(res.url).host}`);
  } catch (e) {
    console.log(`失敗 ${g.name}：${(e as Error).name}`);
  }
  await new Promise((r) => setTimeout(r, 250));
}
