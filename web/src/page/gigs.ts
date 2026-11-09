/** 業主挑的最愛表演人：owner.json 的 favorites.gigs → 頁面與房間用的清單。純函式，可測。 */
import type { TasteProfile } from '../core/profile.ts';

export interface GigPick {
  name: string;
  /** Spotify artist ID */
  spotify: string;
}

export interface Gig {
  /** 要顯示的名字（業主指定的，例如中文名） */
  name: string;
  /** 歌手照片的相對網址（public/gigs/<id>.jpg 存在才有） */
  img: string | null;
  /** 一年榜名次（1 起），沒上榜 null。只用來決定畫框大小，頁面與牆上都不寫出名次 */
  rankNo: number | null;
}

export function yearRank(profile: TasteProfile, artistId: string): number | null {
  const at = profile.music?.ranges.all.artists.findIndex((a) => a.id === artistId) ?? -1;
  return at >= 0 ? at + 1 : null;
}

/** hasPhoto：public/gigs/<id>.jpg 在不在（建置時由 vite.config.ts 用 existsSync 查）。id 只收英數字，不讓它拼出奇怪的路徑 */
export function gigsOf(profile: TasteProfile, picks: readonly GigPick[] | undefined, hasPhoto: (id: string) => boolean): Gig[] {
  const out: Gig[] = [];
  for (const p of picks ?? []) {
    const name = typeof p?.name === 'string' ? p.name.trim().slice(0, 40) : '';
    const id = typeof p?.spotify === 'string' ? p.spotify : '';
    if (!name || !/^[A-Za-z0-9]+$/.test(id)) continue;
    out.push({ name, img: hasPhoto(id) ? `gigs/${id}.jpg` : null, rankNo: yearRank(profile, id) });
  }
  return out;
}
