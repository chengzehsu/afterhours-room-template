import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FAV_BOX, FAV_CELL, FAV_FRONT, FAV_HALF, FAV_ROW_MARGIN, FAV_SUB_PX, FAV_TEX_W, FAV_TITLE_PX, FAV_WALL, favCopy, favIndexes, favPhonePose, favRowPose, favRowY, favWidePose, hostPool, stripOrder, type Pose } from '../screening/favorites.ts';

/** 燈箱正面四角（含外框）投影到畫面的 NDC 範圍 */
function project(p: Pose, W: number, H: number) {
  const cam = new THREE.PerspectiveCamera(p.fov, W / H, 0.05, 50);
  cam.position.set(...p.pos);
  cam.lookAt(...p.look);
  cam.updateMatrixWorld();
  const vs: THREE.Vector3[] = [];
  for (const dz of [-1, 1]) for (const dy of [-1, 1]) vs.push(new THREE.Vector3(FAV_WALL.x + FAV_FRONT, FAV_WALL.y + dy * FAV_HALF.h, FAV_WALL.z + dz * FAV_HALF.w).project(cam));
  return { x0: Math.min(...vs.map((v) => v.x)), x1: Math.max(...vs.map((v) => v.x)), y0: Math.min(...vs.map((v) => v.y)), y1: Math.max(...vs.map((v) => v.y)), cam };
}
/** 第 r 排（含外框左右）四角投影；r = -1 是整座燈箱 */
function projectRow(p: Pose, W: number, H: number, r: number) {
  const cam = new THREE.PerspectiveCamera(p.fov, W / H, 0.05, 50);
  cam.position.set(...p.pos);
  cam.lookAt(...p.look);
  cam.updateMatrixWorld();
  const chh = FAV_CELL.h + FAV_CELL.cap, hw = FAV_BOX.w / 2 + 0.03;
  const yc = favRowY(r), hh = chh / 2;
  const vs: THREE.Vector3[] = [];
  for (const dz of [-1, 1]) for (const dy of [-1, 1]) vs.push(new THREE.Vector3(FAV_WALL.x + FAV_FRONT, yc + dy * hh, FAV_WALL.z + dz * hw).project(cam));
  return { x0: Math.min(...vs.map((v) => v.x)), x1: Math.max(...vs.map((v) => v.x)), y0: Math.min(...vs.map((v) => v.y)), y1: Math.max(...vs.map((v) => v.y)) };
}
/** 片名字高（px）：貼圖字級 FAV_TITLE_PX／貼圖格寬 FAV_TEX_W 對應 FAV_CELL.w 公尺；每公尺幾 px 由整排外框寬度量出 */
function titlePx(p: Pose, W: number, H: number, r: number) {
  const row = projectRow(p, W, H, r);
  const pxPerM = (((row.x1 - row.x0) / 2) * W) / (FAV_BOX.w + 0.06);
  const mPerTexPx = FAV_CELL.w / FAV_TEX_W;
  return { title: FAV_TITLE_PX * mPerTexPx * pxPerM, sub: FAV_SUB_PX * mPerTexPx * pxPerM };
}

test('桌機：3×3 完整入鏡、避開頂列，且整個在畫面右半（文案在左）', () => {
  for (const [W, H] of [[1280, 720], [1920, 1080], [1440, 900], [1024, 768]] as const) {
    const r = project(favWidePose(W / H), W, H);
    assert.ok(r.x1 <= 0.95, `${W}×${H} 右緣 ${r.x1}`);
    assert.ok(r.y1 <= 1 - (2 * 64) / H && r.y0 >= -0.92, `${W}×${H} y ${r.y0}~${r.y1}`);
    const leftPx = ((r.x0 + 1) / 2) * W;
    assert.ok(leftPx >= Math.min(W * 0.4, 440 + 64 + 24), `${W}×${H} 左緣 ${leftPx}px 會壓到文案`);
  }
});

test('手機直式全景：完整入鏡、不進頂列、不壓到底下文案', () => {
  const cases = [[390, 844, 330], [375, 667, 290], [360, 800, 330], [412, 915, 330]] as const;
  for (const [W, H, bottom] of cases) {
    const r = project(favPhonePose(W, H), W, H);
    assert.ok(r.x0 >= -0.96 && r.x1 <= 0.96, `${W}×${H} x ${r.x0}~${r.x1}`);
    assert.ok(r.y1 <= 1 - (2 * 56) / H, `${W}×${H} 上緣 ${r.y1} 進了頂列`);
    assert.ok(r.y0 >= 1 - (2 * (H - bottom)) / H - 0.01, `${W}×${H} 下緣 ${r.y0} 壓到文案`);
  }
});

test('手機直式逐排推近：每排完整入鏡、左右各留 16px、不進頂列、不壓到該段文案；片名字高 375×667 ≥ 14px、390×844 ≥ 15px', () => {
  // 每段文案貼在 80svh 那格的底，約佔畫面下方 78% 以下（kicker＋一行片名，約 90px 高）
  const floor = { 375: 14, 390: 15, 360: 14, 412: 15 } as const;
  for (const [W, H] of [[390, 844], [375, 667], [360, 800], [412, 915]] as const) {
    for (const r of [0, 1, 2]) {
      const p = favRowPose(r, W, H);
      const row = projectRow(p, W, H, r);
      const m = (2 * FAV_ROW_MARGIN) / W;
      assert.ok(row.x0 >= -1 + m - 1e-6 && row.x1 <= 1 - m + 1e-6, `${W}×${H} 第 ${r + 1} 排 x ${row.x0}~${row.x1} 超出左右 16px 邊距`);
      assert.ok(row.x1 - row.x0 >= 2 - 2 * m - 0.03, `${W}×${H} 第 ${r + 1} 排沒填滿寬度`);
      assert.ok(row.y1 <= 1 - (2 * 64) / H, `${W}×${H} 第 ${r + 1} 排上緣 ${row.y1} 進了頂列`);
      assert.ok(row.y0 >= 1 - (2 * H * 0.7) / H, `${W}×${H} 第 ${r + 1} 排下緣 ${row.y0} 壓到下方文案`);
      const t = titlePx(p, W, H, r);
      console.log(`${W}×${H} 第 ${r + 1} 排 距牆 ${(p.pos[0] - FAV_WALL.x).toFixed(2)}m 相機高 ${p.pos[1].toFixed(2)} 排 y ${row.y0.toFixed(2)}~${row.y1.toFixed(2)} 片名 ${t.title.toFixed(1)}px 小字 ${t.sub.toFixed(1)}px`);
      assert.ok(t.title >= floor[W as keyof typeof floor], `${W}×${H} 片名字高 ${t.title}px`);
    }
  }
});

test('文案由資料算出：數量、回來看最多天的那部', () => {
  const c = favCopy([{ title: 'A', days: 3 }, { title: 'B', days: 9 }]);
  assert.equal(c.titleTop, '這 2 部，');
  assert.match(c.lead, /《B》.*9 天/);
  assert.equal(favCopy([{ title: 'A', days: 3 }]).titleTop, '這一部，');
});

test('favIndexes：依業主順序、找不到的跳過、不重複；非陣列回空', () => {
  const shelf = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(favIndexes(['c', 'x', 'a', 'c'], shelf), [2, 0]);
  assert.deepEqual(favIndexes(undefined, shelf), []);
});

test('stripOrder：最愛排最前（不受時段限制），其他照原順序且只收時段內', () => {
  assert.deepEqual(stripOrder(6, [4, 1], (i) => i % 2 === 0), [4, 1, 0, 2]);
  assert.deepEqual(stripOrder(3, [], () => true), [0, 1, 2]);
});

test('hostPool：有最愛只從最愛挑；沒有才用天數前 30', () => {
  const shelf = Array.from({ length: 40 }, (_, i) => ({ days: i }));
  assert.deepEqual(hostPool(shelf, [3, 5]), [3, 5]);
  const p = hostPool(shelf, []);
  assert.equal(p.length, 30);
  assert.equal(p[0], 39);
});
