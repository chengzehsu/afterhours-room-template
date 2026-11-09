/**
 * 產生完全虛構的範例資料與佔位圖，讓沒有任何金鑰的人 clone 下來就能 test / typecheck / build，
 * 3D 房間與放映室也都有東西可看。歌手、專輯、曲目、片名、簡介、主人全是編的，與任何真人或作品無關。
 *
 * 用法（在 web/ 底下）：
 *   npm run data:sample                 寫進這支腳本所在 repo
 *   node scripts/make-sample-data.ts --root <repo 根目錄>   寫進另一個資料夾（匯出公開快照用）
 *   加 --force 才會蓋掉不是範例的既有 profile.json（避免誤蓋業主自己的真實資料）
 *
 * 輸出（全在 root 底下）：
 *   web/src/data/{profile,chorus,opener,owner}.json
 *   web/public/media/sample-*.jpg                  封面與歌手照（sm 300、lg 640）
 *   web/public/gigs/<假 id>.jpg                    owner.json 的 favorites.gigs 用
 *   web/public/screening/story.js                  window.STORY（形狀同 prototypes/screening-room/home/build_story.py）
 *   web/public/screening/media/sample-{p,b}-NN.jpg 海報 342 寬、劇照 780 寬
 *
 * 固定種子的偽亂數：同一份腳本每次產生完全一樣的檔案（沒有時間戳、沒有亂數檔名）。
 * 佔位圖只印拉丁字母與數字，不依賴系統有沒有中文字型。
 * 第三方字串規則（AGENTS.md 不變量）照舊：這裡的字串只寫進 JSON／story.js 與 SVG（有 xml 轉義），
 * 進 HTML 仍由 render.ts 的 esc() 負責。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { Album, Artist, ArtistRef, Picture, Play, TasteProfile, Track } from '../src/core/profile.ts';

// ───────── 參數 ─────────
const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = resolve(argOf('--root') ?? resolve(HERE, '../..'));
const FORCE = argv.includes('--force');
const WEB = join(ROOT, 'web');
const DATA_DIR = join(WEB, 'src/data');
const MEDIA_DIR = join(WEB, 'public/media');
const GIGS_DIR = join(WEB, 'public/gigs');
const SCREENING_DIR = join(WEB, 'public/screening');
const SCREENING_MEDIA = join(SCREENING_DIR, 'media');

// ───────── 偽亂數與小工具 ─────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261108);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const at = <T>(xs: readonly T[], i: number): T => {
  const v = xs[i];
  if (v === undefined) throw new Error(`索引 ${i} 超出範圍（長度 ${xs.length}）`);
  return v;
};
const pick = <T>(xs: readonly T[]): T => at(xs, Math.floor(rand() * xs.length));
function shuffle<T>(xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [at(out, j), at(out, i)];
  }
  return out;
}
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const usedIds = new Set<string>();
function fakeId(): string {
  for (;;) {
    let s = '';
    for (let i = 0; i < 22; i++) s += B62[Math.floor(rand() * 62)];
    if (!usedIds.has(s)) {
      usedIds.add(s);
      return s;
    }
  }
}
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// ───────── 佔位圖（SVG → sharp → JPEG） ─────────
function hex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
function cardSvg(w: number, h: number, hue: number, top: string, big: string, bottom: string): string {
  const u = Math.min(w, h);
  const c1 = hex(hue, 0.55, 0.38);
  const c2 = hex((hue + 40) % 360, 0.6, 0.2);
  const ring = hex((hue + 180) % 360, 0.5, 0.62);
  const cap = (t: string, size: number, y: number, weight: number, fill: string, spacing = 0) =>
    `<text x="${w / 2}" y="${y}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}" fill="${fill}">${xml(t)}</text>`;
  const fit = (t: string, size: number) => (t.length * size * 0.56 > w * 0.88 ? Math.max(10, Math.floor((w * 0.88) / (t.length * 0.56))) : size);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<circle cx="${w * 0.5}" cy="${h * 0.48}" r="${u * 0.3}" fill="none" stroke="${ring}" stroke-opacity="0.55" stroke-width="${Math.max(2, u * 0.012)}"/>
<circle cx="${w * 0.5}" cy="${h * 0.48}" r="${u * 0.18}" fill="${ring}" fill-opacity="0.16"/>
${cap(top, Math.round(u * 0.055), Math.round(h * 0.12), 600, '#ffffff', Math.round(u * 0.012))}
${cap(big, Math.round(u * 0.2), Math.round(h * 0.48 + u * 0.07), 700, '#ffffff')}
${cap(bottom, fit(bottom, Math.round(u * 0.058)), Math.round(h * 0.9), 500, '#ffffff')}
</svg>`;
}
const imageJobs = new Map<string, string>(); // 輸出檔 → svg（Map 去重）
function queueImage(file: string, w: number, h: number, hue: number, top: string, big: string, bottom: string) {
  if (!imageJobs.has(file)) imageJobs.set(file, cardSvg(w, h, hue, top, big, bottom));
}
async function flushImages() {
  const entries = [...imageJobs];
  for (let i = 0; i < entries.length; i += 16) {
    await Promise.all(
      entries.slice(i, i + 16).map(async ([file, svg]) => {
        mkdirSync(dirname(file), { recursive: true });
        await sharp(Buffer.from(svg)).jpeg({ quality: 72, mozjpeg: true, chromaSubsampling: '4:2:0' }).toFile(file);
      }),
    );
  }
}
const latinTag = (name: string) => name.match(/[A-Za-z][A-Za-z0-9 &.']*/)?.[0]?.trim() ?? '';

// 圖片路徑（相對 public/）：給 profile 用；實際檔案排進 imageJobs
function squarePicture(kind: 'artist' | 'cover', n: number, hue: number, label: string): Picture {
  const sm = `media/sample-${kind}-${pad(n)}-sm.jpg`;
  const lg = `media/sample-${kind}-${pad(n)}-lg.jpg`;
  const top = kind === 'artist' ? 'SAMPLE ARTIST' : 'SAMPLE ALBUM';
  queueImage(join(WEB, 'public', sm), 300, 300, hue, top, pad(n), label);
  queueImage(join(WEB, 'public', lg), 640, 640, hue, top, pad(n), label);
  return { sm, lg };
}

// ───────── 虛構歌手、專輯、曲目 ─────────
const ARTIST_NAMES = [
  // 中文與中英並列（displayName 只留中文那段）
  '晚風合唱團', '海鹽汽水 Sea Salt Soda', '貓步', '雲端早餐', '小夜燈 Nightlight Kids', '週日散步 Sunday Stroll', '霧中信箋', '青檸電台 Lime Radio',
  '月台上的人', '紙飛機工廠 Paper Plane Works', '午後雷陣雨', '透明雨傘', '半糖少冰', '橘子日曆', '搖椅樂隊', '阿澄 Acheng',
  '小滿樂團', '禾木', '未央', '南風信子', '知夏', '夏夜公路', '薄荷與鯨魚', '灰色沙發',
  '迷你巴士', '玻璃彈珠', '森林郵局', '二號出口', '屋頂上的電台', '山下合唱團',
  // 英文
  'Velvet Harbor Club', 'Nine Orchids', 'The Quiet Kites', 'Marble Tides', 'Lowlight Parade', 'Sunday Origami', 'Cobalt Meadow', 'Porcelain Radio',
  'Fern & Ash', 'Midnight Tangerine', 'Atlas Lantern', 'Hollow Pines', 'Glass Weather', 'June Vacancy', 'Tiny Satellite', 'Paper Moth Choir',
  'Orchard Static', 'Pale Ferry', 'Kiwi Overpass', 'Soft Elevator', 'Juniper & the Tides', 'Lantern District', 'Moss Telegram', 'The Borrowed Umbrellas',
  'Coral Parking Lot', 'Saltwater Cinema', 'Daydream Postal', 'Honey Circuit', 'North Window', 'The Amber Hours', 'Quiet Orbit Club', 'Mellow Cartridge',
  'Tidepool Kids', 'Wren & Willow',
];
const ZH_A = ['晚風', '路燈', '海風', '雨傘', '月台', '咖啡', '明信片', '紙飛機', '玻璃', '午後', '日記', '窗邊', '慢速', '夜車', '橘色', '薄荷', '潮汐', '信箋', '空白', '迴音', '微光', '屋頂', '風箏', '巷口', '散步', '季節', '口袋', '拼圖', '雲朵', '鬧鐘'];
const ZH_B = ['的夢', '來信', '練習曲', '之後', '小夜曲', '日常', '慢板', '旅行', '快門', '倒影', '和你', '不說話', '還在', '明信片', '天氣', '出發', '晴天', '回家', '散場', '留白'];
const EN_A = ['Paper', 'Velvet', 'Lemon', 'Quiet', 'Slow', 'Neon', 'Salt', 'Cardboard', 'Midnight', 'Softer', 'Hollow', 'Tiny', 'Borrowed', 'Amber', 'Static', 'Pale', 'Wild', 'Little', 'Faded', 'Open'];
const EN_B = ['Weather', 'Kites', 'Harbor', 'Orbit', 'Postcards', 'Daylight', 'Radio', 'Tangerine', 'Satellite', 'Windows', 'Fireflies', 'Elevator', 'Lanterns', 'Parade', 'Sundays', 'Coastline', 'Receipts', 'Echoes', 'Vacancy', 'Metro'];
const usedNames = new Set<string>();
function fakeTitle(zh: boolean): string {
  for (;;) {
    const t = zh ? pick(ZH_A) + pick(ZH_B) : `${pick(EN_A)} ${pick(EN_B)}`;
    if (!usedNames.has(t)) {
      usedNames.add(t);
      return t;
    }
  }
}

interface FakeArtist extends Artist { zh: boolean; tracks: Track[] }
const artists: FakeArtist[] = [];
const trackById = new Map<string, Track>();
const albumCount = { n: 0 };

ARTIST_NAMES.forEach((name, i) => {
  const zh = /[一-鿿]/.test(name);
  const id = fakeId();
  const hue = (i * 47 + 13) % 360;
  const a: FakeArtist = {
    id,
    name,
    url: `https://open.spotify.com/artist/${id}`,
    picture: squarePicture('artist', i + 1, hue, latinTag(name) || `ARTIST ${pad(i + 1)}`),
    zh,
    tracks: [],
  };
  artists.push(a);
});

/** 每位歌手 1 張專輯；前 14 名多一張。專輯圖只在有曲目被用到時才排進輸出（見 touchAlbum） */
interface PlannedAlbum { id: string; name: string; year: number; hue: number; artist: FakeArtist; n: number; picture?: Picture }
const plannedAlbums: PlannedAlbum[] = [];
artists.forEach((a, i) => {
  const count = i < 14 ? 2 : 1;
  for (let k = 0; k < count; k++) {
    albumCount.n++;
    plannedAlbums.push({ id: fakeId(), name: fakeTitle(a.zh ? rand() < 0.85 : rand() < 0.2), year: rand() < 0.35 ? int(2025, 2026) : int(2014, 2024), hue: (albumCount.n * 29 + 200) % 360, artist: a, n: albumCount.n });
  }
});
function albumOf(p: PlannedAlbum): Album {
  p.picture ??= squarePicture('cover', p.n, p.hue, latinTag(p.name) || `ALBUM ${pad(p.n)}`);
  return { id: p.id, name: p.name, year: p.year, picture: p.picture };
}
// 曲目：每張專輯 4～5 首；album 物件延後到「這首歌真的被某個排行或最近播放用到」才建（才會產生封面圖）
interface PlannedTrack { id: string; name: string; plan: PlannedAlbum; durationMs: number; feat?: FakeArtist }
const plannedTracks = new Map<FakeArtist, PlannedTrack[]>();
for (const p of plannedAlbums) {
  const list = plannedTracks.get(p.artist) ?? [];
  const n = int(4, 5);
  for (let j = 0; j < n; j++) {
    list.push({ id: fakeId(), name: fakeTitle(p.artist.zh ? rand() < 0.85 : rand() < 0.2), plan: p, durationMs: int(150_000, 285_000), feat: rand() < 0.1 ? pick(artists) : undefined });
  }
  plannedTracks.set(p.artist, list);
}
const ref = (a: Artist): ArtistRef => ({ id: a.id, name: a.name });
function realize(pt: PlannedTrack): Track {
  const hit = trackById.get(pt.id);
  if (hit) return hit;
  const main = pt.plan.artist;
  const t: Track = {
    id: pt.id,
    name: pt.name,
    artists: pt.feat && pt.feat !== main ? [ref(main), ref(pt.feat)] : [ref(main)],
    album: albumOf(pt.plan),
    durationMs: pt.durationMs,
    url: `https://open.spotify.com/track/${pt.id}`,
  };
  trackById.set(pt.id, t);
  return t;
}

// ───────── 三段排行 ─────────
const idx = (n: number) => Array.from({ length: n }, (_, i) => i);
/** 讓排名小幅打亂：每個位置跟後面 span 格內的某個交換 */
function jitter<T>(xs: readonly T[], span: number): T[] {
  const out = [...xs];
  for (let i = 0; i < out.length - 1; i++) {
    const j = Math.min(out.length - 1, i + int(0, span));
    [out[i], out[j]] = [at(out, j), at(out, i)];
  }
  return out;
}
// 歌手排行（以 artists 的索引表示）
const allOrder = jitter(idx(50), 2); // 一年：0..49
const faded = allOrder.slice(12, 15); // 一年前 15 名、但這 4 週完全沒聽
const NEWCOMERS = [50, 51, 52]; // 這 4 週才出現、一年榜上沒有
const halfOrder = [...jitter(allOrder.slice(0, 32), 3), ...idx(10).map((i) => 50 + i), ...allOrder.slice(32, 40)];
const monthCore = jitter(allOrder.slice(0, 12), 2);
const monthRest = [...allOrder.slice(15, 40), ...idx(11).map((i) => 53 + i)];
const monthOrder = [...monthCore.slice(0, 5), NEWCOMERS[0]!, ...monthCore.slice(5, 9), NEWCOMERS[1]!, ...monthCore.slice(9), NEWCOMERS[2]!, ...monthRest].slice(0, 50);
for (const f of faded) if (monthOrder.includes(f)) throw new Error('faded 歌手不該出現在 month');

function rangeChart(order: readonly number[], boost?: number, mix = false) {
  const chartArtists = order.map((i) => at(artists, i));
  const cands: { score: number; pt: PlannedTrack }[] = [];
  order.forEach((ai, r) => {
    const own = plannedTracks.get(at(artists, ai)) ?? [];
    // 半年與 4 週各自挑歌，跟一年榜不要完全重疊；第 1 名歌手的前 4 首固定，三段才有「一直在循環」的歌
    const pts = mix && ai !== boostIdx ? shuffle(own) : own;
    // 一年榜第 1 名的歌手：前 4 首都擠進前段，才有「一頭栽進去」與「整張聽完」的故事
    const step = ai === boost ? 1.1 : 4 + r * 0.15;
    pts.slice(0, ai === boost ? 4 : 3).forEach((pt, j) => cands.push({ score: r + j * step + rand() * 2.5, pt }));
  });
  const tracks = cands.sort((a, b) => a.score - b.score).slice(0, 50).map((c) => realize(c.pt));
  return { artists: chartArtists.map((a) => ({ id: a.id, name: a.name, picture: a.picture, url: a.url })), tracks };
}
// 第 1 名歌手的前 4 首要出自同一張專輯
const boostIdx = at(allOrder, 0);
const boostTracks = plannedTracks.get(at(artists, boostIdx)) ?? [];
if (new Set(boostTracks.slice(0, 4).map((t) => t.plan.id)).size !== 1) throw new Error('第 1 名歌手前 4 首應同一張專輯');
const ranges = {
  all: rangeChart(allOrder, boostIdx),
  half: rangeChart(halfOrder, undefined, true),
  month: rangeChart(monthOrder, undefined, true),
};

// ───────── 最近播放與額外曲目 ─────────
const inRanges = new Set(Object.values(ranges).flatMap((r) => r.tracks.map((t) => t.id)));
const extraPool: PlannedTrack[] = [];
for (const [a, pts] of plannedTracks) {
  const ai = artists.indexOf(a);
  // 排行裡歌手沒被選進榜的歌，加上沒進榜的歌手（60 以後）的歌
  for (const pt of pts) if (!inRanges.has(pt.id) && (ai >= 60 || ai < 40)) extraPool.push(pt);
}
const extraTracks = shuffle(extraPool).slice(0, 28).map(realize);
const rankedPool = shuffle([...inRanges]).slice(0, 22).map((id) => {
  const t = trackById.get(id);
  if (!t) throw new Error(`找不到曲目 ${id}`);
  return t;
});
const playOrder = shuffle([...extraTracks, ...rankedPool]);
const NOW = Date.UTC(2026, 10, 8, 5, 0, 0);
let clock = Date.UTC(2026, 10, 8, 3, 8, 4, 252);
const recent: Play[] = playOrder.map((t) => {
  const p = { trackId: t.id, playedAt: new Date(clock).toISOString() };
  clock -= int(9, 58) * 60_000 + int(0, 59) * 1000;
  return p;
});

// ───────── profile / chorus / opener / owner ─────────
const profile: TasteProfile = {
  version: 1,
  generatedAt: new Date(NOW).toISOString(),
  owner: { name: 'Alex Lin', country: 'TW', url: 'https://open.spotify.com/user/spotify' },
  music: { source: 'spotify-api', ranges, recent, extraTracks, totals: { saved: 842, followed: 63 } },
};
const chorus: Record<string, number | null> = {};
for (const id of [...inRanges].sort()) chorus[id] = rand() < 0.68 ? int(18, 96) * 1000 + int(0, 9) * 100 : null;
const topNames = ranges.all.artists.slice(0, 20).map((a) => a.name);
const opener = { artists: shuffle(topNames).slice(0, 6) };
// 演唱會牆：形狀照真實清單（12 場、名字短、拉丁中文都有、1 位沒上榜、名次分布相近），版面與鏡頭測試才量得到同樣的情況
// 年度歌手名次與文字（拉丁字比中文窄，可以長一點）；沒上榜那位另外插在第 10 張
const isZh = (s: string) => /[一-鿿]/.test(s);
const GIG_RANKS: [number, 'zh' | 'latin'][] = [[15, 'zh'], [19, 'zh'], [7, 'zh'], [1, 'zh'], [36, 'zh'], [6, 'zh'], [39, 'latin'], [34, 'zh'], [13, 'zh'], [3, 'zh'], [50, 'latin']];
const allArtists = ranges.all.artists;
const taken = new Set<string>();
const gigArtists = GIG_RANKS.map(([rank, script]) => {
  const ok = (i: number) => {
    const a = allArtists[i];
    return !!a && !taken.has(a.id) && (script === 'zh' ? isZh(a.name) && a.name.length <= 9 : !isZh(a.name) && a.name.length <= 10);
  };
  let i = rank - 1;
  for (let d = 0; d < allArtists.length && !ok(i); d++) i = ok(rank - 1 - d) ? rank - 1 - d : rank - 1 + d;
  if (!ok(i)) throw new Error(`找不到名次 ${rank} 附近名字夠短的歌手`);
  taken.add(allArtists[i]!.id);
  return allArtists[i]!;
});
const gigs = gigArtists.map((a) => {
  const ai = artists.findIndex((x) => x.id === a.id);
  queueImage(join(GIGS_DIR, `${a.id}.jpg`), 640, 640, (ai * 47 + 90) % 360, 'SAMPLE GIG', pad(ai + 1), latinTag(a.name) || `ARTIST ${pad(ai + 1)}`);
  return { name: a.name, spotify: a.id };
});
const offChart = { name: 'Moonwake', spotify: fakeId() }; // 去看過但不在排行裡的歌手
queueImage(join(GIGS_DIR, `${offChart.spotify}.jpg`), 640, 640, 210, 'SAMPLE GIG', '00', 'OFF CHART');
gigs.splice(9, 0, offChart);

// ───────── 虛構片單（story.js） ─────────
type Kind = '電影' | '影集' | '動畫' | '實境秀';
const KIND_LABEL: Record<Kind, string> = { 電影: 'FILM', 影集: 'SERIES', 動畫: 'ANIME', 實境秀: 'REALITY' };
const KIND_ORDER: Kind[] = ['電影', '影集', '動畫', '實境秀'];
const TITLES: Record<Kind, string[]> = {
  電影: ['夜班巴士的最後一站', '檸檬色的星期四', '海邊的郵差小姐', '午夜圖書館的貓', '三十八號月台', '雨後的操場', '低空飛行', '隔壁的隔壁', '時差七小時', '沉默的合唱團', '末班車以後', '夏天的第四十天', '回聲谷', '老街放映機'],
  影集: ['小鎮氣象台', '第七號診療室', '迷路的導遊', '辦公室裡的外星人', '雲端上的麵包店', '灣區偵探社', '隔壁班的天才', '失眠者互助會', '午後三點的謎團', '潮間帶', '鐵道旁的民宿', '星期五的同學會', '備用鑰匙', '臨時演員日記', '港口夜話', '山城警局', '代班店長', '屋頂上的樂團', '補習班的燈', '無人島民宿', '週末限定的家', '雨季食堂', '第二人生說明書', '城市邊緣的圖書館員', '倒數第二個夏天', '新手村長'],
  動畫: ['雲上的小餐館', '月亮郵局', '機械貓的日記', '星屑旅行社', '森林裡的補習班', '魔法洗衣店', '小小氣象員', '海底電車', '風鈴少女', '遲到的流星', '紙飛機大作戰', '咖啡杯裡的宇宙', '夜行動物園', '時鐘鎮的祕密'],
  實境秀: ['週末大廚擂台', '荒島求生一二三', '相親餐桌', '旅行不要吵', '極限收納王', '新手露營團'],
};
const ALT: Record<string, string> = {
  夜班巴士的最後一站: 'Last Stop of the Night Bus', 午夜圖書館的貓: 'The Cat of the Midnight Library', 時差七小時: 'Seven Hours Behind', 小鎮氣象台: 'Small Town Weather Station',
  辦公室裡的外星人: 'Alien in Cubicle 9', 迷路的導遊: 'The Lost Guide', 月亮郵局: 'Moon Post Office', 咖啡杯裡的宇宙: 'Universe in a Coffee Cup', 荒島求生一二三: 'Island 1-2-3',
};
const ORIGINS: Record<Kind, string[]> = { 電影: ['華語', '華語', '日本', '韓國', '英語', '法語'], 影集: ['華語', '華語', '韓國', '日本', '英語', '西班牙語'], 動畫: ['日本', '日本', '日本', '韓國', '英語'], 實境秀: ['華語', '韓國', '日本'] };
const GENRES: Record<Kind, string[]> = {
  電影: ['劇情', '喜劇', '愛情', '懸疑', '科幻', '奇幻', '家庭', '冒險'],
  影集: ['劇情', '喜劇', '愛情', '懸疑', '犯罪', '科幻', '家庭'],
  動畫: ['奇幻', '冒險', '家庭', '喜劇'],
  實境秀: [],
};
const DAY = 86_400_000;
const UNTIL = Date.UTC(2026, 10, 8);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const START = Date.UTC(2021, 0, 1);
const SIGNATURE = '小鎮氣象台';
const NOW_TITLE = '新手村長';

interface ShelfItem {
  id: string; title: string; kind: Kind; year: string; days: number; first: string; last: string; origin: string; genres: string[];
  in: { month: boolean; half: boolean; year: boolean }; poster: string; backdrop: string; alt: string | null; trailer: null;
  /** 劇情簡介（真實版來自 TMDB 繁中，沒有就省略欄位） */
  overview?: string;
}
const PLOTS = [
  '一個不太會說話的人，在一連串意外裡學會跟身邊的人好好相處。',
  '幾個高中同學多年後重聚，才發現當年那件事每個人記得的版本都不一樣。',
  '小鎮來了一位外地旅人，平靜的日子開始出現說不清楚的變化。',
  '主角每天都在同一個時間醒來，直到某天鬧鐘沒有響。',
  '一間快要收掉的小店，靠著一群常客撐過最難熬的冬天。',
  '兩個個性完全相反的人被迫合作，從互看不順眼到彼此信任。',
  '一封寄錯地址的信，牽起兩座城市之間的緣分。',
]
let titleNo = 0;
const shelf: ShelfItem[] = [];
for (const kind of KIND_ORDER) {
  for (const title of TITLES[kind]) {
    titleNo++;
    const n = titleNo;
    const days = title === SIGNATURE ? 34 : kind === '電影' ? int(1, 3) : kind === '實境秀' ? int(1, 6) : kind === '動畫' ? 1 + Math.floor(rand() ** 2 * 12) : 1 + Math.floor(rand() ** 2 * 18);
    // 最後一次看的時間：約兩成在 4 週內、三成在半年內、三成在一年內，其餘更早
    const r = rand();
    const ago = title === NOW_TITLE ? 0 : r < 0.2 ? int(1, 27) : r < 0.5 ? int(29, 180) : r < 0.8 ? int(184, 360) : int(370, 1800);
    const last = UNTIL - ago * DAY;
    const first = Math.max(START, last - (days > 1 ? int(days, Math.max(days, 400)) : 0) * DAY);
    const hue = (n * 37 + 20) % 360;
    queueImage(join(SCREENING_MEDIA, `sample-p-${pad(n)}.jpg`), 342, 513, hue, `SAMPLE ${KIND_LABEL[kind]}`, pad(n), `TITLE ${pad(n)}`);
    queueImage(join(SCREENING_MEDIA, `sample-b-${pad(n)}.jpg`), 780, 439, hue, `SAMPLE ${KIND_LABEL[kind]}`, pad(n), `STILL ${pad(n)}`);
    const k = Math.min(3, GENRES[kind].length);
    shelf.push({
      id: `sample-${pad(n)}`, title, kind, year: String(int(2014, 2026)), days, first: iso(first), last: iso(last), origin: pick(ORIGINS[kind]),
      genres: shuffle(GENRES[kind]).slice(0, k === 0 ? 0 : int(1, k)),
      in: { month: ago <= 28, half: ago <= 182, year: ago <= 365 },
      poster: `media/sample-p-${pad(n)}.jpg`, backdrop: `media/sample-b-${pad(n)}.jpg`, alt: ALT[title] ?? null, trailer: null,
      ...(kind !== '實境秀' && rand() < 0.7 ? { overview: pick(PLOTS) } : {}),
    });
  }
}
shelf.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.days - a.days || a.title.localeCompare(b.title, 'zh-Hant'));
const counts = { month: shelf.filter((s) => s.in.month).length, half: shelf.filter((s) => s.in.half).length, year: shelf.filter((s) => s.in.year).length };
const shelfOf = (title: string) => {
  const s = shelf.find((x) => x.title === title);
  if (!s) throw new Error(`片櫃沒有 ${title}`);
  return s;
};

// 時間軸：2021-01 到 2026-11 一個月一格
const KIND_SHARE: [Kind, number][] = [['影集', 0.45], ['電影', 0.25], ['動畫', 0.2], ['實境秀', 0.1]];
interface TopRef { title: string; days: number; kind: Kind; poster: string; backdrop: string }
interface Entry { m: string; works: number; days: number; kinds: Partial<Record<Kind, number>>; top: TopRef; now?: unknown }
const DOM_MONTH = '2023-04';
const timeline: Entry[] = [];
for (let y = 2021; y <= 2026; y++) {
  for (let mo = 1; mo <= 12; mo++) {
    if (y === 2026 && mo > 11) break;
    const m = `${y}-${pad(mo)}`;
    const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const season = [11, 12, 1, 2, 7, 8].includes(mo) ? 6 : 0;
    const works = m === DOM_MONTH ? 14 : int(4, 20) + season + (y >= 2022 ? 3 : 0);
    const days = m === DOM_MONTH ? 12 : Math.max(2, Math.min(dim, Math.ceil(works * 0.55) + int(-2, 4)));
    const kinds: Partial<Record<Kind, number>> = {};
    let left = works;
    KIND_SHARE.forEach(([k, share], i) => {
      const c = i === KIND_SHARE.length - 1 ? left : Math.min(left, Math.round(works * share));
      if (c > 0) kinds[k] = c;
      left -= c;
    });
    const top = m === DOM_MONTH ? shelfOf(SIGNATURE) : m === '2026-11' ? shelfOf(NOW_TITLE) : pick(shelf);
    timeline.push({ m, works, days, kinds, top: { title: top.title, days: m === DOM_MONTH ? 11 : Math.min(days, int(1, 4)), kind: top.kind, poster: top.poster, backdrop: top.backdrop } });
  }
}
const busiest = timeline.reduce((a, b) => (b.works > a.works || (b.works === a.works && b.days > a.days) ? b : a));
const nowItem = shelfOf(NOW_TITLE);
const nowObj = { title: nowItem.title, kind: nowItem.kind, last: nowItem.last, days: nowItem.days, poster: nowItem.poster, backdrop: nowItem.backdrop };
const lastEntry = at(timeline, timeline.length - 1);
lastEntry.now = nowObj;
const sig = shelfOf(SIGNATURE);
const domEntry = timeline.find((t) => t.m === DOM_MONTH)!;
const dominance = { month: DOM_MONTH, title: sig.title, days: 11, of: domEntry.days, share: 11 / domEntry.days };
const moments: Record<string, string> = {
  [at(timeline, 0).m]: '從這個月開始有紀錄。',
  [lastEntry.m]: `這個月，也就是現在。我正在看《${nowItem.title}》。`,
};
moments[busiest.m] = `看最多部的一個月：${busiest.works} 部。`;
moments[dominance.month] = `這個月我有開 Netflix 的 ${dominance.of} 天裡，有 ${dominance.days} 天在看《${dominance.title}》。`;
const years: Record<string, { works: number; days: number }> = {};
for (const e of timeline) {
  const y = (years[e.m.slice(0, 4)] ??= { works: 0, days: 0 });
  y.works += e.works;
  y.days += e.days;
}
for (const v of Object.values(years)) v.works = Math.round(v.works * 0.82);
const total = Object.values(years).reduce((s, v) => s + v.works, 0);
// 最愛：owner.json 存片名、story.js 存片櫃 id，兩邊是同一份清單（真實版由 build_story.py 對照）
const favScreen = shelf.filter((s) => s.kind !== '實境秀').sort((a, b) => b.days - a.days).slice(0, 9);
const story = {
  owner: 'Alex', ownerFull: 'Alex Lin', total, since: '2021-01-09', until: iso(UNTIL), signature: sig.title, dominance, shelf, favorites: favScreen.map((s) => s.id), counts, timeline, moments, years, now: nowObj,
};

const owner = {
  name: '阿明',
  alias: 'Ming',
  share: { posterSwap: {} as Record<string, string> },
  favorites: { screen: favScreen.map((s) => s.title), gigs },
};

// ───────── 寫檔 ─────────
const profilePath = join(DATA_DIR, 'profile.json');
if (existsSync(profilePath) && !FORCE) {
  const old = readFileSync(profilePath, 'utf8');
  if (!old.includes('media/sample-')) {
    console.error(`${profilePath} 看起來是真實資料（不含 sample- 圖片路徑），不覆蓋。確定要蓋掉請加 --force。`);
    process.exit(1);
  }
}
// 清掉上一輪的範例圖，避免殘留（只動 sample- 開頭的檔，不碰別的）
for (const dir of [MEDIA_DIR, SCREENING_MEDIA]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) if (f.startsWith('sample-')) rmSync(join(dir, f));
}
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(SCREENING_DIR, { recursive: true });
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
writeFileSync(profilePath, json(profile));
writeFileSync(join(DATA_DIR, 'chorus.json'), json(chorus));
writeFileSync(join(DATA_DIR, 'opener.json'), json(opener));
writeFileSync(join(DATA_DIR, 'owner.json'), json(owner));
writeFileSync(join(SCREENING_DIR, 'story.js'), '// 由 make-sample-data.ts 產生的虛構範例資料，不要手改\nwindow.STORY = ' + JSON.stringify(story) + ';\n');
await flushImages();

const uniqueTracks = trackById.size;
console.log(`範例資料寫入 ${ROOT}`);
console.log(`歌手 ${artists.length}、曲目 ${uniqueTracks}（排行 ${inRanges.size}、額外 ${extraTracks.length}）、片櫃 ${shelf.length} 部、時間軸 ${timeline.length} 個月、圖片 ${imageJobs.size} 張`);
