export type Vec3 = readonly [number, number, number];

export interface IntroPlan {
  /** wall = 飛牆上那張的複製品；temp = 牆上沒有，用封面臨時做一片 */
  source: 'wall' | 'temp';
  /** false = 不飛：唱片直接在唱盤上，時間軸停在等互動那一段 */
  animate: boolean;
  /** 開場永遠停在唱盤上等第一下互動，不會在點擊前自己結束 */
  endsOnGesture: true;
}

export function planIntro(onWall: boolean, reducedMotion: boolean): IntroPlan {
  return { source: onWall ? 'wall' : 'temp', animate: !reducedMotion, endsOnGesture: true };
}

/** 臨時 CD 的起點：牆上第一格的位置，往房間內拉出一點、再抬高一點，之後從這裡放大滑出 */
export function tempStart(firstSlot: Vec3): [number, number, number] {
  return [firstSlot[0] + 0.35, firstSlot[1] + 0.45, firstSlot[2]];
}

/** 只在開發模式用：網址 ?opener=<trackId> 強制開場挑這首；不在曲目表裡就忽略 */
export function forcedOpener(search: string, tracks: Readonly<Record<string, unknown>>): string | null {
  const id = new URLSearchParams(search).get('opener');
  return id && Object.hasOwn(tracks, id) ? id : null;
}

/** 這次進來走哪條路：一般開場／從放映室回到出口／回到出口但不動畫（減少動態） */
export type EntryRoute = 'opening' | 'return' | 'return-still';

export function entryRoute(search: string, reducedMotion: boolean): EntryRoute {
  if (new URLSearchParams(search).get('from') !== 'screening') return 'opening';
  return reducedMotion ? 'return-still' : 'return';
}

/** 回到出口的時間表（毫秒）：鏡頭拉回、門關上、暗場淡入 */
export const RETURN_MS = { cam: 1200, door: 1000, veil: 500 };

export interface Pose {
  pos: readonly [number, number, number];
  look: readonly [number, number, number];
  fov: number;
}

export const DIVE_AIM: Vec3 = [3.25, 1.5, -2.6];
export const DIVE_LOOK: Vec3 = [3.25, 1.3, -4.4];

/** 推進放映室門洞的終點鏡頭。room.ts 的 dive() 與回到出口的起點共用這個算法 */
export function diveEnd(from: Pose): { pos: [number, number, number]; look: [number, number, number]; fov: number } {
  const pos = from.pos.map((v, i) => v + (DIVE_AIM[i]! - v) * 0.62) as [number, number, number];
  return { pos, look: [...DIVE_LOOK], fov: from.fov * 0.86 };
}

/** 動畫結束後換掉網址用：拿掉 from=screening，其他參數保留 */
export function withoutReturnParam(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('from');
  const s = q.toString();
  return s ? `?${s}` : '';
}
