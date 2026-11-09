// 回歸：手機直式在沙發，預告要顯示（trailerMode = inside）。
// 2026-11-09 業主用 Sony Xperia 1 選片後沒有預告：沙發鏡頭往下看，銀幕投影成上寬下窄，上緣兩角超出畫面被判 off。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { trailerMode } from '../screening/trailer.ts';
import { screenPhonePose } from '../screening/screen-pose.ts';

const L = JSON.parse(readFileSync(new URL('../public/screening/room/layout.json', import.meta.url), 'utf8'));
const SC = L.screen;
const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => new THREE.Vector3(SC.x + sx! * SC.w / 2, SC.y + sy! * SC.h / 2, SC.z + 0.004));

// 常見手機直式（Chrome 扣掉網址列前後都量）：Xperia 1 是 411×891／411×960
for (const [W, H] of [[360, 640], [360, 800], [375, 667], [390, 844], [393, 873], [411, 891], [411, 960], [412, 915], [430, 932]] as const) {
  test(`${W}×${H}：沙發鏡頭下預告顯示（銀幕四角都在畫面內）`, () => {
    const p = screenPhonePose(W / H, SC);
    const cam = new THREE.PerspectiveCamera(p.fov, W / H, 0.05, 50);
    cam.position.set(...p.pos);
    cam.lookAt(new THREE.Vector3(...p.look));
    cam.updateMatrixWorld();
    const ndc = corners.map((c) => { const v = c.clone().project(cam); return { x: v.x, y: v.y, z: v.z }; });
    assert.equal(trailerMode(cam.position.z, L.room.z0, ndc, false), 'inside', JSON.stringify(ndc.map((v) => [+v.x.toFixed(3), +v.y.toFixed(3)])));
  });
}
