/**
 * 燈箱牆的位置：讀房間烘焙時輸出的 public/room/lights.json 的 `lightbox`（燈箱凹牆的精確矩形）與 `occluders`
 * （擋在牆前面的東西：喇叭、唱盤架、真空管機、VU 表…），沒有或格式不對就用預設值
 * （gig-layout.ts 的 DEFAULT_LIGHTBOX_RECT、BACK_WALL_OBSTACLES，數字只在那裡寫一份；test/gigs.test.ts 會檢查預設值跟檔案一致）。
 *
 * lights.json 格式（單位公尺，房間座標）：
 *  - lightbox: { x0, x1, y0, y1, z }：凹牆的左右、上下緣與前緣 z（也接受包在 { rect } 裡，另可有 depth：燈箱往凹牆裡縮多少，預設 0.03）
 *  - occluders: [{ name?, min: [x, y, z], max: [x, y, z] }]：包圍盒；也接受 { x0, x1, y0, y1, z0, z1 }
 */
import { BACK_WALL_OBSTACLES, DEFAULT_LIGHTBOX_RECT, usableArea, type WallRect } from './gig-layout.ts';
import { BACK_WALL, type GigWall } from './posters.ts';

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 擋住燈箱的東西 → 牆面矩形（u = 世界 x）；只收在燈箱凹牆前面、而且有重疊高度的；格式不認得的略過 */
export function obstaclesFromOccluders(list: unknown, frontZ: number): WallRect[] {
  const out: WallRect[] = [];
  if (!Array.isArray(list)) return out;
  for (const o of list as Record<string, unknown>[]) {
    let b: [number, number, number, number, number, number] | null = null;
    const mn = o?.min as unknown[] | undefined;
    const mx = o?.max as unknown[] | undefined;
    if (Array.isArray(mn) && Array.isArray(mx) && mn.length === 3 && mx.length === 3 && [...mn, ...mx].every(num)) b = [mn[0], mx[0], mn[1], mx[1], mn[2], mx[2]] as [number, number, number, number, number, number];
    else if (num(o?.x0) && num(o?.x1) && num(o?.y0) && num(o?.y1) && num(o?.z0) && num(o?.z1)) b = [o.x0, o.x1, o.y0, o.y1, o.z0, o.z1];
    if (!b || b[0] > b[1] || b[2] > b[3] || b[5] <= frontZ - 0.5) continue; // 在牆前面（z 比前緣大）才算
    out.push({ zMin: b[0], zMax: b[1], yMin: b[2], yMax: b[3] });
  }
  return out;
}

/** 純函式：把 lights.json（或只有矩形的 JSON）轉成牆；格式不對回 null。沒有 occluders 就用預設的遮擋物 */
export function gigWallFromJson(json: unknown): GigWall | null {
  const o = json as { lightbox?: unknown; rect?: unknown; depth?: unknown; occluders?: unknown } | null;
  if (!o || typeof o !== 'object') return null;
  const box = (o.lightbox ?? o.rect ?? o) as Record<string, unknown>;
  const holder = (o.lightbox && typeof o.lightbox === 'object' ? o.lightbox : o) as { depth?: unknown };
  if (!box || !num(box.x0) || !num(box.x1) || !num(box.y0) || !num(box.y1) || !num(box.z)) return null;
  if (box.x1 - box.x0 < 0.5 || box.y1 - box.y0 < 0.5) return null;
  const depth = num(holder.depth) ? holder.depth : num(o.depth) ? o.depth : 0.03;
  const occ = obstaclesFromOccluders(o.occluders, box.z);
  const obstacles = Array.isArray(o.occluders) ? occ : BACK_WALL_OBSTACLES;
  return { kind: 'back', at: box.z - depth, area: usableArea({ x0: box.x0, x1: box.x1, y0: box.y0, y1: box.y1 }, obstacles), obstacles };
}

export async function loadGigWall(url: string): Promise<GigWall> {
  try {
    const res = await fetch(url);
    if (res.ok) return gigWallFromJson(await res.json()) ?? BACK_WALL;
  } catch {
    // 沒有檔案就用預設
  }
  return BACK_WALL;
}

export { DEFAULT_LIGHTBOX_RECT };
