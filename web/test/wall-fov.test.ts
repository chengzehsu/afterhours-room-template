import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { fitWallFov } from '../src/room/fit.ts';
import { SHELF } from '../src/room/props.ts';

// room.ts 有 TS 參數屬性，node 的型別剝除載不進來；直接從原始碼讀 CAMS.wall.wide（同 tube-placement.test.ts）
const src = readFileSync(new URL('../src/room/room.ts', import.meta.url), 'utf8');
const m = src.match(/\n  wall: \{[\s\S]*?wide: \{ pos: \[([^\]]+)\], look: \[([^\]]+)\], fov: (\d+(?:\.\d+)?) \}/);
assert.ok(m, '找不到 CAMS.wall.wide');
const nums = (t: string) => t.split(',').map(Number) as [number, number, number];
const wall = { pos: nums(m[1]!), look: nums(m[2]!), fov: Number(m[3]) };

/** 滿牆 50 張最右一欄、抽出時的右緣，投影到螢幕的 NDC x */
function rightEdge(aspect: number): number {
  const cam = new THREE.PerspectiveCamera(fitWallFov(wall.fov, aspect), aspect, 0.05, 50);
  cam.position.set(...wall.pos);
  cam.lookAt(...wall.look);
  cam.updateMatrixWorld();
  let edge = -1;
  for (let r = 0; r < SHELF.rows; r++) {
    const v = new THREE.Vector3(SHELF.x + 0.09, SHELF.y0 - r * SHELF.dy, SHELF.z0 - (SHELF.cols - 1) * SHELF.dz - 0.15).project(cam);
    edge = Math.max(edge, v.x);
  }
  return edge;
}

test('CD 牆：1024×768 到 21:9，滿牆最右一欄都完整入鏡（右緣留至少 4%）', () => {
  for (const aspect of [1024 / 768, 1280 / 800, 1440 / 900, 1920 / 1080, 2560 / 1080]) {
    assert.ok(rightEdge(aspect) <= 0.92, `寬高比 ${aspect.toFixed(2)} 右緣 ${rightEdge(aspect).toFixed(3)}`);
  }
});

test('CD 牆：寬螢幕維持原本的視角，只有比較方的螢幕才放寬', () => {
  assert.equal(fitWallFov(wall.fov, 1920 / 1080), wall.fov);
  assert.ok(fitWallFov(wall.fov, 1024 / 768) > 60);
});
