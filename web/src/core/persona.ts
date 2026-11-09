/**
 * 「我的聽歌習慣」海報：用歌和人講品味，不用百分比當主角（2026-11-08 使用者覺得統計數字不像一個人）。
 * 只用排行與最近播放算，不靠曲風（Spotify 不再提供，開放資料庫對台灣樂團覆蓋太少），換成別人的資料也成立。
 * 標題：從一年第 1 名的歌手，到前 10 名裡第一位不同語言的歌手，加上最常聽歌的時段。
 * 四格：一整年都在循環的歌（或一直都在的歌手）、整張聽完的專輯、聽歌時間、輪流的歌手（或一頭栽進去）。
 */
import { displayName } from './names.ts';
import type { MusicTaste, Track } from './profile.ts';
import { fullestAlbum } from './albums.ts';
import { findDominance } from './stories.ts';
import { trackKeyFor } from './trackkey.ts';

export interface Trait {
  key: 'loop' | 'loyal' | 'album' | 'hours' | 'spread' | 'deep';
  label: string;
  /** 代表這格的大字，例如「3 首」「中午・晚上」 */
  figure: string;
  /** 一句有歌名、專輯名或數字的證據 */
  proof: string;
}

export interface Persona {
  title: string;
  traits: Trait[];
}

export function scriptOf(name: string): 'ja' | 'zh' | 'latin' {
  if (/[぀-ヿ]/.test(name)) return 'ja';
  if (/[一-鿿㐀-䶿]/.test(name)) return 'zh';
  return 'latin';
}

const lead = (t: Track) => displayName(t.artists[0]?.name ?? '');
const song = (t: Track) => `${lead(t)}〈${t.name}〉`;
/** 同一位歌手連續出現時只寫第一次的名字：落日飛車〈A〉〈B〉 */
function songList(ts: readonly Track[]): string {
  return ts.map((t, i) => (i && lead(ts[i - 1]!) === lead(t) ? `〈${t.name}〉` : song(t))).join('、');
}

/** 一天切成 6 段，用在「聽歌時間」那格 */
function slot(h: number): string {
  return h < 6 ? '凌晨' : h < 11 ? '早上' : h < 14 ? '中午' : h < 18 ? '下午' : h < 22 ? '晚上' : '深夜';
}
function clock(h: number): string {
  const s = slot(h);
  const twelve = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${s === '中午' && h > 12 ? '下午' : s} ${twelve} 點`;
}
function hourIn(iso: string, timeZone: string | undefined): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(d);
  return Number(h) % 24;
}
/** 次數最多的前 n 個鍵；同票時照 order 的順序 */
function topKeys<K>(count: Map<K, number>, n: number): K[] {
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

const MIN_RECENT_DAYS = 7;
/** 最近播放最早到最晚的跨度（天） */
function coverageDays(music: MusicTaste): number {
  const ts = music.recent.map((r) => new Date(r.playedAt).getTime()).filter((n) => !Number.isNaN(n));
  return ts.length ? (Math.max(...ts) - Math.min(...ts)) / 86_400_000 : 0;
}

export interface PersonaOptions {
  /** 主人所在時區（IANA，例如 Asia/Taipei）；沒給就用建置那台機器的時區 */
  timeZone?: string;
}

export function buildPersona(music: MusicTaste, opts: PersonaOptions = {}): Persona {
  const { month, half, all } = music.ranges;
  const traits: Trait[] = [];

  // 1 一整年都在循環：一年、半年、4 週的前 50 首都有的歌；沒有就講三段前 10 名都在的歌手
  // 用「同一首歌」比對：同一首歌在三段榜的 id 可能不同（單曲、專輯、Deluxe 各一個）
  const key = trackKeyFor(music);
  const inHalf = new Set(half.tracks.map(key));
  const inMonth = new Set(month.tracks.map(key));
  const seenLoop = new Set<string>();
  const loops = all.tracks.filter((t) => inHalf.has(key(t)) && inMonth.has(key(t)) && !seenLoop.has(key(t)) && seenLoop.add(key(t)));
  if (loops.length) {
    traits.push({ key: 'loop', label: '一整年都在循環', figure: `${loops.length} 首`, proof: `${songList(loops.slice(0, 3))}${loops.length > 3 ? ` 等 ${loops.length} 首` : ''}，一整年都沒停過。` });
  } else {
    const top10 = (xs: { id: string }[]) => new Set(xs.slice(0, 10).map((a) => a.id));
    const h10 = top10(half.artists);
    const m10 = top10(month.artists);
    const stay = all.artists.slice(0, 10).filter((a) => h10.has(a.id) && m10.has(a.id));
    if (stay.length) traits.push({ key: 'loyal', label: '一整年都在聽', figure: `${stay.length} 位`, proof: `${stay.slice(0, 3).map((a) => displayName(a.name)).join('、')}，一年、半年、這 4 週都在前 10 名。` });
  }

  // 2 從頭聽到尾的專輯：聽過的不同歌曲 ÷ 專輯曲目數（三段榜 ∪ 最近播放 ∪ 按讚）。
  // 只有整張都聽過才出現；沒聽滿就不講（這頁是分享品味，不報「至少聽過幾首」這種數字，業主 2026-11-09）
  const alb = fullestAlbum(music);
  if (alb?.complete) traits.push({ key: 'album', label: '從頭聽到尾的專輯', figure: `${alb.total} 首`, proof: `${displayName(alb.artist)}《${alb.name}》，${alb.total} 首我都聽過。` });

  // 3 聽歌時間：最近播放的時段（主人所在時區）
  // 最近播放只涵蓋不到 7 天時，時段只是那幾天的樣子，不代表習慣，這一格不顯示
  const hours = music.recent.map((r) => hourIn(r.playedAt, opts.timeZone)).filter((h): h is number => h !== null);
  if (hours.length && coverageDays(music) >= MIN_RECENT_DAYS) {
    const bySlot = new Map<string, number>();
    const byHour = new Map<number, number>();
    for (const h of hours) {
      bySlot.set(slot(h), (bySlot.get(slot(h)) ?? 0) + 1);
      byHour.set(h, (byHour.get(h) ?? 0) + 1);
    }
    const ORDER = ['凌晨', '早上', '中午', '下午', '晚上', '深夜'];
    const slots = topKeys(bySlot, 2).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    const peak = topKeys(byHour, 2).sort((a, b) => a - b);
    const small = hours.filter((h) => h < 6).length;
    traits.push({
      key: 'hours',
      label: '我聽歌的時間',
      figure: slots.join('・'),
      proof: `最近 ${hours.length} 首，最常在${peak.map(clock).join('和')}；${small ? `有 ${small} 首在凌晨` : '凌晨一首都沒有'}。`,
    });
  }

  // 4 輪流的歌手，或一頭栽進去（一位歌手佔一年前 10 首的 6 首以上）
  const dom = findDominance(music, 10, ['all']);
  if (dom && dom.count >= 6) {
    traits.push({ key: 'deep', label: '一頭栽進去', figure: `${dom.count} 首`, proof: `這一年常放的歌裡，${displayName(dom.artist)}就佔了 ${dom.count} 首。` });
  } else if (all.tracks.length) {
    const per = new Map<string, number>();
    for (const t of all.tracks) per.set(lead(t), (per.get(lead(t)) ?? 0) + 1);
    const [name, most] = [...per].sort((a, b) => b[1] - a[1])[0]!;
    const who = scriptOf(name) === 'latin' ? ` ${name}` : name; // 英文名前面留空格；後面接全形逗號，不留
    traits.push({ key: 'spread', label: '輪流的歌手', figure: `${per.size} 位`, proof: `這一年常放的歌來自 ${per.size} 位歌手，${who.trim()}最多。` });
  }

  // 標題：從第 1 名，到前 10 名裡第一位不同語言的歌手
  const names = all.artists.slice(0, 10).map((a) => displayName(a.name));
  const first = names[0];
  const other = names.slice(1).find((n) => scriptOf(n) !== scriptOf(first ?? '')) ?? names[1];
  // 標題講人、不講時段（時段交給「我聽歌的時間」那格，只寫「白天」會跟它對不起來）
  const who = first ? (other ? `${first} 和${scriptOf(other) === 'latin' ? ' ' : ''}${other}` : first) : '';
  return { title: who ? `${who}，我一整年都在聽` : '我一整年都在聽的歌', traits };
}
