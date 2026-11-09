// 放映室的 3D 房間（從 index.html 的行內模組搬出來：Vite 開發模式的 html-proxy 在這個專案會對不到快取）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { initShare } from '../src/share/client.ts';
import { screenPhonePose as phoneScreenPose } from './screen-pose.ts';
import { FAV_WALL, FAV_CELL, FAV_HALF, FAV_TITLE_PX, FAV_SUB_PX, FAV_TEX_W, favWidePose, favPhonePose, favRowPose, favCopy, stripOrder, favIndexes, hostPool } from './favorites.ts';
import { embedUrl, netflixSearchUrl, parseYtMessage, ytError, command, LISTEN, linkVisible, trailerMode, doorClip, clipPathCss } from './trailer.ts';

initShare();
if (document.documentElement.classList.contains('fallback-on')) throw new Error('fallback');
window.__step = 'module-start';
const S = window.STORY;
const SHELF = S.shelf;
const html = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(hover: none)').matches;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
const ym = (iso) => { const [y, m] = iso.split('-'); return `${y} 年 ${Number(m)} 月`; };
const RANGE_WORD = { month: '這 4 週', half: '這半年', year: '這一年' };
// 畫在 3D 貼圖上的字也走 design system：Switzer（英數）＋ Noto Sans TC（中文），字重只用 400／500／600
const FAMILY = '"Switzer", "Noto Sans TC", "PingFang TC", sans-serif';
const font = (weight, px) => `${weight} ${px}px ${FAMILY}`;
const displayText = (g, on) => { g.letterSpacing = on ? '-0.04em' : '0px'; };


/* ================================================================ 補間 */
const tweens = new Set();
function tween(ms, update, curve = ease) {
  return new Promise((res) => tweens.add({ t0: performance.now(), ms: reduced ? 0 : ms, update, curve, res }));
}
function runTweens(now) {
  for (const t of tweens) {
    const k = t.ms ? Math.min(1, (now - t.t0) / t.ms) : 1;
    t.update(t.curve(k));
    if (k >= 1) { tweens.delete(t); t.res(); }
  }
}

/* ================================================================ 票根與打孔 */
const STOP_WORDS = ['進門了', '到客廳了', '坐下了', '時間軸看完了'];
let punchedUpTo = -1;
function punch(i) {
  if (i <= punchedUpTo) return;
  const holes = $$('.holes li');
  for (let k = punchedUpTo + 1; k <= i; k++) {
    const h = holes[k];
    h.classList.add('punching');
    setTimeout(() => { h.classList.remove('punching'); h.classList.add('punched'); }, reduced ? 0 : 140 + (k - punchedUpTo - 1) * 160);
  }
  punchedUpTo = i;
  $('[data-stops]').textContent = STOP_WORDS[i];
}

/* ================================================================ 捲動鎖、平滑捲動 */
let lockedSince = 0;
function lock(on) { html.classList.toggle('locked', on); lockedSince = on ? performance.now() : 0; }
function scrollToEl(el, ms) {
  const box = el.getBoundingClientRect();
  const target = box.top + scrollY + box.height / 2 - innerHeight / 2;
  if (reduced || !ms) { scrollTo(0, target); return Promise.resolve(); }
  const start = scrollY;
  // 每一格重抓目標位置：捲動途中版面會變（例如離開片櫃時挑片模式收掉、片櫃那段變長），一開始算死會停在半路
  return tween(ms, (k) => { const b = el.getBoundingClientRect(); const t = b.top + scrollY + b.height / 2 - innerHeight / 2; scrollTo(0, start + (t - start) * k); });
}

/* ================================================================ 3D */
const canvas = $('#room');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
RectAreaLightUniformsLib.init();
// 銀幕預告：另一層 CSS3D 疊在 WebGL 上，用同一台鏡頭，把 YouTube 嵌入貼在 3D 銀幕的位置
const css3d = new CSS3DRenderer();
Object.assign(css3d.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', display: 'none' });
canvas.after(css3d.domElement);
const cssScene = new THREE.Scene();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0806);
const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 60);

const draco = new DRACOLoader().setDecoderPath(new URL('../draco/', location.href).href);
const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
const texLoader = new THREE.TextureLoader();
let loaded = 0;
const TOTAL = 9 + SHELF.length;
const progress = () => { loaded++; window.__lastProgress = performance.now(); const p = Math.round((loaded / TOTAL) * 100); const el = $('[data-loading]'); if (el) el.textContent = `客廳整理中… ${p}%`; $('[data-fade-say]').textContent = `客廳整理中… ${p}%`; };
const loadTex = (url) => new Promise((res) => texLoader.load(url, (t) => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; progress(); res(t); }, undefined, () => { progress(); res(null); }));
const loadImg = (url) => new Promise((res) => { if (!url) { progress(); return res(null); } const im = new Image(); im.onload = () => { progress(); res(im); }; im.onerror = () => { progress(); res(null); }; im.src = url; });

window.__step = 'renderer-ok';
const L = await fetch('room/layout.json').then((r) => r.json());
const [roomGltf, propsGltf, ...maps] = await Promise.all([
  gltfLoader.loadAsync('room/screening.glb').then((g) => { progress(); return g; }),
  gltfLoader.loadAsync('room/props.glb').then((g) => { progress(); return g; }),
  ...['night', 'lamp', 'screen'].flatMap((p) => [loadTex(`room/${p}_shell.jpg`), loadTex(`room/${p}_props.jpg`)]),
]);
window.__step = 'glb-ok';
const posters = await Promise.all(SHELF.map((s) => loadImg(s.poster)));
await Promise.all([document.fonts.load('600 40px "Noto Sans TC"', '片櫃電影時間軸'), document.fonts.load('500 40px "Noto Sans TC"', '天部月'), document.fonts.load('600 40px "Switzer"', '2026'), document.fonts.load('500 40px "Switzer"', 'PLAY 0')]).catch(() => {});

window.__step = 'posters-ok';
/* ---------- 烘焙好的房間：三層光相加 ---------- */
const U = { kN: { value: 1 }, kL: { value: 1 }, kS: { value: 0 }, tint: { value: new THREE.Color(1, 1, 1) } };
function bakedMaterial(n, l, s) {
  return new THREE.ShaderMaterial({
    uniforms: { tN: { value: n }, tL: { value: l }, tS: { value: s }, kN: U.kN, kL: U.kL, kS: U.kS, tint: U.tint },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tN; uniform sampler2D tL; uniform sampler2D tS; uniform float kN; uniform float kL; uniform float kS; uniform vec3 tint; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tN, vUv).rgb * kN + texture2D(tL, vUv).rgb * kL + texture2D(tS, vUv).rgb * kS * tint; gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
  });
}
const [nS, nP, lS, lP, sS, sP] = maps;
roomGltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  if (o.name.startsWith('room_shell')) o.material = bakedMaterial(nS, lS, sS);
  else if (o.name.startsWith('room_props')) o.material = bakedMaterial(nP, lP, sP);
});
scene.add(roomGltf.scene);

/* ---------- 即時燈光（給會動的東西：DVD、播放機、門） ---------- */
const hemi = new THREE.HemisphereLight(0xffe2c0, 0x2a1810, 0.25);
scene.add(hemi);
const prWarm = new THREE.PointLight(0xffb070, 10, 8, 2);
prWarm.position.set(2.3, 2.6, -2.0);
scene.add(prWarm);
const handLight = new THREE.PointLight(0xffe2c4, 0, 1.6, 2);  // 拿在手上時，鏡頭旁邊的小燈
scene.add(handLight);
const lampLight = new THREE.PointLight(0xffc68a, 0, 8, 1.8);
lampLight.position.set(...L.lamp);
scene.add(lampLight);
const shelfLights = L.shelf.rows.map((r) => {
  const a = new THREE.RectAreaLight(0xffd2a0, 0, 0.04, (r.z_start - r.z_end));
  a.position.set(r.x_front + 0.02, r.y + 0.34, (r.z_start + r.z_end) / 2);
  a.lookAt(r.x_front + 0.05, r.y, (r.z_start + r.z_end) / 2);
  scene.add(a);
  return a;
});
const SC = L.screen;
// 銀幕四角：決定 CSS3D 預告層的模式（房內／門外裁成門洞／不顯示），見 trailer.ts 的 trailerMode
const SC_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => new THREE.Vector3(SC.x + sx * SC.w / 2, SC.y + sy * SC.h / 2, SC.z + 0.004));
const screenLight = new THREE.RectAreaLight(0xffffff, 0, SC.w, SC.h);
screenLight.position.set(SC.x, SC.y, SC.z + 0.05);
screenLight.lookAt(SC.x, SC.y, 0);
scene.add(screenLight);

/* ---------- 會動的東西（props.glb） ---------- */
const props = propsGltf.scene;
scene.add(props);
const node = (n) => props.getObjectByName(n);
const doorHinge = node('door_hinge');
const dvdTemplate = node('dvd');
dvdTemplate.removeFromParent();
const playerTray = node('player_tray');
const trayBaseZ = playerTray.position.z;
const matByName = (root, name) => { let m = null; root.traverse((o) => { if (o.isMesh && o.material?.name === name) m = o; }); return m; };

// 招牌與燈泡
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const signMesh = matByName(props, 'sign');
signMesh.material = new THREE.MeshBasicMaterial({ map: canvasTex(1024, 256, (g, w, h) => {
  g.fillStyle = '#2a1c13'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#f3c47f'; g.font = '600 150px ' + FAMILY; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('放映室', w / 2, h / 2 + 8);
}) });
const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.018, 10, 8), bulbMat, L.bulbs.length);
const m4 = new THREE.Matrix4();
L.bulbs.forEach((p, i) => { m4.makeTranslation(...p); bulbs.setMatrixAt(i, m4); bulbs.setColorAt(i, new THREE.Color(1, 1, 1)); });
scene.add(bulbs);

// 窗外的夜
matByName(props, 'night').material = new THREE.MeshBasicMaterial({ map: canvasTex(512, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0d1626'); gr.addColorStop(1, '#1d2a3c');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255, ${190 + Math.random() * 50 | 0}, 120, ${0.25 + Math.random() * 0.5})`; g.fillRect(Math.random() * w, h * 0.55 + Math.random() * h * 0.45, 3 + Math.random() * 5, 3 + Math.random() * 4); }
}) });
// 牆上的海報：動畫類回來看最多天的那部
const wallItem = SHELF.filter((s) => s.kind === '動畫').sort((a, b) => b.days - a.days)[0];
const wallImg = posters[SHELF.indexOf(wallItem)];
const posterMesh = matByName(props, 'poster');
if (wallImg) posterMesh.material = new THREE.MeshStandardMaterial({ map: canvasTex(342, 513, (g, w, h) => g.drawImage(wallImg, 0, 0, w, h)), roughness: 0.6 });

/* ---------- 左牆最愛燈箱：業主最愛的作品排成 3×3 背光海報牆，下面各有一條片名牌 ---------- */
const FAVS = favIndexes(S.favorites, SHELF).slice(0, 9);
const favSet = new Set(FAVS);
let favBox = null;
let favGlow = 0;
if (FAVS.length) {
  posterMesh.visible = false;  // 原本那張自動挑的動畫海報被燈箱蓋住，不用再畫
  favBox = await buildFavBox();
}
async function buildFavBox() {
  // 片名要用 Noto Sans TC 600 畫在 canvas 上：先把用到的字載進來，不然會先用備用字型畫
  await document.fonts.load(font(600, 40), FAVS.map((i) => SHELF[i].title).join('') + '回來看了天').catch(() => {});
  const cw = FAV_TEX_W, ph = Math.round((cw * FAV_CELL.h) / FAV_CELL.w), cap = Math.round((ph * FAV_CELL.cap) / FAV_CELL.h), ch = ph + cap;
  const cv = document.createElement('canvas');
  cv.width = cw * 3; cv.height = ch * 3;
  const g = cv.getContext('2d');
  g.fillStyle = '#120d09'; g.fillRect(0, 0, cv.width, cv.height);
  FAVS.forEach((si, n) => {
    const it = SHELF[si], img = posters[si], x = (n % 3) * cw, y = Math.floor(n / 3) * ch;
    g.save(); g.beginPath(); g.rect(x, y, cw, ch); g.clip();
    // 海報（cover）
    if (img) { const k = Math.max(cw / img.width, ph / img.height); g.drawImage(img, x + (cw - img.width * k) / 2, y + (ph - img.height * k) / 2, img.width * k, img.height * k); }
    else { g.fillStyle = '#2a1c13'; g.fillRect(x, y, cw, ph); }
    // 背光透出來：海報四邊微微偏暖亮，像光從框後面漏出
    for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, 0, 1, 0, 0, cw, 40], [0, 1, 0, 0, 0, ph - 40, cw, 40], [0, 0, 1, 0, 0, 0, 30, ph], [1, 0, 0, 0, cw - 30, 0, 30, ph]]) {
      const gr = g.createLinearGradient(x + x0 * rw + rx, y + y0 * rh + ry, x + x1 * rw + rx, y + y1 * rh + ry);
      gr.addColorStop(0, 'rgba(255, 214, 150, 0.22)'); gr.addColorStop(1, 'rgba(255, 214, 150, 0)');
      g.fillStyle = gr; g.fillRect(x + rx, y + ry, rw, rh);
    }
    // 片名牌：深底亮字。字級固定（手機逐排推近時要讀得到），放不下就換行，兩行還放不下才用「…」
    g.fillStyle = '#17110c'; g.fillRect(x, y + ph, cw, cap);
    g.fillStyle = 'rgba(243, 196, 127, 0.55)'; g.fillRect(x, y + ph, cw, 3);
    const title = it.title.replace(/[：:].*$/, ''), room = cw - 16, lh = Math.round(FAV_TITLE_PX * 1.08);
    g.font = font(600, FAV_TITLE_PX);
    const chars = [...title], lines = [];
    let ci = 0;
    while (ci < chars.length && lines.length < 2) {
      let cur = '';
      while (ci < chars.length && g.measureText(cur + chars[ci]).width <= room) cur += chars[ci++];
      if (!cur) cur = chars[ci++];
      lines.push(cur);
    }
    if (ci < chars.length) { const l = [...lines.pop()]; while (l.length > 1 && g.measureText(l.join('') + '…').width > room) l.pop(); lines.push(l.join('') + '…'); }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f8e9cc';
    const blockMid = y + ph + 14 + lh;  // 片名區（兩行高）的中線，一行時置中
    lines.forEach((ln, k) => g.fillText(ln, x + cw / 2, blockMid + (k - (lines.length - 1) / 2) * lh));
    g.font = font(500, FAV_SUB_PX); g.fillStyle = '#d3bd94';
    g.fillText(`回來看了 ${it.days} 天`, x + cw / 2, y + ph + cap - 26);
    g.restore();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  // 幾何（局部座標：x 向右、y 向上、z 離牆往外；整組轉 90 度貼左牆）
  const cw3 = FAV_CELL.w, chh = FAV_CELL.h + FAV_CELL.cap, bar = FAV_CELL.bar;
  const W = 3 * cw3 + 4 * bar, Ht = 3 * chh + 4 * bar;
  const pos = [], uv = [], idx = [];
  for (let n = 0; n < 9; n++) {
    const c = n % 3, r = Math.floor(n / 3);
    const x0 = -W / 2 + bar + c * (cw3 + bar), y1 = Ht / 2 - bar - r * (chh + bar);
    const b = pos.length / 3;
    pos.push(x0, y1 - chh, 0, x0 + cw3, y1 - chh, 0, x0 + cw3, y1, 0, x0, y1, 0);
    const u0 = c / 3, u1 = (c + 1) / 3, v0 = 1 - (r + 1) / 3, v1 = 1 - r / 3;
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const faceGeo = new THREE.BufferGeometry();
  faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  faceGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  faceGeo.setIndex(idx);
  const faceMat = new THREE.MeshBasicMaterial({ map: tex });
  const metal = new THREE.MeshStandardMaterial({ color: 0x1d1a18, metalness: 0.65, roughness: 0.42 });
  const group = new THREE.Group();
  group.position.set(L.room.x0, FAV_WALL.y, FAV_WALL.z);
  group.rotation.y = Math.PI / 2;
  const box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), metal); m.position.set(x, y, z); group.add(m); };
  box(W + 0.06, Ht + 0.06, 0.07, 0, 0, 0.035);                                  // 箱體
  for (const sx of [-1, 1]) box(0.03, Ht + 0.06, 0.05, sx * (W / 2 + 0.015), 0, 0.095);  // 左右外框
  for (const sy of [-1, 1]) box(W + 0.06, 0.03, 0.05, 0, sy * (Ht / 2 + 0.015), 0.095);  // 上下外框
  for (let k = 1; k < 3; k++) {
    box(bar, Ht, 0.02, -W / 2 + k * (cw3 + bar) + bar / 2, 0, 0.08);               // 直向分隔
    box(W, bar, 0.02, 0, Ht / 2 - k * (chh + bar) + bar / 2, 0.08);                // 橫向分隔
  }
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.position.z = 0.072;
  group.add(face);
  scene.add(group);
  // 牆上的暖色光暈（加法混合的平面，貼在牆上、燈箱後面）
  const hc = document.createElement('canvas'); hc.width = hc.height = 256;
  const hg = hc.getContext('2d'), rg = hg.createRadialGradient(128, 128, 10, 128, 128, 128);
  rg.addColorStop(0, 'rgba(255, 190, 110, 0.85)'); rg.addColorStop(0.45, 'rgba(255, 170, 90, 0.35)'); rg.addColorStop(1, 'rgba(255, 160, 80, 0)');
  hg.fillStyle = rg; hg.fillRect(0, 0, 256, 256);
  const haloTex = new THREE.CanvasTexture(hc); haloTex.colorSpace = THREE.SRGBColorSpace;
  const haloMat = new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.7), haloMat);
  halo.position.set(L.room.x0 + 0.006, FAV_WALL.y - 0.05, FAV_WALL.z);
  halo.rotation.y = Math.PI / 2;
  scene.add(halo);
  return { faceMat, haloMat };
}
// 燈罩、鏡頭、銀幕、播放機面板
const shadeMesh = matByName(props, 'shade');
const shadeMat = new THREE.MeshBasicMaterial({ color: 0xffd8a8, side: THREE.DoubleSide });
shadeMesh.material = shadeMat;
const lensMesh = matByName(props, 'lens');
const lensMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
lensMesh.material = lensMat;
const screenMesh = matByName(props, 'screen');
const screenCanvas = document.createElement('canvas');
screenCanvas.width = 1600; screenCanvas.height = 900;
const screenTex = new THREE.CanvasTexture(screenCanvas);
screenTex.flipY = false; screenTex.colorSpace = THREE.SRGBColorSpace;
const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, color: 0x000000 });
screenMesh.material = screenMat;
const displayMesh = matByName(props, 'player_display');
const dispCanvas = document.createElement('canvas');
dispCanvas.width = 256; dispCanvas.height = 40;
const dispTex = new THREE.CanvasTexture(dispCanvas);
dispTex.flipY = false; dispTex.colorSpace = THREE.SRGBColorSpace;
displayMesh.material = new THREE.MeshBasicMaterial({ map: dispTex });
function display(text) {
  const g = dispCanvas.getContext('2d');
  g.fillStyle = '#050807'; g.fillRect(0, 0, 256, 40);
  g.fillStyle = '#7cf2c2'; g.font = font(500, 24); g.textBaseline = 'middle';
  g.fillText(text, 12, 21);
  dispTex.needsUpdate = true;
}
display('– –:– –');

// 投影光束
const LENS = new THREE.Vector3(L.lens[0], L.lens[1], L.lens[2] - 0.02);
const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(SC.x + (a * SC.w) / 2, SC.y + (b * SC.h) / 2, SC.z + 0.01));
const beamGeo = new THREE.BufferGeometry().setFromPoints(corners.flatMap((c, i) => [LENS, c, corners[(i + 1) % 4]]));
const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1dc, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
scene.add(new THREE.Mesh(beamGeo, beamMat));

window.__step = 'props-ok';
/* ================================================================ 片櫃：198 片 DVD */
const DV = L.dvd;
const avgColor = (img) => {
  if (!img) return new THREE.Color(0.25, 0.18, 0.14);
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
  const col = new THREE.Color(r / 64 / 255, gg / 64 / 255, b / 64 / 255);
  const hsl = {}; col.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.35 + 0.08), Math.min(0.5, Math.max(0.16, hsl.l)));
};
const colors = posters.map(avgColor);
const css = (c, k = 1) => `rgb(${Math.round(c.r * 255 * k)}, ${Math.round(c.g * 255 * k)}, ${Math.round(c.b * 255 * k)})`;
const inkOn = (c) => (0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 0.55 ? '#2a1c13' : '#f4e6cd');
const KIND_MARK = { '電影': '電影', '影集': '影集', '動畫': '動畫', '實境秀': '實境' };

function drawSpine(g, x, y, w, h, i) {
  const it = SHELF[i], col = colors[i];
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = css(col); g.fillRect(x, y, w, h);
  const ink = inkOn(col);
  g.fillStyle = ink;
  // 上方：類別小字（橫寫兩字疊起來）
  const fsSmall = w * 0.34;
  g.font = font(600, fsSmall); g.textAlign = 'center'; g.textBaseline = 'top';
  [...KIND_MARK[it.kind]].forEach((ch, k) => g.fillText(ch, x + w / 2, y + w * 0.3 + k * fsSmall * 1.05));
  g.fillRect(x + w * 0.2, y + w * 0.3 + fsSmall * 2.3, w * 0.6, Math.max(1, w * 0.03));
  // 片名：中文直排，英文轉 90 度
  const top = y + w * 0.3 + fsSmall * 2.3 + w * 0.3, bottom = y + h - w * 1.2;
  const room = bottom - top;
  const title = it.title.replace(/[：:].*$/, '');
  if (/^[\x00-\x7f]+$/.test(title)) {
    let fs = w * 0.56;
    g.font = font(600, fs);
    while (g.measureText(title).width > room && fs > w * 0.3) { fs -= 1; g.font = font(600, fs); }
    g.translate(x + w / 2, top); g.rotate(Math.PI / 2); g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(title, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    const chars = [...title];
    let fs = w * 0.62;
    while (chars.length * fs * 1.04 > room && fs > w * 0.36) fs -= 0.5;
    const fit = Math.floor(room / (fs * 1.04));
    const shown = chars.length > fit ? [...chars.slice(0, fit - 1), '…'] : chars;
    g.font = font(600, fs); g.textAlign = 'center'; g.textBaseline = 'top';
    shown.forEach((ch, k) => g.fillText(ch, x + w / 2, top + k * fs * 1.04));
  }
  // 下方：年份
  if (it.year) { g.font = font(500, w * 0.3); g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(it.year.slice(2), x + w / 2, y + h - w * 0.35); }
  g.restore();
}

// 圖集：書背（36×472）與正面封面（96×137）
const SP = { size: 2048, w: 36, h: 472 }, CV = { size: 2048, w: 96, h: 137 };
const spCols = Math.floor(SP.size / SP.w), cvCols = Math.floor(CV.size / CV.w);
const spineAtlas = canvasTex(SP.size, SP.size, (g) => {
  g.fillStyle = '#111'; g.fillRect(0, 0, SP.size, SP.size);
  SHELF.forEach((_, i) => drawSpine(g, (i % spCols) * SP.w, Math.floor(i / spCols) * SP.h, SP.w, SP.h, i));
});
const coverAtlas = canvasTex(CV.size, CV.size, (g) => {
  g.fillStyle = '#111'; g.fillRect(0, 0, CV.size, CV.size);
  SHELF.forEach((_, i) => { const x = (i % cvCols) * CV.w, y = Math.floor(i / cvCols) * CV.h; if (posters[i]) g.drawImage(posters[i], x, y, CV.w, CV.h); else { g.fillStyle = css(colors[i]); g.fillRect(x, y, CV.w, CV.h); } });
});
function atlasMaterial(tex, uRange, cell) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRange = { value: new THREE.Vector2(...uRange) };
    sh.uniforms.uCell = { value: new THREE.Vector2(...cell) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCell;\nuniform vec2 uRange;\nuniform vec2 uCell;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = aCell + vec2((uv.x - uRange.x) / (uRange.y - uRange.x), uv.y) * uCell;');
  };
  return m;
}
// 從 Blender 做的 DVD 盒取出各部位的幾何（已套用在盒子座標裡的位置）
dvdTemplate.updateMatrixWorld(true);
const partGeo = (name) => { const o = dvdTemplate.getObjectByName(name); const g = (o.isMesh ? o : o.children.find((c) => c.isMesh)).geometry.clone(); g.applyMatrix4(o.matrixWorld); return g; };
const N = SHELF.length;
const plastic = new THREE.MeshStandardMaterial({ color: 0x1a1918, roughness: 0.3 });
const parts = [
  new THREE.InstancedMesh(partGeo('dvd_tray_body'), plastic, N),
  new THREE.InstancedMesh(partGeo('dvd_lid_body'), plastic, N),
  new THREE.InstancedMesh(partGeo('cover_spine'), atlasMaterial(spineAtlas, DV.u_spine, [SP.w / SP.size, SP.h / SP.size]), N),
  new THREE.InstancedMesh(partGeo('cover_front'), atlasMaterial(coverAtlas, [DV.u_spine[1], 1], [CV.w / CV.size, CV.h / CV.size]), N),
  new THREE.InstancedMesh(partGeo('cover_back'), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), N),
];
const spineMesh = parts[2];
const cellSp = new Float32Array(N * 2), cellCv = new Float32Array(N * 2);
SHELF.forEach((_, i) => {
  cellSp[i * 2] = ((i % spCols) * SP.w) / SP.size; cellSp[i * 2 + 1] = (Math.floor(i / spCols) * SP.h) / SP.size;
  cellCv[i * 2] = ((i % cvCols) * CV.w) / CV.size; cellCv[i * 2 + 1] = (Math.floor(i / cvCols) * CV.h) / CV.size;
});
parts[2].geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cellSp, 2));
parts[3].geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cellCv, 2));
parts.forEach((p) => scene.add(p));

// 排位置：上層先放、由左到右；換類別空一格，貼紙膠帶標籤
const rowsTopFirst = [...L.shelf.rows].reverse();
const slots = [];
const labels = [];
// 最上層「最近在看」：正在看的那部，加上最近看過的另外兩部
const recentIdx = [SHELF.findIndex((s) => s.title === S.now.title), ...SHELF.map((s, i) => [s, i]).filter(([s]) => s.title !== S.now.title).sort((a, b) => b[0].last.localeCompare(a[0].last)).slice(0, 2).map(([, i]) => i)].filter((i) => i >= 0);
const faceOut = new Set(recentIdx);
const Y_FACE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);  // 封面（盒子 +z）朝房間（-x）
{
  const top = L.shelf.top;
  const span = top.z_start - top.z_end;
  recentIdx.forEach((i, k) => {
    // 由左到右排三片，間距平均；盒子背面貼著片櫃背板
    const zc = top.z_end + span * (k + 1) / (recentIdx.length + 1);
    slots[i] = { x: top.x_back - 0.012, y: top.y, z: zc - DV.w / 2, row: -1, quat: Y_FACE };
  });
  labels.push({ kind: '最近在看', row: top, z: top.z_end + 0.02 });
  let r = 0, z = rowsTopFirst[0].z_end + 0.004;
  let prevKind = null;
  SHELF.forEach((it, i) => {
    if (faceOut.has(i)) return;
    const newKind = it.kind !== prevKind;
    if (newKind && prevKind !== null) z += 0.03;
    prevKind = it.kind;
    if (z + DV.d > rowsTopFirst[r].z_start - 0.003) { r++; z = rowsTopFirst[r].z_end + 0.004; }
    const row = rowsTopFirst[r];
    if (newKind) labels.push({ kind: it.kind, row, z });
    slots[i] = { x: row.x_front + 0.006, y: row.y, z, row: r };
    z += DV.d + 0.0005;
  });
}
labels.forEach(({ kind, row, z }) => {
  const tex = canvasTex(256, 72, (g, w, h) => {
    g.fillStyle = '#e9dcbf'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(42,28,19,0.85)'; g.font = '600 44px ' + FAMILY; g.textBaseline = 'middle'; g.fillText(kind, 18, h / 2 + 2);
  });
  const tape = new THREE.Mesh(new THREE.PlaneGeometry(kind.length > 3 ? 0.11 : 0.08, 0.0225), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  tape.position.set(row.x_front - 0.0015, row.y - 0.011, z + 0.04);
  tape.rotation.y = -Math.PI / 2;
  tape.rotation.z = (Math.random() - 0.5) * 0.06;
  scene.add(tape);
});

// 每片的「抽出來多少」與亮度
const pull = SHELF.map(() => ({ now: 0, to: 0 }));
const dim = SHELF.map(() => ({ now: 1, to: 1 }));
const hidden = new Set();
const tmpC = new THREE.Color();
function writeInstance(i) {
  const s = slots[i];
  if (hidden.has(i)) m4.makeScale(0, 0, 0);
  else if (s.quat) m4.compose(new THREE.Vector3(s.x - pull[i].now, s.y, s.z), s.quat, new THREE.Vector3(1, 1, 1));
  else m4.makeTranslation(s.x - pull[i].now, s.y, s.z);
  for (const p of parts) p.setMatrixAt(i, m4);
  tmpC.setScalar(dim[i].now);
  parts[2].setColorAt(i, tmpC); parts[3].setColorAt(i, tmpC);
  parts[4].setColorAt(i, tmpC.copy(colors[i]).multiplyScalar(0.45 * dim[i].now));
  parts[0].setColorAt(i, tmpC.setScalar(dim[i].now)); parts[1].setColorAt(i, tmpC);
}
SHELF.forEach((_, i) => writeInstance(i));
parts.forEach((p) => { p.instanceMatrix.needsUpdate = true; if (p.instanceColor) p.instanceColor.needsUpdate = true; });

let range = 'month';
const lifted = (i) => SHELF[i].in[range] || favSet.has(i);  // 時段內看過的、最愛的，都從書架抽出一點
function setRange(r) {
  range = r;
  $$('[data-range]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.range === r)));
  if (!searching) SHELF.forEach((it, i) => { pull[i].to = faceOut.has(i) ? 0 : it.in[r] || favSet.has(i) ? 0.016 : 0; dim[i].to = it.in[r] || favSet.has(i) || faceOut.has(i) ? 1 : 0.5; });
  const n = S.counts[r];
  renderStrip();
  $('[data-shelf-say]').textContent = `一共 ${SHELF.length} 部，電影、影集、動畫、實境秀分開放。${RANGE_WORD[r]}看過的 ${n} 部，我先抽出來了。${FAVS.length ? `最愛的 ${FAVS.length} 部一直抽在前面。` : ''}`;
}
$$('[data-range]').forEach((b) => b.addEventListener('click', () => setRange(b.dataset.range)));
/* 手機選片：這段時間看過的那幾部排成一排海報，左右滑、點一張就從書架抽出來（順序跟書架一樣） */
const stripEl = $('[data-strip]');
function renderStrip() {
  if (!stripEl) return;
  const items = stripOrder(SHELF.length, FAVS, (i) => SHELF[i].in[range]).map((i) => [SHELF[i], i]);  // 最愛排最前，其他照書架順序
  stripEl.replaceChildren(...items.map(([it, i]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'strip__item'; b.dataset.i = String(i); b.setAttribute('role', 'listitem'); b.setAttribute('aria-label', favSet.has(i) ? `${it.title}（我的最愛）` : it.title);
    if (favSet.has(i)) b.dataset.fav = '';
    if (it.poster) {
      const img = document.createElement('img');
      img.src = it.poster; img.alt = ''; img.loading = 'lazy'; img.width = 68; img.height = 102;
      b.append(img);
    } else {
      const t = document.createElement('span'); t.className = 'strip__title'; t.textContent = it.title; b.append(t);
    }
    return b;
  }));
  stripEl.scrollLeft = 0;
}
stripEl?.addEventListener('click', (e) => {
  const b = e.target.closest('.strip__item');
  if (!b || busy || inHand >= 0) return;
  if (!entered) enter(false, true); // 留在片櫃，不要捲回客廳
  pick(Number(b.dataset.i));
});

/* ---------- 搜尋片櫃：中文片名或原文都行；符合的抽出來，其他變暗 ---------- */
let searching = false;
const norm = (t) => (t || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const searchKeys = SHELF.map((it) => [norm(it.title), norm(it.alt)]);
const qEl = $('[data-q]'), resultsEl = $('[data-results]');
function runSearch() {
  const q = norm(qEl.value);
  resultsEl.innerHTML = '';
  if (!q) { searching = false; setRange(range); return; }
  searching = true;
  const hits = SHELF.map((it, i) => {
    const [a, b] = searchKeys[i];
    const pos = Math.min(...[a.indexOf(q), b.indexOf(q)].filter((x) => x >= 0).concat(Infinity));
    return { i, pos };
  }).filter((h) => h.pos !== Infinity).sort((x, y) => x.pos - y.pos || SHELF[y.i].days - SHELF[x.i].days);
  const hit = new Set(hits.map((h) => h.i));
  SHELF.forEach((_, i) => { pull[i].to = hit.has(i) && !faceOut.has(i) ? 0.035 : 0; dim[i].to = hit.has(i) ? 1 : 0.3; });
  if (!hits.length) {
    const li = document.createElement('li');
    li.className = 'search__empty';
    li.textContent = '片櫃上沒有這部。';
    resultsEl.append(li);
    return;
  }
  for (const { i } of hits.slice(0, 6)) {
    const it = SHELF[i];
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const name = document.createElement('span'); name.className = 'search__name'; name.textContent = it.title;
    const meta = document.createElement('span'); meta.className = 'search__meta'; meta.textContent = `${it.kind}・回來看了 ${it.days} 天`;
    btn.append(name, meta);
    btn.addEventListener('click', () => choose(i));
    li.append(btn);
    resultsEl.append(li);
  }
  if (hits.length > 6) { const li = document.createElement('li'); li.className = 'search__empty'; li.textContent = `還有 ${hits.length - 6} 部，架上都幫你抽出來了。`; resultsEl.append(li); }
}
function choose(i) {
  qEl.blur();
  pick(i);
}
qEl.addEventListener('input', runSearch);
qEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const first = resultsEl.querySelector('button'); if (first) first.click(); }
  if (e.key === 'Escape') { qEl.value = ''; runSearch(); }
});
setRange('month');
$('[data-shelf-hint]').textContent = touch ? '下面那排左右滑，點一部抽出來看看。' : '滑過去會顯示劇名，點一下抽出來看看。';

window.__step = 'shelf-ok';
/* ================================================================ 拿在手上的 DVD */
/** 依目前 g.font 把字串換行：中文逐字、最多 maxLines 行，放不下最後一行用「…」 */
function wrapLines(g, text, room, maxLines) {
  const chars = [...text], lines = [];
  let ci = 0;
  while (ci < chars.length && lines.length < maxLines) {
    let cur = '';
    while (ci < chars.length && g.measureText(cur + chars[ci]).width <= room) cur += chars[ci++];
    if (!cur) cur = chars[ci++];
    lines.push(cur.replace(/^ /, ''));
  }
  if (ci < chars.length) { const l = [...lines.pop()]; while (l.length > 1 && g.measureText(l.join('') + '…').width > room) l.pop(); lines.push(l.join('') + '…'); }
  return lines;
}
function coverTexture(i) {
  const it = SHELF[i], col = colors[i], img = posters[i];
  return canvasTex(2048, 1426, (g, w, h) => {
    const back = Math.round(w * DV.u_spine[0]), front = Math.round(w * DV.u_spine[1]);
    // 背面
    g.fillStyle = css(col, 0.55); g.fillRect(0, 0, back, h);
    g.fillStyle = 'rgba(244,230,205,0.95)';
    g.font = '600 64px ' + FAMILY; g.textBaseline = 'top';
    g.fillText(it.title.length > 13 ? it.title.slice(0, 12) + '…' : it.title, 70, 560);
    g.font = '500 38px ' + FAMILY;
    const lines = [`我回來看了 ${it.days} 天`, `第一次 ${ym(it.first)}`, `最後一次 ${ym(it.last)}`, [it.origin, ...it.genres].join('・')];
    lines.forEach((t, k) => g.fillText(t, 70, 650 + k * 54));
    // 背面簡介（像真的 DVD 背面）：自動換行，最多 6 行，超過用「…」
    if (it.overview) {
      g.fillStyle = 'rgba(244,230,205,0.85)'; g.font = '400 30px ' + FAMILY;
      wrapLines(g, it.overview.replace(/\s+/g, ' '), back - 140, 6).forEach((ln, k) => g.fillText(ln, 70, 886 + k * 46));
    }
    g.fillStyle = '#f4e6cd'; g.fillRect(70, h - 230, 300, 150);
    g.fillStyle = '#111';
    for (let k = 0, x = 86; x < 354; k++) { const bw = 2 + ((i * 7 + k * 13) % 5); g.fillRect(x, h - 214, bw, 100); x += bw + 2 + ((k * 5 + i) % 4); }
    g.font = font(500, 22); g.fillText(`No.${String(i + 1).padStart(4, '0')}`, 86, h - 106);
    g.fillStyle = 'rgba(244,230,205,0.7)'; g.font = '400 30px ' + FAMILY;
    g.fillText(`${S.owner} 家片庫`, 400, h - 150);
    // 書背
    g.save(); g.translate(back, 0);
    const tmp = document.createElement('canvas'); tmp.width = front - back; tmp.height = h;
    drawSpine(tmp.getContext('2d'), 0, 0, front - back, h, i);
    g.drawImage(tmp, 0, 0); g.restore();
    // 正面：海報滿版
    if (img) g.drawImage(img, front, 0, w - front, h);
    else { g.fillStyle = css(col); g.fillRect(front, 0, w - front, h); }
  });
}
function backdropImage(i) { return SHELF[i].backdrop ? loadImg(SHELF[i].backdrop) : Promise.resolve(null); }
function drawBackStill(tex, img) {
  if (!img) return;
  const g = tex.image.getContext('2d');
  g.drawImage(img, 70, 70, Math.round(2048 * DV.u_spine[0]) - 140, (Math.round(2048 * DV.u_spine[0]) - 140) * img.height / img.width);
  tex.needsUpdate = true;
}
function discTexture(i) {
  const it = SHELF[i], col = colors[i];
  return canvasTex(512, 512, (g, w) => {
    g.fillStyle = css(col, 0.9); g.fillRect(0, 0, w, w);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(w / 2, w / 2, w * 0.17, 0, Math.PI * 2); g.fill();
    g.fillStyle = inkOn(col); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 34px ' + FAMILY; g.fillText(it.title.length > 10 ? it.title.slice(0, 9) + '…' : it.title, w / 2, w * 0.3);
    g.font = '500 22px ' + FAMILY; g.fillText(`回來看了 ${it.days} 天`, w / 2, w * 0.72);
  });
}
function makeDvd(i) {
  const pivot = new THREE.Group();
  const dvd = dvdTemplate.clone(true);
  const cover = new THREE.MeshPhysicalMaterial({ map: coverTexture(i), roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.12 });
  const label = new THREE.MeshStandardMaterial({ map: discTexture(i), roughness: 0.45 });
  dvd.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material.name === 'cover') o.material = cover;
    else if (o.material.name === 'disc_label') o.material = label;
  });
  dvd.position.set(-DV.w / 2, -DV.h / 2, -DV.d / 2);
  pivot.add(dvd);
  pivot.userData = { dvd, cover, lid: dvd.getObjectByName('dvd_lid'), disc: dvd.getObjectByName('dvd_disc') };
  backdropImage(i).then((im) => drawBackStill(cover.map, im));
  return pivot;
}
const slotPose = (i, out = 0.13) => {
  const s = slots[i];
  if (s.quat) {
    const origin = new THREE.Vector3(s.x - out, s.y, s.z);
    const center = new THREE.Vector3(DV.w / 2, DV.h / 2, DV.d / 2).applyQuaternion(s.quat).add(origin);
    return { pos: center, quat: s.quat.clone() };
  }
  return { pos: new THREE.Vector3(s.x - out + DV.w / 2, s.y + DV.h / 2, s.z + DV.d / 2), quat: new THREE.Quaternion() };
};
function facingCamera(dist, side = 0, down = 0.02) {
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const up = camera.up.clone().applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  up.crossVectors(right, fwd).normalize();
  const pos = camera.position.clone().addScaledVector(fwd, dist).addScaledVector(right, side).addScaledVector(up, -down);
  const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate()));
  return { pos, quat };
}
function fly(obj, to, ms, arc = 0.06) {
  const p0 = obj.position.clone(), q0 = obj.quaternion.clone();
  return tween(ms, (k) => {
    obj.position.lerpVectors(p0, to.pos, k);
    obj.position.y += Math.sin(k * Math.PI) * arc;
    obj.quaternion.slerpQuaternions(q0, to.quat, k);
  });
}

let inHand = -1, busy = false, held = null, spin = 0, spinTo = 0;
const panel = $('[data-panel]');
// 劇情簡介（TMDB 的 zh-TW／zh-HK 文字，第三方字串一律 textContent）：預設收成幾行，超過才出現「展開」
const synEl = $('[data-p-syn]'), synText = $('[data-p-syn-text]'), synMore = $('[data-p-syn-more]');
function showSynopsis(it) {
  synEl.classList.remove('open');
  synMore.textContent = '展開'; synMore.setAttribute('aria-expanded', 'false');
  synEl.hidden = !it.overview;       // 沒有簡介就整段不出現
  synMore.hidden = true;
  synText.textContent = it.overview || '';
  if (!it.overview) return;
  requestAnimationFrame(updateSynMore);
}
// 被截到才需要「展開」。版面或字型晚一步才定下來（慢機器、字型後到）時 ResizeObserver 會再量一次，不會漏掉按鈕
function updateSynMore() {
  if (synEl.hidden || synEl.classList.contains('open')) return;
  synMore.hidden = !(synText.scrollHeight > synText.clientHeight + 1);
}
new ResizeObserver(updateSynMore).observe(synText);
document.fonts?.ready.then(updateSynMore);
synMore.addEventListener('click', () => {
  const open = synEl.classList.toggle('open');
  synMore.textContent = open ? '收合' : '展開'; synMore.setAttribute('aria-expanded', String(open));
});
function showPanel(i) {
  const it = SHELF[i];
  $('[data-p-meta]').textContent = [it.kind, it.year && `${it.year} 年`, it.origin, ...it.genres].filter(Boolean).join('・');
  $('[data-p-title]').textContent = `《${it.title}》`;
  $('[data-p-say]').textContent = `我前後回來看了 ${it.days} 天。第一次是 ${ym(it.first)}，最後一次是 ${ym(it.last)}。`;
  showSynopsis(it);
  $('[data-p-drag]').textContent = touch ? '左右拖可以轉一圈。' : '按住拖曳可以轉一圈。';
  $('[data-flip]').textContent = '翻到背面';
  panel.classList.add('on');
}
async function pick(i) {
  if (busy || inHand >= 0) return;
  busy = true; inHand = i; shelfTouched = true; lock(true); html.classList.add('in-hand'); hideTip();
  pull[i].to = 0.13;
  await tween(320, () => {});
  hidden.add(i); writeInstance(i); parts.forEach((p) => (p.instanceMatrix.needsUpdate = true));
  held = makeDvd(i);
  const sp = slotPose(i, pull[i].now);
  held.position.copy(sp.pos); held.quaternion.copy(sp.quat);
  scene.add(held);
  spin = spinTo = 0;
  const wide = innerWidth > 860;
  await fly(held, facingCamera(wide ? 0.42 : 0.55, wide ? -0.07 : 0, wide ? 0.0 : -0.13), 900, 0.05);  // 手機：放在畫面上半，下半是說明
  held.userData.base = held.quaternion.clone();
  showPanel(i);
  busy = false;
}
async function putBack() {
  if (busy || inHand < 0) return;
  busy = true; panel.classList.remove('on');
  const i = inHand;
  await fly(held, slotPose(i, 0.13), 800, 0.04);
  scene.remove(held); held = null;
  hidden.delete(i); pull[i].now = 0.13; pull[i].to = faceOut.has(i) ? 0 : lifted(i) ? 0.016 : 0;
  inHand = -1; busy = false; lock(false); html.classList.remove('in-hand');
}
$('[data-back]').addEventListener('click', putBack);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && inHand >= 0 && !busy) putBack(); });
$('[data-flip]').addEventListener('click', () => {
  spinTo = Math.round(spinTo / Math.PI) * Math.PI + Math.PI;
  $('[data-flip]').textContent = Math.round(spinTo / Math.PI) % 2 ? '翻回正面' : '翻到背面';
});
// 拖曳轉一圈
let drag = null;
canvas.addEventListener('pointerdown', (e) => { if (inHand >= 0 && !busy) { drag = { x: e.clientX, s: spinTo }; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener('pointermove', (e) => { if (drag) spinTo = drag.s + (e.clientX - drag.x) * 0.012; });
canvas.addEventListener('pointerup', () => { drag = null; });

/* ================================================================ 放進播放機 */
const POSE_PLAYER = { pos: [3.75, 1.28, -9.35], look: [3.38, 0.76, -10.45], fov: 46 };
let camOverride = null;
let nowPlaying = -1;
let skipSeq = false;
async function trayTo(open, ms) {
  const z0 = playerTray.position.z, z1 = trayBaseZ + (open ? L.player_tray.open_dz : 0);
  await tween(ms, (k) => (playerTray.position.z = z0 + (z1 - z0) * k), easeOut);
}
let oldDisc = null;
let playingSlot = -1;
window.__playErrs = [];
async function play(i, from) {
  // 手機：放映機特寫那 6 秒只看得到一塊空白藍幕和放映機，看不出在幹嘛；直接坐到沙發、銀幕開演（桌機保留放片動畫）
  if (isPhone()) {
    if (from) scene.remove(from);
    finishPlay(i);
    return;
  }
  try {
    await playSeq(i, from);
  } catch (err) {
    console.error('放片動畫出錯，直接開演：', err);
    window.__playErrs.push(String(err?.stack || err).slice(0, 400));
    finishPlay(i);
  }
}
async function playSeq(i, from) {
  if (busy && !from) return;
  busy = true; panel.classList.remove('on'); html.classList.add('playing-seq'); skipSeq = false;
  const pivot = from || held; held = null;
  camOverride = { ...CAMS.player[isPhone() ? 'phone' : 'wide'] };
  standby('NO DISC');
  await wait(700);
  display('OPEN');
  await trayTo(true, 900);
  if (oldDisc) { oldDisc.removeFromParent(); oldDisc = null; }
  const P = L.player;
  await fly(pivot, { pos: new THREE.Vector3(P.x + 0.34, P.y + 0.14, P.z + 0.12), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, -0.5, 0)) }, 1000, 0.08);
  const { lid, disc } = pivot.userData;
  await tween(650, (k) => (lid.rotation.y = -2.75 * k));
  scene.attach(disc);
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const trayWorld = new THREE.Vector3(); playerTray.getWorldPosition(trayWorld);
  await fly(disc, { pos: new THREE.Vector3(P.x, L.player_tray.y + 0.004, trayWorld.z), quat: flat }, 1000, 0.07);
  playerTray.attach(disc);
  oldDisc = disc;
  // 盒子闔上，平放在播放機旁邊
  tween(500, (k) => (lid.rotation.y = -2.75 * (1 - k)));
  fly(pivot, { pos: new THREE.Vector3(P.x + 0.42, P.y + DV.d / 2 + 0.001, P.z + 0.02), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0.3)) }, 900, 0.05)
    .then(() => { if (window.__case) scene.remove(window.__case); window.__case = pivot; });
  display('CLOSE');
  await trayTo(false, 900);
  display('LOADING');
  standby('LOADING…');
  await wait(900);
  display('PLAY  0:00:01');
  finishPlay(i);
}
function finishPlay(i) {
  lockedSince = 0;
  nowPlaying = i;
  camOverride = null;
  if (held) { scene.remove(held); held = null; }
  panel.classList.remove('on');
  html.classList.remove('playing-seq');
  inHand = -1; busy = false; html.classList.remove('in-hand');
  // 正在放的那片不在架上；換片時，上一片回到架上
  if (playingSlot >= 0 && playingSlot !== i) { hidden.delete(playingSlot); pull[playingSlot].now = 0.13; pull[playingSlot].to = lifted(playingSlot) ? 0.016 : 0; writeInstance(playingSlot); }
  playingSlot = i;
  html.classList.add('has-film');
  lock(false);
  startScreen(i);
  sofaCopy(i);
  goSofa();
}
// 放好片：鏡頭從播放機（或手上的 DVD）直接移到沙發，不跟著捲動經過片櫃。
// 做法：鏡頭先鎖在沙發的姿勢（render loop 會平滑過去），捲動在背後瞬間跳到沙發那段；鏡頭到位再交還給捲動，那時兩者是同一個姿勢，不會跳。
let sofaHold = null;
function goSofa() {
  const pose = CAMS.sofa[isPhone() ? 'phone' : 'wide'];
  const hold = (sofaHold = { pos: [...pose.pos], look: [...pose.look], fov: pose.fov, near: 'sofa' });
  camOverride = hold;
  scrollToEl($('#sofa'), 0);
  setTimeout(() => { if (camOverride === hold) camOverride = null; if (sofaHold === hold) sofaHold = null; }, reduced ? 0 : 1600);
}
$('[data-play]').addEventListener('click', () => { if (inHand >= 0) { hostPicked = false; play(inHand); } });
// 主人挑片：回來看最多天的那部，從片櫃抽出來自己放
let hostPicked = true;
async function hostPlay() {
  if (busy || inHand >= 0) return;
  // 先滑到沙發時已經自動放了我挑的那部：按下去不能沒反應，直接帶去沙發看
  if (nowPlaying === window.__sig) { html.classList.add('has-film'); goSofa(); return; }
  hostPicked = true; busy = true; lock(true);
  const i = window.__sig;
  let pivot;
  try {
    pull[i].to = 0.13;
    await wait(250);
    hidden.add(i); writeInstance(i); parts.forEach((p) => (p.instanceMatrix.needsUpdate = true));
    pivot = makeDvd(i);
    const sp = slotPose(i, 0.13);
    pivot.position.copy(sp.pos); pivot.quaternion.copy(sp.quat);
    scene.add(pivot);
  } catch (err) {
    console.error('抽片出錯，直接開演：', err);
    window.__playErrs.push(String(err?.stack || err).slice(0, 400));
    finishPlay(i);
    return;
  }
  camOverride = { ...CAMS.player[isPhone() ? 'phone' : 'wide'] };
  play(i, pivot);
}
$('[data-host]').addEventListener('click', hostPlay);
$('[data-skip-seq]').addEventListener('click', () => { if (html.classList.contains('playing-seq')) reduceSeq(); });
function reduceSeq() { tweens.forEach((t) => { t.t0 = -1e9; }); }

/* ================================================================ 銀幕 */
let screenOn = 0, screenTo = 0, screenTint = new THREE.Color(1, 1, 1), kb = 0;
let stillImg = null, titleCard = 0;
async function startScreen(i) {
  const img = await backdropImage(i);
  stillImg = img || posters[i];
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const g = c.getContext('2d'); if (stillImg) g.drawImage(stillImg, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0;
  for (let k = 0; k < d.length; k += 4) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; }
  screenTint = new THREE.Color(r / 64 / 255, gg / 64 / 255, b / 64 / 255).convertSRGBToLinear().lerp(new THREE.Color(1, 0.95, 0.88), 0.35).multiplyScalar(1.6);
  titleCard = performance.now();
  screenOn = 0; screenTo = 1; kb = 0;
  setLight('screen');
  drawScreen(i, 1);
  startTrailer(i);
}

/* ---------- 銀幕預告（YouTube 官方預告，沒有或放不了就維持上面的劇照） ---------- */
const YT_ORIGIN = 'https://www.youtube-nocookie.com';
const trUI = $('[data-trailer-ctl]');
const trSound = $('[data-tr-sound]'), trPause = $('[data-tr-pause]'), trNetflix = $('[data-tr-netflix]');
let tr = null;  // { idx, frame, obj, state, muted }
const trPost = (c) => { if (tr) tr.last = c; tr?.frame.contentWindow?.postMessage(command(c), YT_ORIGIN); };
// 開發模式才有：預告播放狀態（.aside/diag-trailer.js 讀，驗自動暫停、聲音、Netflix 連結）
if (import.meta.env?.DEV) Object.defineProperty(window, '__trailer', { get: () => tr && { idx: tr.idx, state: tr.state, muted: tr.muted, autoPaused: !!tr.autoPaused, last: tr.last ?? null, src: tr.frame.src, shown: trShown } });
// 畫面上看得到的段落文字（.copy）有沒有壓在 el 底下：看不到的（display: none、淡掉的、.gone）不算
const copyEls = $$('main .copy');
function copyUnder(el) {
  const c = el.getBoundingClientRect();
  return copyEls.some((e) => {
    if (e.classList.contains('gone') || !e.getClientRects().length || Number(getComputedStyle(e).opacity) < 0.05) return false;
    const r = e.getBoundingClientRect();
    return r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top;
  });
}
function stopTrailer() {
  if (!tr) return;
  cssScene.remove(tr.obj); tr.frame.src = 'about:blank'; tr.obj.element.remove();
  tr = null; trShown = false;
  css3d.domElement.style.display = 'none'; trUI.classList.remove('on');
}
function startTrailer(i) {
  stopTrailer();
  const url = embedUrl(SHELF[i].trailer?.yt, { origin: location.origin, reduced });
  if (!url) return;
  const frame = document.createElement('iframe');
  frame.title = `《${SHELF[i].title}》官方預告`;
  frame.allow = 'autoplay; encrypted-media; picture-in-picture';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  Object.assign(frame.style, { width: '1600px', height: '900px', border: '0', background: '#000', pointerEvents: 'none', display: 'block' });
  const box = document.createElement('div');
  Object.assign(box.style, { width: '1600px', height: '900px', background: '#000', pointerEvents: 'none' });
  box.append(frame);
  const obj = new CSS3DObject(box);
  obj.element.style.pointerEvents = 'none';
  obj.position.set(SC.x, SC.y, SC.z + 0.004);
  obj.scale.setScalar(SC.w / 1600);
  cssScene.add(obj);
  tr = { idx: i, frame, obj, state: reduced ? -1 : 1, muted: true };
  // 訂閱播放狀態（暫停、結束、出錯）：載入後送 listening，慢的話再送一次
  frame.addEventListener('load', () => { frame.contentWindow?.postMessage(LISTEN, YT_ORIGIN); setTimeout(() => tr?.frame === frame && frame.contentWindow?.postMessage(LISTEN, YT_ORIGIN), 1500); });
  frame.src = url;
  trNetflix.href = netflixSearchUrl(SHELF[i].title);
  trLabels();
}
function trLabels() {
  if (!tr) return;
  trSound.textContent = tr.muted ? '開聲音' : '關聲音';
  trPause.textContent = tr.state === 1 || tr.state === 3 ? '暫停' : '播放預告';
  trNetflix.classList.toggle('show', linkVisible(tr.state));
}
addEventListener('message', (e) => {
  if (!tr || e.origin !== YT_ORIGIN || e.source !== tr.frame.contentWindow) return;
  if (ytError(e.data)) { stopTrailer(); return; }
  const st = parseYtMessage(e.data);
  if (st === null) return;
  tr.state = st; trLabels();
});
trSound.addEventListener('click', () => { if (!tr) return; tr.muted = !tr.muted; trPost(tr.muted ? 'mute' : 'unMute'); if (!tr.muted && tr.state !== 1 && tr.state !== 3) trPost('playVideo'); trLabels(); });
trPause.addEventListener('click', () => { if (!tr) return; const playing = tr.state === 1 || tr.state === 3; tr.state = playing ? 2 : 1; trPost(playing ? 'pauseVideo' : 'playVideo'); trLabels(); });
// 銀幕中心在畫面內才顯示（CSS 層在 canvas 上面，鏡頭轉去別處時一定要藏起來）；時間軸、放片動畫、散場也藏
const trV = new THREE.Vector3();
let trShown = false;
function trailerVisible() {
  if (!tr || inTimeline || camOverride || !screenTo || nowPlaying !== tr.idx) return false;
  const corners = SC_CORNERS.map((c) => { const v = trV.copy(c).project(camera); return { x: v.x, y: v.y, z: v.z }; });
  const hole = DOOR_HOLE.map((c) => trV.copy(c).project(camera).z);
  trMode = trailerMode(camera.position.z, L.room.z0, corners, hole.some((z) => z >= 1 || z <= -1));
  return trMode !== 'off';
}
// 門洞前緣（門框正面 z -3.98）與後緣（-4.08）、門板：投影成螢幕像素，給 CSS3D 預告層裁切（站在門外看投影）
const DOOR_HOLE = [-3.98, -4.08].flatMap((z) => [[L.door.x0, 0], [L.door.x1, 0], [L.door.x1, L.door.h], [L.door.x0, L.door.h]].map(([x, y]) => new THREE.Vector3(x, y, z)));
let trMode = 'off';
const toPx = (v) => ({ x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight });
function trailerClip() {
  if (trMode !== 'door') return 'none';
  const pts = DOOR_HOLE.map((c) => toPx(trV.copy(c).project(camera)));
  let leaf = null;
  const leafMesh = doorHinge.getObjectByName('door_leaf');
  if (leafMesh?.geometry) {
    // 門板實際輪廓：每個頂點投影後取凸包（用方盒外框會挖太多，把預告多切掉一條）
    const pos = leafMesh.geometry.attributes.position;
    leafMesh.updateWorldMatrix(true, false);
    leaf = [];
    for (let k = 0; k < pos.count; k++) leaf.push(toPx(trV.fromBufferAttribute(pos, k).applyMatrix4(leafMesh.matrixWorld).project(camera)));
  }
  const c = doorClip(pts.slice(0, 4), pts.slice(4), leaf);
  return c ? clipPathCss(c) : 'inset(50%)';
}
function drawScreen(i, cardAlpha) {
  const g = screenCanvas.getContext('2d'), W = 1600, H = 900;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  if (stillImg) {
    const s = 1.06 + kb * 0.06;
    const iw = stillImg.width, ih = stillImg.height, r = Math.max(W / iw, H / ih) * s;
    g.drawImage(stillImg, (W - iw * r) / 2 - kb * 30, (H - ih * r) / 2, iw * r, ih * r);
  }
  // 手機：片名在底下的字裡已經有，銀幕上不再寫一次（不然會跟 HTML 的字疊在一起）
  if (cardAlpha > 0 && !isPhone()) {
    g.fillStyle = `rgba(0,0,0,${0.55 * cardAlpha})`; g.fillRect(0, H * 0.58, W, H * 0.42);
    g.globalAlpha = cardAlpha;
    g.fillStyle = '#f4e6cd'; g.font = '600 92px ' + FAMILY; g.textBaseline = 'alphabetic';
    g.fillText(SHELF[i].title, 90, H - 150);
    g.font = '500 40px ' + FAMILY; g.fillStyle = 'rgba(244,230,205,0.8)';
    g.fillText(`我回來看了 ${SHELF[i].days} 天`, 92, H - 86);
    g.globalAlpha = 1;
  }
  screenTex.needsUpdate = true;
}
// 投影機開機：深藍待機畫面，照亮播放機那一區
function standby(text) {
  stillImg = null; nowPlaying = -1; stopTrailer();
  const g = screenCanvas.getContext('2d'), W = 1600, H = 900;
  g.fillStyle = '#0b2a6b'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = font(500, 54); g.textAlign = 'right'; g.textBaseline = 'top';
  g.fillText(text, W - 80, 70); g.textAlign = 'left';
  screenTex.needsUpdate = true;
  screenTint = new THREE.Color(0.18, 0.32, 0.85);
  screenTo = 0.55;
}
function sofaCopy(i) {
  const it = SHELF[i];
  const t = $('[data-sofa-title]');
  if (hostPicked) {
    t.innerHTML = '';
    t.append(`我選了《${it.title}》，`, document.createElement('br'), '開始了。');
    const rank = [...SHELF].sort((a, b) => b.days - a.days).findIndex((s) => s === it) + 1;
    let say = `這部我前後回來看了 ${it.days} 天，${rank === 1 ? '比哪一部都多' : `在片櫃上排第 ${rank}`}。`;
    if (S.dominance && S.dominance.title === it.title) say += `${ym(S.dominance.month + '-01')}，我有開 Netflix 的 ${S.dominance.of} 天裡，有 ${S.dominance.days} 天在看它。`;
    $('[data-sofa-say]').textContent = say + '你坐靠窗那格。';
  } else {
    t.innerHTML = '';
    t.append(`你挑了《${it.title}》，`, document.createElement('br'), '開始了。');
    $('[data-sofa-say]').textContent = `你挑得好。這部我前後回來看了 ${it.days} 天，最後一次是 ${ym(it.last)}。坐靠窗那格，燈我關了。`;
  }
}
{
  // 主人放的片：每次來不一樣，有最愛就從最愛裡挑，沒有才從我回來看最多天的前 30 部裡隨機挑一部
  const pool = hostPool(SHELF, FAVS);
  const sig = pool[Math.floor(Math.random() * pool.length)];
  window.__sig = sig;
  const it = SHELF[sig];
  $('[data-sofa-title]').append(`我選了《${it.title}》，`, document.createElement('br'), '開始了。');
}
$('[data-again]').addEventListener('click', () => { html.classList.remove('has-film'); scrollToEl($('#shelf'), 2200); });
$('[data-bye-say]').textContent = `票根你帶走。下次來，片櫃上的 ${SHELF.length} 部都還在，隔壁的歌也還在放。`;
// 回播放室：跟播放室進來時一樣，先淡到暗場再換頁
$$('[data-leave]').forEach((a) => a.addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  $('[data-fade-say]').textContent = '';
  $('[data-fade]').classList.remove('out');
  setTimeout(() => { location.href = a.href; }, reduced ? 0 : 600);
}));
// 用上一頁回來（bfcache）時拿掉暗場
addEventListener('pageshow', (e) => { if (e.persisted) $('[data-fade]').classList.add('out'); });

/* ================================================================ 時間軸 */
const TL = S.timeline;
const tlEl = $('[data-timeline]');
const KIND_COLOR = { '電影': '#c9a27e', '影集': '#c0533a', '動畫': '#f3c47f', '實境秀': '#e6d7ba' };
const imgCache = new Map();
const cachedImg = (url) => { if (!url) return null; if (!imgCache.has(url)) { const im = new Image(); im.src = url; imgCache.set(url, im); im.onload = () => { if (inTimeline) drawTimeline(tlIndex, true); }; } const im = imgCache.get(url); return im.complete && im.naturalWidth ? im : null; };
let inTimeline = false, tlIndex = -1;
function timelineProgress() {
  const top = tlEl.offsetTop, len = tlEl.offsetHeight - innerHeight;
  const raw = (scrollY - top) / len;
  return { inside: scrollY > top - innerHeight * 0.35 && scrollY < top + len + innerHeight * 0.2, p: Math.min(1, Math.max(0, raw)) };
}
function monthWords(e) {
  const [y, m] = e.m.split('-');
  return { y, m: Number(m) };
}
function drawTimeline(idx, force) {
  if (idx === tlIndex && !force) return;
  tlIndex = idx;
  const e = TL[idx], { y, m } = monthWords(e);
  const g = screenCanvas.getContext('2d'), W = 1600, H = 900;
  g.fillStyle = '#120d0a'; g.fillRect(0, 0, W, H);
  const note = S.moments[e.m];
  if (isPhone()) {
    // 手機：直立畫面放不下橫的版面（右邊劇照、長條圖會被切掉），銀幕只放劇照＋年月大字＋這前後兩年的長條；
    // 看了幾部、最常回來這些字交給下面的網頁文字講，不在銀幕上重複
    const feat = e.now || e.top;
    const still = cachedImg(feat?.backdrop) || cachedImg(feat?.poster);
    if (still) {
      const r = Math.max(W / still.width, H / still.height);
      g.drawImage(still, (W - still.width * r) / 2, (H - still.height * r) / 2, still.width * r, still.height * r);
    }
    const shade = g.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, 'rgba(18,13,10,0.75)'); shade.addColorStop(0.45, 'rgba(18,13,10,0.15)'); shade.addColorStop(0.7, 'rgba(18,13,10,0.35)'); shade.addColorStop(1, 'rgba(18,13,10,0.92)');
    g.fillStyle = shade; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f4e6cd'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    displayText(g, true);
    g.font = font(600, 200); g.fillText(y, 80, 250);
    g.font = font(600, 120); g.fillText(`${m} 月`, 84, 390);
    displayText(g, false);
    const lo = Math.max(0, Math.min(TL.length - 24, idx - 12)), hi = Math.min(TL.length, lo + 24);
    const win = TL.slice(lo, hi), x0 = 80, x1 = W - 80, base = 840, maxH = 190;
    const maxW = Math.max(...win.map((t) => t.works)) || 1;
    const step = (x1 - x0) / win.length, bw = Math.max(6, step - 10);
    win.forEach((t, k) => {
      const at = lo + k, h = Math.max(4, (t.works / maxW) * maxH);
      g.globalAlpha = at === idx ? 1 : at < idx ? 0.7 : 0.3;
      g.fillStyle = at === idx ? '#f4e6cd' : (KIND_COLOR[t.top?.kind] || '#6d5a4a');
      g.fillRect(x0 + k * step, base - h, bw, h);
    });
  } else {
    // 這個月最常回來看的那部：劇照放右邊
    const feat = e.now || e.top;
    const still = cachedImg(feat?.backdrop) || cachedImg(feat?.poster);
    if (still) {
      const bw = 760, bh = 428, bx = W - bw - 70, by = 70;
      const r = Math.max(bw / still.width, bh / still.height);
      g.save(); g.beginPath(); g.rect(bx, by, bw, bh); g.clip();
      g.drawImage(still, bx + (bw - still.width * r) / 2, by + (bh - still.height * r) / 2, still.width * r, still.height * r);
      g.restore();
    }
    g.fillStyle = '#f4e6cd'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    displayText(g, true);
    g.font = font(600, 168); g.fillText(y, 80, 250);
    g.font = font(600, 96); g.fillText(`${m} 月`, 84, 370);
    displayText(g, false);
    g.font = font(500, 40); g.fillStyle = 'rgba(244,230,205,0.9)';
    g.fillText(e.works ? `看了 ${e.works} 部，有 ${e.days} 天在看` : '這個月什麼都沒看', 84, 450);
    if (e.now) {
      g.font = font(400, 34); g.fillStyle = 'rgba(244,230,205,0.72)';
      const t = e.now.title.length > 16 ? e.now.title.slice(0, 15) + '…' : e.now.title;
      g.fillText(`正在看：《${t}》`, 84, 506);
    } else if (e.top) {
      g.font = font(400, 34); g.fillStyle = 'rgba(244,230,205,0.72)';
      const t = e.top.title.length > 16 ? e.top.title.slice(0, 15) + '…' : e.top.title;
      g.fillText(`最常回來：《${t}》${e.top.days} 天`, 84, 506);
    }
    if (note) { g.font = font(500, 34); g.fillStyle = '#f3c47f'; g.fillText(note.length > 30 ? note.slice(0, 29) + '…' : note, 84, 566); }
    // 底下一排：一個月一根，高度是看了幾部，顏色是那個月最常看的類別
    const x0 = 80, x1 = W - 80, base = 820, maxH = 170;
    const maxW = Math.max(...TL.map((t) => t.works)) || 1;
    const step = (x1 - x0) / TL.length, bw = Math.max(3, step - 5);
    TL.forEach((t, k) => {
      const h = Math.max(3, (t.works / maxW) * maxH);
      g.globalAlpha = k === idx ? 1 : k < idx ? 0.62 : 0.22;
      g.fillStyle = k === idx ? '#f4e6cd' : (KIND_COLOR[t.top?.kind] || '#6d5a4a');
      g.fillRect(x0 + k * step, base - h, bw, h);
      if (S.moments[t.m]) { g.fillStyle = '#f3c47f'; g.beginPath(); g.arc(x0 + k * step + bw / 2, base - h - 14, 5, 0, Math.PI * 2); g.fill(); }
      if (t.m.endsWith('-01') || k === 0) { g.globalAlpha = 0.7; g.fillStyle = '#f4e6cd'; g.font = font(500, 24); g.fillText(t.m.slice(0, 4), x0 + k * step, base + 40); }
    });
    g.globalAlpha = 1;
  }
  g.globalAlpha = 1;
  screenTex.needsUpdate = true;
  $('[data-tl-say]').textContent = !e.works ? `${y} 年 ${m} 月，這個月什麼都沒看。`
    : e.now ? `${y} 年 ${m} 月，看了 ${e.works} 部。現在正在看的是《${e.now.title}》。`
    : `${y} 年 ${m} 月，看了 ${e.works} 部${e.top ? `，最常回來的是《${e.top.title}》，${e.top.days} 天` : ''}。`;
  const yr = S.years[y];
  $('[data-tl-note]').textContent = note || (yr ? `${y} 這一年一共 ${yr.works} 部。` : '');
}

/* ================================================================ 燈光 */
const TL_TINT = new THREE.Color(1.15, 1.0, 0.85);
// 燈光不給訪客調：進門開小燈，開演只留銀幕的光，散場再開回來
const PRESETS = { lamp: { lamp: 1 }, screen: { lamp: 0.1 } };
let lightKey = 'lamp';
function setLight(key) { lightKey = key; }

/* ================================================================ 撕票、進門 */
let entered = false, doorTo = 1;
function moveStubToDock(animate) {
  const stub = $('[data-stub]'), dock = $('[data-dock]');
  const from = stub.getBoundingClientRect();
  dock.appendChild(stub);
  if (!animate || reduced) return;
  const to = stub.getBoundingClientRect();
  stub.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) rotate(7deg) scale(${from.width / to.width})`, transformOrigin: 'top left' }, { transform: 'none', transformOrigin: 'top left' }], { duration: 820, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
}
// stay：訪客自己捲過門口時用，不再把他拉回客廳
function enter(animate, stay = false) {
  if (entered) return;
  entered = true;
  const ticket = $('[data-ticket]');
  const finish = () => {
    $('#door').classList.add('torn');
    moveStubToDock(animate);
    punch(0);
    doorTo = 1;
    html.classList.remove('intro-running');
    if (!stay) setTimeout(() => scrollToEl($('#hall'), animate ? 3400 : 0), animate ? 700 : 0);
  };
  if (!animate || reduced) { ticket.style.visibility = 'hidden'; finish(); return; }
  ticket.classList.add('tug');
  setTimeout(() => { ticket.classList.add('tearing'); setTimeout(() => { finish(); setTimeout(() => (ticket.style.visibility = 'hidden'), 400); }, 380); }, 240);
}
$('[data-tear]').addEventListener('click', () => enter(true));
$('[data-skip]').addEventListener('click', () => enter(false));
$('[data-loading]').remove();
$('[data-tear]').disabled = false;
$('[data-skip]').disabled = false;

/* ================================================================ 最愛段落（沒有最愛就整段不出現） */
if (FAVS.length) {
  const c = favCopy(FAVS.map((i) => SHELF[i]));
  $('#favorites').hidden = false;
  $('[data-fav-nav]').hidden = false;
  $('[data-fav-title]').append(c.titleTop, document.createElement('br'), c.titleBottom);
  $('[data-fav-say]').textContent = c.lead;
  $('[data-fav-hint]').textContent = c.hint;
  // 沒有片的排不留推近那段（最愛不滿 9 部時）
  $$('[data-fav-row]').forEach((el) => { if (!FAVS.slice(Number(el.dataset.favRow) * 3).length) el.remove(); });
  $('[data-fav-list]').append(...FAVS.map((i) => { const li = document.createElement('li'); li.textContent = SHELF[i].title; return li; }));
} else {
  $('#favorites')?.remove();
  $('[data-fav-nav]')?.remove();
}

/* ================================================================ 鏡頭：跟著捲動（同播放室的 data-cam） */
const CAMS = {
  // 接播放室換頁前的最後一格：cinema 往 (3.25,1.5,-2.6) 推近 0.62，fov × 0.86（見 web/src/room/room.ts 的 dive()）
  door: { wide: { pos: [2.6, 1.55, -2.03], look: [3.25, 1.3, -4.4], fov: 43 }, phone: { pos: [2.737, 1.538, -1.84], look: [3.25, 1.3, -4.4], fov: 60.2 } },
  threshold: { wide: { pos: [3.25, 1.6, -3.45], look: [3.5, 1.3, -8], fov: 56 }, phone: { pos: [3.25, 1.6, -3.4], look: [3.5, 1.3, -8], fov: 74 } },
  hall: { wide: { pos: [3.2, 1.62, -4.55], look: [4.4, 1.0, -10.5], fov: 58 }, phone: { pos: [3.2, 1.62, -4.45], look: [4.2, 1.05, -10.5], fov: 78 } },
  shelf: { wide: { pos: [4.85, 1.42, -5.2], look: [6.7, 1.12, -5.95], fov: 52 }, phone: { pos: [5.45, 1.3, -5.36], look: [6.7, 1.05, -5.36], fov: 74 } },
  player: { wide: { pos: [3.75, 1.28, -9.35], look: [3.38, 0.76, -10.45], fov: 46 }, phone: { pos: [3.7, 1.32, -9.15], look: [3.36, 0.76, -10.45], fov: 66 } },
  bye: { wide: { pos: [3.45, 1.6, -6.6], look: [3.2, 1.25, -3.6], fov: 54 }, phone: { pos: [3.4, 1.6, -6.9], look: [3.2, 1.25, -3.6], fov: 74 } },
  favorites: { get wide() { return favWidePose(innerWidth / innerHeight); }, get phone() { return favPhonePose(innerWidth, innerHeight); } },
  // 手機：逐排推近（桌機沒有這三格，段落只有全景那一格）
  ...Object.fromEntries([0, 1, 2].map((r) => [`favorites-r${r}`, { get wide() { return favWidePose(innerWidth / innerHeight); }, get phone() { return favRowPose(r, innerWidth, innerHeight); } }])),
  sofa: { wide: { pos: [3.05, 1.12, -7.6], look: [3.2, 1.42, -11], fov: 52 }, get phone() { return screenPhonePose(); } },
};
const isPhone = () => innerWidth / innerHeight < 0.9;
// 手機看銀幕：退到沙發後面，整面銀幕（寬 SC.w）放進畫面寬度、擺在畫面上方約 27% 的高度，下半留給字
// 手機沙發鏡頭：算法與為什麼要實際投影四角，見 screen-pose.ts
const screenPhonePose = () => phoneScreenPose(innerWidth / innerHeight, SC);
let anchors = [];
const measure = () => {
  const vh = innerHeight;
  anchors = $$('[data-cam]').filter((el) => !el.closest('[hidden]') && el.getClientRects().length).map((el) => { const b = el.getBoundingClientRect(); return { cam: el.dataset.cam, at: b.top + scrollY + b.height / 2 - vh / 2 }; }).sort((a, b) => a.at - b.at);
};
// 給 .aside 驗收腳本讀鏡頭（只有 dev）
if (import.meta.env?.DEV) window.__scr = { camera, target: () => target(), anchors: () => anchors, isPhone: () => isPhone(), SC };
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); css3d.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); measure(); };
addEventListener('resize', resize);
new ResizeObserver(measure).observe(document.body);
resize();
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function target() {
  const y = scrollY;
  let i = anchors.findIndex((a, k) => y < (anchors[k + 1]?.at ?? Infinity));
  if (i < 0) i = 0;
  const a = anchors[i], b = anchors[i + 1];
  let t = b ? Math.min(1, Math.max(0, (y - a.at) / (b.at - a.at))) : 0;
  if (y < a.at) t = 0;
  t = ease(Math.min(1, Math.max(0, (t - 0.15) / 0.7)));
  if (reduced && a.cam.startsWith('favorites') && (b?.cam ?? '').startsWith('favorites')) t = t < 0.5 ? 0 : 1;  // 減少動態：排與排之間直接切
  const k = isPhone() ? 'phone' : 'wide';
  const pa = CAMS[a.cam][k], pb = b ? CAMS[b.cam][k] : pa;
  return { pos: mix(pa.pos, pb.pos, t), look: mix(pa.look, pb.look, t), fov: pa.fov + (pb.fov - pa.fov) * t, near: t < 0.5 ? a.cam : (b?.cam ?? a.cam) };
}

/* ---------- 現在在哪：頂列、打孔、到沙發時沒挑就先放代表作 ---------- */
let lastWhere = '';
function onWhere(name) {
  html.dataset.where = name;
  $$('[data-where]').forEach((a) => a.setAttribute('aria-current', String(a.dataset.where === name)));
  if (entered && name === 'hall') punch(1);
  if (entered && name === 'sofa') punch(2);
  if (name === 'bye') { setLight('lamp'); screenTo = 0; stopTrailer(); }
  if (name === 'sofa' && nowPlaying < 0 && !busy) { hostPicked = true; nowPlaying = window.__sig; startScreen(window.__sig); sofaCopy(window.__sig); }
}
$$('[data-where]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); if (entered && inHand < 0) scrollToEl($(a.getAttribute('href')), 1600); }));

/* ---------- 滑過書背 ---------- */
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let hover = -1, atShelf = false, shelfTouched = false;
const tip = $('[data-tip]');
function hideTip() { tip.classList.remove('on'); if (hover >= 0) { pull[hover].to = faceOut.has(hover) ? 0 : lifted(hover) ? 0.016 : 0; hover = -1; } canvas.style.cursor = ''; }
function hit(e) {
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const h = ray.intersectObjects([parts[2], parts[0]], false)[0];
  return h ? h.instanceId : -1;
}
canvas.addEventListener('pointermove', (e) => {
  if (!atShelf || inHand >= 0 || busy || touch) return;
  const i = hit(e);
  if (i !== hover) {
    if (hover >= 0) pull[hover].to = faceOut.has(hover) ? 0 : lifted(hover) ? 0.016 : 0;
    hover = i;
    if (i >= 0) { pull[i].to = faceOut.has(i) ? 0.02 : 0.04; tip.innerHTML = ''; const b = document.createElement('b'); b.textContent = SHELF[i].title; tip.append(b, `${SHELF[i].kind}・回來看了 ${SHELF[i].days} 天`); }
  }
  tip.classList.toggle('on', i >= 0);
  canvas.style.cursor = i >= 0 ? 'pointer' : '';
  tip.style.left = `${e.clientX}px`; tip.style.top = `${e.clientY}px`;
});
canvas.addEventListener('pointerleave', hideTip);
canvas.addEventListener('click', (e) => {
  if (!atShelf || inHand >= 0 || busy) return;
  const i = hit(e);
  if (i >= 0) pick(i);
});

/* ================================================================ 每一格畫面 */
const first = CAMS.door[isPhone() ? 'phone' : 'wide'];
const cur = { pos: new THREE.Vector3(...first.pos), look: new THREE.Vector3(...first.look), fov: first.fov };
const lit = { lamp: 1, door: 1 };
const pointer = { x: 0, y: 0 };
addEventListener('pointermove', (e) => { pointer.x = e.clientX / innerWidth - 0.5; pointer.y = e.clientY / innerHeight - 0.5; });
let last = performance.now();
const hallEl = $('#hall'), sofaCopyEl = $('#sofa .copy');
function frame(now) {
  // 沒按「撕下票根」直接往下滑（手機很常這樣）：捲過門口就當作進門了，時間軸、打孔才會動
  if (!entered && scrollY > hallEl.offsetTop - innerHeight * 0.6) enter(false, true);
  // 手機：沙發那段的字往上捲到銀幕那一帶時淡掉，不壓在劇照上
  if (isPhone()) { const b = sofaCopyEl.getBoundingClientRect().bottom / innerHeight; const o = Math.min(1, Math.max(0, (b - 0.5) / 0.22)); sofaCopyEl.style.transition = 'none'; sofaCopyEl.style.opacity = String(o); sofaCopyEl.classList.toggle('gone', o < 0.1); }
  else if (sofaCopyEl.style.opacity) { sofaCopyEl.style.opacity = sofaCopyEl.style.transition = ''; sofaCopyEl.classList.remove('gone'); }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  runTweens(now);
  if (lockedSince && now - lockedSince > 15000 && inHand < 0 && !held) {
    console.error('捲動鎖住超過 15 秒，自動解開');
    window.__playErrs?.push('watchdog: locked > 15s');
    camOverride = null; busy = false; html.classList.remove('playing-seq', 'in-hand'); lock(false);
  }
  const tp = timelineProgress();
  const wasTl = inTimeline;
  inTimeline = tp.inside && entered && !camOverride;
  html.classList.toggle('in-tl', inTimeline);
  if (inTimeline) { drawTimeline(Math.round(tp.p * (TL.length - 1)), !wasTl); screenTo = 1; if (tp.p > 0.98) punch(3); }
  else if (wasTl && nowPlaying >= 0) titleCard = performance.now() - 6000;
  const tg = camOverride ? { near: 'player', ...camOverride } : target();
  const k = reduced ? 1 : 1 - Math.exp(-dt * (camOverride ? 3 : 5));
  const sway = isPhone() || reduced || inHand >= 0 || camOverride ? [0, 0] : [pointer.x * 0.3, -pointer.y * 0.18];
  cur.pos.lerp(new THREE.Vector3(...tg.pos), k);
  cur.look.lerp(new THREE.Vector3(tg.look[0] + sway[0], tg.look[1] + sway[1], tg.look[2]), k);
  cur.fov += (tg.fov - cur.fov) * k;
  camera.position.copy(cur.pos); camera.lookAt(cur.look); camera.fov = cur.fov; camera.updateProjectionMatrix();
  const where = inTimeline ? 'timeline' : (tg.near === 'threshold' ? 'hall' : tg.near.startsWith('favorites') ? 'favorites' : tg.near);
  atShelf = where === 'shelf' && entered && !camOverride;
  // 手機：抽過一次之後回到片櫃（放回去、換一部），說明收起來、控制項貼底，整面書架露出來好再挑
  html.classList.toggle('shelf-dock', isPhone() && atShelf && shelfTouched && inHand < 0);
  if (!atShelf && hover >= 0) hideTip();
  if (where !== lastWhere) { lastWhere = where; onWhere(where); }

  // 門
  lit.door += (doorTo - lit.door) * (reduced ? 1 : 1 - Math.exp(-dt * 1.5));
  doorHinge.rotation.y = 1.75 * ease(Math.min(1, lit.door));
  // 燈光層
  const kl = reduced ? 1 : 1 - Math.exp(-dt * 1.8);
  lit.lamp += (PRESETS[lightKey].lamp - lit.lamp) * kl;
  screenOn += (screenTo - screenOn) * (reduced ? 1 : 1 - Math.exp(-dt * 1.3));
  const flicker = screenTo && screenOn < 0.6 && !reduced ? 0.7 + Math.random() * 0.3 : 1;
  const s = screenOn * flicker;
  U.kL.value = 1.9 * lit.lamp;
  U.kS.value = 2.2 * s;
  U.tint.value.copy(inTimeline ? TL_TINT : screenTint);
  U.kN.value = 1.5;
  lampLight.intensity = 14 * lit.lamp;
  shelfLights.forEach((a) => (a.intensity = 26 * lit.lamp));
  shadeMat.color.setRGB(0.12 + 0.58 * lit.lamp, 0.08 + 0.42 * lit.lamp, 0.05 + 0.22 * lit.lamp);
  hemi.intensity = 0.3 + 0.55 * lit.lamp + 0.25 * s;
  // 最愛燈箱：開燈時最亮、播放時退到暗場（約三分之一），不搶銀幕；鏡頭停在它前面時再亮一點
  if (favBox) {
    favGlow += ((tg.near.startsWith('favorites') ? 1 : 0) - favGlow) * (reduced ? 1 : 1 - Math.exp(-dt * 3));
    const b = (0.3 + 0.7 * lit.lamp) * (0.82 + 0.18 * favGlow);
    favBox.faceMat.color.setScalar(b);
    favBox.haloMat.opacity = 0.6 * b * b;
  }
  screenLight.color.copy(inTimeline ? TL_TINT : screenTint);
  screenLight.intensity = 2.2 * s;
  // 預告（CSS3D）正在播時，底下的 WebGL 銀幕改成全黑：門外裁切若差幾 px，露出的是投影邊緣的黑，不是另一張劇照
  screenMat.color.setScalar((0.04 + 0.96 * s) * (trShown && tr && tr.state === 1 ? 0 : 1));
  beamMat.opacity = 0.012 * s;
  lensMat.color.setScalar(0.9 * s);
  // 銀幕：片名卡 4 秒後淡出，劇照慢慢推近
  if (screenTo && stillImg && nowPlaying >= 0 && !inTimeline) {
    kb = Math.min(1, kb + dt / 40);
    const card = Math.max(0, Math.min(1, 1 - (now - titleCard - 4000) / 1200));
    drawScreen(nowPlaying, card);
  }
  // 招牌燈泡
  for (let i = 0; i < L.bulbs.length; i++) bulbs.setColorAt(i, tmpC.setScalar(0.65 + 0.35 * (0.5 + 0.5 * Math.sin(now / 260 - i * 0.6))));
  bulbs.instanceColor.needsUpdate = true;
  // 片櫃
  let moved = false;
  const kp = reduced ? 1 : 1 - Math.exp(-dt * 10);
  for (let i = 0; i < N; i++) {
    const p = pull[i], d = dim[i];
    if (Math.abs(p.to - p.now) > 1e-4 || Math.abs(d.to - d.now) > 1e-3) { p.now += (p.to - p.now) * kp; d.now += (d.to - d.now) * kp; writeInstance(i); moved = true; }
  }
  if (moved) parts.forEach((p) => { p.instanceMatrix.needsUpdate = true; if (p.instanceColor) p.instanceColor.needsUpdate = true; });
  // 拿在手上：鏡頭旁邊補光
  handLight.position.copy(camera.position).add(new THREE.Vector3(0.15, 0.2, 0).applyQuaternion(camera.quaternion));
  handLight.intensity += ((held ? 1.4 : 0) - handLight.intensity) * (reduced ? 1 : 1 - Math.exp(-dt * 6));
  // 拿在手上：轉
  if (held && held.userData.base && !busy) {
    spin += (spinTo - spin) * (reduced ? 1 : 1 - Math.exp(-dt * 8));
    held.quaternion.copy(held.userData.base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin));
  }
  renderer.render(scene, camera);
  const trVis = trailerVisible();
  if (trVis) { css3d.domElement.style.opacity = String(Math.min(1, screenOn * 1.3)); css3d.domElement.style.clipPath = trailerClip(); css3d.render(cssScene, camera); }
  if (trVis !== trShown) {
    trShown = trVis; css3d.domElement.style.display = trVis ? '' : 'none'; trUI.classList.toggle('on', trVis);
    // display:none 的 iframe 照樣會播：藏起來時正在播就先停，回到銀幕前再接著播（訪客自己按的暫停不動）
    if (tr && !trVis && (tr.state === 1 || tr.state === 3)) { tr.autoPaused = true; trPost('pauseVideo'); }
    else if (tr && trVis && tr.autoPaused) { tr.autoPaused = false; trPost('playVideo'); }
  }
  // 桌機：預告按鈕固定在畫面底部正中，左欄的字（客廳、片櫃、沙發、散場）捲過那一帶時先讓開，字停好再回來。
  // 手機不用：按鈕貼在銀幕下緣，沙發的字往上捲到那裡之前就淡掉了
  if (trShown) trUI.classList.toggle('yield', !isPhone() && copyUnder(trUI));
  requestAnimationFrame(frame);
}
// 載入途中已經改用 HTML 版（20 秒沒進度、素材出錯）：main 被藏起來，鏡頭點（data-cam）一個都量不到，
// 這時還開動畫迴圈，target() 會讀到空的 anchors 而每格丟錯。退路一旦決定就不再啟動 3D（2026-11-09 稽核 2560×1440 量到）
if (html.classList.contains('fallback-on')) window.__step = 'fell-back';
else {
  window.__step = 'running';
  requestAnimationFrame(frame);
  requestAnimationFrame(() => requestAnimationFrame(() => $('[data-fade]').classList.add('out')));
}
window.__room = { scene, camera, U, pick, SHELF, slots };
