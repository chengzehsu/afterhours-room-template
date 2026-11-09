import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

type Pose = { pos: number[]; look: number[]; fov: number };
// room.ts 有 TS 參數屬性，node 的型別剝除載不進來；直接從原始碼讀鏡頭定點，避免兩邊各抄一份
const roomSrc = readFileSync(new URL('../src/room/room.ts', import.meta.url), 'utf8');
function readCams(name: string): Record<'wide' | 'phone', Pose> {
  const block = roomSrc.match(new RegExp(`${name}: \\{\\s*wide: (\\{[^}]*\\}),\\s*phone: (\\{[^}]*\\})`));
  assert.ok(block, `找不到 CAMS.${name}`);
  const parse = (t: string): Pose => {
    const num = (key: string) => (t.match(new RegExp(`${key}: \\[([^\\]]*)\\]`))![1]!).split(',').map(Number);
    return { pos: num('pos'), look: num('look'), fov: Number(t.match(/fov: (\d+)/)![1]) };
  };
  return { wide: parse(block[1]!), phone: parse(block[2]!) };
}
const CAMS = { deck0: readCams('deck0'), deck2: readCams('deck2') };
const stageSrc = readFileSync(new URL('../src/live/stage.ts', import.meta.url), 'utf8');
const posMatch = stageSrc.match(/TUBE_AMP_POS = \{ x: (-?[\d.]+), y: (-?[\d.]+), z: (-?[\d.]+) \}/);
assert.ok(posMatch, '找不到 TUBE_AMP_POS');
const TUBE_AMP_POS = { x: Number(posMatch[1]), y: Number(posMatch[2]), z: Number(posMatch[3]) };

const VIEWS = [
  { name: '1280x800', k: 'wide', w: 1280, h: 800 },
  { name: '1440x900', k: 'wide', w: 1440, h: 900 },
  { name: '1920x1080', k: 'wide', w: 1920, h: 1080 },
  { name: '390x844', k: 'phone', w: 390, h: 844 },
] as const;

const TUBE_TOP = 0.054 + 0.095 + 0.026;
const TUBES: [number, number][] = [[-0.12, 0.06], [-0.06, 0.06], [0.03, 0.095], [0.11, 0.095]];

function camera(pose: { pos: number[]; look: number[]; fov: number }, w: number, h: number) {
  const c = new THREE.PerspectiveCamera(pose.fov, w / h, 0.1, 50);
  c.position.set(pose.pos[0]!, pose.pos[1]!, pose.pos[2]!);
  c.lookAt(pose.look[0]!, pose.look[1]!, pose.look[2]!);
  c.updateMatrixWorld();
  return c;
}

function toScreen(c: THREE.PerspectiveCamera, p: THREE.Vector3, w: number, h: number) {
  const depth = -p.clone().applyMatrix4(c.matrixWorldInverse).z;
  const v = p.clone().project(c);
  return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, depth };
}

test('管機在 deck0 完整入鏡，且落在標題下緣與面板上緣之間、不壓唱盤', () => {
  const { x, y, z } = TUBE_AMP_POS;
  const corners: THREE.Vector3[] = [];
  for (const dx of [-0.18, 0.18]) for (const dy of [0, TUBE_TOP]) for (const dz of [-0.065, 0.065]) corners.push(new THREE.Vector3(x + dx, y + dy, z + dz));
  const disc = Array.from({ length: 32 }, (_, i) => new THREE.Vector3(-0.05 + 0.15 * Math.cos((i / 32) * Math.PI * 2), 0.711, -3.66 + 0.15 * Math.sin((i / 32) * Math.PI * 2)));
  for (const v of VIEWS) {
    const c = camera(CAMS.deck0[v.k], v.w, v.h);
    const pts = corners.map((p) => toScreen(c, p, v.w, v.h));
    const box = { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
    const pad = Math.min(120, Math.max(80, 0.11 * v.h));
    const display = Math.min(108, Math.max(48, 12.8 + 0.062 * v.w));
    const head = Math.min(52, Math.max(28, 19.2 + 0.022 * v.w));
    const headBottom = pad + 0.95 * display + 1.25 * head;
    const panelTop = v.h - 120 - 168;
    assert.ok(box.x0 >= 0 && box.x1 <= v.w && box.y0 >= 0 && box.y1 <= v.h, `${v.name} 入鏡`);
    assert.ok(box.y0 > headBottom, `${v.name} 不壓標題`);
    assert.ok(box.y1 < panelTop, `${v.name} 不壓面板`);
    const dxs = disc.map((p) => toScreen(c, p, v.w, v.h).x);
    assert.ok(box.x1 < Math.min(...dxs), `${v.name} 不壓唱盤`);
  }
});

test('deck2 近拍：寬螢幕至少看得到一支管子', () => {
  const { x, y, z } = TUBE_AMP_POS;
  for (const v of VIEWS.filter((q) => q.k === 'wide')) {
    const c = camera(CAMS.deck2[v.k], v.w, v.h);
    const seen = TUBES.filter(([tx, th]) => {
      const p = toScreen(c, new THREE.Vector3(x + tx, y + 0.054 + th * 0.42, z), v.w, v.h);
      return p.depth > 0.05 && p.x >= 0 && p.x <= v.w && p.y >= 0 && p.y <= v.h;
    });
    assert.ok(seen.length >= 1, `${v.name} 看得到管子`);
  }
});
