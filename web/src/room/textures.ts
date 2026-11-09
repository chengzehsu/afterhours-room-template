import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
/** 以 Source 為鍵：clone 出來的貼圖共用同一個 Source，等的是同一張圖 */
const loaded = new WeakMap<THREE.Source<unknown>, Promise<void>>();

/** 先在背景解碼，上傳時才不用在主執行緒同步解 JPEG；不支援或失敗就照舊 */
export async function decoded(tex: THREE.Texture): Promise<void> {
  const img = tex.image as HTMLImageElement | null;
  await img?.decode?.().catch(() => {});
}

export function photo(url: string, renderer: THREE.WebGLRenderer): THREE.Texture {
  const hit = cache.get(url);
  if (hit) return hit;
  let done!: () => void;
  const ready = new Promise<void>((r) => (done = r));
  const tex = loader.load(url, (t) => void decoded(t).then(done), undefined, () => done());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  loaded.set(tex.source, ready);
  cache.set(url, tex);
  return tex;
}

/** 這張貼圖的圖載好（並解碼）了；不是 photo() 載的就當作已經好了 */
export function whenLoaded(tex: THREE.Texture): Promise<void> {
  return loaded.get(tex.source) ?? Promise.resolve();
}

/** 物件底下所有材質用到的貼圖（含 ShaderMaterial 的 uniform），不含 render target 的貼圖；看不見的物件也算 */
export function texturesIn(root: THREE.Object3D): THREE.Texture[] {
  const out = new Set<THREE.Texture>();
  const add = (v: unknown) => {
    const t = v as THREE.Texture | null | undefined;
    if (t?.isTexture && !t.isRenderTargetTexture) out.add(t);
  };
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of [m].flat()) {
      Object.values(mat).forEach(add);
      const u = (mat as THREE.ShaderMaterial).uniforms;
      if (u) Object.values(u).forEach((x) => add(x?.value));
    }
  });
  return [...out];
}

/** 黑膠唱片的溝紋：同心圓明暗交錯 */
export function grooves(): THREE.CanvasTexture {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d0c0c';
  g.fillRect(0, 0, size, size);
  const mid = size / 2;
  for (let r = mid * 0.36; r < mid * 0.98; r += 2.2) {
    const shade = 14 + Math.round(Math.random() * 10) + (Math.floor(r / 60) % 2 ? 6 : 0);
    g.strokeStyle = `rgb(${shade},${shade},${shade})`;
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(mid, mid, r, 0, Math.PI * 2);
    g.stroke();
  }
  // 曲目之間的空白溝
  for (const f of [0.52, 0.66, 0.8]) {
    g.strokeStyle = '#050505';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(mid, mid, mid * f, 0, Math.PI * 2);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 木頭地板：一條條長木板，色差很小 */
export function planks(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  const rows = 8;
  for (let i = 0; i < rows; i++) {
    let x = -Math.random() * 300;
    while (x < 512) {
      const w = 220 + Math.random() * 260;
      const v = 38 + Math.round(Math.random() * 9);
      g.fillStyle = `rgb(${v + 8},${v - 2},${v - 16})`;
      g.fillRect(x, (i * 512) / rows, w - 2, 512 / rows - 2);
      x += w;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

/** 放映室招牌上的字 */
export function signText(text: string, font: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e4e2da';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#2b2216';
  g.font = `600 150px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
