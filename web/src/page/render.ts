import { onboardLines, type OwnerCall } from '../core/onboard.ts';
/** TasteProfile → 整頁 HTML。建置時跑一次，輸出靜態頁；之後上傳資料時在瀏覽器也能重跑。 */
import type { Artist, MusicTaste, RangeKey, TasteProfile, Track } from '../core/profile.ts';
import { DEFAULT_RANGE, RANGE_KEYS } from '../core/profile.ts';
import { buildPersona } from '../core/persona.ts';
import { albumsOf, buildStories, topTrackOf, trackRanksOf } from '../core/stories.ts';
import { trackKeyFor } from '../core/trackkey.ts';
import type { Gig } from './gigs.ts';
import { deckRanks, deckSub, displayName, EXIT, fmt, RANGE_LABEL, RANGE_LONG, rankLine, spaceMixed, splitOwner } from './copy.ts';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const img = (src: string | undefined, alt: string, w: number, h: number, extra = '') =>
  src ? `<img src="${esc(src)}" alt="${esc(alt)}" width="${w}" height="${h}" loading="lazy" decoding="async"${extra}>` : '';

const artistsOf = (t: Track): string => t.artists.map((a) => a.name).join('、');

/** 時段分段按鈕：4 週｜半年｜一年，整頁只放一組 */
function rangeSeg(): string {
  const opts = RANGE_KEYS.map(
    (k) => `<button type="button" role="radio" class="seg__opt range__opt" data-range-opt="${k}" aria-checked="${k === DEFAULT_RANGE}"${k === DEFAULT_RANGE ? '' : ' tabindex="-1"'}>${RANGE_LABEL[k]}</button>`,
  ).join('');
  return `<div class="seg range" role="radiogroup" aria-label="看哪一段時間的我">${opts}</div>`;
}

/** 窗邊榜單腳註：每個時段一句，跟著切換 */
const CHART_FOOT: Record<RangeKey, string> = {
  month: '箭頭是跟這一年的排名比。',
  half: '箭頭是跟這一年的排名比。',
  all: '這是一整年的總排名，所以沒有箭頭。',
};
const chartFoot = () =>
  `<p class="chart-foot">${RANGE_KEYS.map((k) => `<span data-range="${k}"${k === DEFAULT_RANGE ? '' : ' hidden'}>${CHART_FOOT[k]}</span>`).join('')}想聽哪首，點歌名就好。</p>`;

/** CD 牆的 HTML 版：鍵盤與螢幕閱讀器用；沒有 WebGL 時直接顯示成封面牆 */
function shelfList(music: MusicTaste): string {
  return RANGE_KEYS.map(
    (range) => `<ol class="shelf__covers" data-range="${range}"${range === DEFAULT_RANGE ? '' : ' hidden'} aria-label="${RANGE_LONG[range]}最常聽的專輯">
      ${albumsOf(music.ranges[range].tracks)
        .slice(0, 50)
        .map(
          (a) => `<li><button type="button" data-play="${esc(a.lead.id)}">${img(a.lead.album.picture?.sm, '', 300, 300)}<span>放〈${esc(a.lead.name)}〉，專輯《${esc(a.name)}》，${esc(a.by)}</span></button></li>`,
        )
        .join('')}
    </ol>`,
  ).join('');
}

function portraits(list: { item: Artist; ranks: Record<RangeKey, number | null> }[], music: MusicTaste): string {
  return list
    .map(({ item, ranks }, i) => {
      const t = topTrackOf(music, 'all', item.id);
      return `<li class="portrait ${i % 2 ? 'portrait--right' : 'portrait--left'}" data-reveal>
        <figure>
          ${img(item.picture?.lg, item.name, 640, 800)}
          <figcaption>
            <span class="portrait__name">${esc(item.name)}</span>
            <span class="portrait__ranks">${rankLine(ranks)}</span>
            ${t ? `<span class="portrait__line">這一年最常聽〈${esc(t.name)}〉。</span>` : ''}
          </figcaption>
        </figure>
      </li>`;
    })
    .join('');
}

const TZ: Record<string, string> = { TW: 'Asia/Taipei', HK: 'Asia/Hong_Kong', JP: 'Asia/Tokyo', KR: 'Asia/Seoul', SG: 'Asia/Singapore', CN: 'Asia/Shanghai', GB: 'Europe/London', DE: 'Europe/Berlin', FR: 'Europe/Paris', AU: 'Australia/Sydney' };

/** 更新日期：用主人那邊的日期（CI 跑在 UTC，不給時區的話台灣早上 8 點前部署會少一天）；認不得的國家用建置機器的時區 */
export function formatUpdated(iso: string, country?: string): string {
  return new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', timeZone: TZ[country ?? ''] });
}

/** 頁面上的人設（標題與四格）。分享圖要用同一句標題，所以抽出來共用；聽歌時間要用主人那邊的時間算，認不得的國家就用建置機器的時區 */
export function personaOf(profile: TasteProfile) {
  if (!profile.music) throw new Error('這份 profile 沒有音樂資料');
  return buildPersona(profile.music, { timeZone: TZ[profile.owner.country ?? ''] });
}

/** screeningReady：web/screening/index.html 存在。不存在時主按鈕不換頁，門只開一點就關上 */
export function renderPage(profile: TasteProfile, opts: { screeningReady?: boolean; owner?: OwnerCall; gigs?: readonly Gig[] } = {}): string {
  const ready = opts.screeningReady ?? true;
  const gigs = opts.gigs ?? [];
  const music = profile.music;
  if (!music) throw new Error('這份 profile 沒有音樂資料');
  const s = buildStories(music);
  const persona = personaOf(profile);
  // 只接受 Spotify 個人頁網址：之後開放上傳資料時，這個欄位就不再是自己的
  const ownerUrl = /^https:\/\/open\.spotify\.com\//.test(profile.owner.url ?? '') ? profile.owner.url! : 'https://open.spotify.com';
  const updated = formatUpdated(profile.generatedAt, profile.owner.country);
  const dom = s.dominance;
  const sig = s.signature;
  const sigTrack = sig?.item;
  const opener = music.ranges[DEFAULT_RANGE].tracks[0];
  const topAlbums = albumsOf(music.ranges.all.tracks).slice(0, 4);
  const domTrack = dom ? music.ranges[dom.range].tracks.find((t) => t.artists.some((a) => a.id === dom.artistId)) : undefined;
  // 鏡頭推近 CD 牆時亮的是這位歌手的專輯（room.ts 依 artistIds 調暗其他張），數一樣的東西才對得上
  const domLit = dom ? albumsOf(music.ranges[dom.range].tracks).filter((al) => al.lead.artists.some((a) => a.id === dom.artistId)).length : 0;

  /* ---- 排行榜：前 3 名大照片、4–10 名縮圖、11–20 名只有字（C 的層次，B 的紙） ---- */
  const allRank = new Map(music.ranges.all.artists.map((a, i) => [a.id, i + 1]));
  const move = (range: RangeKey, id: string, now: number) => {
    if (range === 'all') return '';
    const was = allRank.get(id);
    if (was === undefined) return '<span class="cmp cmp--new">新進榜</span>';
    if (was === now) return '<span class="cmp">持平</span>';
    return was > now ? `<span class="cmp cmp--up">▲ ${was - now}</span>` : `<span class="cmp">▼ ${now - was}</span>`;
  };
  const sheets = RANGE_KEYS.map((range) => {
    const list = music.ranges[range].artists.slice(0, 20);
    const song = (a: Artist) => {
      const t = topTrackOf(music, range, a.id);
      return t
        ? `<button type="button" class="song" data-play="${esc(t.id)}">${esc(t.name)}</button>`
        : '<span class="song song--none">沒有單曲進前 50</span>';
    };
    const podium = list
      .slice(0, 3)
      .map(
        (a, i) => `<li class="pod">
          ${img(a.picture?.lg, a.name, 640, 640, ' class="pod__img"')}
          <span class="pod__rk">${i + 1}</span>
          <span class="pod__nm">${esc(a.name)}</span>${song(a)}${move(range, a.id, i + 1)}
        </li>`,
      )
      .join('');
    const mid = list
      .slice(3, 10)
      .map(
        (a, i) => `<li class="row"><span class="rk">${i + 4}</span>${img(a.picture?.sm, '', 300, 300, ' class="th"')}
          <span class="who"><span class="nm">${esc(a.name)}</span>${song(a)}</span>${move(range, a.id, i + 4)}</li>`,
      )
      .join('');
    const tail = list
      .slice(10)
      .map((a, i) => `<li class="row row--text"><span class="rk">${i + 11}</span><span class="nm">${esc(a.name)}</span>${move(range, a.id, i + 11)}</li>`)
      .join('');
    return `<div class="sheet" data-range="${range}"${range === DEFAULT_RANGE ? '' : ' hidden'}>
      <ol class="podium" aria-label="${RANGE_LONG[range]}第 1 到 3 名">${podium}</ol>
      <ol class="sheet-list" start="4" aria-label="第 4 到 10 名">${mid}</ol>
      <ol class="sheet-tail" start="11" aria-label="第 11 到 20 名">${tail}</ol>
    </div>`;
  }).join('');

  /* ---- 串燈上的拍立得（B） ---- */
  const rankstrip = (r: Record<RangeKey, number | null>) =>
    `<span class="rstrip">${(['month', 'half', 'all'] as RangeKey[])
      .map((k) => `<span class="rs${r[k] ? '' : ' rs--none'}"><i>${({ month: '4 週', half: '半年', all: '一年' } as const)[k]}</i><b>${r[k] ? `#${r[k]}` : '未上榜'}</b></span>`)
      .join('')}</span>`;
  const sag = (i: number, n: number, depth: number) => Math.round(depth * 4 * ((i + 0.5) / n) * (1 - (i + 0.5) / n));
  const rot = [-3, 2, -1.5, 3, -2.5, 1.5, -2, 2.5];
  const loyal = s.loyal
    .map((r, i) => {
      const t = topTrackOf(music, 'all', r.item.id);
      return `<figure class="pol" style="--y:${sag(i, s.loyal.length, 30)};--r:${rot[i % 8]}deg" data-reveal>
        <span class="pin" aria-hidden="true"></span>
        <div class="ph">${img(r.item.picture?.lg, r.item.name, 640, 640)}</div>
        <figcaption><span class="pn">${esc(r.item.name)}</span>${rankstrip(r.ranks)}${t ? `<span class="ps">最常放〈${esc(t.name)}〉</span>` : ''}</figcaption>
      </figure>`;
    })
    .join('');
  const newcomers = s.newcomers
    .map(
      (r, i) => `<figure class="pol pol--new" style="--y:${sag(i, s.newcomers.length, 22)};--r:${[2.5, -2, 1.5][i] ?? 0}deg" data-reveal>
        <span class="pin" aria-hidden="true"></span>
        <div class="ph">${img(r.item.picture?.lg, r.item.name, 640, 640)}</div>
        <figcaption><span class="pn">${esc(r.item.name)}</span>${rankstrip(r.ranks)}</figcaption>
      </figure>`,
    )
    .join('');
  const wire = (n: number, depth: number) => {
    const bulbs = Array.from({ length: 22 }, (_, k) => {
      const t = (k + 1) / 23;
      return `<circle cx="${(1000 * t).toFixed(1)}" cy="${(8 + depth * 2 * 4 * t * (1 - t) / 2 + 5).toFixed(1)}" r="4"/>`;
    }).join('');
    void n;
    return `<svg class="wire" viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden="true"><path d="M0 8 Q500 ${8 + depth * 2} 1000 8"/><g class="bulbs">${bulbs}</g></svg>`;
  };

  return spaceMixed(`
<a class="skip" href="#shelf">跳到 CD 牆</a>
<header class="bar">
  <a class="bar__home" href="${sigTrack ? '#deck' : '#top'}">聽歌的地方</a>
  <nav class="where" aria-label="房間裡的位置">
    <ol>
      <li><a href="#deck" data-where="deck0">唱盤</a></li>
      <li><a href="#top" data-where="door">門口</a></li>
      <li><a href="#taste" data-where="brick">海報牆</a></li>
      <li><a href="#shelf" data-where="wall">CD 牆</a></li>
      <li><a href="#chart" data-where="window">窗邊榜單</a></li>
      <li><a href="#lights" data-where="lights">串燈</a></li>
      ${gigs.length ? '<li><a href="#gigs" data-where="gigs">收藏牆</a></li>' : ''}
      <li><a href="#next" data-where="cinema">出口</a></li>
    </ol>
  </nav>
  <div class="seg moods" role="radiogroup" aria-label="房間的時段">
    <button type="button" role="radio" class="seg__opt moods__opt" data-mood="afternoon" aria-checked="false" aria-label="午後放空">午後<span class="moods__tail">放空</span></button>
    <button type="button" role="radio" class="seg__opt moods__opt" data-mood="tipsy" aria-checked="true">微醺</button>
    <button type="button" role="radio" class="seg__opt moods__opt" data-mood="night" aria-checked="false" aria-label="深夜靜靜">深夜<span class="moods__tail">靜靜</span></button>
  </div>
</header>

<div class="stage" aria-hidden="true"><canvas id="room"></canvas></div>

<main>
  <h1 class="sr-only">${esc(profile.owner.name)} 家・聽歌的地方</h1>
  <!-- 唱盤在最前面：開場選的那張落盤開始放，就停在這一格；往下捲才退一步看整個房間（門口） -->
  ${
    sigTrack
      ? `<section id="deck" class="deck">
    <div class="deck__stage">
      <h2 class="deck__head"><span class="deck__top" data-now-head>${esc(sigTrack.name)}</span><span class="deck__bottom" data-now-sub>${esc(deckSub(false))}</span></h2>
      <div class="amp">
        <div class="amp-face">
          ${img(sigTrack.album.picture?.lg, `${sigTrack.album.name} 專輯封面`, 640, 640, ' class="amp-cover" data-now-cover')}
          <div class="amp-info deck__now" aria-live="polite">
            <p class="amp-state"><span class="led" aria-hidden="true"></span>唱盤上</p>
            <p class="sr-only" data-now-title>${esc(sigTrack.name)}</p>
            <p class="amp-sub"><span data-now-by>${esc(artistsOf(sigTrack))}</span><span data-now-year>${sigTrack.album.year ? `，${sigTrack.album.year} 年` : ''}</span></p>
            <p class="amp-ranks" data-now-ranks>${deckRanks(sig!.ranks)}</p>
          </div>
          <div class="amp-ctrl deck__actions">
            <button type="button" class="btn btn--bulb" data-listen="${esc(sigTrack.id)}">放這首</button>
            <button type="button" class="btn btn--amp deck__lyrics-btn" data-lyrics-toggle aria-pressed="false" aria-controls="lyrics">歌詞</button>
          </div>
        </div>
        <div class="lyrics" id="lyrics" hidden><p class="lyrics__status" data-lyrics-status></p><ol class="lyrics__lines" data-lyrics-lines></ol></div>
      </div>
    </div>
    <p class="scroll-cue">往下捲，退一步看整個房間</p>
    <div class="deck__steps" aria-hidden="true"><i data-cam="deck0"></i></div>
  </section>`
      : ''
  }

  <section id="top" class="scene scene--door moment" data-cam="door">
    <div class="door-copy">
      <p class="door-meta">這一年常聽的歌手有 ${fmt(s.distinctArtists)} 位，按過讚的歌有 ${fmt(music.totals.saved ?? 0)} 首，我帶你看幾樣。</p>
      <div class="door-actions">
        <a class="btn btn--bulb" href="#shelf">看我的唱片牆</a>
        ${opener ? `<button type="button" class="btn btn--amp" data-listen="${esc(opener.id)}">先放〈${esc(opener.name)}〉給你聽</button>` : ''}
      </div>
    </div>
    <p class="scroll-cue" data-scroll-cue>往下捲，我帶你逛一圈</p>
    ${opener ? `<p class="opening-cap" aria-hidden="true"><span class="opening-cap__state"><span class="cap-choose">喜歡光停的這張，就點一下</span><span class="cap-pick">你挑了這張</span><span class="cap-wait">點任何地方，開播</span><span class="cap-retry">沒聲音？再點一下，或按右下角的 ▶</span><span class="cap-fail">播放器今天沒開起來，右下角可以直接到 Spotify 聽</span><span class="cap-cue">唱針放下了…</span><span class="cap-on">正在放</span></span><span class="opening-cap__song">${esc(opener.name)}</span><span class="opening-cap__by">${esc(artistsOf(opener))}</span></p>` : ''}
    <button type="button" class="opening-skip">直接進房間</button>
    ${opener && opts.owner ? `<div class="onboard" data-onboard hidden>
      <button type="button" class="onboard__skip" data-onboard-skip>略過</button>
      <div class="onboard__box" role="dialog" aria-label="${esc(opts.owner.name)} 的開場">
        <p class="onboard__name">${esc(opts.owner.name)}</p>
        <p class="onboard__line" data-onboard-line aria-live="polite"></p>
        <span class="onboard__next" aria-hidden="true">▼</span>
      </div>
      <ol class="onboard__lines" hidden>${onboardLines(opts.owner, s.distinctArtists, ready).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
    </div>` : ''}
  </section>

  <section id="taste" class="scene scene--brick moment" data-cam="brick">
    <div class="cdbox" aria-label="這一年常放的歌所在的 4 張專輯">
      ${topAlbums.map((a) => img(a.lead.album.picture?.sm, a.name, 300, 300)).join('')}
      <p class="cdbox__cap">這一年常放的歌，都在這 4 張裡</p>
    </div>
    <article class="poster">
      <span class="tape tape--l" aria-hidden="true"></span><span class="tape tape--r" aria-hidden="true"></span>
      <p class="poster-small">我的聽歌習慣</p>
      <h2 class="poster-title">${esc(persona.title)}</h2>
      <div class="traits">${persona.traits
        .map((t) => `<div class="trait"><p class="fig">${esc(t.figure)}</p><h3 class="lbl">${esc(t.label)}</h3><p class="proof">${esc(t.proof)}</p></div>`)
        .join('')}</div>
      <p class="poster-foot"><span>從 Spotify 排行算出來</span><span>${esc(updated)}</span></p>
    </article>
  </section>

  ${
    dom
      ? `<section id="month" class="scene scene--month moment" data-cam="wall-close" data-focus-artist="${esc(dom.artistId)}">
    <div class="month-copy">
      <h2 class="month-title">${RANGE_LONG[dom.range]}最常聽的 ${dom.of} 首，<br>${dom.count} 首是${esc(displayName(dom.artist))}。</h2>
      ${domTrack ? `<p class="month-note">${domLit ? `牆上亮著的 ${domLit} 張都有他們，` : ''}排最前面的是〈${esc(domTrack.name)}〉。</p>` : ''}
    </div>
    <p class="month-big" aria-hidden="true"><span data-roll>${dom.count}</span><span class="month-of">/${dom.of}</span></p>
  </section>`
      : ''
  }

  <section id="shelf" class="shelf">
    <i class="shelf__cam shelf__cam--in" data-cam="wall" aria-hidden="true"></i>
    <div class="shelf__moment scene moment">
      <div class="shelf__top"><h2 class="shelf__head">我的 CD 牆</h2>${rangeSeg()}</div>
      <p class="shelf__say">這面牆是我<span data-range-label aria-live="polite">${RANGE_LONG[DEFAULT_RANGE]}</span>最常聽的專輯。看到喜歡的就點，我幫你放上唱盤。</p>
      <div class="shelf__now" data-scrub-now aria-hidden="true">
        <p class="shelf__count"><span data-scrub-i>1</span> / <span data-scrub-n>1</span></p>
        <p class="shelf__song" data-scrub-name></p>
        <p class="shelf__by" data-scrub-by></p>
        <div class="shelf__ctrl">
          <button type="button" class="btn btn--amp btn--sm shelf__step" data-shelf-step="-1" tabindex="-1">‹ 上一張</button>
          <button type="button" class="btn btn--bulb btn--sm shelf__pick" data-play="" tabindex="-1">放上唱盤</button>
          <button type="button" class="btn btn--amp btn--sm shelf__step" data-shelf-step="1" tabindex="-1">下一張 ›</button>
        </div>
      </div>
      ${shelfList(music)}
    </div>
    <i class="shelf__cam shelf__cam--out" data-cam="wall" aria-hidden="true"></i>
  </section>



  <section id="chart" class="scene scene--window moment" data-cam="window">
    <div class="chart">
      <div class="chart-head">
        <h2 class="chart-title"><span data-range-label>${RANGE_LONG[DEFAULT_RANGE]}</span>最常聽的 20 位</h2>
      </div>
      ${sheets}
      ${chartFoot()}
    </div>
  </section>

  <section id="lights" class="scene scene--lights moment" data-cam="lights">
    <div class="line-block">
      <div class="line-copy"><h2 class="line-title">一直都在的 ${s.loyal.length} 位</h2><p class="line-note">不管什麼時候打開，他們都在我常聽的名單裡，是我一直聽不膩的人。</p></div>
      <div class="line">${wire(s.loyal.length, 30)}<div class="pols">${loyal}</div></div>
    </div>
    ${
      s.newcomers.length
        ? `<div class="line-block line-block--new">
      <div class="line-copy"><h2 class="line-title">最近常聽的 ${s.newcomers.length} 位</h2><p class="line-note">這陣子常放他們的歌。</p></div>
      <div class="line line--new">${wire(s.newcomers.length, 22)}<div class="pols">${newcomers}</div></div>
    </div>`
        : ''
    }
  </section>

  ${gigsSection(gigs)}

  <aside class="dock" aria-label="正在播放"><div class="dock__player" data-player></div></aside>


  <section id="next" class="scene scene--exit moment" data-cam="cinema">
    <div class="exit-copy">
      <h2 class="exit-title">隔壁是<br>我看劇的地方。</h2>
      <p class="exit-lead">${EXIT.lead[ready ? 'ready' : 'pending']}</p>
      <div class="exit-actions">
        <a class="btn btn--bulb" href="${ready ? 'screening/' : '#next'}" data-enter="screening/" data-note="${esc(EXIT.pending)}">${EXIT.enter}</a>
        <a class="btn btn--amp" href="${esc(ownerUrl)}" rel="noopener">${EXIT.spotify}</a>
      </div>
      <p class="exit-note" role="status" aria-live="polite" data-enter-note></p>
    </div>
  </section>
</main>

<footer class="postcard">
  <i class="postcard__cam" data-cam="cinema-end" aria-hidden="true"></i>
  <p class="postcard__note">謝謝你來。牆上的歌會跟著我的排行換，下次再來坐，說不定又不一樣了。</p>
  <nav class="postcard__links" aria-label="頁尾">
    <a href="${ready ? 'screening/' : '#next'}" data-enter="screening/" data-note="${esc(EXIT.pending)}">${EXIT.footer}</a>
    <a href="#shelf">CD 牆</a>
    <a href="#deck">唱盤</a>
    <a href="#top">回到門口</a>
    <a href="${esc(ownerUrl)}" rel="noopener">Spotify</a>
  </nav>
  <div class="postcard__share">
    <button type="button" class="btn btn--sm" data-share hidden>分享聽歌的地方</button>
    <p class="postcard__sharenote" data-share-note role="status"></p>
  </div>
  <p class="postcard__fine">資料來自 Spotify Web API，${esc(updated)}更新。專輯封面與歌手照片的版權屬於各權利人，只用來展示我的聽歌紀錄。房間用 Blender 製作，模型與材質來自 Poly Haven（CC0）。</p>
</footer>
<div class="enter-veil" aria-hidden="true"></div>`);
}

/**
 * 右牆的收藏牆那一段。沒有清單就整段不出現（換人資料也成立）；文案只用清單算得出的數字。
 * 名字清單只給閱讀器（sr-only），畫面上名字只印在牆上框內卡紙的下緣一次。
 * 手機另有推近左、中、右三段的捲動錨點（gigs-t1／t2／t3，桌機隱藏；放在段落外面、緊接在後，錨點順序才是 總覽 → 左 → 中 → 右，
 * 放在段落裡面的話段落自己的中心點會夾在兩個錨點中間，順序就亂了）：整面牆在小螢幕上名字太小，左中右各推近一段才讀得到。
 */
function gigsSection(gigs: readonly Gig[]): string {
  if (!gigs.length) return '';
  const names = gigs.map((g) => `<li>${esc(g.name)}</li>`).join('');
  const steps = [1, 2, 3].map((i) => `<i class="gigs__step" data-cam="gigs-t${i}" aria-hidden="true"></i>`).join('');
  return `<section id="gigs" class="scene scene--gigs moment" data-cam="gigs" aria-labelledby="gigs-title">
    <div class="gigs-copy">
      <p class="gigs-kicker">收藏牆</p>
      <h2 class="line-title" id="gigs-title">我最喜歡的 ${gigs.length} 組表演人</h2>
      <ul class="sr-only">${names}</ul>
    </div>
  </section>
  ${steps}`;
}

/** 給 3D 房間用的精簡資料（只帶需要的欄位，嵌進頁面） */
/** chorus：曲目 id → 副歌開始的毫秒（建置時由 data:chorus 算好；null = 判斷不出來） */
export function roomData(profile: TasteProfile, chorus: Readonly<Record<string, number | null>> = {}, screeningReady = false, openerArtists: readonly string[] = [], gigs: readonly Gig[] = []) {
  const music = profile.music!;
  const s = buildStories(music);
  const pack = (t: Track) => ({
    id: t.id,
    name: t.name,
    by: artistsOf(t),
    artist: t.artists[0]?.name ?? '',
    durationMs: t.durationMs,
    artistIds: t.artists.map((a) => a.id),
    year: t.album.year ?? null,
    album: t.album.name,
    sm: t.album.picture?.sm ?? null,
    lg: t.album.picture?.lg ?? null,
    chorusMs: chorus[t.id] ?? null,
  });
  const tracks = new Map<string, ReturnType<typeof pack>>();
  const allById = new Map<string, Track>();
  const ranges = Object.fromEntries(
    RANGE_KEYS.map((k) => {
      for (const t of music.ranges[k].tracks) {
        tracks.set(t.id, pack(t));
        allById.set(t.id, t);
      }
      return [k, albumsOf(music.ranges[k].tracks).map((al) => al.lead.id)];
    }),
  ) as Record<RangeKey, string[]>;
  // 名次用「同一首歌」比對，同一首歌的不同 id 拿到一樣的名次
  const key = trackKeyFor(music);
  const keyRanks = new Map<string, Record<RangeKey, number | null>>();
  const ranks = Object.fromEntries(
    [...tracks.keys()].map((id) => {
      const k = key(allById.get(id)!);
      if (!keyRanks.has(k)) keyRanks.set(k, trackRanksOf(music, allById.get(id)!));
      return [id, keyRanks.get(k)!];
    }),
  );
  return {
    tracks: Object.fromEntries(tracks),
    ranges,
    ranks,
    signature: s.signature?.item.id ?? null,
    loyal: s.loyal.map((r) => ({ name: r.item.name, lg: r.item.picture?.lg ?? null })),
    newcomers: s.newcomers.map((r) => ({ name: r.item.name, lg: r.item.picture?.lg ?? null })),
    dominantArtist: s.dominance?.artistId ?? null,
    screeningReady,
    openerArtists: [...openerArtists],
    gigs: gigs.map((g) => ({ name: g.name, img: g.img, rankNo: g.rankNo })),
  };
}
export type RoomData = ReturnType<typeof roomData>;
