/**
 * 後牆燈箱牆（#gigs）的鏡頭：從唱盤這側往後拉，正對燈箱。獨立成檔是為了讓測試能直接載入（room.ts 有 TS 參數屬性，
 * node 的型別剝除載不進來）。
 * 數字是用 test/gigs.test.ts 同一套限制搜出來的（整組燈箱的外框投影到螢幕，且鏡頭到每個取樣點的視線不穿過
 * lights.json 的 occluders：唱盤架、唱盤、管機、VU 表、喇叭）：
 *  - 桌機：落在文字欄（左邊 gutter + 440px）右邊、離右緣 20px、頂列之下（76px）、右下播放列（約 190px）之上
 *  - 手機：整面牆在說明文字之下（390×844 從 260px、375×667 從 250px 起）、底部播放列（100px）之上，左右各留 8px
 *  - 手機另有三個推近的鏡頭（gigs-t1／t2／t3：牆的左、中、右三段）：整面牆 2.45 公尺寬在小螢幕上名字太小，
 *    每段約 0.85 公尺寬（兩排都在畫面裡），印在卡紙下緣的名字才讀得到 12px 以上
 * 燈箱凹牆的矩形若被 public/room/gig-wall.json 改掉，要重跑搜尋、更新這裡（DEFAULT_LIGHTBOX_RECT 是預設值的唯一來源）。
 */
export interface GigsPose {
  pos: [number, number, number];
  look: [number, number, number];
  fov: number;
}

const P = (pos: [number, number, number], look: [number, number, number], fov: number): GigsPose => ({ pos, look, fov });

export const GIGS_CAM = {
  wide: P([0, 1.5, -0.5], [-0.75, 1.2, -3.93], 44),
  phone: P([0, 1.5, 0.5], [0, 2, -3.93], 64),
  // 矮手機（寬高比 > 0.5，例如 375×667）：文字佔掉的比例更大，牆放進中段
  phoneShort: P([0, 1.5, 0], [0, 1.9, -3.93], 60),
  /** 推近左、中、右三段：phone = 390×844，short = 375×667 */
  thirds: {
    phone: [P([0, 1.5, -1], [-0.75, 1.3, -3.93], 36), P([0.5, 1.5, -1], [0, 1.7, -3.93], 40), P([0, 1.5, -1], [0.75, 1.3, -3.93], 36)],
    short: [P([-0.75, 1.5, -1], [-0.75, 1.6, -3.93], 36), P([0, 1.5, -1], [0, 1.4, -3.93], 36), P([0.75, 1.5, -1], [0.75, 1.4, -3.93], 36)],
  },
};

/** 鏡頭名 gigs-t1…t3 → 第幾段（0 起）；不是的回 -1 */
export function gigsThirdOf(name: string): number {
  const m = /^gigs-t(\d)$/.exec(name);
  return m ? Number(m[1]) - 1 : -1;
}
