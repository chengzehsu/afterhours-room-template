/**
 * CD 牆上哪些位子該是空的：正在放的那張被拿去唱盤了，牆上不能同時還有一張。
 * deck = 已在唱盤上的；flying = 正從牆上飛向唱盤的。換歌時上一張（deck）要等新的一張落盤才放回牆上。
 * 全是純函式，room.ts 每一格拿它算位子要不要藏；狀態沒變就回傳同一個物件，呼叫端可以用 === 判斷「沒變」。
 */
export interface DeckSlots {
  deck: string | null;
  flying: string | null;
}

export const EMPTY_DECK: DeckSlots = { deck: null, flying: null };

/** 這首起飛（或開場被選中）。已在唱盤上或已在飛的同一首：原樣回傳，牆上不閃 */
export function takeOff(s: DeckSlots, id: string): DeckSlots {
  if (s.deck === id || s.flying === id) return s;
  return { deck: s.deck, flying: id };
}

/** 飛行中的那張落到唱盤上，上一張就此放回牆上 */
export function land(s: DeckSlots): DeckSlots {
  if (s.flying === null) return s;
  return { deck: s.flying, flying: null };
}

export function hiddenIds(s: DeckSlots): ReadonlySet<string> {
  return new Set([s.deck, s.flying].filter((x): x is string => x !== null));
}

/** 目前這面牆（依位子順序的歌 id）上要空著的位子 */
export function vacantIndices(wallIds: readonly string[], s: DeckSlots): number[] {
  const hidden = hiddenIds(s);
  return wallIds.flatMap((id, i) => (hidden.has(id) ? [i] : []));
}

/** 從 prev 到 next，哪些歌從「空位」變回「放在牆上」 */
export function released(prev: DeckSlots, next: DeckSlots): string[] {
  const now = hiddenIds(next);
  return [...hiddenIds(prev)].filter((id) => !now.has(id));
}
