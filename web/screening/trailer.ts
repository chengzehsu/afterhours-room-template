// 銀幕預告的純函式：嵌入網址、Netflix 連結、YouTube iframe 的 postMessage（不載入 IFrame API 腳本）。
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function embedUrl(id: unknown, o: { origin: string; reduced: boolean }): string | null {
  if (typeof id !== 'string' || !YT_ID.test(id)) return null;
  const u = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  u.searchParams.set('autoplay', o.reduced ? '0' : '1');
  u.searchParams.set('mute', '1');
  u.searchParams.set('playsinline', '1');
  u.searchParams.set('rel', '0');
  u.searchParams.set('enablejsapi', '1');
  u.searchParams.set('origin', o.origin);
  return u.toString();
}

// Netflix 紀錄沒有片號，只能連搜尋頁
export function netflixSearchUrl(title: string): string {
  const u = new URL('https://www.netflix.com/search');
  u.searchParams.set('q', title);
  return u.toString();
}

// 回傳 YouTube 播放狀態（0 結束、1 播放中、2 暫停…），不是狀態訊息就回 null
export function parseYtMessage(data: unknown): number | null {
  if (typeof data !== 'string') return null;
  try {
    const m = JSON.parse(data);
    if (m?.event === 'onStateChange' && typeof m.info === 'number') return m.info;
    if (m?.event === 'infoDelivery' && typeof m.info?.playerState === 'number') return m.info.playerState;
  } catch { /* 不是 JSON */ }
  return null;
}

export type YtCommand = 'mute' | 'unMute' | 'pauseVideo' | 'playVideo';
export const command = (func: YtCommand) => JSON.stringify({ event: 'command', func, args: [] });
export const LISTEN = JSON.stringify({ event: 'listening' });

export const linkVisible = (state: number) => state === 0 || state === 2;

// 影片被擋嵌入或已下架時 YouTube 會送 onError，這時退回劇照
export function ytError(data: unknown): boolean {
  if (typeof data !== 'string') return false;
  try { return JSON.parse(data)?.event === 'onError'; } catch { return false; }
}

export type Pt = { x: number; y: number };

/**
 * 預告是疊在 WebGL 上的 CSS3D 層，不會被 3D 的門框、牆擋住。
 *  - 鏡頭在放映室裡：銀幕四角都在畫面內才顯示（不裁切）。
 *  - 鏡頭在門外：照樣顯示，但由 doorClip() 把這一層裁成門洞的形狀，像站在門外看著投影。
 *  - 鏡頭正在穿過門洞（門洞的角跑到鏡頭後面）或貼著前牆內側：不顯示，銀幕改用 WebGL 的劇照。
 * camZ：鏡頭 z；roomFrontZ：放映室前牆 z（layout.json room.z0）；corners：銀幕四角的 NDC；holeBehind：門洞有角在鏡頭後面。
 */
export function trailerMode(camZ: number, roomFrontZ: number, corners: readonly { x: number; y: number; z: number }[], holeBehind: boolean): 'off' | 'inside' | 'door' {
  if (corners.length === 0 || corners.some((p) => p.z >= 1)) return 'off';
  if (camZ > roomFrontZ + 0.1) {
    if (holeBehind) return 'off';
    // 銀幕的外框跟畫面有重疊就算看得到（實際露出多少由 doorClip 裁）
    const off = corners.every((p) => p.x < -1) || corners.every((p) => p.x > 1) || corners.every((p) => p.y < -1) || corners.every((p) => p.y > 1);
    return off ? 'off' : 'door';
  }
  if (camZ > roomFrontZ - 0.3) return 'off';
  return corners.every((p) => Math.abs(p.x) <= 1.001 && Math.abs(p.y) <= 1.001) ? 'inside' : 'off';
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** 凸包（Andrew monotone chain），逆時針 */
export function convexHull(pts: readonly Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const lo: Pt[] = [], hi: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2]!, hi[hi.length - 1]!, q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** 兩個凸多邊形的交集（Sutherland–Hodgman；clip 必須是凸的） */
export function clipConvex(subject: readonly Pt[], clip: readonly Pt[]): Pt[] {
  const c = convexHull(clip);
  let out = [...subject];
  for (let i = 0; i < c.length && out.length; i++) {
    const a = c[i]!, b = c[(i + 1) % c.length]!;
    const inp = out;
    out = [];
    const inside = (q: Pt) => cross(a, b, q) >= 0;
    for (let j = 0; j < inp.length; j++) {
      const cur = inp[j]!, prev = inp[(j + inp.length - 1) % inp.length]!;
      const hit = (): Pt => { const d1 = cross(a, b, prev), d2 = cross(a, b, cur), t = d1 / (d1 - d2); return { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t }; };
      if (inside(cur)) { if (!inside(prev)) out.push(hit()); out.push(cur); } else if (inside(prev)) out.push(hit());
    }
  }
  return out;
}

/**
 * 門外看銀幕的可見範圍（螢幕像素）：門洞前緣與後緣兩個四邊形的交集，再挖掉往房內開的門板（先裁進門洞，避免 evenodd 把門洞外的部分反而補回來）。
 * 回傳可見多邊形與要挖掉的洞；門洞完全看不到時回傳 null。
 */
export function doorClip(holeFront: readonly Pt[], holeBack: readonly Pt[], leaf: readonly Pt[] | null): { hole: Pt[]; cut: Pt[] | null } | null {
  const hole = clipConvex(convexHull(holeFront), holeBack);
  if (hole.length < 3) return null;
  const cut = leaf && leaf.length >= 3 ? clipConvex(convexHull(leaf), hole) : null;
  return { hole, cut: cut && cut.length >= 3 ? cut : null };
}

/** CSS clip-path：path(evenodd, ...)，門洞減門板 */
export function clipPathCss(c: { hole: Pt[]; cut: Pt[] | null }): string {
  const ring = (r: Pt[]) => 'M' + r.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('L') + 'Z';
  return `path(evenodd, '${ring(c.hole)}${c.cut ? ring(c.cut) : ''}')`;
}

/** evenodd 的點在不在裁切範圍內（測試用，也可給除錯） */
export function insideClip(q: Pt, c: { hole: Pt[]; cut: Pt[] | null }): boolean {
  const inPoly = (r: Pt[]) => { let k = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i]!, b = r[j]!; if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) k = !k; } return k; };
  return inPoly(c.hole) !== (c.cut ? inPoly(c.cut) : false);
}
