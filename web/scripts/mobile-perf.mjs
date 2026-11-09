// 手機順暢度與觸控行為：CPU 降速 4 倍、用 Chrome 的觸控捲動手勢（跟手指滑一樣會觸發 touchmove／pointercancel）
//   1. 載入與開場：最長的長任務
//   2. 從頭滑到底：滑動期間的長任務、有沒有卡住（捲動位置不動）
//   3. CD 牆：手指點一下牆、再滑，發光的那張要跟字幕同一張（之前卡在手指按過的那張）
//   4. 點「下一張」到序號換掉要多久
// 用法：npm run build 後 AUDIT_SINGLE_PROCESS=1 node scripts/mobile-perf.mjs；不合格 exit 1
// 注意：沙盒裡 WebGL 用 CPU 模擬（swiftshader），畫面格率比真手機差很多，所以只看長任務與反應時間，不看 fps
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2' };
const shell = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const [W, H] = [390, 844];
const fails = [];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? (fs.existsSync(shell) ? shell : undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.AUDIT_SINGLE_PROCESS ? ['--single-process', '--no-zygote'] : [])] });
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await ctx.route('**/*', (r) => {
  const u = new URL(r.request().url());
  if (u.host !== 'room.test') return r.abort();
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
  return r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' } });
});
const pg = await ctx.newPage();
const cdp = await ctx.newCDPSession(pg);
const RATE = Number(process.env.CPU_RATE ?? 4);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
const errors = [];
pg.on('pageerror', (e) => errors.push(String(e)));
await pg.addInitScript(() => {
  window.__lt = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true });
});
const lt = (from) => pg.evaluate((from) => window.__lt.filter((e) => e.at >= from), from);
const now = () => pg.evaluate(() => performance.now());
const swipe = (dy, speed = 1600) => cdp.send('Input.synthesizeScrollGesture', { x: W / 2, y: H * 0.6, yDistance: -dy, speed, gestureSourceType: 'touch', repeatCount: 1 });

// 1. 載入與開場
await pg.goto('https://room.test/', { waitUntil: 'load' });
await pg.waitForTimeout(6000);
const load = await lt(0);
const loadMax = Math.max(0, ...load.map((e) => e.ms));
console.log(`載入＋開場：長任務 ${load.length} 次，最長 ${loadMax}ms（CPU 降速 ${RATE} 倍）`, JSON.stringify(load));

// 2. 手指往下滑：第一下就要跳過開場，之後一路滑到底，每一下捲動位置都要有動
let t0 = await now();
const y0 = await pg.evaluate(() => scrollY);
await swipe(500);
await pg.waitForTimeout(1500);
const intro = await pg.evaluate(() => ({ y: scrollY, running: document.documentElement.classList.contains('intro-running'), skipped: document.documentElement.classList.contains('intro-skipped') }));
console.log(`第一下滑動：scrollY ${y0}→${intro.y}，開場${intro.running ? '還在跑' : '結束'}${intro.skipped ? '（已跳過、字幕收起）' : ''}`);
if (!intro.skipped && intro.running) fails.push('第一下滑動沒有跳過開場');
const total = await pg.evaluate(() => document.documentElement.scrollHeight - innerHeight);
let stuck = 0, swipes = 0;
for (let last = -1; swipes < 80; swipes++) {
  const y = await pg.evaluate(() => scrollY);
  if (y >= total - 2) break;
  if (y === last) { if (++stuck >= 3) { fails.push(`滑到 ${y}px 卡住，連續 3 下捲不動`); break; } } else stuck = 0;
  last = y;
  await swipe(700);
  await pg.waitForTimeout(250);
}
const scrollLt = await lt(t0);
const scrollMax = Math.max(0, ...scrollLt.map((e) => e.ms));
console.log(`一路滑到底：${swipes} 下、到 ${await pg.evaluate(() => scrollY)}/${total}px，滑動中長任務 ${scrollLt.length} 次，最長 ${scrollMax}ms`);

// 3. CD 牆：手指點一下牆上某張，要選起來（字幕換成那張、發光那張就是字幕那張），不能直接開播
const shelfTop = await pg.evaluate(() => document.querySelector('#shelf').getBoundingClientRect().top + scrollY);
await pg.evaluate((y) => scrollTo(0, y), shelfTop);
await pg.waitForTimeout(1500);
const read = () => pg.evaluate(() => ({ lit: document.querySelector('canvas')?.dataset.lit ?? '', cap: document.querySelector('.shelf__pick')?.dataset.play ?? '', i: document.querySelector('[data-scrub-i]')?.textContent, song: document.querySelector('[data-scrub-name]')?.textContent }));
const before = await read();
// 找一張不是目前選中的 CD 來點：在牆的範圍內掃，點到字幕換掉為止
let tapped = before;
for (const [fx, fy] of [[0.3, 0.42], [0.6, 0.42], [0.3, 0.5], [0.7, 0.36], [0.45, 0.46]]) {
  await pg.touchscreen.tap(W * fx, H * fy);
  await pg.waitForTimeout(700);
  tapped = await read();
  if (tapped.cap !== before.cap) break;
}
console.log(`CD 牆：原本 第${before.i}張 ${before.song}；手指點一張 → 第${tapped.i}張 ${tapped.song}，發光 ${tapped.lit === tapped.cap ? '= 字幕 ✓' : '≠ 字幕 ✗'}`);
if (tapped.cap === before.cap) fails.push('CD 牆點了牆上的 CD，字幕沒換（點不到或沒選起來）');
if (tapped.lit !== tapped.cap) fails.push(`CD 牆點選後發光 ${tapped.lit} 跟字幕 ${tapped.cap} 不同張`);
const playingAfterTap = await pg.evaluate(() => document.querySelector('.shelf__pick')?.classList.contains('is-on'));
if (playingAfterTap) fails.push('手機點一下 CD 就開播了（應該先選）');

// 4. 「下一張」反應時間
const ia = Number((await read()).i);
const tTap = Date.now();
await pg.locator('[data-shelf-step="1"]').tap();
let ib = ia;
while (Date.now() - tTap < 3000 && ib === ia) { await pg.waitForTimeout(16); ib = Number((await read()).i); }
const stepMs = Date.now() - tTap;
await pg.waitForTimeout(1200);
const settled = await read();
console.log(`「下一張」：第${ia}→${ib}張，${stepMs}ms 開始換；停下來時發光 ${settled.lit === settled.cap ? '= 字幕 ✓' : '≠ 字幕 ✗'}`);
if (ib !== ia + 1) fails.push(`「下一張」從 ${ia} 到 ${ib}`);
if (stepMs > 1000) fails.push(`「下一張」${stepMs}ms 才有反應`);
if (settled.lit !== settled.cap) fails.push('「下一張」停下來時發光跟字幕不同張');

// 長任務門檻：CPU 降速 4 倍下，載入 > 2 秒、滑動中 > 1 秒算卡死
// 沙盒的 swiftshader 不支援 KHR_parallel_shader_compile，shader 全在主執行緒同步編（profile 證實 3 秒幾乎都在 linkProgram），
// 真手機的 Chrome／Safari 都支援；這時載入長任務只列出來、不判定
const parallel = await pg.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')?.getExtension('KHR_parallel_shader_compile')));
if (!parallel) console.log(`（這個瀏覽器不支援平行編譯 shader，載入的 ${loadMax}ms 是同步編 shader，不代表真手機；載入要看真手機）`);
else if (loadMax > 2000) fails.push(`載入有 ${loadMax}ms 的長任務`);
if (scrollMax > 1000) fails.push(`滑動中有 ${scrollMax}ms 的長任務`);
if (errors.length) fails.push(...errors.map((e) => `頁面錯誤 ${e}`));
await b.close();

// 5. 桌機：滑鼠指到 CD，字幕換成那張；移去按「放上唱盤」，選的那張不能跳掉
{
  const b2 = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? (fs.existsSync(shell) ? shell : undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.AUDIT_SINGLE_PROCESS ? ['--single-process', '--no-zygote'] : [])] });
  const c2 = await b2.newContext({ viewport: { width: 1440, height: 900 } });
  await c2.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.host !== 'room.test') return r.abort();
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(DIST, p);
    if (!f.startsWith(DIST) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' } });
  });
  const d = await c2.newPage();
  await d.goto('https://room.test/', { waitUntil: 'load' });
  await d.waitForTimeout(5000);
  if (await d.locator('.opening-skip').isVisible().catch(() => false)) { await d.locator('.opening-skip').click(); await d.waitForTimeout(2500); }
  await d.evaluate(() => scrollTo(0, document.querySelector('#shelf').getBoundingClientRect().top + scrollY));
  await d.waitForTimeout(1800);
  const rd = () => d.evaluate(() => ({ lit: document.querySelector('canvas')?.dataset.lit ?? '', cap: document.querySelector('.shelf__pick')?.dataset.play ?? '', song: document.querySelector('[data-scrub-name]')?.textContent }));
  const first = await rd();
  const seen = new Set([first.cap]);
  let ok = 0, bad = 0, last = first;
  for (const [fx, fy] of [[0.55, 0.3], [0.65, 0.4], [0.75, 0.5], [0.6, 0.55], [0.85, 0.35], [0.7, 0.62]]) {
    await d.mouse.move(1440 * fx, 900 * fy, { steps: 4 });
    await d.waitForTimeout(500);
    const r = await rd();
    if (r.lit && r.lit === r.cap) ok++; else if (r.lit) bad++;
    seen.add(r.cap);
    last = r;
  }
  const pickBox = await d.locator('.shelf__pick').boundingBox();
  await d.mouse.move(pickBox.x + pickBox.width / 2, pickBox.y + pickBox.height / 2, { steps: 6 });
  await d.waitForTimeout(500);
  const onBtn = await rd();
  console.log(`桌機 CD 牆：滑鼠走過 6 點，字幕換了 ${seen.size - 1} 次，發光=字幕 ${ok} 次、不一致 ${bad} 次；移到「放上唱盤」時仍是 ${onBtn.song}${onBtn.cap === last.cap ? ' ✓' : ' ✗（跳掉了）'}`);
  if (seen.size < 3) fails.push('桌機滑鼠指著 CD，字幕沒有跟著換');
  if (bad) fails.push(`桌機滑鼠指著時發光跟字幕不一致 ${bad} 次`);
  if (onBtn.cap !== last.cap) fails.push('桌機移去按「放上唱盤」時選的那張跳掉了');
  await b2.close();
}
console.log(fails.length ? `✗ ${fails.length} 項\n  ${fails.join('\n  ')}` : '✓ 全部通過');
process.exit(fails.length ? 1 : 0);
