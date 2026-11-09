/**
 * TasteProfile：頁面唯一吃的資料格式。
 * 每種來源（Spotify API、Spotify 資料下載、Netflix CSV）各寫一個 adapter 轉成這個格式，
 * 頁面不知道資料從哪裡來。
 */

export const RANGE_KEYS = ['month', 'half', 'all'] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
/** CD 牆與榜單一進來看哪一段：一年的歌最多、最好挑（2026-11-08 使用者決定，原本是這 4 週） */
export const DEFAULT_RANGE: RangeKey = 'all';

export interface Picture {
  /** 約 300px，給架上與列表用 */
  sm: string;
  /** 約 640px，給唱盤與大圖用 */
  lg: string;
}

export interface ArtistRef {
  id: string;
  name: string;
}

export interface Artist extends ArtistRef {
  picture?: Picture;
  url?: string;
}

export interface Album {
  id: string;
  name: string;
  year?: number;
  /** 專輯收錄的曲目數（算「整張聽完」的分母）；舊資料沒有 */
  totalTracks?: number;
  picture?: Picture;
}

export interface Track {
  id: string;
  name: string;
  artists: ArtistRef[];
  album: Album;
  durationMs: number;
  /** 國際標準錄音代碼：不同專輯版本的同一首歌通常共用；舊資料沒有 */
  isrc?: string;
  url?: string;
}

export interface Play {
  trackId: string;
  playedAt: string;
}

export interface RangeChart {
  artists: Artist[];
  tracks: Track[];
}

export interface MusicTaste {
  source: 'spotify-api' | 'spotify-export';
  ranges: Record<RangeKey, RangeChart>;
  /** 最近播放（API 最多 50 筆） */
  recent: Play[];
  /** recent 裡出現、但不在排行裡的歌 */
  extraTracks: Track[];
  /** 按讚的歌（Spotify 資料量大，已去掉圖片；只用來算專輯聽過幾首）。舊資料沒有 */
  saved?: Track[];
  totals: { saved?: number; followed?: number };
}

/** Netflix 之後接上；先定出形狀，頁面看到 undefined 就不畫放映室內容 */
export interface ScreenTitle {
  id: string;
  title: string;
  kind: 'series' | 'film';
  poster?: Picture;
  year?: number;
  genres?: string[];
  /** 看過的集數或次數 */
  views: number;
  lastWatched: string;
}

export interface ScreenTaste {
  source: 'netflix-csv';
  titles: ScreenTitle[];
}

export interface TasteProfile {
  version: 1;
  generatedAt: string;
  owner: { name: string; country?: string; url?: string; picture?: Picture };
  music?: MusicTaste;
  screen?: ScreenTaste;
}
