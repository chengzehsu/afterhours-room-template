/** 一直放下去：一首播完就從牆上隨機挑下一首，最近放過的幾首先不重複 */
export function nextShuffle(pool: readonly string[], recent: readonly string[], rand: () => number = Math.random, avoid = 8): string | null {
  const uniq = [...new Set(pool)];
  if (!uniq.length) return null;
  const last = recent.at(-1);
  const keep = Math.min(avoid, Math.max(0, uniq.length - 1)); // 牆太小時至少能換一首
  const blocked = new Set(recent.slice(-keep));
  let cands = uniq.filter((id) => !blocked.has(id));
  if (!cands.length) cands = uniq.filter((id) => id !== last);
  if (!cands.length) cands = uniq;
  return cands[Math.min(cands.length - 1, Math.floor(rand() * cands.length))]!;
}

/** 播完了沒：位置走到曲長的最後 1 秒內（Spotify 嵌入播放器播完會停在結尾） */
export function trackEnded(positionMs: number, durationMs: number): boolean {
  return durationMs > 5000 && positionMs >= durationMs - 1000;
}

/**
 * 每次播完只接一次下一首：播完會連續回報好幾次，只算第一次；位置離開結尾（同一首又從前面放）就重新算。
 * 舊版用「替哪首接過」的旗標，從來不清，同一首第二次播完就不續播、音樂停住（2026-11-09 業主回報）。
 */
export function endWatcher(): (positionMs: number, durationMs: number) => boolean {
  let armed = true;
  return (positionMs, durationMs) => {
    if (!trackEnded(positionMs, durationMs)) {
      if (positionMs < durationMs - 3000) armed = true;
      return false;
    }
    if (!armed) return false;
    armed = false;
    return true;
  };
}
