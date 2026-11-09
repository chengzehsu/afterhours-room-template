/** 打 Spotify API 的共用小工具（拆出來好測；fetch-spotify.ts 是會直接跑的腳本，不能被 import） */

/** 每個請求的標頭：Accept-Language 要求歌手名、專輯名盡量回中文（沒有中文名的照舊回原文） */
export function spotifyHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh-TW' };
}

type Page = { total?: number; items: { track: { id: string } }[] };

/** 按讚的歌分頁抓完（每頁最多 50）；回空頁或超過 maxPages 就停，不會無限迴圈 */
export async function fetchAllSaved<P extends Page>(
  get: (path: string, params: Record<string, number>) => Promise<P>,
  limit = 50,
  maxPages = 100,
): Promise<{ total: number; items: P['items'] }> {
  const items: P['items'] = [];
  let total = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await get('me/tracks', { limit, offset: page * limit });
    total = res.total ?? total;
    if (!res.items.length) break;
    items.push(...res.items);
    if (items.length >= total) break;
  }
  return { total, items };
}
