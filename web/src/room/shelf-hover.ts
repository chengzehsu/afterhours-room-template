/**
 * CD 牆的滑鼠選片：滑鼠指到哪張就馬上選哪張，光跟字幕才跟得上快速移動。
 * 只是路過（例如滑去按「放上唱盤」，途中掃過別張）不該換掉原本那張：
 * 剛換不到 HOVER_SETTLE_MS 就離開房間、移到頁面按鈕上，就退回上一張停穩的。
 * （之前是「停 140ms 才選」，快速移動時一直重新計時，光完全跟不上；使用者 2026-11-09 回報很卡）
 */

/** 在一張上停多久才算「選定」，離開時不再退回 */
export const HOVER_SETTLE_MS = 140;

export interface HoverMemo {
  /** 上一張停穩的 */
  stable: string | null;
  /** 上次因為滑鼠而換張的時間 */
  changedAt: number;
  /** 上一格滑鼠底下那張：滑鼠移到「不同的」CD 才算滑鼠選片，靜止時不搶鍵盤換的那張 */
  lastOver?: string | null;
}

export interface HoverInput {
  /** 目前選中的 */
  current: string | null;
  /** 滑鼠底下那張（沒有就 null） */
  over: string | null;
  /** 滑鼠還在房間畫面上（不在頁面按鈕、文字上） */
  onRoom: boolean;
  now: number;
}

/** 回傳這一格該選哪張；memo 會就地更新 */
export function hoverPick(memo: HoverMemo, { current, over, onRoom, now }: HoverInput): string | null {
  const moved = over !== memo.lastOver;
  memo.lastOver = over;
  // 只有滑鼠移到另一張才換：滑鼠靜止停在某張上時，左右鍵換的張不會被它搶回去
  if (moved && over && over !== current) {
    memo.changedAt = now;
    return over;
  }
  const fresh = now - memo.changedAt < HOVER_SETTLE_MS;
  if (!onRoom && fresh && memo.stable && current !== memo.stable) {
    memo.changedAt = -Infinity;
    return memo.stable;
  }
  if (!fresh) memo.stable = current;
  return current;
}
