import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import type { TasteProfile } from '../src/core/profile.ts';
import { gigsOf, yearRank } from '../src/page/gigs.ts';
import { renderPage, roomData } from '../src/page/render.ts';
import { BACK_WALL_OBSTACLES, BORDER, DEFAULT_LIGHTBOX_RECT, FACE_ASPECT, FRAME_GAP, GIG_AREA, TIER_W, WINDOW_K, frameRect, gigLayout, tierOf, uniformNameEm, usableArea } from '../src/room/gig-layout.ts';
import { GIGS_CAM, gigsThirdOf } from '../src/room/gigs-cam.ts';
import { gigWallFromJson, obstaclesFromOccluders } from '../src/room/gig-wall.ts';
import { boxLook, finalLinear, linearToSrgb, PLAY_LEVEL, WALL_HEX } from '../src/room/poster-light.ts';
import { atlasSize, cellWidthFor, drawAtlas, estimateNameEm, HAIRLINE, INK_TEXT, INKS, MAX_ATLAS, nameEmPx, nameFont, PAPER_HEX, poolAlpha } from '../src/room/posters.ts';

const owner = JSON.parse(readFileSync(new URL('../src/data/owner.json', import.meta.url), 'utf8')) as { favorites: { gigs: { name: string; spotify: string }[] } };
const profile = JSON.parse(readFileSync(new URL('../src/data/profile.json', import.meta.url), 'utf8')) as TasteProfile;
const picks = owner.favorites.gigs;
const N = picks.length;
const gigs = gigsOf(profile, picks, () => true);
const items = gigs.map((g) => ({ rankNo: g.rankNo }));
const layout = gigLayout(items, GIG_AREA, BACK_WALL_OBSTACLES);

type Rect = { zMin: number; zMax: number; yMin: number; yMax: number };
const dist = (a: Rect, b: Rect) => Math.hypot(Math.max(0, a.zMin - b.zMax, b.zMin - a.zMax), Math.max(0, a.yMin - b.yMax, b.yMin - a.yMax));
const rects = layout.frames.map((f) => ({ f, kind: 'frame', r: frameRect(f) }));

test('版面：張數跟清單一樣、整組都在燈箱凹牆的可用區內', () => {
  assert.equal(layout.frames.length, N);
  const R = DEFAULT_LIGHTBOX_RECT;
  for (const { r } of rects) {
    assert.ok(r.zMin >= GIG_AREA.zMin - 1e-9 && r.zMax <= GIG_AREA.zMax + 1e-9, `x ${r.zMin}..${r.zMax}`);
    assert.ok(r.yMin >= GIG_AREA.yMin - 1e-9 && r.yMax <= GIG_AREA.yMax + 1e-9, `y ${r.yMin}..${r.yMax}`);
    assert.ok(r.zMin >= R.x0 && r.zMax <= R.x1 && r.yMin >= R.y0 && r.yMax <= R.y1, '在凹牆矩形內');
  }
});

test('版面：互不重疊，框與框距離至少 4 公分', () => {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      assert.ok(dist(a.r, b.r) >= 0.04 - 1e-9, `${a.f.index} 與 ${b.f.index} 距離 ${dist(a.r, b.r)}`);
    }
  }
  assert.ok(FRAME_GAP >= 0.04 && FRAME_GAP <= 0.06);
});

test('版面：不撞唱盤加細腳架與兩支喇叭（遮擋物投影到牆面的矩形）', () => {
  for (const { f, kind, r } of rects) {
    for (const o of BACK_WALL_OBSTACLES) assert.ok(!(r.zMax > o.zMin && r.zMin < o.zMax && r.yMax > o.yMin && r.yMin < o.yMax), `${f.index}${kind} 撞到遮擋物`);
  }
  // 橫向跟凹牆重疊的遮擋物（唱盤架、唱盤、管機、VU 表）最高的頂端：整組下緣至少在它上面 5 公分
  const top = Math.max(...BACK_WALL_OBSTACLES.filter((o) => o.zMax > DEFAULT_LIGHTBOX_RECT.x0 && o.zMin < DEFAULT_LIGHTBOX_RECT.x1).map((o) => o.yMax));
  assert.ok(layout.bounds.yMin >= top + 0.05 - 1e-9, `整組下緣 ${layout.bounds.yMin} 要在 ${top} 之上`);
});

test('版面：名次越前框越大，沒上榜最小；細框寬 1.5–2.5 公分；款式是霧黑細框', () => {
  const byRank = [...layout.frames].sort((a, b) => (gigs[a.index]!.rankNo ?? 999) - (gigs[b.index]!.rankNo ?? 999));
  for (let i = 1; i < byRank.length; i++) assert.ok(byRank[i - 1]!.w >= byRank[i]!.w - 1e-9);
  const none = layout.frames.find((f) => gigs[f.index]!.rankNo === null);
  assert.ok(none && none.w <= Math.min(...layout.frames.map((f) => f.w)) + 1e-9);
  assert.equal(tierOf(1), 'XL');
  assert.equal(tierOf(null), 'XS');
  assert.ok(TIER_W.XL > TIER_W.L && TIER_W.L > TIER_W.M && TIER_W.M > TIER_W.S && TIER_W.S > TIER_W.XS);
  for (const f of layout.frames) {
    assert.equal(f.style, 'black');
    assert.ok(f.border >= 0.015 - 1e-9 && f.border <= 0.025 + 1e-9, `框條 ${f.border}`);
  }
  assert.ok(Object.values(BORDER).every((b) => b >= 0.015 && b <= 0.025));
});

test('版面：最大的兩幅在同一排（放在中間偏上）；每排框沿同一條水平中心線對齊', () => {
  const two = [...layout.frames].sort((a, b) => b.w - a.w).slice(0, 2);
  assert.equal(two[0]!.row, two[1]!.row);
  assert.equal(two[0]!.row, Math.floor((layout.rows.length - 1) / 2));
  for (let r = 0; r < layout.rows.length; r++) {
    const ys = layout.frames.filter((f) => f.row === r).map((f) => f.y);
    assert.ok(Math.max(...ys) - Math.min(...ys) < 1e-9);
  }
});

test('版面：吃「可用矩形＋遮擋物」參數，換牆只換參數；排數依寬高比自己選；撞到遮擋物或放不下就丟錯', () => {
  assert.equal(layout.rows.length, 2, '寬扁的凹牆用 2 排');
  const tall = { zMin: 0, zMax: 1.8, yMin: 0.5, yMax: 2.5 };
  const t = gigLayout(items, tall);
  assert.equal(t.rows.length, 3, '高的區塊用 3 排');
  for (const f of t.frames) assert.ok(frameRect(f).zMin >= tall.zMin - 1e-9 && frameRect(f).zMax <= tall.zMax + 1e-9);
  const mid = { zMin: t.bounds.zMin + 0.5, zMax: t.bounds.zMin + 0.6, yMin: t.bounds.yMin, yMax: t.bounds.yMax };
  assert.throws(() => gigLayout(items, tall, [mid]));
  assert.doesNotThrow(() => gigLayout(items, tall, [{ zMin: 3, zMax: 4, yMin: 0, yMax: 1 }]));
  assert.throws(() => gigLayout(items, { zMin: 0, zMax: 0.5, yMin: 0, yMax: 0.5 }));
  // 可用區由凹牆矩形扣掉擋住下緣的遮擋物
  const u = usableArea({ x0: -1, x1: 1, y0: 0.2, y1: 2 }, BACK_WALL_OBSTACLES);
  assert.ok(Math.abs(u.yMin - (Math.max(...BACK_WALL_OBSTACLES.filter((o) => o.zMax > -1 && o.zMin < 1).map((o) => o.yMax)) + 0.05)) < 1e-9 && u.zMin > -1 && u.zMax < 1);
  assert.equal(usableArea({ x0: -1, x1: 1, y0: 0.2, y1: 2 }, []).yMin, 0.2);
});

test('版面：每次算結果一樣；張數少也不崩', () => {
  assert.deepEqual(gigLayout(items, GIG_AREA, BACK_WALL_OBSTACLES), layout);
  for (const n of [1, 2, 5, 8, 12]) {
    const l = gigLayout(Array.from({ length: n }, (_, i) => ({ rankNo: i % 3 ? null : i + 1 })));
    assert.equal(l.frames.length, n);
    for (const f of l.frames) {
      assert.ok(frameRect(f).zMin >= GIG_AREA.zMin - 1e-9 && frameRect(f).zMax <= GIG_AREA.zMax + 1e-9 && frameRect(f).yMin >= GIG_AREA.yMin - 1e-9 && frameRect(f).yMax <= GIG_AREA.yMax + 1e-9);
    }
  }
});

test('位置檔：lights.json 的 lightbox 與 occluders 讀得到，格式不對回 null（用預設）', () => {
  const a = gigWallFromJson({ lightbox: { x0: -1.2, x1: 1.2, y0: 0.4, y1: 2.2, z: -3.9 } });
  assert.ok(a && a.kind === 'back' && Math.abs(a.at - -3.93) < 1e-9 && a.area.yMin >= 0.84 - 1e-9, '沒寫 occluders 就用預設遮擋物');
  const b = gigWallFromJson({ lightbox: { x0: -1.2, x1: 1.2, y0: 0.4, y1: 2.2, z: -3.9 }, occluders: [{ name: '管機', min: [-0.4, 0.9, -3.8], max: [0.4, 1.3, -3.5] }, { x0: 1.3, x1: 1.7, y0: 0, y1: 1.05, z0: -3.8, z1: -3.4 }, { nope: 1 }] });
  assert.ok(b && b.obstacles.length === 2 && Math.abs(b.area.yMin - 1.35) < 1e-9, '管機頂 1.3 + 5 公分；喇叭在凹牆範圍外不影響下緣');
  assert.deepEqual(obstaclesFromOccluders([{ min: [0, 0, -9], max: [1, 1, -8] }], -3.93), [], '在牆後面的不算');
  assert.ok(gigWallFromJson({ rect: { x0: -1.2, x1: 1.2, y0: 0.4, y1: 2.2, z: -3.9 }, depth: 0.04 }));
  assert.equal(gigWallFromJson(null), null);
  assert.equal(gigWallFromJson({ lightbox: { x0: 'a' } }), null);
  assert.equal(gigWallFromJson({ lightbox: { x0: 0, x1: 0.1, y0: 0, y1: 0.1, z: -3 } }), null);
});

test('位置檔：預設值跟 public/room/lights.json 的 lightbox 一致（數字只有烘焙那邊一份，預設只是備援）', () => {
  const file = JSON.parse(readFileSync(new URL('../public/room/lights.json', import.meta.url), 'utf8')) as { lightbox?: Record<string, number>; occluders?: unknown[] };
  if (!file.lightbox) return;
  for (const k of ['x0', 'x1', 'y0', 'y1', 'z'] as const) assert.equal(file.lightbox[k], DEFAULT_LIGHTBOX_RECT[k], `lights.json 的 lightbox.${k} 變了，要更新 gig-layout.ts 的預設值並重搜鏡頭（gigs-cam.ts）`);
  // 檔案有 occluders 時：用它算出來的可用區也要放得下 12 張，且鏡頭不被擋
  if (Array.isArray(file.occluders)) {
    const wall = gigWallFromJson(file)!;
    const l = gigLayout(items, wall.area, wall.obstacles);
    assert.equal(l.frames.length, N);
  }
});

test('光暈：alpha 從中心平滑降到 0，橢圓邊緣以外一律 0（貼圖四邊不會有硬邊）', () => {
  assert.ok(poolAlpha(0) > 0.99);
  assert.equal(poolAlpha(1), 0);
  assert.equal(poolAlpha(1.4), 0);
  let prev = 2;
  for (let d = 0; d <= 1; d += 0.05) {
    const a = poolAlpha(d);
    assert.ok(a <= prev + 1e-12);
    prev = a;
  }
  // 貼圖四邊與四角的取樣點離中心（0.5, 0.5）至少 1
  for (const [x, y] of [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1], [0, 0], [1, 1]] as const) {
    assert.equal(poolAlpha(Math.hypot((x - 0.5) / 0.5, (y - 0.5) / 0.5)), 0);
  }
});

/** 鏡頭 */
type Pose = { pos: number[]; look: number[]; fov: number };
function cam(pose: Pose, W: number, H: number) {
  const c = new THREE.PerspectiveCamera(pose.fov, W / H, 0.05, 30);
  c.position.set(pose.pos[0]!, pose.pos[1]!, pose.pos[2]!);
  c.lookAt(pose.look[0]!, pose.look[1]!, pose.look[2]!);
  c.updateMatrixWorld();
  return c;
}
/** 牆面座標 (u, y) → 世界（後牆 z = -3.92） */
const world = (u: number, y: number) => new THREE.Vector3(u, y, -3.92);
function box(c: THREE.PerspectiveCamera, rs: Rect[], W: number, H: number) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const r of rs) {
    for (const u of [r.zMin, r.zMax]) {
      for (const y of [r.yMin, r.yMax]) {
        const v = world(u, y).project(c);
        assert.ok(v.z > -1 && v.z < 1, '在鏡頭後面');
        x0 = Math.min(x0, ((v.x + 1) / 2) * W); x1 = Math.max(x1, ((v.x + 1) / 2) * W);
        y0 = Math.min(y0, ((1 - v.y) / 2) * H); y1 = Math.max(y1, ((1 - v.y) / 2) * H);
      }
    }
  }
  return { x0, x1, y0, y1 };
}
/** 後牆前面的東西（世界座標包圍盒）：從房間烘焙輸出的 public/room/lights.json 的 occluders 讀，不另寫數字 */
const lightsFile = JSON.parse(readFileSync(new URL('../public/room/lights.json', import.meta.url), 'utf8')) as { occluders?: { name: string; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[] };
const BOXES = (lightsFile.occluders ?? []).map((o) => ({ name: o.name, min: [o.x0, o.y0, o.z0], max: [o.x1, o.y1, o.z1] }));
test('遮擋物：lights.json 有 occluders，而且預設的牆面遮擋矩形（BACK_WALL_OBSTACLES）跟它一致', () => {
  assert.ok(BOXES.length >= 5, 'lights.json 還沒有 occluders，要等房間重烘焙輸出');
  assert.deepEqual(BACK_WALL_OBSTACLES, BOXES.map((b) => ({ zMin: b.min[0], zMax: b.max[0], yMin: b.min[1], yMax: b.max[1] })));
});

/** 鏡頭到這些矩形每個取樣點（含四角與中心）的視線是否穿過遮擋物（slab 法），回傳擋住的名字；沒擋回 null */
function blocked(pos: number[], rs: Rect[]): string | null {
  for (const r of rs) {
    for (const u of [r.zMin, (r.zMin + r.zMax) / 2, r.zMax]) {
      for (const y of [r.yMin, (r.yMin + r.yMax) / 2, r.yMax]) {
        const to = [u, y, -3.92];
        for (const b of BOXES) {
          let t0 = 0, t1 = 1;
          for (let i = 0; i < 3 && t0 <= t1; i++) {
            const d = to[i]! - pos[i]!;
            if (Math.abs(d) < 1e-9) { if (pos[i]! < b.min[i]! || pos[i]! > b.max[i]!) t0 = 2; continue; }
            let a = (b.min[i]! - pos[i]!) / d, c = (b.max[i]! - pos[i]!) / d;
            if (a > c) [a, c] = [c, a];
            t0 = Math.max(t0, a); t1 = Math.min(t1, c);
          }
          if (t0 <= t1) return b.name;
        }
      }
    }
  }
  return null;
}
const all = rects.map((x) => x.r);
const thirdOf = (f: { z: number }) => (f.z < -0.41 ? 0 : f.z < 0.41 ? 1 : 2);
const third = (h: number) => rects.filter((x) => thirdOf(x.f) === h).map((x) => x.r);
const NAMES = picks.map((g) => g.name);
/** 全牆同一物理字級（公尺）：用估計的字寬；實際畫的時候用 measureText 量 */
const EM_M = uniformNameEm(layout.frames, NAMES, estimateNameEm);
/** 名字的物理字級（em）在這個鏡頭下的螢幕像素，取這個鏡頭看得到的這幾幅裡最小的 */
function nameEmPxOnScreen(c: THREE.PerspectiveCamera, W: number, H: number, fs: typeof layout.frames): number {
  let min = 1e9;
  for (const f of fs) {
    const y = f.y - f.ah / 2 + 0.05;
    const a = world(f.z, y).project(c);
    const b = world(f.z + 0.1, y).project(c);
    min = Math.min(min, (EM_M * Math.hypot(((b.x - a.x) / 2) * W, ((b.y - a.y) / 2) * H)) / 0.1);
  }
  return min;
}
/** 從 room.ts 原始碼讀鏡頭表（room.ts 有 TS 參數屬性，node 載不進來；比照 wall-fov.test.ts） */
const roomSrc = readFileSync(new URL('../src/room/room.ts', import.meta.url), 'utf8');
function camOf(name: string, which: 'wide' | 'phone'): Pose {
  const m = roomSrc.match(new RegExp(`\\n  ${name}: \\{[\\s\\S]*?${which}: \\{ pos: \\[([^\\]]+)\\], look: \\[([^\\]]+)\\], fov: (\\d+(?:\\.\\d+)?) \\}`));
  assert.ok(m, `找不到 CAMS.${name}.${which}`);
  const nums = (t: string) => t.split(',').map(Number);
  return { pos: nums(m[1]!), look: nums(m[2]!), fov: Number(m[3]) };
}

test('鏡頭（桌機）：整面燈箱牆在文字欄右邊、播放列上方', () => {
  for (const [W, H] of [[1280, 720], [1440, 900], [1920, 1080]] as const) {
    const b = box(cam(GIGS_CAM.wide, W, H), all, W, H);
    assert.ok(b.x0 >= Math.min(0.04 * W, 56) + 440 + 24 && b.x1 <= W - 20 && b.y0 >= 76 && b.y1 <= H - 190, `${W}×${H} ${JSON.stringify(b)}`);
  }
});

test('鏡頭（手機總覽）：390×844 與 375×667 整面牆在說明文字之下、播放列之上', () => {
  const a = box(cam(GIGS_CAM.phone, 390, 844), all, 390, 844);
  assert.ok(a.x0 >= 8 && a.x1 <= 382 && a.y0 >= 260 && a.y1 <= 744, JSON.stringify(a));
  const b = box(cam(GIGS_CAM.phoneShort, 375, 667), all, 375, 667);
  assert.ok(b.x0 >= 8 && b.x1 <= 367 && b.y0 >= 250 && b.y1 <= 567, JSON.stringify(b));
});

test('鏡頭（手機推近）：左、中、右三段整片入鏡，名字字級 ≥ 12px（375×667 與 390×844）', () => {
  const rows: string[] = [];
  for (const [set, W, H] of [[GIGS_CAM.thirds.phone, 390, 844], [GIGS_CAM.thirds.short, 375, 667]] as const) {
    set.forEach((pose, h) => {
      const c = cam(pose, W, H);
      const b = box(c, third(h), W, H);
      assert.ok(b.x0 >= 8 && b.x1 <= W - 8 && b.y0 >= 70 && b.y1 <= H - 100, `${W}×${H} 第 ${h + 1} 段 ${JSON.stringify(b)}`);
      const em = nameEmPxOnScreen(c, W, H, layout.frames.filter((f) => thirdOf(f) === h));
      rows.push(`${W}×${H} 第 ${h + 1} 段 名字字級 ${em.toFixed(1)}px`);
      assert.ok(em >= 12, `${W}×${H} 第 ${h + 1} 段名字 ${em.toFixed(1)}px`);
    });
  }
  console.log(`全牆物理字級 ${(EM_M * 100).toFixed(2)} 公分\n${rows.join('\n')}`);
  assert.equal(gigsThirdOf('gigs-t3'), 2);
  assert.equal(gigsThirdOf('gigs'), -1);
});

test('遮擋：從 door、deck0、gigs（桌機、手機、推近）鏡頭看，每一張都不被唱盤、喇叭擋住', () => {
  const poses: [string, Pose][] = [
    ['door wide', camOf('door', 'wide')], ['door phone', camOf('door', 'phone')],
    ['deck0 wide', camOf('deck0', 'wide')], ['deck0 phone', camOf('deck0', 'phone')],
    ['gigs wide', GIGS_CAM.wide], ['gigs phone', GIGS_CAM.phone], ['gigs short', GIGS_CAM.phoneShort],
    ...GIGS_CAM.thirds.phone.map((p, i): [string, Pose] => [`third${i + 1} phone`, p]), ...GIGS_CAM.thirds.short.map((p, i): [string, Pose] => [`third${i + 1} short`, p]),
  ];
  for (const [name, p] of poses) {
    assert.equal(blocked(p.pos, all), null, `${name} 的視線被擋`);
  }
});

test('清單與名次：照 owner.json 的順序與顯示名；名次只取榜上真的有的', () => {
  assert.equal(gigs.length, N);
  assert.deepEqual(gigs.map((g) => g.name), picks.map((g) => g.name));
  const top = profile.music!.ranges.all.artists[0]!;
  assert.equal(yearRank(profile, top.id), 1);
  assert.equal(yearRank(profile, 'notInAnyChart'), null);
  assert.deepEqual(gigsOf(profile, [{ name: '沒人', spotify: 'zzzzzzzzzzzzzzzzzzzzzz' }], () => false), [{ name: '沒人', img: null, rankNo: null }]);
});

test('清單：照片不存在時 img 是 null；id 帶奇怪字元的略過', () => {
  const g = gigsOf(profile, [{ name: 'A', spotify: 'abc123' }, { name: 'B', spotify: '../x' }, { name: '', spotify: 'ok' }], (id) => id === 'abc123');
  assert.deepEqual(g.map((x) => [x.name, x.img]), [['A', 'gigs/abc123.jpg']]);
});

test('頁面：有清單才有 #gigs 段落，名字經過 esc；文案不暗示看過演唱會；沒有清單就沒有段落', () => {
  const list = [{ name: '<b>x</b> & "y"', img: null, rankNo: null }, { name: 'ZÜRA', img: 'gigs/a.jpg', rankNo: 50 }];
  const html = renderPage(profile, { gigs: list });
  assert.match(html, /id="gigs"[^>]*data-cam="gigs"/);
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;'));
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('ZÜRA'));
  const section = html.slice(html.indexOf('id="gigs"'), html.indexOf('id="gigs"') + 1500);
  assert.ok(section.includes('我最喜歡的 2 組表演人') && section.includes('收藏牆'));
  const body = section.slice(0, section.indexOf('</section>'));
  assert.ok(!/演唱會|現場|去過|看過/.test(body), '段落文案不能暗示看過演唱會');
  assert.ok(!/名次|排行|第 ?\d+ ?名|榜/.test(body), '段落不寫名次或排行');
  assert.ok(section.includes('class="sr-only"'));
  assert.ok(html.indexOf('id="lights"') < html.indexOf('id="gigs"') && html.indexOf('id="gigs"') < html.indexOf('id="next"'));
  const bare = renderPage(profile, {});
  assert.ok(!bare.includes('id="gigs"') && !bare.includes('#gigs'));
  assert.deepEqual(roomData(profile).gigs, []);
  assert.deepEqual(roomData(profile, {}, false, [], list).gigs.map((g) => g.img), [null, 'gigs/a.jpg']);
  // 手機推近左、中、右三段的鏡頭錨點
  const withSteps = renderPage(profile, { gigs: list });
  assert.equal((withSteps.match(/data-cam="gigs-t\d"/g) ?? []).length, 3);
  // 錨點順序：段落（總覽）→ 左半 → 右半 → 出口；錨點不在段落裡面，段落的中心點才不會夾在兩個錨點中間
  const at = (t: string) => withSteps.indexOf(t);
  assert.ok(at('id="gigs"') < at('data-cam="gigs-t1"') && at('data-cam="gigs-t1"') < at('data-cam="gigs-t2"') && at('data-cam="gigs-t2"') < at('data-cam="gigs-t3"') && at('data-cam="gigs-t3"') < at('id="next"'));
  assert.ok(withSteps.slice(at('id="gigs"'), withSteps.indexOf('</section>', at('id="gigs"'))).indexOf('gigs-t1') < 0);
});

/* ---------- 亮度表 ---------- */
const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255];
const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const enc = (c: number[]) => c.map((v) => linearToSrgb(Math.min(1, Math.max(0, v))));
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** 孔版印刷某一點的顏色（sRGB）：油墨疊印（相乘）在米白紙上，dA、dB 是兩版的濃度 */
function risoAt(a: string, b: string, k: number, dA: number, dB: number): [number, number, number] {
  const A = hex(a), B = hex(b), P = hex(PAPER_HEX).map(lin);
  return [0, 1, 2].map((i) => linearToSrgb(P[i]! * (1 - dA * k * (1 - A[i]!)) * (1 - dB * k * (1 - B[i]!)))) as [number, number, number];
}

test('亮度：三個時段 × 暗場／全亮／放歌，卡紙與照片最終輸出任一通道 ≤ 0.85（低於泛光門檻），照片暗部與主體不死黑', () => {
  const rows: string[] = [];
  for (const mood of ['afternoon', 'tipsy', 'night'] as const) {
    for (const [name, g, play] of [['暗場 g=0.4', 0.4, 0], ['全亮 g=1', 1, 0], ['放歌 wake=1', 1, 1]] as const) {
      const L = boxLook(mood, g, play);
      const white = (c: string) => Math.max(...enc(finalLinear(hex(c), L)));
      const mat = white(PAPER_HEX);
      let mid = 9, dark = 9, bright = 0;
      for (const ink of INKS) {
        mid = Math.min(mid, lum(enc(finalLinear(risoAt(ink.a, ink.b, ink.k, 0.4, 0.7), L))));
        dark = Math.min(dark, lum(enc(finalLinear(risoAt(ink.a, ink.b, ink.k, 1, 0.9), L))));
        bright = Math.max(bright, ...enc(finalLinear(risoAt(ink.a, ink.b, ink.k, 0.1, 0.2), L)));
      }
      rows.push(`${mood.padEnd(9)} ${name.padEnd(12)} 卡紙 ${mat.toFixed(2)}  照片亮部 ${bright.toFixed(2)}  照片主體(中間調) ${mid.toFixed(2)}  照片暗部 ${dark.toFixed(2)}  光暈不透明度 ${L.spill.toFixed(2)}`);
      assert.ok(mat <= 0.85 && bright <= 0.85, `${mood} ${name} 爆白：${mat} ${bright}`);
      assert.ok(lin(mat) < 0.86, `${mood} ${name} 超過泛光門檻`);
      assert.ok(mid > 0.12 && dark > 0.12, `${mood} ${name} 死黑：主體 ${mid} 暗部 ${dark}`);
    }
  }
  console.log(rows.join('\n'));
});

test('亮度：放歌時燈箱降到約 30%，暗場比全亮暗；午後比微醺、深夜淡', () => {
  for (const mood of ['afternoon', 'tipsy', 'night'] as const) {
    const full = boxLook(mood, 1, 0);
    const play = boxLook(mood, 1, 1);
    const dark = boxLook(mood, 0.4, 0);
    assert.ok(Math.abs(play.k[0] / full.k[0] - PLAY_LEVEL) < 1e-9 && PLAY_LEVEL >= 0.25 && PLAY_LEVEL <= 0.35);
    assert.ok(dark.k[0] < full.k[0] && dark.k[0] > play.k[0]);
    assert.ok(play.spill < full.spill);
  }
  assert.ok(boxLook('afternoon', 1).k[0] < boxLook('tipsy', 1).k[0] && boxLook('afternoon', 1).spill < boxLook('night', 1).spill);
});

test('光暈疊在墨藍底牆上：仍是暖色（R > G > B），不是灰綠，亮度也不高', () => {
  const wall = hex(WALL_HEX).map(lin);
  for (const mood of ['afternoon', 'tipsy', 'night'] as const) {
    for (const g of [0.4, 1]) {
      const L = boxLook(mood, g, 0);
      const out = [0, 1, 2].map((i) => wall[i]! + L.tint[i]! * L.spill); // 光暈 alpha 最大 1（中心）；加法混合
      // 午後光暈只是淡淡一層（不透明度 0.04），不要求蓋過藍；微醺、深夜要紅通道明顯高於藍（暖），而且不偏綠
      if (mood !== 'afternoon') assert.ok(out[0]! - out[2]! >= 0.015 && out[0]! > out[1]! && out[1]! - out[2]! <= 0.03, `${mood} g=${g} 光暈疊在藍牆上不是暖色：${out.map((v) => v.toFixed(3))}`);
      assert.ok(Math.max(...enc(out)) <= 0.85, `${mood} g=${g} 光暈中心太亮`);
    }
  }
});

test('名字（版畫題字）：atlas 尺寸、全牆同一字級、只畫名字、靠左對齊照片窗、髮絲線、字型與大小寫', () => {
  // atlas 尺寸：high 以上 640、medium 以下 512，都不超過 4096
  for (const [level, cellW] of [[0, 640], [1, 640], [2, 512], [3, 512], [4, 512]] as const) {
    assert.equal(cellWidthFor(level), cellW);
    const a = atlasSize(N, cellWidthFor(level));
    assert.ok(a.w <= MAX_ATLAS && a.h <= MAX_ATLAS, `level ${level} atlas ${a.w}×${a.h}`);
  }
  const hi = atlasSize(N, 640);
  const mid = atlasSize(N, 512);
  console.log(`atlas high ${hi.w}×${hi.h}（RGBA ${(hi.w * hi.h * 4 / 1048576).toFixed(1)}MB，含 mipmap 約 ${(hi.w * hi.h * 4 * 4 / 3 / 1048576).toFixed(1)}MB）；medium ${mid.w}×${mid.h}（${(mid.w * mid.h * 4 / 1048576).toFixed(1)}MB，含 mipmap 約 ${(mid.w * mid.h * 4 * 4 / 3 / 1048576).toFixed(1)}MB）`);

  // 假的 2D context：記錄 fillText 與 fillRect，其他方法什麼都不做
  type Call = { text: string; x: number; y: number; font: string; fill: string; spacing: string };
  const texts: Call[] = [];
  const hair: { x: number; y: number; w: number; h: number }[] = [];
  const state: Record<string, unknown> = { font: '', fillStyle: '', letterSpacing: '0px' };
  const mats: { a: number; d: number; e: number; f: number }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    has: (_t, k) => k === 'letterSpacing',
    get(_t, k: string) {
      if (k === 'fillText') return (text: string, x: number, y: number) => texts.push({ text, x, y, font: String(state.font), fill: String(state.fillStyle), spacing: String(state.letterSpacing) });
      if (k === 'fillRect') return (x: number, y: number, w: number, h: number) => { if (state.fillStyle === HAIRLINE) hair.push({ x, y, w, h }); };
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return (t: string) => ({ width: estimateNameEm(t) * (Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1]) || 100) });
      if (k in state) return state[k];
      return () => {};
    },
    set(_t, k: string, v) { state[k] = v; return true; },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const emPxOf = (i: number) => nameEmPx(layout.frames.find((f) => f.index === i)!, EM_M);
  drawAtlas(canvas, gigs, [], '"Noto Sans TC", sans-serif', 640, emPxOf);
  assert.equal(canvas.width, hi.w);
  assert.equal(canvas.height, hi.h);

  // 只畫 12 個名字，每個一次；沒有名次、編號、第二語言
  assert.deepEqual(texts.map((t) => t.text), NAMES);
  assert.ok(texts.every((t) => !/第|名|榜|\d/.test(t.text) || NAMES.includes(t.text)));
  // 保留原本大小寫；拉丁字用 Switzer，中文用頁面字型；顏色是印刷油墨
  const by = (n: string) => texts.find((t) => t.text === n)!;
  // 名字來自 owner.json（換人資料也成立）：拉丁、中文各至少一個
  const zh = (n: string) => /[\u3400-\u9fff]/.test(n);
  const latin = NAMES.filter((n) => !zh(n)), cjk = NAMES.filter(zh);
  assert.ok(latin.length > 0 && cjk.length > 0, '清單要同時有拉丁與中文名字');
  for (const n of latin) assert.ok(by(n).font.includes('Switzer') && by(n).font.startsWith('400 '), n);
  for (const n of cjk) assert.ok(by(n).font.includes('Noto Sans TC') && !by(n).font.includes('Switzer'), n);
  assert.equal(nameFont('Lumenfield', 40, 'X'), '400 40px Switzer, X');
  assert.ok(texts.every((t) => t.fill === INK_TEXT));
  // 字距：拉丁 0.04em、中文 0.06em（單位 px，相對自己的字級）
  for (const t of texts) {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(t.font)![1]);
    assert.ok(Math.abs(Number.parseFloat(t.spacing) / px - (/[⺀-鿿]/.test(t.text) ? 0.06 : 0.04)) < 1e-6, `${t.text} 字距 ${t.spacing}`);
  }
  // 靠左對齊到照片窗左緣（邏輯 64px，經縮放後在每格內的位置一樣）；髮絲線長度等於照片窗寬
  assert.ok(texts.every((t) => t.x === 64));
  assert.equal(hair.length, N);
  assert.ok(hair.every((h) => h.x === 64 && h.w === Math.round(640 * WINDOW_K) && h.h === 1));
  // 全牆同一物理字級：每幅的字級（邏輯 px）× 這幅每邏輯 px 對應的公尺 = 同一個值（沒被 110 的上限截掉的）
  const phys = layout.frames.map((f) => ({ f, px: nameEmPx(f, EM_M), m: (nameEmPx(f, EM_M) * f.aw) / 640 }));
  for (const p of phys) if (p.px < 110) assert.ok(Math.abs(p.m - EM_M) < 1e-9, `第 ${p.f.index} 幅物理字級 ${p.m} ≠ ${EM_M}`);
  assert.ok(phys.filter((p) => p.px < 110).length >= N - 1, '幾乎全部都不是被上限截掉的');
  // 最長那個名字在自己那幅的照片窗寬內放得下
  for (const f of layout.frames) assert.ok(estimateNameEm(NAMES[f.index]!) * EM_M <= WINDOW_K * f.aw + 1e-9, `${NAMES[f.index]} 放不進照片窗`);
  // 畫面比例：框內露出的畫面高/寬 = 1.28，窗在上、下緣留白比上緣寬
  for (const f of layout.frames) assert.ok(Math.abs(f.ah / f.aw - FACE_ASPECT) < 1e-9);
  assert.ok(((1 - WINDOW_K) / 2) * 1 < FACE_ASPECT - WINDOW_K - (1 - WINDOW_K) / 2, '下緣留白比上緣寬');
  void mats;
});
