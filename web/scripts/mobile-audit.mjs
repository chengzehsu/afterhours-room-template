// 手機版版面稽核：不開連接埠，把 dist/ 直接餵給 headless Chromium，逐段捲動截圖並找出
//   OVERLAP 兩段文字互相疊住、COVER 文字被別的元素蓋住、OFFSCREEN 文字超出螢幕左右、UNDER-BAR 內容捲進沒底色的頂列、
//   UNDER-BAR-END 捲到最底（文字已停住）還有文字高過頂列下緣或被切出畫面上緣
// 用法（先 npm run build）：node scripts/mobile-audit.mjs [輸出資料夾]；有任何問題 exit 1
// 尺寸：預設兩種手機；AUDIT_PRESET=rwd 跑常見 RWD 尺寸（npm run audit:rwd）；AUDIT_SIZES="1280x720,768x1024t" 自訂（t＝觸控）
// 沙盒裡要加 AUDIT_SINGLE_PROCESS=1（單一行程模式）才起得來
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// AUDIT_DIST：讀另一個建置目錄（多個人同時建置、稽核時各用各的，不互相覆蓋 dist/）
const DIST = path.resolve(process.env.AUDIT_DIST ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist'));
const OUT = path.resolve(process.argv[2] ?? path.join(process.env.TMPDIR ?? '/tmp', 'mobile-audit'));
const PAGES = process.env.AUDIT_PAGES ? process.env.AUDIT_PAGES.split(',') : ['/', '/screening/'];
// 常見 RWD 尺寸（CSS px）：手機、平板直／橫、筆電、桌機。t＝觸控裝置（用 tap、isMobile）
const RWD = ['360x800t', '375x667t', '390x844t', '412x915t', '430x932t', '768x1024t', '820x1180t', '1024x768t', '1280x720', '1280x800', '1366x768', '1440x900', '1536x864', '1920x1080', '2560x1440'];
const parseSize = (s) => { const touch = s.endsWith('t'); const [w, h] = s.replace(/t$/, '').split('x').map(Number); return [w, h, touch]; };
const SIZES = (process.env.AUDIT_SIZES ? process.env.AUDIT_SIZES.split(',') : process.env.AUDIT_PRESET === 'rwd' ? RWD : ['390x844t', '375x667t']).map(parseSize);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.ktx2': 'image/ktx2', '.mp4': 'video/mp4', '.webm': 'video/webm' };

// 捲到最底：文字都停住了，不該有任何文字高過頂列下緣（或被切出畫面上緣）。捲到一半時文字滑過有底色的頂列是正常的，所以只在這裡查
function endTop() {
  const bar = document.querySelector('.bar');
  const limit = bar ? bar.getBoundingClientRect().bottom : 0;
  const out = [];
  for (const e of document.querySelectorAll('main *, footer *')) {
    if (e.closest('canvas,iframe,svg,.sr-only,[aria-hidden="true"]')) continue;
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    let hidden = false;
    for (let a = e; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) { hidden = true; break; } }
    if (hidden) continue;
    const r = e.getBoundingClientRect();
    if (r.height < 3 || r.bottom <= 0) continue;
    if (r.top < limit - 2) out.push(`UNDER-BAR-END ${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0] : ''} "${e.textContent.trim().replace(/\s+/g, ' ').slice(0, 20)}" 上緣 ${Math.round(r.top)} < 頂列 ${Math.round(limit)}`);
  }
  return out;
}

function audit() {
  const W = innerWidth, H = innerHeight;
  const clipRect = (e) => {
    let r = e.getBoundingClientRect();
    let box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/(hidden|clip|auto|scroll)/.test(s.overflow + s.overflowX + s.overflowY) || s.clip !== 'auto') {
        const q = a.getBoundingClientRect();
        box = { l: Math.max(box.l, q.left), t: Math.max(box.t, q.top), r: Math.min(box.r, q.right), b: Math.min(box.b, q.bottom) };
      }
    }
    return box;
  };
  const shown = (e) => {
    for (let a = e; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
    }
    const r = e.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return false;
    const c = clipRect(e);
    const area = Math.max(0, c.r - c.l) * Math.max(0, c.b - c.t);
    return area > 0.5 * r.width * r.height && c.b > 0 && c.t < H;
  };
  const name = (e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : ''} "${e.textContent.trim().replace(/\s+/g, ' ').slice(0, 20)}"`;
  const texts = [...document.querySelectorAll('body *')].filter(
    (e) => !e.closest('canvas,iframe,svg,.sr-only,[aria-hidden="true"] .roll__strip') && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && shown(e),
  );
  const bar = document.querySelector('.bar');
  const barScrim = bar && (getComputedStyle(bar).backgroundColor !== 'rgba(0, 0, 0, 0)' || getComputedStyle(bar, '::before').content !== 'none');
  const inBar = (e) => bar && bar.contains(e);
  const out = [];
  for (const e of texts) {
    const r = e.getBoundingClientRect();
    for (const [x, y] of [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 3, r.top + r.height / 2], [r.right - 3, r.top + r.height / 2]]) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const t = document.elementFromPoint(x, y);
      if (!t || t === e || e.contains(t) || t.contains(e) || t.tagName === 'CANVAS') continue;
      if (inBar(t) && barScrim) continue;
      if (getComputedStyle(t).pointerEvents === 'none') continue;
      const bg = getComputedStyle(t).backgroundColor;
      if ([...t.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || bg !== 'rgba(0, 0, 0, 0)') { out.push(`COVER ${name(e)} 被 ${name(t)}`); break; }
    }
  }
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.contains(b) || b.contains(a)) continue;
      if ((inBar(a) || inBar(b)) && barScrim && !(inBar(a) && inBar(b))) continue;
      // 同一個旋轉容器裡（例如榜單 .chart 的 rotate(-1deg)）：用沒旋轉的版面座標比，不然外框會多出 寬×sinθ，被當成疊字
      const rot = (e) => { for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { const t = getComputedStyle(x).transform; if (t && t !== 'none') { const m = new DOMMatrix(t); if (Math.abs(m.b) > 1e-4) return x; } } return null; };
      const local = (e, root) => { let l = 0, t = 0; for (let x = e; x && x !== root; x = x.offsetParent) { l += x.offsetLeft; t += x.offsetTop; if (!x.offsetParent || !root.contains(x.offsetParent) && x.offsetParent !== root) break; } return { left: l, top: t, right: l + e.offsetWidth, bottom: t + e.offsetHeight }; };
      const ra = rot(a), rb = rot(b);
      const same = ra && ra === rb;
      const p = same ? local(a, ra) : a.getBoundingClientRect(), q = same ? local(b, ra) : b.getBoundingClientRect();
      const ox = Math.min(p.right, q.right) - Math.max(p.left, q.left), oy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      if (ox > 6 && oy > 6) out.push(`${(inBar(a) || inBar(b)) ? 'UNDER-BAR' : 'OVERLAP'} ${name(a)} × ${name(b)} ${Math.round(ox)}×${Math.round(oy)}`);
    }
  // 左右滑的捲動列（拍立得那排）本來就會切到畫面外，不算爆版
  const inHScroller = (e) => { for (let a = e.parentElement; a; a = a.parentElement) if (/(auto|scroll)/.test(getComputedStyle(a).overflowX) && a.scrollWidth > a.clientWidth) return true; return false; };
  for (const e of texts) {
    const r = e.getBoundingClientRect();
    if (inHScroller(e)) continue;
    if (r.right > W + 1 || r.left < -1) out.push(`OFFSCREEN ${name(e)} ${Math.round(r.left)}→${Math.round(r.right)}`);
  }
  // 被截斷到剩不到四成（例如名字只剩兩個字＋…）
  for (const e of texts) {
    if (e.scrollWidth > 0 && e.clientWidth > 0 && e.clientWidth < e.scrollWidth * 0.4 && getComputedStyle(e).textOverflow === 'ellipsis') out.push(`TRUNCATED ${name(e)} 寬 ${e.clientWidth}/${e.scrollWidth}`);
  }
  if (document.documentElement.scrollWidth > W + 1) out.push(`HSCROLL scrollWidth ${document.documentElement.scrollWidth} > ${W}`);
  return [...new Set(out)];
}

// 用 Playwright 裝好的 headless shell；版本對不上時用 CHROMIUM_PATH 指定
const shell = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const launch = () => chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? (fs.existsSync(shell) ? shell : undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  // Claude Code 沙盒不准註冊 mach port，多行程起不來；單一行程可以
  ...(process.env.AUDIT_SINGLE_PROCESS ? ['--single-process', '--no-zygote'] : [])] });
let problems = 0;
for (const [w, h, touch] of SIZES)
  for (const pagePath of PAGES) {
    const tag = `${pagePath === '/' ? 'home' : pagePath.replace(/\W+/g, '')}-${w}x${h}`;
    const dir = path.join(OUT, tag);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const browser = await launch(); // 單一行程模式一個瀏覽器只能開一個環境，每頁各開一次
    const desk = !touch;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !desk, hasTouch: !desk });
    const press = (loc) => (desk ? loc.click() : loc.tap());
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.host !== 'room.test') return route.abort(); // 外部（Spotify、lrclib、字型）一律不連
      let p = decodeURIComponent(u.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(DIST, p);
      if (!f.startsWith(DIST) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' } });
    });
    const pg = await ctx.newPage();
    const errors = [];
    const lines = [];
    pg.on('pageerror', (e) => errors.push(String(e)));
    try {
    await pg.goto(`https://room.test${pagePath}`, { waitUntil: 'load' });
    await pg.waitForTimeout(4000);
    // 播放室首頁的新手引導（taste-room:onboarded 沒記過就會出現）蓋在開場上，會擋住「直接進房間」：先當第一眼檢查一次，再按它自己的「略過」關掉
    const onboard = pg.locator('[data-onboard]');
    if (await onboard.isVisible().catch(() => false)) {
      await pg.screenshot({ path: path.join(dir, 'onboard.jpg'), type: 'jpeg', quality: 55 });
      for (const l of await pg.evaluate(audit)) lines.push(`onboard.jpg ${l}`);
      await press(pg.locator('[data-onboard-skip]'));
      await pg.waitForFunction(() => !document.querySelector('[data-onboard]') || getComputedStyle(document.querySelector('[data-onboard]')).display === 'none' || !document.querySelector('[data-onboard]').offsetParent, null, { timeout: 15000 }).catch(() => lines.push('ONBOARD 按「略過」後引導層沒有消失'));
      await pg.waitForTimeout(800);
    }
    const skip = pg.locator('.opening-skip');
    if (await skip.isVisible().catch(() => false)) {
      // 開場畫面（還沒點）是訪客第一眼看到的，先查一次再按掉
      await pg.screenshot({ path: path.join(dir, 'opening.jpg'), type: 'jpeg', quality: 55 });
      for (const l of await pg.evaluate(audit)) lines.push(`opening.jpg ${l}`);
      await press(skip);
      await pg.waitForTimeout(3000);
    }
    const total = await pg.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0, i = 0; y < total; y += Math.round(h * 0.8), i++) {
      await pg.evaluate((y) => window.scrollTo(0, y), y);
      await pg.waitForTimeout(600);
      const shot = `s${String(i).padStart(2, '0')}.jpg`;
      await pg.screenshot({ path: path.join(dir, shot), type: 'jpeg', quality: 55 });
      for (const l of await pg.evaluate(audit)) lines.push(`${shot} y=${y} ${l}`);
    }
    // 捲到最底（逐段的步距不一定剛好停在底）：頁尾會把最後一段的文字往上推，最容易鑽進頂列
    await pg.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await pg.waitForTimeout(900);
    await pg.screenshot({ path: path.join(dir, 'end.jpg'), type: 'jpeg', quality: 55 });
    for (const l of await pg.evaluate(audit)) lines.push(`end.jpg ${l}`);
    for (const l of await pg.evaluate(endTop)) lines.push(`end.jpg ${l}`);
    if (pagePath === '/') {
      // CD 牆：「下一張」一次只能換一張
      await pg.evaluate(() => { const el = document.querySelector('#shelf'); window.scrollTo(0, el.getBoundingClientRect().top + scrollY); });
      await pg.waitForTimeout(900);
      const idx = () => pg.evaluate(() => Number(document.querySelector('[data-scrub-i]')?.textContent));
      const next = pg.locator('[data-shelf-step="1"]');
      if (desk) { /* 桌機用滑鼠指，不檢查觸控用的「下一張」 */ }
      else if (!(await next.isVisible().catch(() => false))) lines.push('SHELF 觸控裝置看不到「下一張」');
      else {
        const a = await idx();
        for (let k = 0; k < 2; k++) { await press(next); await pg.waitForTimeout(1200); }
        const b = await idx();
        await pg.screenshot({ path: path.join(dir, 'shelf-next.jpg'), type: 'jpeg', quality: 55 });
        if (b - a !== 2) lines.push(`SHELF 按兩次「下一張」從第 ${a} 張到第 ${b} 張（應該 +2）`);
        else console.log(`   CD 牆「下一張」×2：第 ${a} → ${b} 張 ✓`);
      }
    }
    if (pagePath === '/screening/') {
      // 選片預覽面板：手上那片 DVD 在畫面上半，面板（含劇情簡介）不能長到蓋住它。上限＝畫面高的 52%，簡介預設最多 3 行（展開後在面板內捲動，不再長高）
      await pg.evaluate(() => { const el = document.querySelector('#shelf'); window.scrollTo(0, el.getBoundingClientRect().top + scrollY); });
      await pg.waitForTimeout(900);
      const item = pg.locator('.strip__item').first();
      // 只查手機模式（screening/main.js 的 isPhone：寬高比 < 0.9）：桌機與橫式平板沒有海報條，面板也是另一套版面
      const phoneMode = await pg.evaluate(() => innerWidth / innerHeight < 0.9);
      if (!phoneMode) { /* 非手機版面：PANEL 規則不適用 */ }
      else if (!(await item.isVisible().catch(() => false))) lines.push('PANEL 手機看不到海報條，點不了片');
      else {
        // 先挑海報條第一部（最愛第一部）；再挑海報條裡簡介最長的，量最壞情況
        const ids = await pg.evaluate(() => { const S = window.STORY; const longest = [...document.querySelectorAll('.strip__item')].map((b) => Number(b.dataset.i)).sort((x, y) => (S.shelf[y].overview?.length ?? 0) - (S.shelf[x].overview?.length ?? 0))[0]; return [Number(document.querySelector('.strip__item')?.dataset.i), longest]; });
        for (const [k, i] of ids.entries()) {
          if (k > 0) {
            // 上一部放回去：等狀態（離開 in-hand），不用固定秒數
            await pg.evaluate(() => document.querySelector('[data-back]')?.click());
            await pg.waitForFunction(() => !document.documentElement.classList.contains('in-hand'), null, { timeout: 60000 }).catch(() => lines.push('PANEL 放回去後一直還在 in-hand 狀態'));
            await pg.waitForTimeout(300);
          }
          // 第一次拿起會編譯 DVD 的材質（clearcoat），沙盒的模擬 GPU 可能要好幾秒：等「in-hand 且面板亮起」這個狀態，不是固定時間
          const t0 = Date.now();
          if (k > 0) await pg.evaluate((i) => document.querySelector(`.strip__item[data-i="${i}"]`)?.click(), i);
          else await press(item);
          const ready = await pg.waitForFunction(() => document.documentElement.classList.contains('in-hand') && document.querySelector('[data-panel]').classList.contains('on'), null, { timeout: 60000 }).then(() => true, () => false);
          const took = Date.now() - t0;
          await pg.waitForTimeout(500);  // 面板淡入 0.35s
          const m = await pg.evaluate(() => { const p = document.querySelector('[data-panel]'), r = p.getBoundingClientRect(), t = document.querySelector('[data-p-syn-text]'); return { on: p.classList.contains('on'), top: r.top, h: r.height, vh: innerHeight, syn: !document.querySelector('[data-p-syn]').hidden, clamp: getComputedStyle(t).webkitLineClamp, more: !document.querySelector('[data-p-syn-more]').hidden, bottom: r.bottom, scrollW: document.documentElement.scrollWidth }; });
          const shot = `panel-${k}.jpg`;
          await pg.screenshot({ path: path.join(dir, shot), type: 'jpeg', quality: 55 });
          console.log(`   預覽面板 #${i}（點下去到面板亮 ${ready ? took + 'ms' : '逾時 60s'}）：高 ${Math.round(m.h)}px（畫面 ${m.vh}px 的 ${Math.round((m.h / m.vh) * 100)}%）簡介 ${m.syn ? '有' : '無'} clamp ${m.clamp} 展開鈕 ${m.more ? '有' : '無'}`);
          if (!m.on) lines.push(`PANEL ${shot} 挑了片但面板沒出現`);
          else if (m.h > m.vh * 0.52) lines.push(`PANEL ${shot} 預覽面板高 ${Math.round(m.h)}px，超過畫面 ${m.vh}px 的 52%（會蓋到手上的 DVD）`);
          if (m.bottom > m.vh + 1) lines.push(`PANEL ${shot} 面板底部 ${Math.round(m.bottom)}px 超出畫面`);
          if (m.syn && m.clamp !== '3') lines.push(`PANEL ${shot} 手機簡介預設應該收成 3 行，實際 ${m.clamp}`);
        }
      }
    }
    } catch (e) {
      lines.push(`CRASH ${String(e.message ?? e).split('\n')[0]}`);  // 這頁壞了不要整支腳本中止，其他頁與寬度照跑
    }
    if (errors.length) lines.push(...errors.map((e) => `PAGEERROR ${e}`));
    fs.writeFileSync(path.join(dir, 'findings.txt'), lines.join('\n') + '\n');
    console.log(`${lines.length ? '✗' : '✓'} ${tag}  ${lines.length} 項  ${dir}`);
    for (const l of lines.slice(0, 40)) console.log('   ' + l);
    problems += lines.length;
    await browser.close().catch(() => {});
  }
process.exit(problems ? 1 : 0);
