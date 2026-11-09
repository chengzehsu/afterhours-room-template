// 開場選片：對話結束後，滑鼠在 CD 牆上移動，光要跟著滑鼠底下那張走（業主 2026-11-09 抓到「光不會動、停在第一個」）
// 用法（先 build）：AUDIT_SINGLE_PROCESS=1 node scripts/opening-hover-check.mjs [dist 目錄，預設 dist]；不合格 exit 1
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const DIST = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '../dist'));
const shell = path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const b = await chromium.launch({ executablePath: fs.existsSync(shell) ? shell : undefined, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--single-process','--no-zygote'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const T = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.host !== 'room.test') return r.abort(); let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(DIST, p); return fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': T[path.extname(f)] ?? 'application/octet-stream' } }) : r.fulfill({ status: 404, body: '' }); });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
await pg.goto('https://room.test/'); await pg.waitForTimeout(4000);
const onb = await pg.evaluate(() => document.documentElement.classList.contains('onboarding'));
const skip = pg.locator('[data-onboard-skip]'); if (await skip.isVisible().catch(() => false)) await skip.click();
await pg.waitForFunction(() => document.documentElement.classList.contains('is-choosing'), null, { timeout: 30000 }).catch(() => {});
await pg.waitForTimeout(3000);
const state = () => pg.evaluate(() => { const c = document.querySelector('#room'); return { lit: c?.dataset.lit, choosing: document.documentElement.classList.contains('is-choosing'), onb: (() => { const o = document.querySelector('[data-onboard]'); return o ? { hidden: o.hidden, display: getComputedStyle(o).display, vis: getComputedStyle(o).visibility, op: getComputedStyle(o).opacity } : null; })() }; });
const seen = new Set();
console.log('onboarding shown', onb, JSON.stringify(await state()));
seen.add((await state()).lit);
for (const [x, y] of [[700, 300], [800, 350], [900, 400], [1000, 450], [1100, 300], [750, 500], [950, 250]]) {
  await pg.mouse.move(x, y, { steps: 4 }); await pg.waitForTimeout(700);
  const top = await pg.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${(e.className && typeof e.className === 'string' ? e.className : '').split(' ')[0]}` : null; }, [x, y]);
  const st = await state(); seen.add(st.lit);
  console.log(x, y, 'top=', top, st.lit);
}
console.log('errors', errs.slice(0, 3));
await b.close();
const ok = seen.size >= 3 && errs.length === 0;
console.log(ok ? `✓ 光跟著滑鼠換了 ${seen.size - 1} 次` : `✗ 滑鼠移過 7 個位置，光只停過 ${seen.size} 張（應該至少 3 張）${errs.length ? '；頁面錯誤 ' + errs.length : ''}`);
process.exit(ok ? 0 : 1);
