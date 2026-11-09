// 放映室的遮擋物：從 room/screening.glb（Draco，烘焙的牆、地板、沙發、窗簾、立燈等）與 room/props.glb（門、燈罩、招牌、播放機）
// 讀出實際幾何，給鏡頭的視線遮擋測試用。不開瀏覽器：Draco 用 three 附的 draco_decoder.js（asm.js 版）在 node 裡解。
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as THREE from 'three';

const ROOM = new URL('../../public/screening/room/', import.meta.url);
const DRACO_JS = new URL('../../node_modules/three/examples/jsm/libs/draco/draco_decoder.js', import.meta.url);

type Gltf = { json: any; bin: Uint8Array };
function readGlb(file: string): Gltf {
  const buf = readFileSync(new URL(file, ROOM));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
  const binStart = 20 + jsonLen + 8;
  return { json, bin: buf.subarray(binStart) };
}

/** 門開到底的角度（main.js：doorHinge.rotation.y = 1.75 * ease(1)） */
export const DOOR_OPEN = 1.75;

function nodeMatrix(n: any): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const t = n.translation ?? [0, 0, 0], r = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1];
  return m.compose(new THREE.Vector3(...t), new THREE.Quaternion(...r), new THREE.Vector3(...s));
}

/** 世界矩陣：parent 由 children 反推 */
function worldMatrices(json: any, override: Record<string, THREE.Euler> = {}): THREE.Matrix4[] {
  const parent: number[] = [];
  json.nodes.forEach((n: any, i: number) => (n.children ?? []).forEach((c: number) => (parent[c] = i)));
  const memo: THREE.Matrix4[] = [];
  const get = (i: number): THREE.Matrix4 => {
    if (memo[i]) return memo[i]!;
    const n = json.nodes[i];
    const local = nodeMatrix(n);
    if (override[n.name]) local.compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion().setFromEuler(override[n.name]!), new THREE.Vector3(1, 1, 1));
    memo[i] = parent[i] === undefined ? local : get(parent[i]!).clone().multiply(local);
    return memo[i]!;
  };
  json.nodes.forEach((_: any, i: number) => get(i));
  return memo;
}

/** props.glb 的小物件：用各 mesh 的位置範圍（accessor min/max）做成有方向的盒子。排除貼牆或在牆外的（窗外夜景、牆上海報、鏡頭光點）與擺在片櫃用的 DVD */
const SKIP = /^(dvd|cover|lens_glow|window_glass|wall_poster|screen_surface)/;
export function propBoxes(): { name: string; mesh: THREE.Mesh }[] {
  const { json } = readGlb('props.glb');
  const world = worldMatrices(json, { door_hinge: new THREE.Euler(0, DOOR_OPEN, 0) });
  const out: { name: string; mesh: THREE.Mesh }[] = [];
  json.nodes.forEach((n: any, i: number) => {
    if (n.mesh === undefined || SKIP.test(n.name)) return;
    // dvd 的子節點名字不是 dvd_*，用祖先判斷
    let anc = i, skip = false;
    const parent: number[] = [];
    json.nodes.forEach((p: any, pi: number) => (p.children ?? []).forEach((c: number) => (parent[c] = pi)));
    while (anc !== undefined) { if (/^dvd$/.test(json.nodes[anc].name)) skip = true; anc = parent[anc]!; }
    if (skip) return;
    const prim = json.meshes[n.mesh].primitives[0];
    const a = json.accessors[prim.attributes.POSITION];
    const min = new THREE.Vector3(...(a.min as number[])), max = new THREE.Vector3(...(a.max as number[]));
    const size = max.clone().sub(min).max(new THREE.Vector3(0.01, 0.01, 0.01));   // 平的面給 1 公分厚
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(world[i]!).multiply(new THREE.Matrix4().makeTranslation(...min.clone().add(max).multiplyScalar(0.5).toArray() as [number, number, number]));
    mesh.matrixWorld.copy(mesh.matrix);
    out.push({ name: n.name, mesh });
  });
  return out;
}

/** screening.glb 的烘焙房間（牆、地板、天花板、沙發、窗簾、立燈…）：Draco 解出三角形，套節點的位移與旋轉 */
export async function roomMeshes(): Promise<THREE.Mesh[]> {
  const { json, bin } = readGlb('screening.glb');
  const ctx: Record<string, unknown> = { console, process, require: createRequire(import.meta.url), __dirname: '/', __filename: '/x.js' };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(DRACO_JS, 'utf8') + '\n;this.DracoDecoderModule = DracoDecoderModule;', ctx);
  const draco: any = await (ctx.DracoDecoderModule as any)({});
  const decoder = new draco.Decoder();
  const world = worldMatrices(json);
  const out: THREE.Mesh[] = [];
  json.nodes.forEach((n: any, ni: number) => {
    if (n.mesh === undefined) return;
    const prim = json.meshes[n.mesh].primitives[0];
    const ext = prim.extensions.KHR_draco_mesh_compression;
    const bv = json.bufferViews[ext.bufferView];
    const data = new Int8Array(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0), bv.byteLength);
    const dbuf = new draco.DecoderBuffer();
    dbuf.Init(data, data.byteLength);
    const mesh = new draco.Mesh();
    const st = decoder.DecodeBufferToMesh(dbuf, mesh);
    if (!st.ok()) throw new Error('Draco 解碼失敗：' + st.error_msg());
    const nPts = mesh.num_points(), nFaces = mesh.num_faces();
    const attr = decoder.GetAttributeByUniqueId(mesh, ext.attributes.POSITION);
    const arr = new draco.DracoFloat32Array();
    decoder.GetAttributeFloatForAllPoints(mesh, attr, arr);
    const pos = new Float32Array(nPts * 3);
    for (let i = 0; i < pos.length; i++) pos[i] = arr.GetValue(i);
    const idxArr = new draco.DracoInt32Array();
    const index = new Uint32Array(nFaces * 3);
    const tri = new draco.DracoInt32Array();
    for (let f = 0; f < nFaces; f++) { decoder.GetFaceFromMesh(mesh, f, tri); index[f * 3] = tri.GetValue(0); index[f * 3 + 1] = tri.GetValue(1); index[f * 3 + 2] = tri.GetValue(2); }
    draco.destroy(arr); draco.destroy(tri); draco.destroy(idxArr); draco.destroy(mesh); draco.destroy(dbuf);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.matrixAutoUpdate = false;
    m.matrix.copy(world[ni]!);
    m.matrixWorld.copy(world[ni]!);
    m.name = n.name;
    out.push(m);
  });
  draco.destroy(decoder);
  return out;
}

/** 從相機沿線段射向目標，回傳擋在中間的第一個東西的名字（沒有就是 null）。target 前 eps 公尺內的不算（目標本身貼在牆上） */
export function firstBlocker(from: THREE.Vector3, to: THREE.Vector3, occluders: { name: string; mesh: THREE.Mesh }[], eps = 0.01): { name: string; dist: number } | null {
  const dir = to.clone().sub(from);
  const len = dir.length();
  dir.normalize();
  const ray = new THREE.Raycaster(from, dir, 0, len - eps);
  let best: { name: string; dist: number } | null = null;
  for (const o of occluders) {
    const hit = ray.intersectObject(o.mesh, false)[0];
    if (hit && (!best || hit.distance < best.dist)) best = { name: o.name, dist: hit.distance };
  }
  return best;
}

/** 燈箱前面的整塊空間（鏡頭與視線都在這裡面）：只留下可能碰到視線的三角形，不然 17 萬個三角形每條視線都掃太慢 */
export async function occludersNear(region: THREE.Box3): Promise<{ name: string; mesh: THREE.Mesh }[]> {
  const occ = propBoxes();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), box = new THREE.Box3();
  for (const m of await roomMeshes()) {
    const pos = m.geometry.getAttribute('position'), idx = m.geometry.index!;
    const keep: number[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, idx.getX(i + 1)).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, idx.getX(i + 2)).applyMatrix4(m.matrixWorld);
      box.makeEmpty().expandByPoint(a).expandByPoint(b).expandByPoint(c);
      if (box.intersectsBox(region)) keep.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld();
    occ.push({ name: m.name, mesh });
  }
  return occ;
}
