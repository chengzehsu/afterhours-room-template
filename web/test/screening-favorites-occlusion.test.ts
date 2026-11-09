import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { favCellCorners, favPhonePose, favRowPose, favWidePose, type Pose } from '../screening/favorites.ts';
import { firstBlocker, occludersNear, propBoxes, DOOR_OPEN } from './helpers/room-geometry.ts';

// 業主桌機截圖（2026-11-09）：鏡頭站在 (4.0, 1.66, -4.8) 回頭看，開到底的門板（暗紅）正好切掉燈箱左欄。
// 這支測試讀 room/props.glb（門、燈罩、招牌、播放機）與 room/screening.glb（Draco：牆、沙發、窗簾、立燈等烘焙幾何），
// 從每個鏡頭姿勢射向燈箱 9 格共 36 個角，斷言中間沒有任何東西。
const occ = await occludersNear(new THREE.Box3(new THREE.Vector3(0.6, -1, -7.6), new THREE.Vector3(5, 4, -3.4)));
const targets = favCellCorners().map((p) => new THREE.Vector3(...p));

function blockers(p: Pose): string[] {
  const from = new THREE.Vector3(...p.pos);
  return targets.flatMap((t) => { const b = firstBlocker(from, t, occ); return b ? [`${b.name}@${b.dist.toFixed(2)}`] : []; });
}

test('遮擋測試本身有效：舊的桌機鏡頭 (4.0,1.66,-4.8) 會被門板擋住', () => {
  const old: Pose = { pos: [4.0, 1.66, -4.8], look: [0.7, 1.66, -4.2], fov: 48 };
  assert.ok(blockers(old).some((s) => s.startsWith('door_leaf')), '舊鏡頭應該被 door_leaf 擋到');
});

test('門開到底時門板的範圍：x 2.57～2.80、z -4.92～-3.96（對照 main.js 的 rotation.y = 1.75）', () => {
  assert.equal(DOOR_OPEN, 1.75);
  const leaf = propBoxes().find((b) => b.name === 'door_leaf')!;
  const box = new THREE.Box3().setFromObject(leaf.mesh);
  assert.ok(Math.abs(box.min.x - 2.57) < 0.02 && Math.abs(box.max.x - 2.8) < 0.02, `x ${box.min.x}~${box.max.x}`);
  assert.ok(Math.abs(box.min.z - -4.92) < 0.02 && Math.abs(box.max.z - -3.96) < 0.02, `z ${box.min.z}~${box.max.z}`);
});

test('桌機全景（16:9、16:10、超寬、小視窗）：36 個角都看得到，不穿過門板、燈罩、招牌、播放機或烘焙的家具牆面', () => {
  for (const [W, H] of [[1280, 720], [1920, 1080], [2576, 1400], [1440, 900], [1280, 800], [1024, 768]] as const) {
    assert.deepEqual(blockers(favWidePose(W / H)), [], `${W}×${H}`);
  }
});

test('手機（390×844、375×667、360×800、412×915）：全景與逐排推近每個錨點，36 個角都不被擋', () => {
  for (const [W, H] of [[390, 844], [375, 667], [360, 800], [412, 915]] as const) {
    assert.deepEqual(blockers(favPhonePose(W, H)), [], `${W}×${H} 全景`);
    for (const r of [0, 1, 2]) assert.deepEqual(blockers(favRowPose(r, W, H)), [], `${W}×${H} 第 ${r + 1} 排`);
  }
});

test('手機排與排之間（鏡頭平移途中）也不被門板擋住', () => {
  for (const [W, H] of [[390, 844], [375, 667]] as const) {
    const stops = [favPhonePose(W, H), favRowPose(0, W, H), favRowPose(1, W, H), favRowPose(2, W, H)];
    for (let i = 0; i < stops.length - 1; i++) {
      for (let k = 1; k < 6; k++) {
        const a = stops[i]!, b = stops[i + 1]!, t = k / 6;
        const mid: Pose = { pos: a.pos.map((v, j) => v + (b.pos[j]! - v) * t) as Pose['pos'], look: a.look, fov: a.fov };
        assert.deepEqual(blockers(mid), [], `${W}×${H} 第 ${i} 段 ${k}/6`);
      }
    }
  }
});
