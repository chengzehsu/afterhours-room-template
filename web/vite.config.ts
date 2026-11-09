import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import type { TasteProfile } from './src/core/profile.ts';
import { gigsOf, type GigPick } from './src/page/gigs.ts';
import { buildIndexHtml } from './src/page/template.ts';
import { buildShareAssets, type ShareAssets } from './src/share/render.ts';
import { shareTags, siteUrl } from './src/share/scene.ts';

import { cloudflare } from "@cloudflare/vite-plugin";
import site from "./site.config.json" with { type: "json" };

/** 建置時把 profile 畫成靜態 HTML：沒有 JavaScript 也看得到全部內容 */
function tastePage(): Plugin {
  const file = resolve(__dirname, 'src/data/profile.json');
  const chorusFile = resolve(__dirname, 'src/data/chorus.json');
  const openerFile = resolve(__dirname, 'src/data/opener.json');
  const ownerFile = resolve(__dirname, 'src/data/owner.json');
  return {
    name: 'taste-page',
    transformIndexHtml(html) {
      const profile = JSON.parse(readFileSync(file, 'utf8')) as TasteProfile;
      const chorus = existsSync(chorusFile) ? (JSON.parse(readFileSync(chorusFile, 'utf8')) as Record<string, number | null>) : {};
      const openerArtists = existsSync(openerFile) ? ((JSON.parse(readFileSync(openerFile, 'utf8')) as { artists?: string[] }).artists ?? []) : [];
      // 放映室頁面建好了才換頁；沒建好時出口的門只開一點就關上
      const screeningReady = existsSync(resolve(__dirname, 'screening/index.html'));
      const ownerJson = existsSync(ownerFile) ? (JSON.parse(readFileSync(ownerFile, 'utf8')) as { name: string; alias?: string; favorites?: { gigs?: GigPick[] } }) : undefined;
      const owner = ownerJson;
      // 最愛演唱會：歌手照片在 public/gigs/<id>.jpg（npm run data:gigs 抓），沒有就純字排版
      const gigs = gigsOf(profile, ownerJson?.favorites?.gigs, (id) => existsSync(resolve(__dirname, 'public/gigs', `${id}.jpg`)));
      return buildIndexHtml(html, profile, { chorus, openerArtists, screeningReady, owner, gigs });
    },
    handleHotUpdate({ file: changed, server }) {
      if (changed.endsWith('profile.json') || changed.endsWith('chorus.json') || changed.endsWith('opener.json') || changed.endsWith('owner.json') || changed.includes('/src/page/')) server.ws.send({ type: 'full-reload' });
    },
  };
}

/**
 * 分享圖與分享標籤：建置時用 sharp 合成（只讀 profile、story.js 與 public/ 的圖，不連網），
 * 檔名帶內容雜湊，資料一變就是新網址，LINE／Facebook 的快取才會換新圖。
 * 網域用 site.config.json 的 url（環境變數 SITE_URL 可以蓋過）；dev 時由 middleware 供 /share/*。
 */
function shareCards(): Plugin {
  const profileFile = resolve(__dirname, 'src/data/profile.json');
  const ownerFile = resolve(__dirname, 'src/data/owner.json');
  const site = siteUrl(process.env.SITE_URL);
  let assets: Promise<ShareAssets> | undefined;
  const posterSwap = () => {
    if (!existsSync(ownerFile)) return {};
    const o = JSON.parse(readFileSync(ownerFile, 'utf8')) as { share?: { posterSwap?: Record<string, string> } };
    return o.share?.posterSwap ?? {};
  };
  const get = () => (assets ??= buildShareAssets({ profile: JSON.parse(readFileSync(profileFile, 'utf8')) as TasteProfile, publicDir: resolve(__dirname, 'public'), posterSwap: posterSwap() }));
  return {
    name: 'share-cards',
    async transformIndexHtml(html, ctx) {
      const a = await get();
      const screening = ctx.path.includes('screening');
      const first = a.ownerName.split(/\s+/)[0] ?? a.ownerName;
      const abs = (f: string) => `${site}/${f}`;
      const og = screening ? (a.names.ogScreening ?? a.names.ogHome) : a.names.ogHome;
      const story = screening ? (a.names.storyScreening ?? a.names.storyHome) : a.names.storyHome;
      const tags = shareTags(screening
        ? { title: `${first} 家・看劇的地方`, description: a.screeningLine ? `${a.screeningLine}。從聽歌的地方隔壁那扇門走進來，看我家客廳的投影與片櫃。` : '從聽歌的地方隔壁那扇門走進來：我家客廳的投影、片櫃，和我這幾年看了什麼的時間軸。', url: `${site}/screening/`, image: abs(og), imageAlt: `${a.ownerName} 家・看劇的地方：${a.screeningLine ?? '一排我最常回來看的海報'}`, icon32: abs(a.names.icon32), icon180: abs(a.names.icon180) }
        : { title: `${first} 家：聽歌的地方、看劇的地方`, description: `${[a.personaTitle, a.screeningLine].filter(Boolean).join('。')}。推開門，聽我聽的歌、看我看的劇。`, url: `${site}/`, image: abs(og), imageAlt: `${a.ownerName} 家・聽歌的地方與看劇的地方：${[a.personaTitle, a.screeningLine].filter(Boolean).join('；')}`, icon32: abs(a.names.icon32), icon180: abs(a.names.icon180) });
      const data = JSON.stringify({ url: screening ? `${site}/screening/` : `${site}/`, story: `${screening ? '../' : ''}${story}`, filename: story.replace(/^share\//, '') }).replace(/</g, '\\u003c');
      const block = `${tags}\n    <script type="application/json" id="share-data">${data}</script>\n  `;
      return html.replace('</head>', () => `${block}</head>`);
    },
    async generateBundle() {
      for (const f of (await get()).files) this.emitFile({ type: 'asset', fileName: f.fileName, source: f.source });
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        if (!path.startsWith('/share/')) return next();
        const hit = (await get()).files.find((f) => `/${f.fileName}` === path);
        if (!hit) return next();
        res.setHeader('Content-Type', hit.fileName.endsWith('.png') ? 'image/png' : 'image/jpeg');
        res.end(hit.source);
      });
    },
  };
}

/**
 * 工具（gstack 瀏覽器、Claude）會把日誌寫進 public/ 的點目錄，Vite 每次建置都會整包複製進 dist。
 * 部署端雖然有 .assetsignore 擋，這裡再刪一次，日誌不會留在要上傳的目錄裡。只刪目錄，.assetsignore 等檔案保留。
 */
function dropDotDirs(): Plugin {
  let outDir = '';
  const sweep = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name);
      if (e.name.startsWith('.')) rmSync(p, { recursive: true, force: true });
      else sweep(p);
    }
  };
  return {
    name: 'drop-dot-dirs',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    closeBundle: { order: 'post', handler() { if (existsSync(outDir)) sweep(outDir); } },
  };
}

export default defineConfig({
  base: './',
  plugins: [tastePage(), shareCards(), cloudflare({ config: { name: site.worker } }), dropDotDirs()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    // 多頁：播放室（index.html）＋放映室（screening/index.html）
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ...(existsSync(resolve(__dirname, 'screening/index.html')) ? { screening: resolve(__dirname, 'screening/index.html') } : {}),
      },
    },
  },
});