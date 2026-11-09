/** 房間的時段：照訪客裝置的當地時間決定；訪客自己選的只在同一天、同一個時段有效 */
export type Mood = 'afternoon' | 'tipsy' | 'night';
export const MOODS: readonly Mood[] = ['afternoon', 'tipsy', 'night'];

/** 6–16 點午後、16–21 點微醺、其餘深夜（Date 的 getHours 就是裝置的當地時間） */
export function moodByClock(d: Date): Mood {
  const h = d.getHours();
  if (h >= 6 && h < 16) return 'afternoon';
  if (h >= 16 && h < 21) return 'tipsy';
  return 'night';
}

export interface SavedMood {
  mood: Mood;
  /** 選的當下，照時間該是哪個時段 */
  slot: Mood;
  /** 選的那天（toDateString） */
  day: string;
}

const isMood = (v: unknown): v is Mood => typeof v === 'string' && (MOODS as readonly string[]).includes(v);

/** 晚上選了深夜、隔天白天打開不能還是深夜：時段一過或換一天，就回到照時間 */
export function pickMood(now: Date, saved: SavedMood | null): Mood {
  const clock = moodByClock(now);
  if (!saved || !isMood(saved.mood) || saved.slot !== clock || saved.day !== now.toDateString()) return clock;
  return saved.mood;
}
