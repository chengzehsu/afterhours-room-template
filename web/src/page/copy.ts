/** 台灣繁體中文文案。所有句子都由資料產生，換人的資料也成立。 */
import type { RangeKey } from '../core/profile.ts';

export const RANGE_LABEL: Record<RangeKey, string> = { month: '4 週', half: '半年', all: '一年' };
export const RANGE_LONG: Record<RangeKey, string> = { month: '這 4 週', half: '這半年', all: '這一年' };

/** 出口：邀朋友進放映室。放映室頁面還沒建好時，門只開一點，講一句話就關上 */
export const EXIT = {
  lead: {
    ready: '我看過的電影、影集和動畫都在那裡，投影已經架好，進去挑一部。',
    pending: '隔壁是我家客廳，我還在整理片單。票先給你，位子幫你留著。',
  },
  enter: '推開門，過去看劇',
  spotify: '先到 Spotify 找我',
  pending: '投影還在架，下次來就開門。',
  footer: '看劇的地方',
} as const;

export const fmt = (n: number) => n.toLocaleString('zh-TW');

/**
 * 唱盤歌名下那句：只講我有多常放（分享品味，不報名次、不講「少聽」「衝到」這種比較，業主 2026-11-09）。
 * 依序：這一年第 1 → 這陣子第 1 → 這一年前 10 → 這一年有上榜 → 半年有上榜 → 只有最近 4 週上榜；都沒上榜回空字串。
 */
export function rankLine(ranks: Record<RangeKey, number | null>): string {
  const { month: m, half: h, all: a } = ranks;
  if (a === 1) return '這一年我最常放的一首。';
  if (m === 1) return '這陣子最常放的就是它。';
  if (a && a <= 10) return '這一年我很常放。';
  if (a || h) return '這一年常常會放到。';
  if (m) return '最近很常放。';
  return '';
}

/** 唱盤面板的名次：大標已經說「這一年聽最多」時，不再重複「這一年第 1」 */
export function deckRanks(ranks: Record<RangeKey, number | null>): string {
  return rankLine(ranks);
}

/** 名字切成兩半，放在畫面兩個角落 */
export function splitOwner(name: string): [string, string] {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return [`${first} 的`, '聽歌的地方'];
}

/** 取歌手名稱裡的中文（「晚風樂團 Evening Breeze」→「晚風樂團」），沒有就用原名 */
export { displayName } from '../core/names.ts';

const CJK = '⺀-⻿⼀-⿟぀-ゟ゠-ヿ㄀-ㄯ㈀-㋿㐀-䶿一-鿿豈-﫿';
const CJK_THEN_LATIN = new RegExp(`([${CJK}])([A-Za-z0-9])`, 'g');
const LATIN_THEN_CJK = new RegExp(`([A-Za-z0-9%])([${CJK}])`, 'g');

/** 中文與英數字之間補一個空格（只處理標籤外的文字） */
export function spaceMixed(html: string): string {
  return html
    .split(/(<[^>]+>)/)
    .map((part) => (part.startsWith('<') ? part : part.replace(CJK_THEN_LATIN, '$1 $2').replace(LATIN_THEN_CJK, '$1 $2')))
    .join('');
}

/** 唱盤標題的下半句：回應訪客的動作，不報排名（排名在面板小字）。自己挑的寫「你挑的這首」 */
export function deckSub(picked: boolean): string {
  return picked ? '你挑的這首' : '唱盤上這張';
}

/** 唱盤標題的下半句：挑這首歌名次最好的那段時間 */
export function deckHeadline(ranks: Record<RangeKey, number | null>): string {
  if (ranks.all === 1) return '是我這一年聽最多的一首';
  const order: RangeKey[] = ['all', 'half', 'month'];
  const best = order
    .filter((k) => ranks[k])
    .sort((a, b) => (ranks[a] as number) - (ranks[b] as number))[0];
  return best ? `${RANGE_LONG[best]}第 ${ranks[best]} 名` : '最近有在聽';
}

/** 片名連同〈〉放進同一個字串（同一個元素的文字），括號才不會被單獨換到別行 */
export const quoteTitle = (name: string): string => `〈${name}〉`;
