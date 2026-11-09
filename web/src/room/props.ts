/** 房間裡的家具與道具。單位是公尺，地板 y=0，房間 x、z 各 -4 到 4。 */
import * as THREE from 'three';
import { ROOM } from './palette.ts';
import { grooves, planks, signText } from './textures.ts';

const std = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

export function shell(scene: THREE.Object3D): void {
  const floorTex = planks();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.65 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMat = std(ROOM.wall, 0.95);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.2), wallMat);
  back.position.set(0, 1.6, -4);
  back.receiveShadow = true;
  const left = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.2), wallMat);
  left.position.set(-4, 1.6, 0);
  left.rotation.y = Math.PI / 2;
  left.receiveShadow = true;
  const right = left.clone();
  right.position.x = 4;
  right.rotation.y = -Math.PI / 2;
  const front = back.clone();
  front.position.z = 4;
  front.rotation.y = Math.PI;
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), std(ROOM.ceiling, 1));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 3.2;
  // 踢腳板：一圈深色胡桃木
  const skirtMat = std(ROOM.walnutDark, 0.7);
  for (const [x, z, ry] of [[0, -3.99, 0], [-3.99, 0, Math.PI / 2], [3.99, 0, -Math.PI / 2]] as const) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(8, 0.12, 0.02), skirtMat);
    s.position.set(x, 0.06, z);
    s.rotation.y = ry;
    scene.add(s);
  }
  scene.add(back, left, right, front, ceiling);
}

/** CD 牆背板與層板（左牆） */
export const SHELF = { cols: 10, rows: 5, z0: 1.62, dz: 0.36, y0: 2.27, dy: 0.42, x: -3.93 } as const;

export function shelfBoard(scene: THREE.Object3D): void {
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.25, 3.9), std(ROOM.walnut, 0.6));
  board.position.set(-3.97, 1.42, 0);
  board.receiveShadow = true;
  scene.add(board);
  const ledgeMat = std(ROOM.walnutDark, 0.55);
  for (let r = 0; r < SHELF.rows; r++) {
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 3.8), ledgeMat);
    ledge.position.set(-3.91, SHELF.y0 - r * SHELF.dy - 0.15, 0);
    ledge.castShadow = ledge.receiveShadow = true;
    scene.add(ledge);
  }
}

export interface Deck {
  group: THREE.Group;
  record: THREE.Group;
  label: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  arm: THREE.Group;
}

/** 兩層細架（霧黑後柱、寬台面托住唱盤座與管機、VU 表，下層板斜靠黑膠）、唱盤與一對落地喇叭（後牆）。尺寸要跟 build_room.py 一致 */
export function deck(fixed: THREE.Object3D, live: THREE.Object3D): Deck {
  const scene = fixed;
  const standMat = std(0x141210, 0.5);
  // [尺寸, x, y, z]：腳盤、後柱、下層板、擋板、上層台面（x -0.74~0.28，托住唱盤座與左邊的管機、VU 表）
  for (const [size, x, y, z] of [
    [[0.9, 0.02, 0.3], -0.31, 0.01, -3.72],
    [[0.05, 0.655, 0.05], 0, 0.3475, -3.8],
    [[0.76, 0.03, 0.32], -0.34, 0.315, -3.66],
    [[0.6, 0.2, 0.012], -0.4, 0.43, -3.8],
    [[1.02, 0.025, 0.45], -0.23, 0.6875, -3.665],
  ] as const) {
    const part = new THREE.Mesh(new THREE.BoxGeometry(...size), standMat);
    part.position.set(x, y, z);
    part.castShadow = part.receiveShadow = true;
    scene.add(part);
  }
  // 下層板上斜靠的 5 張黑膠封套（素色，後仰 18°），跟烘焙一致
  const th = (18 * Math.PI) / 180;
  [0xa88c72, 0x5e2219, 0xe4e2da, 0xa88c72, 0x5e2219].forEach((color, i) => {
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.31, 0.005), std(color, 0.8));
    sleeve.position.set([-0.48, -0.44, -0.4, -0.36, -0.32][i]!, 0, 0);
    sleeve.rotation.x = -th;
    sleeve.position.y = 0.332 + i * 0.012 * Math.sin(th) + 0.155 * Math.cos(th);
    sleeve.position.z = -3.7264 + i * 0.012 * Math.cos(th) - 0.155 * Math.sin(th);
    scene.add(sleeve);
  });

  const group = new THREE.Group();
  group.position.set(0, 0.7, -3.66);
  live.add(group);
  const base0 = new THREE.Group();
  base0.position.copy(group.position);
  scene.add(base0);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.38), std(ROOM.walnutDark, 0.45));
  plinth.position.y = 0.045;
  plinth.castShadow = plinth.receiveShadow = true;
  base0.add(plinth);
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.018, 64), std(ROOM.metal, 0.35, 0.8));
  platter.position.set(-0.05, 0.1, 0);
  platter.castShadow = true;
  base0.add(platter);

  const record = new THREE.Group();
  record.position.set(-0.05, 0.111, 0);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.003, 96),
    [std(ROOM.vinyl, 0.4), new THREE.MeshStandardMaterial({ map: grooves(), roughness: 0.32, metalness: 0.1 }), std(ROOM.vinyl, 0.4)],
  );
  disc.castShadow = true;
  record.add(disc);
  const label = new THREE.Mesh(new THREE.CircleGeometry(0.052, 64), new THREE.MeshStandardMaterial({ color: ROOM.tan, roughness: 0.7 }));
  label.rotation.x = -Math.PI / 2;
  label.position.y = 0.0017;
  record.add(label);
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 12), std(ROOM.metal, 0.3, 0.9));
  spindle.position.y = 0.008;
  record.add(spindle);
  group.add(record);

  // 唱臂：支點在右後方，繞 y 軸轉進唱片
  const arm = new THREE.Group();
  arm.position.set(0.17, 0.1, -0.12);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.03, 24), std(ROOM.metal, 0.3, 0.9));
  base.position.y = 0.015;
  arm.add(base);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.25, 12), std(ROOM.bone, 0.25, 0.7));
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.04, 0.125);
  arm.add(tube);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.035), std(ROOM.vinyl, 0.5));
  head.position.set(0, 0.034, 0.255);
  arm.add(head);
  const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 20), std(ROOM.metal, 0.3, 0.9));
  weight.rotation.x = Math.PI / 2;
  weight.position.set(0, 0.04, -0.02);
  arm.add(weight);
  arm.rotation.y = 0.15;
  group.add(arm);

  // 落地喇叭
  for (const x of [-1.55, 1.55]) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.05, 0.34), std(ROOM.walnut, 0.6));
    box.position.set(x, 0.525, -3.62);
    box.castShadow = box.receiveShadow = true;
    scene.add(box);
    const grill = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.98), std(ROOM.walnutDark, 1));
    grill.position.set(x, 0.53, -3.449);
    scene.add(grill);
    for (const [y, r] of [[0.33, 0.12], [0.72, 0.06]] as const) {
      const cone = new THREE.Mesh(new THREE.CircleGeometry(r, 48), std(0x1b140c, 0.9));
      cone.position.set(x, y, -3.448);
      scene.add(cone);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.012, 48), std(ROOM.tan, 0.6));
      ring.position.set(x, y, -3.4475);
      scene.add(ring);
    }
  }

  // 落地燈：桿子加燈罩
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.55, 12), std(ROOM.walnutDark, 0.5));
  pole.position.set(-2.35, 0.775, -3.55);
  scene.add(pole);
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.24, 0.3, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: ROOM.tan, emissive: ROOM.bulb, emissiveIntensity: 0.55, side: THREE.DoubleSide, roughness: 1 }),
  );
  shade.position.set(-2.35, 1.62, -3.55);
  scene.add(shade);

  return { group, record, label, arm };
}

/** 右牆的相框（一直都在的歌手） */
export function frames(fixed: THREE.Object3D, live: THREE.Object3D, pics: (THREE.Texture | null)[]): void {
  const frameMat = std(ROOM.walnutDark, 0.5);
  pics.forEach((tex, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const g = new THREE.Group();
    g.position.set(3.97, 1.95 - row * 0.85, 1.25 + col * 0.72);
    g.rotation.y = -Math.PI / 2;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.69, 0.03), frameMat);
    frame.castShadow = true;
    frame.position.copy(g.position);
    frame.rotation.copy(g.rotation);
    fixed.add(frame);
    const mat = tex ? new THREE.MeshStandardMaterial({ map: tex.clone(), roughness: 0.6 }) : std(ROOM.tan);
    if (mat.map) {
      // 正方形照片裁成 4:5
      mat.map.repeat.set(0.8, 1);
      mat.map.offset.set(0.1, 0);
      mat.map.needsUpdate = true;
    }
    const picture = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.6), mat);
    picture.position.z = 0.016;
    g.add(picture);
    live.add(g);
  });
}

/** 唱片箱：新到的唱片靠在箱子裡（後牆右邊地上） */
export function crate(fixed: THREE.Object3D, live: THREE.Object3D, sleeves: (THREE.Texture | null)[]): void {
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.36, 0.42), std(ROOM.tan, 0.85));
  box.position.set(2.45, 0.18, -3.55);
  box.castShadow = box.receiveShadow = true;
  fixed.add(box);
  sleeves.forEach((tex, i) => {
    const sleeve = new THREE.Mesh(
      new THREE.BoxGeometry(0.31, 0.31, 0.006),
      [std(ROOM.bone), std(ROOM.bone), std(ROOM.bone), std(ROOM.bone), tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }) : std(ROOM.bone), std(ROOM.bone)],
    );
    sleeve.position.set(2.2 + i * 0.25, 0.42 + (i === 1 ? 0.03 : 0), -3.6 + i * 0.05);
    sleeve.rotation.set(-0.18, -0.1 + i * 0.12, 0);
    sleeve.castShadow = true;
    live.add(sleeve);
  });
}

/** 放映室的門與跑馬燈招牌（後牆最右邊） */
export function cinemaDoor(fixed: THREE.Object3D, live: THREE.Object3D, font: string): THREE.Mesh[] {
  const scene = fixed;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.2, 0.06), std(ROOM.walnutDark, 0.5));
  frame.position.set(3.25, 1.1, -3.97);
  scene.add(frame);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.98, 2.08, 0.04), std(0x6b2a1f, 0.55));
  door.position.set(3.25, 1.04, -3.94);
  door.castShadow = true;
  scene.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), std(ROOM.tan, 0.3, 0.8));
  knob.position.set(2.88, 1.0, -3.91);
  scene.add(knob);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.25),
    new THREE.MeshStandardMaterial({ map: signText('放映室', font), emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.8 }),
  );
  sign.position.set(3.25, 2.42, -3.955);
  live.add(sign);
  const bulbs: THREE.Mesh[] = [];
  const bulbMat = new THREE.MeshStandardMaterial({ color: ROOM.bulb, emissive: ROOM.bulb, emissiveIntensity: 0.5 });
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    for (const y of [2.27, 2.57]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), bulbMat.clone());
      b.position.set(2.73 + t * 1.04, y, -3.94);
      live.add(b);
      bulbs.push(b);
    }
  }
  return bulbs;
}

/* ---------- 放映室的門：可以推開的 live 門板 ---------- */

/** 烘焙的門在 x 2.76–3.74、高 2.08；live 門板略小一點，門軸在 x0 那側，往牆後（-z）開 */
export const DOOR = { x0: 2.765, w: 0.97, h: 2.06, z: -3.94, hole: { w: 0.98, h: 2.08 }, maxAngle: 1.75 };

export interface DoorRig {
  /** 整組預設隱藏；門開始動才顯示（預編時暫時打開） */
  group: THREE.Group;
  hinge: THREE.Group;
  glow: THREE.Mesh;
  /** 門板用的烘焙同款材質，要跟房間一起吃 dim／tint／flash */
  mats: THREE.ShaderMaterial[];
  /** 門板主體（slab）、兩片門心板的顏色，開門當下從烘焙貼圖取樣 */
  slab: THREE.ShaderMaterial;
  panels: THREE.ShaderMaterial[];
  /** 點擊用的隱形區塊，不畫，只給射線打 */
  hit: THREE.Mesh;
}

/** 只在遮罩範圍內畫，且不看深度：門板轉到牆後面，從鏡頭看出去仍像穿過門洞 */
function insideHole(m: THREE.Material): void {
  m.stencilWrite = true;
  m.stencilRef = 1;
  m.stencilFunc = THREE.EqualStencilFunc;
  m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp;
  m.depthTest = false;
  m.depthWrite = false;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const v = g.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, '#8a4a1c');
  v.addColorStop(0.4, '#f0a65c');
  v.addColorStop(1, '#e8b47a');
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 256);
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(60,25,8,0.55)');
  h.addColorStop(0.3, 'rgba(60,25,8,0)');
  h.addColorStop(0.7, 'rgba(60,25,8,0)');
  h.addColorStop(1, 'rgba(60,25,8,0.55)');
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * 烘焙的門不能動，所以在它正前方疊 live 門板。門後是實心牆，門板往 -z 轉會插進牆裡，
 * 因此用 stencil：先畫一片跟門洞一樣大的遮罩，暖光與門板只畫在遮罩內、且不測深度。
 * renderOrder：烘焙房間 0 → 遮罩 2 → 暖光 3 → 門板 4、門心 5、門把 6。
 * flat：做一個跟烘焙房間同一支 shader、但輸出單一顏色的材質（跟著房間變暗、變色）。
 */
export function doorRig(parent: THREE.Object3D, flat: () => THREE.ShaderMaterial): DoorRig {
  const group = new THREE.Group();
  group.visible = false;
  const cx = DOOR.x0 + DOOR.w / 2;
  const holeGeo = new THREE.PlaneGeometry(DOOR.hole.w, DOOR.hole.h);

  const mask = new THREE.Mesh(
    holeGeo,
    new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    }),
  );
  mask.position.set(cx, DOOR.hole.h / 2, -3.92);
  mask.renderOrder = 2;
  group.add(mask);

  // 暖光：發光（toneMapped:false）跟 ON AIR 燈箱、跑馬燈一致；顏色超過 1 讓 bloom 抓得到
  const glow = new THREE.Mesh(holeGeo, new THREE.MeshBasicMaterial({ map: glowTexture(), toneMapped: false }));
  insideHole(glow.material as THREE.Material);
  glow.position.set(cx, DOOR.hole.h / 2, -3.919);
  glow.renderOrder = 3;
  group.add(glow);

  const hinge = new THREE.Group();
  hinge.position.set(DOOR.x0, 0, DOOR.z);
  group.add(hinge);
  const mats: THREE.ShaderMaterial[] = [];
  const part = (geo: THREE.BufferGeometry, x: number, y: number, z: number, order: number, base?: number) => {
    const m = flat();
    if (base !== undefined) (m.uniforms.base!.value as THREE.Color).set(base);
    insideHole(m);
    mats.push(m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.renderOrder = order;
    hinge.add(mesh);
    return m;
  };
  const mid = DOOR.w / 2;
  const slab = part(new THREE.BoxGeometry(DOOR.w, DOOR.h, 0.04), mid, 1.04, 0, 4);
  // 門心板、門把用單面平片：門轉到背面時被背面剔除，不會穿透門板
  const panels = [0.55, 1.5].map((y) => part(new THREE.PlaneGeometry(0.78, 0.7), mid, y, 0.0205, 5));
  part(new THREE.CircleGeometry(0.03, 16), 0.115, 1.0, 0.0215, 6, ROOM.tan);

  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.1, 0.1), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(cx, 1.05, -3.9);
  parent.add(group, hit);
  return { group, hinge, glow, mats, slab, panels, hit };
}
