// 回歸：門口鏡頭透過門洞看銀幕時，CSS3D 預告不會被門框擋住、整片「飛出來」蓋到牆上（業主 2026-11-09 截圖）。
// 規則：鏡頭在房裡時銀幕四角都在畫面內才顯示、且視線不被擋；在門外時照樣顯示，但裁成門洞形狀（門框、牆、門板擋住的地方都要被裁掉）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { trailerMode, doorClip, insideClip, type Pt } from '../screening/trailer.ts';
import { favWidePose } from '../screening/favorites.ts';
import { firstBlocker, occludersNear, propBoxes } from './helpers/room-geometry.ts';

const L = JSON.parse(readFileSync(new URL('../public/screening/room/layout.json', import.meta.url), 'utf8'));
const SC = L.screen;
const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => new THREE.Vector3(SC.x + sx! * SC.w / 2, SC.y + sy! * SC.h / 2, SC.z + 0.004));

type Pose = { pos: number[]; look: number[]; fov: number };
// 從 main.js 讀出固定的鏡頭表（wide／phone），不另抄一份數字
const src = readFileSync(new URL('../screening/main.js', import.meta.url), 'utf8');
const CAMS: Record<string, { wide: Pose; phone: Pose }> = {};
for (const m of src.matchAll(/^\s+([a-z]+): \{ wide: \{ pos: (\[[^\]]+\]), look: (\[[^\]]+\]), fov: ([\d.]+) \}, phone: \{ pos: (\[[^\]]+\]), look: (\[[^\]]+\]), fov: ([\d.]+) \} \},/gm)) {
  CAMS[m[1]!] = { wide: { pos: JSON.parse(m[2]!), look: JSON.parse(m[3]!), fov: +m[4]! }, phone: { pos: JSON.parse(m[5]!), look: JSON.parse(m[6]!), fov: +m[7]! } };
}
const sofaWide: Pose = { pos: [3.05, 1.12, -7.6], look: [3.2, 1.42, -11], fov: 52 };

function inView(p: Pose, aspect: number): { ok: boolean; cam: THREE.PerspectiveCamera } {
  const cam = new THREE.PerspectiveCamera(p.fov, aspect, 0.05, 50);
  cam.position.set(...(p.pos as [number, number, number]));
  cam.lookAt(new THREE.Vector3(...(p.look as [number, number, number])));
  cam.updateMatrixWorld();
  const ndc = corners.map((c) => { const v = c.clone().project(cam); return { x: v.x, y: v.y, z: v.z }; });
  return { ok: trailerMode(cam.position.z, L.room.z0, ndc, false) === 'inside', cam };
}
const mix = (a: Pose, b: Pose, t: number): Pose => ({ pos: a.pos.map((v, i) => v + (b.pos[i]! - v) * t), look: a.look.map((v, i) => v + (b.look[i]! - v) * t), fov: a.fov + (b.fov - a.fov) * t });

test('鏡頭表讀得到（door、threshold、hall、shelf、player、bye）', () => {
  for (const k of ['door', 'threshold', 'hall', 'shelf', 'player', 'bye']) assert.ok(CAMS[k], k);
});

const W = 1600, H = 900;
const toPx = (v: THREE.Vector3): Pt => ({ x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H });
const holeAt = (z: number) => [[L.door.x0, 0], [L.door.x1, 0], [L.door.x1, L.door.h], [L.door.x0, L.door.h]].map(([x, y]) => new THREE.Vector3(x, y, z));

test('門口與門檻：在門外照樣看得到預告（door 模式），且只露出門洞看得到的部分', async () => {
  const occ = await occludersNear(new THREE.Box3(new THREE.Vector3(0.7, 0, -10.8), new THREE.Vector3(6.7, 2.9, -1.5)));
  const leafBox = propBoxes().find((o) => o.name === 'door_leaf');
  assert.ok(leafBox, 'props.glb 要有 door_leaf');
  for (const k of ['door', 'threshold'] as const) {
    const p = CAMS[k]!.wide;
    const cam = new THREE.PerspectiveCamera(p.fov, W / H, 0.05, 50);
    cam.position.set(...(p.pos as [number, number, number]));
    cam.lookAt(new THREE.Vector3(...(p.look as [number, number, number])));
    cam.updateMatrixWorld();
    const ndc = corners.map((c) => { const v = c.clone().project(cam); return { x: v.x, y: v.y, z: v.z }; });
    assert.equal(trailerMode(cam.position.z, L.room.z0, ndc, false), 'door', k);
    const g = leafBox!.mesh.geometry as THREE.BoxGeometry;
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const leaf = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => toPx(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(leafBox!.mesh.matrixWorld).project(cam)));
    const clip = doorClip(holeAt(-3.98).map((v) => toPx(v.project(cam))), holeAt(-4.08).map((v) => toPx(v.project(cam))), leaf);
    assert.ok(clip, `${k}：門洞要看得到`);
    let agree = 0, seen = 0;
    for (let i = 0; i <= 16; i++) for (let j = 0; j <= 8; j++) {
      const pt = new THREE.Vector3(SC.x - SC.w / 2 + (SC.w * i) / 16, SC.y - SC.h / 2 + (SC.h * j) / 8, SC.z + 0.004);
      const q = toPx(pt.clone().project(cam));
      // 邊界 4px 內的點兩邊都可能，跳過
      const near = [[4, 0], [-4, 0], [0, 4], [0, -4]].some(([dx, dy]) => insideClip({ x: q.x + dx!, y: q.y + dy! }, clip!) !== insideClip(q, clip!));
      if (near) continue;
      const blocked = firstBlocker(cam.position, pt, occ) !== null;
      const shown = insideClip(q, clip!);
      assert.equal(shown, !blocked, `${k}：銀幕上 (${i},${j}) ${blocked ? '被擋住卻露出來' : '沒被擋卻被裁掉'}`);
      agree++;
      if (shown) seen++;
    }
    assert.ok(agree > 40 && seen > 10, `${k}：取樣點太少（${agree}／露出 ${seen}）`);
  }
});

test('沙發：桌機 16:9 預告層會顯示（看劇的主要位置）', () => {
  assert.equal(inView(sofaWide, 16 / 9).ok, true);
});

test('房內不裁切顯示預告的每個鏡頭與過場，銀幕四角的視線都沒有被擋', async () => {
  const occ = await occludersNear(new THREE.Box3(new THREE.Vector3(0.7, 0, -10.8), new THREE.Vector3(6.7, 2.9, -2)));
  const flow: Pose[] = [CAMS.door!.wide, CAMS.threshold!.wide, CAMS.hall!.wide, favWidePose(16 / 9), CAMS.shelf!.wide, sofaWide, CAMS.player!.wide, CAMS.bye!.wide];
  let shown = 0;
  for (let i = 0; i < flow.length - 1; i++) for (let s = 0; s <= 8; s++) {
    const p = mix(flow[i]!, flow[i + 1]!, s / 8);
    const { ok, cam } = inView(p, 16 / 9);
    if (!ok) continue;
    shown++;
    for (const c of corners) {
      const hit = firstBlocker(cam.position, c, occ);
      assert.equal(hit, null, `過場 ${i}→${i + 1} 第 ${s}/8 格：視線被 ${hit?.name} 擋住`);
    }
  }
  assert.ok(shown > 0);
});
