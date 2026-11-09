/**
 * 開場選片的光停在哪張（純函式，可測）。
 * 業主 2026-11-09：「不用快速跳過，隨機照一張、引導使用者選」——光不自己往下走；
 * 滑鼠指到別張才跟過去；鏡頭還在滑動時不理滑鼠（鏡頭一動，滑鼠底下的 CD 每格都變，看起來就像快速跳過很多張）。
 */
export function nextLit(lit: string, pointedId: string | null, gliding: boolean): string {
  if (gliding || !pointedId) return lit;
  return pointedId;
}
