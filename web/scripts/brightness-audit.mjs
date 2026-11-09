// 亮度稽核：每頁、每個 data-cam 鏡頭、每個時段（播放室另加「放歌中」），桌機 1440×900 與手機 390×844 各截一張，
// 量「任一通道 ≥ 250」與「亮度 ≥ 0.95」的像素比例，把過曝區塊（32px 網格的連通區）投影回場景，回報打到哪個 mesh、什麼材質。
// 不開連接埠：先用 development 模式另建一份到 $TMPDIR/brightness-dist（才有 window.__room 這類 DEV 掛鉤），再由 Playwright 攔請求直接餵檔。
// 用法（在 web/ 底下）：AUDIT_SINGLE_PROCESS=1 node scripts/brightness-audit.mjs [--no-build] [--only=home|screening] [--sizes=1440x900,390x844]
//   輸出：$TMPDIR/brightness-audit/（<頁>-<寬>/<鏡頭>-<時段>.png 只有 3D 畫布、.jpg 含網頁文字；report.json、report.txt）
//   判定（任一成立就 exit 1）：
//     1. 任一張「通道 ≥ 250」的像素比例 > 0.5%
//     2. 任一過曝區塊的取樣點，射線第一個打到的不是白名單光源（牆、海報、紙卡、照片、CD 封面、文字牌都算違規）
// 量的是畫布本身（DOM 文字、蓋板先藏起來再截），不含網頁上疊的漸層；swiftshader 是 CPU 模擬，顏色與真機 GPU 可能差 1–2 階。
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = process.env.TMPDIR ?? '/tmp';
const DIST = path.join(TMP, 'brightness-dist');
const OUT = path.join(TMP, 'brightness-audit');
const THREE_DIR = path.join(WEB, 'node_modules/three/build');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const SIZES = (arg('sizes') ?? '1440x900,390x844').split(',').map((s) => s.split('x').map(Number));
const ONLY = arg('only');
const CAMS_ONLY = arg('cams')?.split(','); // 只跑這些鏡頭（試跑用）
const MOODS = arg('moods')?.split(',') ?? ['afternoon', 'tipsy', 'night'];
const HOT = 250; // 任一通道 ≥ 250 算「打到頂」
const LUM = 0.95;
const MAX_HOT_RATIO = 0.005;
const CELL = 32;
const CELL_MIN = 8; // 一格 32×32 裡至少 8 個打到頂的像素才算過曝格（避免單一亮點雜訊）

/**
 * 白名單：真正的光源，畫面打到頂是應該的。用 labelOf() 產生的元件名稱比對，請業主確認。
 * 播放室：跑馬燈燈泡、落地燈罩、ON AIR 字、管機燈絲與燈絲光點（sprite）、VU 表面板、燈串與燭火（sparkle）
 * 只涵蓋射線打到「燈本體」的像素；本體外圈的泛光落在牆、格柵、燈箱上，射線打到的是那些表面，照非光源判定
 * 放映室：跑馬燈燈泡、燈罩（GLB 的 lamp_shade）、投影銀幕 screen_surface（播放中）、投影機鏡頭 lens_glow、投影光束
 */
const WHITELIST = {
  home: [/^bulbs\b/, /^lamp-shade/, /^stage\.onAir/, /^stage\.amp\.(filament|glow)/, /^stage\.vu/, /^sparkle\./],
  screening: [/^marquee-bulbs/, /^lamp_shade/, /^screen_surface/, /^lens_glow/, /^projector-beam/],
};
const isLight = (page, label) => WHITELIST[page].some((re) => re.test(label));
/** 管機的子物件沒有欄位名稱，用材質分：燈絲（MeshBasic、不做色調對應）、暈光（Sprite）、玻璃管（半透明） */
function canon(label, mat) {
  if (!label.startsWith('stage.amp.root/')) return label;
  if (mat?.type === 'SpriteMaterial') return 'stage.amp.glow 燈絲暈光';
  if (mat?.type === 'MeshBasicMaterial' && mat.toneMapped === false) return 'stage.amp.filament 燈絲';
  if (mat?.transparent && mat.opacity < 0.5 && /Cylinder|Sphere/.test(label)) return 'stage.amp.glass 玻璃管';
  return label;
}
const seeThrough = (mat) => mat && (mat.blending === 'Additive' || (mat.transparent && mat.opacity < 0.95));
/**
 * 判定一張圖：每個過曝區塊的取樣點，看射線第一個打到的元件；第一個是半透明（玻璃管、加法光暈）就往後看，
 * 後面三層內有白名單光源就算光源（例如透過玻璃管看到燈絲）。非光源就記一筆違規。
 */
function judge(shot) {
  const violations = [];
  for (const reg of shot.regions) {
    reg.labels = {};
    for (const r of reg.rays ?? []) {
      const hits = (r.hits ?? []).map((h) => ({ ...h, label: canon(h.label, h.mat) }));
      const first = hits[0];
      const label = first?.label ?? '(背景／沒打到 mesh)';
      reg.labels[label] = (reg.labels[label] ?? 0) + 1;
      if (!first || isLight(shot.page, label)) continue;
      if (seeThrough(first.mat) && hits.slice(1).some((h) => isLight(shot.page, h.label))) continue;
      violations.push({ label, px: [r.x, r.y], world: first.at, mat: first.mat, texel: first.texel, behind: hits.slice(1).map((h) => h.label) });
    }
  }
  shot.violations = violations;
  shot.fail = shot.hotRatio > MAX_HOT_RATIO * 100 || violations.length > 0;
  return shot;
}
const REJUDGE = process.argv.includes('--rejudge'); // 只用上一輪的 report.json 重新判定（調白名單用），不重拍

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.ktx2': 'image/ktx2', '.mp4': 'video/mp4', '.webm': 'video/webm' };

/* ---------- 1. 建一份 development 模式的 dist（import.meta.env.DEV = true，才有 __room 掛鉤） ---------- */
if (!REJUDGE && !process.argv.includes('--no-build')) {
  console.log(`建置 development 版到 ${DIST} …`);
  execFileSync('npx', ['vite', 'build', '--mode', 'development', '--outDir', DIST, '--emptyOutDir', '--logLevel', 'warn'], { cwd: WEB, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } });
}
if (!REJUDGE && !fs.existsSync(path.join(DIST, 'index.html'))) throw new Error(`找不到 ${DIST}/index.html`);
fs.mkdirSync(OUT, { recursive: true });

const shell = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const launch = () => chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? (fs.existsSync(shell) ? shell : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(process.env.AUDIT_SINGLE_PROCESS ? ['--single-process', '--no-zygote'] : [])],
});

async function openPage(browser, w, h, url) {
  const phone = w < h;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.host !== 'room.test') return route.abort(); // 外部（Spotify、lrclib、YouTube、字型）一律不連
    let p = decodeURIComponent(u.pathname);
    // 稽核自己要用的 three（射線用），跟頁面打包的是同一版
    const base = p.startsWith('/__audit/') ? THREE_DIR : DIST;
    if (p.startsWith('/__audit/')) p = p.slice('/__audit'.length);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(base, p);
    if (!f.startsWith(base) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' } });
  });
  const pg = await ctx.newPage();
  // swiftshader 單一行程在大畫面＋泛光時一格可能要好幾秒，預設 30 秒不夠
  pg.setDefaultTimeout(120000);
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await pg.goto(url, { waitUntil: 'load', timeout: 180000 });
  await pg.addStyleTag({ content: HIDE }); // 「只截畫布」用的樣式：沒有這行，截圖會連網頁文字、拍立得一起量進去
  return { pg, errors };
}

/* ---------- 頁面內：元件命名、材質參數、射線（evaluate 進去跑） ---------- */
function installProbe(page) {
  const W = window;
  const ctx = page === 'home' ? { scene: W.__room.scene, camera: W.__room.camera, owner: W.__room } : { scene: W.__room.scene, camera: W.__room.camera, owner: null };
  // 播放室：沿著 Room 實例的欄位（到第 4 層）把 Object3D 對到欄位路徑，例如 stage.onAir、bulbs、cdHalo、slots[].mesh
  const paths = new Map();
  if (ctx.owner) {
    const seen = new Set();
    const walk = (v, p, d) => {
      if (!v || typeof v !== 'object' || seen.has(v) || d > 4) return;
      seen.add(v);
      if (v.isObject3D) { if (v !== ctx.scene && !paths.has(v)) paths.set(v, p); if (p === 'scene' || p === 'fixed' || p === 'bakedRoot') return; }
      if (v.isMaterial || v.isTexture || v.isBufferGeometry || v.isCamera || v.isVector3 || v.isColor || v instanceof Node || ArrayBuffer.isView(v)) return;
      if (v instanceof Map || v instanceof WeakMap || v instanceof Set) return;
      const keys = Array.isArray(v) ? v.map((_, i) => i).slice(0, 400) : Object.keys(v);
      for (const k of keys) {
        if (v.isObject3D && (k === 'parent' || k === 'children')) continue;
        try { walk(v[k], Array.isArray(v) ? `${p}[]` : p ? `${p}.${k}` : k, d + 1); } catch {}
      }
    };
    walk(ctx.owner, '', 0);
  }
  const geo = (o) => {
    const g = o.geometry; if (!g) return '';
    const pr = g.parameters ? Object.entries(g.parameters).filter(([, x]) => typeof x === 'number').slice(0, 3).map(([, x]) => +x.toFixed(3)).join('x') : '';
    return `${g.type.replace('Geometry', '')}${pr ? '(' + pr + ')' : ''}`;
  };
  const mats = (o) => (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []);
  const heuristic = (o) => {
    const g = o.geometry?.parameters ?? {}, t = o.geometry?.type, m = mats(o)[0];
    if (page === 'home') {
      if (t === 'CylinderGeometry' && o.geometry.parameters.openEnded && g.radiusTop === 0.16) return 'lamp-shade 落地燈罩';
      if (t === 'PlaneGeometry' && g.width === 0.48 && g.height === 0.6) return 'frame-photo 右牆相框照片';
      if (t === 'BoxGeometry' && g.width === 0.31 && g.depth === 0.006) return 'crate-sleeve 唱片箱封套';
      if (t === 'PlaneGeometry' && g.width === 1 && g.height === 0.25) return 'cinema-sign 放映室招牌字';
      if (t === 'PlaneGeometry' && g.width === 0.16 && g.height === 0.1 && m?.toneMapped === false) return 'stage.vu VU 表面板';
    } else {
      if (o.isInstancedMesh && t === 'SphereGeometry') return 'marquee-bulbs 招牌燈泡';
      if (o.isInstancedMesh) return `dvd-shelf 片櫃 ${geo(o)}`;
      if (m?.blending === 2 && t === 'PlaneGeometry') return 'fav-halo 最愛燈箱後的牆面光暈';
      if (m?.blending === 2 && t === 'BufferGeometry') return 'projector-beam 投影光束';
      if (m?.type === 'MeshBasicMaterial' && t === 'BufferGeometry' && m.map && o.parent?.children.length > 6) return 'fav-face 最愛燈箱海報面';
      if (m?.type === 'MeshStandardMaterial' && o.parent?.children.length > 6 && t === 'BoxGeometry') return 'fav-frame 最愛燈箱金屬框';
    }
    return null;
  };
  const labelOf = (o) => {
    const own = o.name ? `:${o.name}` : '';
    for (let a = o; a; a = a.parent) {
      if (paths.has(a)) {
        const p = paths.get(a).replace(/\[\]\[\]/g, '[]');
        // 燈箱牆：同一群組裡用材質分辨
        if (p.startsWith('posterRig')) {
          const m = mats(o)[0];
          const part = m?.blending === 2 ? 'spill 背光溢光' : m?.transparent && m.color.getHex() === 0 ? 'shadow 接觸陰影' : m?.map && o.geometry?.parameters?.height < 0.12 ? 'plaque 說明卡' : m?.map ? 'face 燈箱畫面（白卡紙＋照片）' : 'frame 邊框';
          return `posterRig/${part}`;
        }
        if (p === 'bakedRoot' || p === 'fixed') return `${p}${own || ':' + geo(o)}`;
        if (a === o) return p + own;
        return `${heuristic(o) ?? p + '/' + (o.name || geo(o))}`; // 子物件：先看認不認得（VU 表面板、燈罩），不然用欄位路徑
      }
    }
    if (page === 'screening' && o.name) return o.name; // 放映室：GLB 物件有名字（lamp_shade、lens_glow…），直接用
    return heuristic(o) ?? `${o.type}${own}:${geo(o)}`;
  };
  const hex = (c) => (c ? `#${c.getHexString()}(${[c.r, c.g, c.b].map((x) => +x.toFixed(2)).join(',')})` : null);
  const BL = ['None', 'Normal', 'Additive', 'Subtractive', 'Multiply', 'Custom'];
  const matInfo = (m, o, instanceId) => {
    const i = { name: m.name || '', type: m.type, toneMapped: m.toneMapped, blending: BL[m.blending] ?? m.blending, opacity: +m.opacity.toFixed(3), transparent: m.transparent };
    if (m.color) i.color = hex(m.color);
    if (m.emissive && m.emissive.getHex()) { i.emissive = hex(m.emissive); i.emissiveIntensity = +m.emissiveIntensity.toFixed(3); }
    if (m.map) i.map = m.map.image?.currentSrc?.split('/').pop() || m.map.image?.src?.split('/').pop() || m.map.image?.constructor?.name || 'texture';
    if (m.uniforms) i.uniforms = Object.fromEntries(Object.entries(m.uniforms).flatMap(([k, u]) => typeof u.value === 'number' ? [[k, +u.value.toFixed(3)]] : u.value?.isColor ? [[k, hex(u.value)]] : u.value?.isTexture ? [[k, u.value.image?.src?.split('/').pop() ?? 'tex']] : []));
    if (o.isInstancedMesh && instanceId != null && o.instanceColor && m.color) { const tmp = m.color.clone(); o.getColorAt(instanceId, tmp); i.instanceColor = hex(tmp); }
    return i;
  };
  // 這個材質最多會輸出多亮（線性值，假設貼圖白色 = 1）：> 0.86 會被泛光抓到，> 1 直接截平
  const maxOut = (m, o) => {
    const mx = (c) => (c ? Math.max(c.r, c.g, c.b) : 0);
    if (m.uniforms?.dim) { const t = mx(m.uniforms.tint.value); const d = m.uniforms.dim.value; const ta = m.uniforms.tintAmt.value; return d * (1 - ta + ta * t * 1.6) + t * m.uniforms.flash.value * 0.06; }
    if (m.uniforms?.kN) return m.uniforms.kN.value + m.uniforms.kL.value + m.uniforms.kS.value * mx(m.uniforms.tint.value);
    let inst = 1;
    if (o.isInstancedMesh && o.instanceColor) { const a = o.instanceColor.array; inst = 0; for (let k = 0; k < a.length; k++) inst = Math.max(inst, a[k]); }
    if (m.type === 'MeshBasicMaterial' || m.type === 'SpriteMaterial') return mx(m.color) * inst * (m.transparent ? m.opacity : 1);
    if (m.type === 'ShaderMaterial' || m.type === 'PointsMaterial') return null;
    return m.emissive ? mx(m.emissive) * m.emissiveIntensity * (m.emissiveMap ? 1 : 1) : 0;
  };
  // 命中點的貼圖顏色（sRGB 0–1）與推算的最終線性輸出：看是貼圖本身就接近白、還是乘上去的係數把它推過 1
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const pix = document.createElement('canvas'); pix.width = pix.height = 1;
  const pg2 = pix.getContext('2d', { willReadFrequently: true });
  const sample = (tex, uv) => {
    const img = tex?.image;
    if (!img || !img.width) return null;
    const u = uv.clone(); tex.transformUv(u);
    if (W.__auditFlipV) u.y = 1 - u.y; // 校準用：反過來取樣，看哪個方向跟畫面對得上
    try { pg2.clearRect(0, 0, 1, 1); pg2.drawImage(img, Math.floor(u.x * img.width), Math.floor(u.y * img.height), 1, 1, 0, 0, 1, 1); } catch { return null; }
    const d = pg2.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255].map((v) => +v.toFixed(3));
  };
  const texel = (m, uv) => {
    const U = m.uniforms;
    const mx = (a) => Math.max(...a);
    if (U?.kN) {
      const n = sample(U.tN.value, uv), l = sample(U.tL.value, uv), s = sample(U.tS.value, uv);
      if (!n || !l || !s) return null;
      const t = U.tint.value;
      const out = [0, 1, 2].map((i) => lin(n[i]) * U.kN.value + lin(l[i]) * U.kL.value + lin(s[i]) * U.kS.value * [t.r, t.g, t.b][i]);
      return { night: n, lamp: l, screen: s, k: [U.kN.value, U.kL.value, +U.kS.value.toFixed(2)], predictedLinear: out.map((v) => +v.toFixed(2)), over1: mx(out) > 1 };
    }
    if (U?.mapB) {
      const b = sample(U.mapB.value, uv);
      if (!b) return null;
      const t = U.tint.value, ta = U.tintAmt.value, d = U.dim.value;
      const out = [0, 1, 2].map((i) => { const c = lin(b[i]) * d; return c * (1 - ta) + c * [t.r, t.g, t.b][i] * 1.6 * ta + [t.r, t.g, t.b][i] * U.flash.value * 0.06; });
      return { baked: b, dim: +d.toFixed(3), tintAmt: +ta.toFixed(3), predictedLinear: out.map((v) => +v.toFixed(2)), over1: mx(out) > 1 };
    }
    if (m.map) {
      const c = sample(m.map, uv);
      if (!c) return null;
      if (m.type !== 'MeshBasicMaterial') return { map: c };
      const out = [0, 1, 2].map((i) => lin(c[i]) * [m.color.r, m.color.g, m.color.b][i]);
      return { map: c, predictedLinear: out.map((v) => +v.toFixed(2)), over1: mx(out) > 1 };
    }
    return null;
  };
  const visible = (o) => { for (let a = o; a; a = a.parent) if (!a.visible) return false; return true; };
  W.__audit = {
    ctx,
    labelOf,
    async ray(points) {
      const THREE = (W.__auditThree ??= await import('/__audit/three.module.js'));
      const rc = new THREE.Raycaster();
      rc.camera = ctx.camera;
      rc.params.Points.threshold = 0.02;
      const rect = document.querySelector('#room').getBoundingClientRect();
      ctx.scene.updateMatrixWorld();
      return points.map(([x, y]) => {
        rc.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), ctx.camera);
        let hits = [];
        try { hits = rc.intersectObject(ctx.scene, true); } catch (e) { return { x, y, error: String(e).slice(0, 120) }; }
        hits = hits.filter((h) => visible(h.object) && mats(h.object).some((m) => m.visible !== false && m.colorWrite !== false && !(m.transparent && m.opacity < 0.01)));
        return {
          x, y,
          hits: hits.slice(0, 3).map((h) => {
            const ms = mats(h.object);
            const m = ms.length > 1 && h.face ? ms[h.face.materialIndex] ?? ms[0] : ms[0];
            const out = { label: labelOf(h.object), dist: +h.distance.toFixed(2), at: h.point.toArray().map((v) => +v.toFixed(2)), mat: matInfo(m, h.object, h.instanceId) };
            if (h.uv) out.texel = texel(m, h.uv);
            return out;
          }),
        };
      });
    },
    inventory() {
      const out = [];
      ctx.scene.traverse((o) => {
        if (!o.isMesh && !o.isSprite && !o.isPoints) return;
        for (const m of mats(o)) {
          const self = m.type === 'MeshBasicMaterial' || m.type === 'SpriteMaterial' || m.type === 'ShaderMaterial' || m.type === 'PointsMaterial' || m.blending === 2 || m.toneMapped === false || (m.emissive && m.emissive.getHex() && m.emissiveIntensity > 0);
          if (!self || m.colorWrite === false || m.visible === false) continue;
          const v = maxOut(m, o);
          out.push({ label: labelOf(o), uuid: m.uuid, visible: visible(o), max: v == null ? null : +v.toFixed(3), mat: matInfo(m, o) });
        }
      });
      return out;
    },
    // ON AIR 本體的四角投影（PlaneGeometry 0.5×0.16）、燈箱頂排的卡紙與畫面四角投影
    onAir() {
      const r = W.__room, cam = ctx.camera;
      const V = cam.position.constructor;
      cam.updateMatrixWorld(); ctx.scene.updateMatrixWorld();
      const rect = document.querySelector('#room').getBoundingClientRect();
      const proj = (o) => {
        const g = o.geometry.parameters, hw = g.width / 2, hh = g.height / 2;
        const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => { const v = new V(x, y, 0).applyMatrix4(o.matrixWorld); const d = v.clone().sub(cam.position); const front = d.dot(cam.getWorldDirection(new V())) > 0; v.project(cam); return front ? [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height] : null; });
        return pts.some((p) => !p) ? null : pts;
      };
      const on = r.stage?.onAir;
      const out = { color: on ? +on.material.color.r.toFixed(3) : null, state: document.documentElement.dataset.onair ?? null, quad: on && visible(on) ? proj(on) : null, widthM: 0.5, plaques: [], faces: [] };
      const rig = r.posterRig;
      if (rig) {
        const planes = [];
        rig.group.traverse((o) => { if (o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.material?.map && !o.material.transparent) planes.push(o); });
        const wy = (o) => o.getWorldPosition(new V()).y;
        const plaques = planes.filter((o) => o.geometry.parameters.height < 0.12), faces = planes.filter((o) => o.geometry.parameters.height >= 0.12);
        const topY = Math.max(...faces.map(wy));
        const topFaces = faces.filter((o) => wy(o) > topY - 0.05);
        // 頂排卡紙：在頂排畫面正下方的那幾張
        const topPlaques = plaques.filter((pl) => topFaces.some((f) => Math.abs(f.getWorldPosition(new V()).x - pl.getWorldPosition(new V()).x) < 0.05 && Math.abs(f.getWorldPosition(new V()).z - pl.getWorldPosition(new V()).z) < 0.05 && wy(pl) < wy(f) && wy(f) - wy(pl) < 0.6));
        out.plaques = topPlaques.map(proj).filter(Boolean);
        out.faces = topFaces.map(proj).filter(Boolean);
        out.faceK = rig.group.children.find((o) => o.material?.map && !o.material.transparent)?.material.color.r;
      }
      return out;
    },
    anchors() {
      const vh = innerHeight, seen = new Set();
      return [...document.querySelectorAll('[data-cam]:not(html)')].flatMap((el) => {
        const key = el.dataset.cam + (el.dataset.cam === 'sofa' ? '#' + (el.id || 'end') : '');
        if (seen.has(key)) return [];
        seen.add(key);
        const b = el.getBoundingClientRect();
        return [{ cam: key.replace('#', '@'), at: Math.max(0, Math.round(b.top + scrollY + b.height / 2 - vh / 2)) }];
      });
    },
  };
  return true;
}

/* ---------- Node 端：像素統計與過曝區塊 ---------- */
async function analyse(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const gw = Math.ceil(w / CELL), gh = Math.ceil(h / CELL);
  const cell = new Uint32Array(gw * gh);
  let hot = 0, lum = 0, sum = 0;
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i += 3) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const Y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      sum += Y;
      if (Y >= LUM) lum++;
      if (r >= HOT || g >= HOT || b >= HOT) { hot++; cell[Math.floor(y / CELL) * gw + Math.floor(x / CELL)]++; }
    }
  // 過曝格的 4 連通區
  const comp = new Int32Array(gw * gh).fill(-1);
  const regions = [];
  for (let s = 0; s < cell.length; s++) {
    if (cell[s] < CELL_MIN || comp[s] >= 0) continue;
    const id = regions.length, stack = [s], cells = [];
    comp[s] = id;
    while (stack.length) {
      const c = stack.pop();
      cells.push(c);
      const cx = c % gw, cy = (c - cx) / gw;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, n = ny * gw + nx;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || comp[n] >= 0 || cell[n] < CELL_MIN) continue;
        comp[n] = id; stack.push(n);
      }
    }
    const xs = cells.map((c) => c % gw), ys = cells.map((c) => Math.floor(c / gw));
    const px = cells.reduce((a, c) => a + cell[c], 0);
    // 取樣點：每個過曝格都取兩點（最靠近該格熱點重心、離重心最遠），區塊最多 40 格。
    // 燈本體的像素射線會打到燈、外圈泛光的像素會打到牆／燈箱，所以白名單只涵蓋本體，溢光照非光源判定
    const samples = [...cells].sort((a, b) => cell[b] - cell[a]).slice(0, 40).flatMap((c) => {
      const x0 = (c % gw) * CELL, y0 = Math.floor(c / gw) * CELL;
      const pts = [];
      for (let y = y0; y < Math.min(h, y0 + CELL); y++)
        for (let x = x0; x < Math.min(w, x0 + CELL); x++) { const i = (y * w + x) * 3; if (data[i] >= HOT || data[i + 1] >= HOT || data[i + 2] >= HOT) pts.push([x, y]); }
      const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      pts.sort((a, b) => Math.hypot(a[0] - mx, a[1] - my) - Math.hypot(b[0] - mx, b[1] - my));
      return pts.length > 1 ? [pts[0], pts[pts.length - 1]] : [pts[0]];
    });
    regions.push({ box: [Math.min(...xs) * CELL, Math.min(...ys) * CELL, (Math.max(...xs) + 1) * CELL, (Math.max(...ys) + 1) * CELL], hotPx: px, samples });
  }
  regions.sort((a, b) => b.hotPx - a.hotPx);
  return { w, h, mean: +(sum / (w * h)).toFixed(3), hotRatio: hot / (w * h), lumRatio: lum / (w * h), regions: regions.slice(0, 12), regionCount: regions.length };
}

/** 點在不在四邊形裡（投影後的 ON AIR、卡紙） */
const inQuad = (q, x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = q[i], [xj, yj] = q[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
function quadStats(raw, w, h, q) {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  let n = 0, sumMax = 0, max = 0, sumY = 0, hot = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!inQuad(q, x + 0.5, y + 0.5)) continue;
      const i = (y * w + x) * 3, m = Math.max(raw[i], raw[i + 1], raw[i + 2]);
      n++; sumMax += m; max = Math.max(max, m); sumY += (0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2]) / 255; if (m >= HOT) hot++;
    }
  return n ? { px: n, meanMaxCh: +(sumMax / n).toFixed(1), maxCh: max, meanLuma: +(sumY / n).toFixed(3), hotPct: +((hot / n) * 100).toFixed(1), box: [x0, y0, x1, y1] } : null;
}
/**
 * ON AIR 的光暈：同一個鏡頭、同一格狀態，把 ON AIR 藏起來再拍一張當「背景」，兩張相減就是 ON AIR 本體加泛光的貢獻。
 * 從字的外框往上、左、右、下各拉一條跟字同寬（同高）的帶子，逐像素往外比；
 * 半徑 = 第一個「有 ON AIR 的亮度 ≤ 背景 × 1.1（且至少 +0.01）」的距離。
 */
const lumaAt = (raw, w, x, y) => { const i = (y * w + x) * 3; return (0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2]) / 255; };
function haloRadius(on, off, w, h, box, D = 260) {
  const [x0, y0, x1, y1] = box;
  const line = (raw, dir, d) => {
    let s = 0, n = 0;
    if (dir === 'up' || dir === 'down') { const y = dir === 'up' ? y0 - d : y1 + d; if (y < 0 || y >= h) return null; for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) { s += lumaAt(raw, w, x, y); n++; } }
    else { const x = dir === 'left' ? x0 - d : x1 + d; if (x < 0 || x >= w) return null; for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) { s += lumaAt(raw, w, x, y); n++; } }
    return n ? s / n : null;
  };
  const out = {};
  for (const dir of ['up', 'left', 'right', 'down']) {
    let r = null, d = 1, edge = null;
    for (; d <= D; d++) {
      const a = line(on, dir, d), b = line(off, dir, d);
      if (a == null || b == null) break;
      if (d === 1) edge = +(a - b).toFixed(3);
      if (a <= Math.max(b * 1.1, b + 0.01)) { r = d; break; }
    }
    out[dir] = d === 1 && r == null ? null : { px: r ?? `>${d - 1}`, edgeDelta: edge };
  }
  return out;
}
/** 本體外面、被 ON AIR 推亮（比背景亮 0.01 以上）的像素：數量、最大通道、其中 ≥250 的數量 */
function spillStats(on, off, w, h, quad, box, pad = 260) {
  const [x0, y0, x1, y1] = box;
  let n = 0, max = 0, hot = 0;
  for (let y = Math.max(0, y0 - pad); y <= Math.min(h - 1, y1 + pad); y++)
    for (let x = Math.max(0, x0 - pad); x <= Math.min(w - 1, x1 + pad); x++) {
      if (inQuad(quad, x + 0.5, y + 0.5)) continue;
      if (lumaAt(on, w, x, y) <= Math.max(lumaAt(off, w, x, y) * 1.1, lumaAt(off, w, x, y) + 0.01)) continue;
      const i = (y * w + x) * 3, m = Math.max(on[i], on[i + 1], on[i + 2]);
      n++; max = Math.max(max, m); if (m >= HOT && Math.max(off[i], off[i + 1], off[i + 2]) < HOT) hot++;
    }
  return { px: n, maxCh: max, newHotPx: hot };
}
async function onAirMeasure(pg, png) {
  const info = await pg.evaluate(() => window.__audit.onAir());
  if (!info.quad) return { color: info.color, state: info.state, inView: false };
  const { data, info: im } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const body = quadStats(data, im.width, im.height, info.quad);
  if (!body) return { color: info.color, state: info.state, inView: false };
  const pxPerM = Math.hypot(info.quad[1][0] - info.quad[0][0], info.quad[1][1] - info.quad[0][1]) / info.widthM;
  // 背景：同一格把 ON AIR 藏起來再拍（只截畫布）
  await pg.evaluate(() => { window.__room.stage.onAir.visible = false; document.documentElement.classList.add('__audit-hide'); });
  await pg.waitForTimeout(260);
  const offPng = await pg.screenshot({ type: 'png' });
  await pg.evaluate(() => { window.__room.stage.onAir.visible = true; document.documentElement.classList.remove('__audit-hide'); });
  const off = (await sharp(offPng).removeAlpha().raw().toBuffer()).valueOf();
  const halo = haloRadius(data, off, im.width, im.height, body.box);
  const spill = spillStats(data, off, im.width, im.height, info.quad, body.box);
  for (const k of Object.keys(halo)) if (halo[k] && typeof halo[k].px === 'number') halo[k].m = +(halo[k].px / pxPerM).toFixed(3);
  const plaques = info.plaques.map((q) => quadStats(data, im.width, im.height, q)).filter(Boolean);
  const faces = info.faces.map((q) => quadStats(data, im.width, im.height, q)).filter(Boolean);
  return {
    color: info.color, state: info.state, inView: true, pxPerM: +pxPerM.toFixed(1), body, halo, spill,
    topPlaques: plaques.length ? { n: plaques.length, maxCh: Math.max(...plaques.map((p) => p.maxCh)), meanMaxCh: +(plaques.reduce((a, p) => a + p.meanMaxCh, 0) / plaques.length).toFixed(1), hotPct: Math.max(...plaques.map((p) => p.hotPct)) } : null,
    // 卡紙印在燈箱畫面上（2026-11-09 改版後沒有獨立說明卡），所以「頂排卡紙」量的是頂排畫面整塊
    topFaces: faces.length ? { n: faces.length, maxCh: Math.max(...faces.map((p) => p.maxCh)), meanMaxCh: +(faces.reduce((a, p) => a + p.meanMaxCh, 0) / faces.length).toFixed(1), hotPct: Math.max(...faces.map((p) => p.hotPct)) } : null,
    faceK: info.faceK,
  };
}

// 只截 3D 畫布：其他 DOM 先藏起來（visibility 不影響排版），截完再放回來另存一張含文字的
const HIDE = 'html.__audit-hide body *:not(#room){visibility:hidden!important} html.__audit-hide #room{visibility:visible!important} html.__audit-bare body *{visibility:hidden!important}';
async function capture(pg, file) {
  await pg.evaluate(() => document.documentElement.classList.add('__audit-hide'));
  await pg.waitForTimeout(120);
  const png = await pg.screenshot({ type: 'png' });
  await pg.evaluate(() => document.documentElement.classList.remove('__audit-hide'));
  fs.writeFileSync(file + '.png', png);
  await pg.screenshot({ path: file + '.jpg', type: 'jpeg', quality: 55 });
  return png;
}

async function settle(pg, page) {
  // 鏡頭追到目標（Room 的 camPos→goalPos；放映室看 camera 連續兩次幾乎不動）
  let last = null, still = 0;
  for (let k = 0; k < 40 && still < 2; k++) {
    await pg.waitForTimeout(250);
    const p = await pg.evaluate((page) => {
      const r = window.__room;
      if (page === 'home') return [r.camPos.distanceTo(r.goalPos) + r.camLook.distanceTo(r.goalLook), 0, 0];
      return r.camera.position.toArray();
    }, page);
    if (page === 'home') still = p[0] < 0.002 ? still + 1 : 0;
    else { still = last && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 0.001 ? still + 1 : 0; last = p; }
  }
  await pg.waitForTimeout(400); // 燈光、燈箱的緩動
}

// 量的時候 ON AIR 的上限是多少（src/live/on-air.ts 會被改，記下來對照）
const onAirSrc = (() => { try { return fs.readFileSync(path.join(WEB, 'src/live/on-air.ts'), 'utf8'); } catch { return ''; } })();
const ON_AIR_CONST = Object.fromEntries([...onAirSrc.matchAll(/export const (ON_AIR_\w+) = ([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
const report = { onAirConst: ON_AIR_CONST, when: new Date().toISOString(), rules: { HOT, LUM, MAX_HOT_RATIO, CELL, CELL_MIN, whitelist: Object.fromEntries(Object.entries(WHITELIST).map(([k, v]) => [k, v.map(String)])) }, shots: [], onAir: [], inventory: {}, errors: [] };
const inv = new Map(); // label|uuid → 最大值與各狀態
function addInventory(page, state, items) {
  for (const it of items) {
    const k = `${page}|${it.label}|${it.uuid}`;
    const cur = inv.get(k) ?? { page, label: it.label, mat: it.mat, max: it.max, states: {} };
    cur.states[state] = it.max;
    if (it.max != null && (cur.max == null || it.max > cur.max)) { cur.max = it.max; cur.mat = it.mat; }
    inv.set(k, cur);
  }
}

async function shoot(pg, page, tag, cam, state) {
  const dir = path.join(OUT, tag);
  const file = path.join(dir, `${cam}-${state}`);
  const png = await capture(pg, file);
  const a = await analyse(png);
  const pts = a.regions.flatMap((r, ri) => r.samples.map((p) => [...p, ri]));
  const rays = pts.length ? await pg.evaluate((pts) => window.__audit.ray(pts.map((p) => [p[0], p[1]])), pts) : [];
  rays.forEach((r, i) => { const reg = a.regions[pts[i][2]]; (reg.rays ??= []).push(r); });
  const shot = judge({ page, size: tag.split('-').pop(), cam, state, file: file + '.png', mean: a.mean, hotRatio: +(a.hotRatio * 100).toFixed(3), lumRatio: +(a.lumRatio * 100).toFixed(3), regionCount: a.regionCount, regions: a.regions.map(({ samples, ...r }) => r) });
  const { violations, fail } = shot;
  if (page === 'home') { shot.onAir = await onAirMeasure(pg, png); if (shot.onAir.inView) report.onAir.push({ size: shot.size, cam, state, ...shot.onAir }); }
  report.shots.push(shot);
  const comps = [...new Set(violations.map((v) => v.label))];
  console.log(`${fail ? '✗' : '✓'} ${tag} ${cam.padEnd(13)} ${state.padEnd(16)} 平均 ${a.mean.toFixed(2)}  ≥250 ${shot.hotRatio.toFixed(2)}%  亮度≥.95 ${shot.lumRatio.toFixed(2)}%  區塊 ${a.regionCount}${comps.length ? '  非光源：' + comps.join('、') : ''}`);
  return shot;
}

async function scrollTo(pg, at) {
  await pg.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), at);
}

/* ---------- 播放室 ---------- */
async function auditHome(w, h) {
  const tag = `home-${w}`;
  fs.mkdirSync(path.join(OUT, tag), { recursive: true });
  const browser = await launch();
  // ?from=screening：走「從放映室回來」的路線，不播開場、沒有 onboarding 對話（繞過 .onboard__skip 擋住 .opening-skip），燈直接是開的
  // ?quality=full：鎖住最高畫質，不讓 swiftshader 的慢格率把泛光自動關掉（真機不會掉這麼多級）
  const { pg, errors } = await openPage(browser, w, h, 'https://room.test/?from=screening&quality=full');
  await pg.waitForFunction(() => window.__room?.baked === true, null, { timeout: 90000, polling: 500 });
  await pg.waitForTimeout(2500); // 回到出口的鏡頭與門的動畫
  await pg.evaluate(installProbe, 'home');
  const all = await pg.evaluate(() => window.__audit.anchors());
  if (process.argv.includes('--calibrate')) { await calibrate(pg, all); await browser.close(); process.exit(0); } // 只校準，不動 report.json
  const anchors = CAMS_ONLY ? all.filter((a) => CAMS_ONLY.includes(a.cam)) : all;
  console.log(`${tag}：鏡頭 ${anchors.map((a) => a.cam).join(' ')}${DECK1 ? ' ＋deck1' : ''}`);
  for (const mood of MOODS) {
    await pg.evaluate((m) => document.querySelector(`.moods__opt[data-mood="${m}"]`)?.click(), mood);
    await pg.waitForFunction(() => !window.__room.moodFade, null, { timeout: 15000, polling: 200 }).catch(() => {});
    for (const playing of [false, true]) {
      await pg.evaluate((on) => { window.__room.setPlaying(on); document.documentElement.classList.toggle('is-playing', on); }, playing);
      if (playing) await pg.waitForTimeout(2500); // wake 爬到 ~1、ON AIR 點亮跑完
      const state = `${mood}${playing ? '-playing' : ''}`;
      addInventory('home', state, await pg.evaluate(() => window.__audit.inventory()));
      for (const a of anchors) {
        await scrollTo(pg, a.at);
        await settle(pg, 'home');
        await shoot(pg, 'home', tag, a.cam, state);
      }
      if (DECK1) await shootDeck1(pg, tag, anchors, state);
      if (!playing) {
        // 等待閃爍（開場懸針時 ON AIR 一閃一閃）：把 Room 的 hover 打開、不放歌；閃爍是時間函式，每個鏡頭拍 3 格取最大
        await pg.evaluate(() => { window.__room.hover = true; });
        for (const cam of ['deck0', 'deck1', 'door', 'gigs']) {
          if (cam === 'deck1') { if (DECK1) await shootDeck1(pg, tag, anchors, `${mood}-blink`, 3); continue; }
          const a = anchors.find((x) => x.cam === cam);
          if (!a) continue;
          await scrollTo(pg, a.at);
          await settle(pg, 'home');
          await blinkFrames(pg, tag, cam, `${mood}-blink`, 3);
        }
        await pg.evaluate(() => { window.__room.hover = false; });
        await pg.waitForTimeout(600);
      }
    }
    await pg.evaluate(() => { window.__room.setPlaying(false); document.documentElement.classList.remove('is-playing'); });
    await pg.waitForTimeout(1500);
  }
  report.errors.push(...errors.map((e) => `${tag} ${e}`));
  await browser.close();
}

/**
 * 校準：隨機取 400 個像素，用射線＋貼圖推算該像素應有的顏色，跟截圖實際值比（相關係數、平均誤差），
 * 正反兩種取樣方向都算。對得上才能相信 texel 欄位拿來判斷「是貼圖本身就亮，還是別處的泛光」。
 */
async function calibrate(pg, anchors) {
  const toS = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255;
  for (const cam of ['door', 'lights', 'deck0', 'wall']) {
    const a = anchors.find((x) => x.cam === cam);
    await scrollTo(pg, a.at); await settle(pg, 'home');
    // 自我檢查：DOM 藏起來、畫布也藏起來時，畫面上不該還有打到頂的像素（有就代表有 DOM 沒被藏到，量到的不是 3D）
    await pg.evaluate(() => { document.documentElement.classList.add('__audit-bare'); });
    await pg.waitForTimeout(400);
    const bare = await analyse(await pg.screenshot({ type: 'png' }));
    await pg.evaluate(() => { document.documentElement.classList.remove('__audit-bare'); });
    console.log(`校準 ${cam} 畫布與 DOM 都藏起來：≥250 像素 ${(bare.hotRatio * 100).toFixed(3)}%、平均亮度 ${bare.mean}`);
    await pg.evaluate(() => document.documentElement.classList.add('__audit-hide'));
    await pg.waitForTimeout(150);
    const png = await pg.screenshot({ type: 'png' });
    await pg.evaluate(() => document.documentElement.classList.remove('__audit-hide'));
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pts = Array.from({ length: 400 }, () => [Math.floor(Math.random() * info.width), Math.floor(Math.random() * info.height)]);
    for (const flip of [false, true]) {
      await pg.evaluate((f) => { window.__auditFlipV = f; }, flip);
      const rays = await pg.evaluate((pts) => window.__audit.ray(pts), pts);
      const xs = [], ys = [];
      rays.forEach((r, i) => {
        const t = r.hits?.[0]?.texel;
        if (!t?.predictedLinear || !/^bakedRoot/.test(r.hits[0].label)) return;
        const [x, y] = pts[i], k = (y * info.width + x) * 3;
        xs.push(Math.max(...t.predictedLinear.map((v) => toS(Math.min(1, v)))));
        ys.push(Math.max(data[k], data[k + 1], data[k + 2]));
      });
      const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
      const cov = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0), sx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0)), sy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
      const mae = xs.reduce((a, x, i) => a + Math.abs(x - ys[i]), 0) / n;
      console.log(`校準 ${cam} ${flip ? '反向' : '正向'}：烘焙表面取樣 ${n} 點，相關係數 ${(cov / (sx * sy)).toFixed(3)}，平均誤差 ${mae.toFixed(1)}／255，推算平均 ${mx.toFixed(1)} 實際平均 ${my.toFixed(1)}`);
    }
    await pg.evaluate(() => { window.__auditFlipV = false; });
  }
}

/* deck1 不是捲動錨點（只在開場用），姿勢從 room.ts 的 CAMS 讀出來，捲到 deck0 再直接 aim 過去 */
const DECK1 = (() => {
  const src = fs.readFileSync(path.join(WEB, 'src/room/room.ts'), 'utf8');
  const m = src.match(/deck1:\s*\{\s*wide:\s*(\{[^}]*\}),\s*phone:\s*(\{[^}]*\})/);
  const j = (t) => JSON.parse(t.replace(/(\w+):/g, '"$1":'));
  try { return m ? { wide: j(m[1]), phone: j(m[2]) } : null; } catch { return null; }
})();
async function shootDeck1(pg, tag, anchors, state, frames = 1) {
  const a = anchors.find((x) => x.cam === 'deck0');
  if (!a) return;
  await scrollTo(pg, a.at);
  await settle(pg, 'home');
  // 捲動迴圈每格都會呼叫 aim() 把鏡頭拉回捲動位置：暫時在 Room 實例上包一層，鎖在 deck1（只在稽核頁面的記憶體裡，拍完還原）
  await pg.evaluate((p) => { const r = window.__room; const pose = r.isPhone() ? p.phone : p.wide; r.__auditAim ??= r.aim; r.aim = () => r.__auditAim(pose); }, DECK1);
  await settle(pg, 'home');
  if (frames > 1) await blinkFrames(pg, tag, 'deck1', state, frames);
  else await shoot(pg, 'home', tag, 'deck1', state);
  await pg.evaluate(() => { const r = window.__room; if (r.__auditAim) { delete r.aim; delete r.__auditAim; } });
}
/** 第一格完整判定，之後幾格只量 ON AIR（閃爍的最亮那一下才是重點） */
async function blinkFrames(pg, tag, cam, state, n) {
  const first = await shoot(pg, 'home', tag, cam, state);
  const extra = [];
  for (let k = 1; k < n; k++) {
    await pg.waitForTimeout(350);
    await pg.evaluate(() => document.documentElement.classList.add('__audit-hide'));
    await pg.waitForTimeout(80);
    const png = await pg.screenshot({ type: 'png' });
    await pg.evaluate(() => document.documentElement.classList.remove('__audit-hide'));
    const m = await onAirMeasure(pg, png);
    if (m.inView) { extra.push(m); report.onAir.push({ size: first.size, cam, state: `${state}#${k + 1}`, ...m }); }
  }
  return first;
}

/* ---------- 放映室 ---------- */
async function auditScreening(w, h) {
  const tag = `screening-${w}`;
  fs.mkdirSync(path.join(OUT, tag), { recursive: true });
  const browser = await launch();
  const { pg, errors } = await openPage(browser, w, h, 'https://room.test/screening/');
  await pg.waitForFunction(() => window.__step === 'running' && window.__room?.scene, null, { timeout: 120000, polling: 500 });
  await pg.waitForTimeout(2500);
  await pg.evaluate(installProbe, 'screening');
  const anchors = await pg.evaluate(() => window.__audit.anchors());
  console.log(`${tag}：鏡頭 ${anchors.map((a) => a.cam).join(' ')}`);
  const before = anchors.filter((a) => !a.cam.startsWith('sofa') && a.cam !== 'bye');
  const sofa = anchors.filter((a) => a.cam.startsWith('sofa'));
  const bye = anchors.find((a) => a.cam === 'bye');
  const kState = () => pg.evaluate(() => ({ kL: +window.__room.U.kL.value.toFixed(2), kS: +window.__room.U.kS.value.toFixed(2) }));
  // 開燈：沙發之前的鏡頭（一走到沙發就自動放代表作、燈暗下來，之後只有走到 bye 才回開燈）
  addInventory('screening', 'lamp', await pg.evaluate(() => window.__audit.inventory()));
  for (const a of before) { await scrollTo(pg, a.at); await settle(pg, 'screening'); await shoot(pg, 'screening', tag, a.cam, 'lamp'); }
  // 看片暗場：走到沙發觸發放片，等銀幕亮起、檯燈退到 0.1
  await scrollTo(pg, sofa[0].at);
  await pg.waitForFunction(() => window.__room.U.kS.value > 2.0 && window.__room.U.kL.value < 0.35, null, { timeout: 20000, polling: 300 }).catch(() => {});
  console.log(`${tag}：暗場 ${JSON.stringify(await kState())}`);
  addInventory('screening', 'screen', await pg.evaluate(() => window.__audit.inventory()));
  for (const a of [...sofa, ...before]) { await scrollTo(pg, a.at); await settle(pg, 'screening'); await shoot(pg, 'screening', tag, a.cam, 'screen'); }
  if (bye) {
    await scrollTo(pg, bye.at);
    await pg.waitForFunction(() => window.__room.U.kL.value > 1.8, null, { timeout: 15000, polling: 300 }).catch(() => {});
    await settle(pg, 'screening');
    await shoot(pg, 'screening', tag, bye.cam, 'lamp');
  }
  report.errors.push(...errors.map((e) => `${tag} ${e}`));
  await browser.close();
}

// --append：補跑（例如中斷的那一頁），把同頁、同尺寸、同時段的舊結果換掉，其他保留
if (process.argv.includes('--append') && fs.existsSync(path.join(OUT, 'report.json'))) {
  const old = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8'));
  const pages = ONLY ? [ONLY] : ['home', 'screening'], sizes = SIZES.map(([w]) => String(w));
  const redo = (page, size, state) => pages.includes(page) && sizes.includes(String(size)) && (page !== 'home' || MOODS.some((m) => String(state).startsWith(m)));
  report.shots = old.shots.filter((x) => !redo(x.page, x.size, x.state));
  report.onAir = (old.onAir ?? []).filter((x) => !redo('home', x.size, x.state));
  report.errors = (old.errors ?? []).filter((e) => !pages.some((pg) => sizes.some((sz) => e.startsWith(`${pg}-${sz} `))));
  for (const it of old.inventory ?? []) inv.set(`${it.page}|${it.label}|old${inv.size}`, it);
}
if (REJUDGE) {
  const old = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8'));
  Object.assign(report, { when: old.when, shots: old.shots.map(judge), onAir: old.onAir ?? [], errors: old.errors });
  for (const it of old.inventory) inv.set(`${it.page}|${it.label}|${inv.size}`, it);
}
for (const [w, h] of REJUDGE ? [] : SIZES) {
  if (ONLY !== 'screening') await auditHome(w, h).catch((e) => { report.errors.push(`home-${w} ${e}`); console.log(`✗ home-${w} 中斷：${e}`); });
  if (ONLY !== 'home') await auditScreening(w, h).catch((e) => { report.errors.push(`screening-${w} ${e}`); console.log(`✗ screening-${w} 中斷：${e}`); });
}

/* ---------- 匯總 ---------- */
report.inventory = [...inv.values()].sort((a, b) => (b.max ?? -1) - (a.max ?? -1));
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const lines = [];
const failed = report.shots.filter((s) => s.fail);
lines.push(`亮度稽核 ${report.when}：${report.shots.length} 張、不合格 ${failed.length} 張；量測時 ON AIR 常數 ${JSON.stringify(report.onAirConst ?? {})}`);
lines.push('', '== 過曝清單（不合格的鏡頭） ==', '頁面\t尺寸\t鏡頭\t時段\t≥250%\t亮度≥.95%\t非光源元件（取樣點數）\t材質');
for (const s of failed) {
  const by = {};
  for (const v of s.violations) (by[v.label] ??= { n: 0, mat: v.mat }).n++;
  const comps = Object.entries(by).map(([l, v]) => `${l}(${v.n})`).join('、') || '（比例超標，區塊都是白名單光源）';
  const mat = Object.values(by)[0]?.mat;
  lines.push(`${s.page}\t${s.size}\t${s.cam}\t${s.state}\t${s.hotRatio}\t${s.lumRatio}\t${comps}\t${mat ? JSON.stringify(mat) : ''}`);
}
lines.push('', '== 元件彙總：哪些非光源元件在幾張圖裡打到頂 ==');
const byComp = {};
for (const s of report.shots) for (const v of s.violations) { const c = (byComp[`${s.page} ${v.label}`] ??= { shots: new Set(), n: 0, mat: v.mat }); c.shots.add(`${s.size}/${s.cam}/${s.state}`); c.n++; if (v.texel && !c.texel) { c.texel = v.texel; c.world = v.world; } }
for (const [k, c] of Object.entries(byComp).sort((a, b) => b[1].shots.size - a[1].shots.size)) lines.push(`${k}：${c.shots.size} 張、${c.n} 個取樣點  例：${[...c.shots].slice(0, 6).join(' ')}  材質 ${JSON.stringify(c.mat)}${c.texel ? `  命中點 ${JSON.stringify(c.world)} 貼圖／推算 ${JSON.stringify(c.texel)}` : ''}`);
lines.push('', '== ON AIR 本體與光暈（播放室，字在畫面內的每張；blink#n 是同一鏡頭閃爍的第 n 格） ==', '尺寸\t鏡頭\t狀態\tcolor\t本體平均最大通道\t本體最大\t本體≥250%\t光暈 上/左/右/下（px／m）\t溢光像素／最大通道／新增≥250\t頂排燈箱（白卡紙＋照片） 最大／平均最大通道／≥250%');
for (const o of report.onAir) {
  const hr = ['up', 'left', 'right', 'down'].map((k) => (o.halo?.[k] ? `${o.halo[k].px}${o.halo[k].m != null ? '／' + o.halo[k].m + 'm' : ''}` : '-')).join(' ');
  lines.push(`${o.size}\t${o.cam}\t${o.state}\t${o.color}\t${o.body.meanMaxCh}\t${o.body.maxCh}\t${o.body.hotPct}\t${hr}\t${o.spill ? `${o.spill.px}／${o.spill.maxCh}／${o.spill.newHotPx}` : '-'}\t${o.topFaces ? `${o.topFaces.maxCh}／${o.topFaces.meanMaxCh}／${o.topFaces.hotPct}` : '-'}`);
}
lines.push('', '== 自發光／加法混合材質盤點（執行期實測，max = 假設貼圖全白時的最大線性輸出；> 0.86 會被泛光抓到，> 1 截平） ==');
for (const it of report.inventory) lines.push(`${it.page}\t${it.label}\tmax ${it.max}\t${Object.entries(it.states).map(([k, v]) => `${k}=${v}`).join(' ')}\t${JSON.stringify(it.mat)}`);
if (report.errors.length) lines.push('', '== 頁面錯誤 ==', ...report.errors);
fs.writeFileSync(path.join(OUT, 'report.txt'), lines.join('\n') + '\n');
console.log(`\n${failed.length ? '✗' : '✓'} ${report.shots.length} 張、不合格 ${failed.length} 張  報告 ${path.join(OUT, 'report.txt')}`);
process.exit(failed.length || report.errors.some((e) => !e.includes('PAGEERROR') && /中斷|Error/.test(e)) ? 1 : 0);
