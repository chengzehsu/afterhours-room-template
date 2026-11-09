import type { OwnerCall } from '../core/onboard.ts';
/** 把 profile 填進 index.html 樣板。建置時由 vite.config.ts 呼叫，抽出來是為了能測。 */
import type { TasteProfile } from '../core/profile.ts';
import type { Gig } from './gigs.ts';
import { esc, renderPage, roomData } from './render.ts';

export interface TemplateExtras {
  chorus?: Readonly<Record<string, number | null>>;
  openerArtists?: readonly string[];
  screeningReady?: boolean;
  /** 開場對話用的名字（src/data/owner.json） */
  owner?: OwnerCall;
  /** 右牆的最愛演唱會（src/page/gigs.ts 的 gigsOf 算出來的） */
  gigs?: readonly Gig[];
}

/**
 * 佔位符一律用函式替換：替換值是字串時，裡面的 $&、$`、$'、$$ 會被 String.replace 展開，
 * 歌名或歌手名帶這些字就會複製樣板片段、弄壞 room-data。
 */
export function buildIndexHtml(html: string, profile: TasteProfile, extras: TemplateExtras = {}): string {
  const { chorus = {}, openerArtists = [], screeningReady = false, owner, gigs = [] } = extras;
  const first = profile.owner.name.split(/\s+/)[0];
  const json = JSON.stringify(roomData(profile, chorus, screeningReady, openerArtists, gigs)).replace(/</g, '\\u003c');
  const title = esc('聽歌的地方'); // 分頁標籤不放名字：開場對話已經介紹過主人（業主 2026-11-09）
  const description = esc(`${profile.owner.name} 在 Spotify 最常聽的歌手與歌曲，放進我家聽歌的地方，可以走進來逛。`);
  const page = renderPage(profile, { screeningReady, owner, gigs });
  const roomScript = `<script type="application/json" id="room-data">${json}</script>`;
  return html
    .replace('<!--title-->', () => title)
    .replace('<!--description-->', () => description)
    .replace('<!--page-->', () => page)
    .replace('<!--room-data-->', () => roomScript);
}
