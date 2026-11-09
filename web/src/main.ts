import './styles.css';
import { initShare } from './share/client.ts';
import { DEFAULT_RANGE, RANGE_KEYS, type RangeKey } from './core/profile.ts';
import { type Mood, moodByClock, pickMood, type SavedMood } from './core/mood.ts';
import { endWatcher, nextShuffle } from './core/shuffle.ts';
import { rouletteCandidates, onlyWithChorus, pickArtistOpener, pickOpener, readLast, readLastArtist, writeLast, writeLastArtist } from './core/opener.ts';
import { entryRoute, forcedOpener, RETURN_MS, withoutReturnParam } from './core/opening.ts';
import { type CueLine, LyricPulse } from './live/cues.ts';
import { deckRanks, deckSub, quoteTitle, RANGE_LONG } from './page/copy.ts';
import { enterPlan, FULL_TRACK_MS, isPreview, SPOTIFY_LOAD_MS, spotifyFault, spotifyTrackUrl, stepIndex, withTimeout } from './core/flow.ts';
import type { RoomData } from './page/render.ts';
import { hoverPick, type HoverMemo } from './room/shelf-hover.ts';

document.documentElement.classList.add('js');
// 走到這裡時 import 的 styles.css 已經套上：拿掉 index.html 防白頁的深色蓋板
document.documentElement.classList.add('css-ready');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const data = JSON.parse(document.getElementById('room-data')!.textContent!) as RoomData;
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

/* ---------- 從放映室回來（?from=screening）：不播開場，直接停在出口段；暗場先蓋住，等房間畫好再淡入 ---------- */
const route = entryRoute(location.search, reduced);
if (route === 'return') document.documentElement.classList.add('is-returning');
// 路線已經記下來，網址馬上拿掉 from=screening：重新整理就是一般進場，但仍停在出口
if (route !== 'opening') history.replaceState(history.state, '', location.pathname + withoutReturnParam(location.search) + '#next');

/* ---------- 這次進來放哪張：不跟上次一樣，同步換好門口字幕與按鈕，首次繪製前就是新歌名 ---------- */
const openerId = (() => {
  if (route !== 'opening') return null; // 回到出口：不挑歌、不寫「上次放的」
  let store: Storage | undefined;
  try {
    store = localStorage;
  } catch {}
  // 開場落針放的是副歌，所以只在有副歌資料的曲目裡挑
  const lastId = readLast(store);
  // 先照指定歌手名單挑；名單空或挑不出歌時退回：本月專輯裡優先挑有副歌的
  // 只從開場時 CD 牆上（這 4 週）的那幾張挑：牆上沒有的歌被選中放出來會很奇怪
  const onWall = Object.fromEntries(data.ranges[DEFAULT_RANGE].flatMap((id) => (data.tracks[id] ? [[id, data.tracks[id]!]] : [])));
  const byList = pickArtistOpener(onWall, data.openerArtists, { id: lastId, artist: readLastArtist(store) }, Math.random);
  const forced = import.meta.env.DEV ? forcedOpener(location.search, data.tracks) : null;
  const id = forced ?? byList?.id ?? pickOpener(onlyWithChorus(data.ranges[DEFAULT_RANGE], (tid) => !!data.tracks[tid]?.chorusMs), lastId, Math.random);
  if (!id) return null;
  if (byList && !forced) writeLastArtist(store, byList.artist);
  setOpener(id);
  return id;
})();
/** 開場這首定了：存起來（下次不重複）、換好字幕與門口按鈕。轉盤選定時再呼叫一次換成訪客挑的那張 */
function setOpener(id: string): void {
  try {
    writeLast(localStorage, id);
  } catch {}
  const t = data.tracks[id];
  if (!t) return;
  showCaption(id);
  const door = $<HTMLButtonElement>('#top [data-listen]');
  if (door) {
    door.dataset.listen = id;
    door.textContent = door.dataset.label = `先放〈${t.name}〉給你聽`; // 按之前就知道會放哪首
  }
  document.documentElement.dataset.opener = id;
}
/** 開場字幕：歌名，下一行「歌手・《專輯》」 */
function showCaption(id: string): void {
  const t = data.tracks[id] as ((typeof data.tracks)[string] & { album?: string }) | undefined;
  if (!t) return;
  const song = $('.opening-cap__song');
  const by = $('.opening-cap__by');
  if (song) song.textContent = t.name;
  if (by) by.textContent = t.album ? `${t.by}・《${t.album}》` : t.by;
}
/** 開發用 ?opener=<id>：跳過轉盤直接放這首（.aside 診斷腳本重現固定情境） */
const forcedOpenerId = import.meta.env.DEV ? forcedOpener(location.search, data.tracks) : null;

type RoomApi = import('./room/room.ts').Room;
let room: RoomApi | null = null;
let current: RangeKey = DEFAULT_RANGE;
let nowPlaying = data.signature;

/* ---------- 開場對話：RPG 對話框，打字、點一下下一句；看過就不再出現 ---------- */
const ONBOARD_KEY = 'taste-room:onboarded';
function runOnboarding(): Promise<void> {
  const box = $('[data-onboard]');
  const lineEl = $('[data-onboard-line]');
  const lines = $$('.onboard__lines li').map((l) => l.textContent ?? '');
  let seen = false;
  try {
    seen = localStorage.getItem(ONBOARD_KEY) === '1';
  } catch {}
  if (!box || !lineEl || !lines.length || seen || forcedOpenerId) return Promise.resolve();
  const html = document.documentElement;
  return new Promise((resolve) => {
    box.hidden = false;
    html.classList.add('onboarding');
    let i = 0;
    let shown = 0;
    let timer = 0;
    const panel = box.querySelector('.onboard__box') ?? box;
    const show = (t: string, n: number) => {
      lineEl.textContent = t.slice(0, n);
      panel.classList.toggle('is-typing', n < t.length); // 打字中藏 ▼
    };
    const typeLine = () => {
      const t = lines[i]!;
      clearInterval(timer);
      shown = reduced ? t.length : 0;
      show(t, shown);
      if (shown < t.length)
        timer = window.setInterval(() => {
          shown++;
          show(t, shown);
          if (shown >= t.length) clearInterval(timer);
        }, 38);
    };
    const finish = () => {
      clearInterval(timer);
      box.hidden = true;
      html.classList.remove('onboarding');
      try {
        localStorage.setItem(ONBOARD_KEY, '1');
      } catch {}
      removeEventListener('keydown', onKey);
      resolve();
    };
    // 打字中點一下：整句顯示；整句顯示後點一下：下一句；最後一句之後：開始挑 CD
    const next = () => {
      const t = lines[i]!;
      if (shown < t.length) {
        clearInterval(timer);
        shown = t.length;
        show(t, shown);
        return;
      }
      i++;
      if (i >= lines.length) finish();
      else typeLine();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      } else if (e.key === 'Escape') finish();
    };
    box.addEventListener('click', (e) => {
      if ((e.target as Element).closest('[data-onboard-skip]')) finish();
      else next();
    });
    addEventListener('keydown', onKey);
    typeLine();
  });
}

/* ---------- 一直放下去：放完一首，從 CD 牆隨機挑下一張放上唱盤 ---------- */
const recentPlayed: string[] = [];
const ended = endWatcher();
function playNextShuffle(): void {
  const cur = loadedUri.replace('spotify:track:', '');
  if (cur) recentPlayed.push(cur);
  const next = nextShuffle(data.ranges[DEFAULT_RANGE], recentPlayed);
  if (!next || !data.tracks[next]) return;
  showOnDeck(next);
  room?.takeAndPlay(next); // 自動續播也從牆上拿下、飛到唱盤
  void listenTo(next);
}

/* ---------- 換唱片：更新唱盤旁的資訊與播放器 ---------- */
function showOnDeck(id: string, picked = false): void {
  const t = data.tracks[id];
  if (!t) return;
  nowPlaying = id;
  $('[data-now-title]')!.textContent = t.name;
  const head = $('[data-now-head]');
  const sub = $('[data-now-sub]');
  if (head) head.textContent = t.name;
  if (sub) sub.textContent = deckSub(picked);
  $('[data-now-by]')!.textContent = t.by;
  $('[data-now-year]')!.textContent = t.year ? `，${t.year} 年` : '';
  $('[data-now-ranks]')!.textContent = deckRanks(data.ranks[id] as Record<RangeKey, number | null>);
  const cover = $<HTMLImageElement>('[data-now-cover]');
  if (cover && t.lg) {
    cover.src = t.lg;
    cover.alt = `${t.name} 專輯封面`;
  }
  // 只改唱盤上那顆；門口的按鈕固定放開場那首（$() 只會抓到頁面上第一個 data-listen，那是門口的）
  const listen = $<HTMLButtonElement>('#deck [data-listen]');
  if (listen) listen.dataset.listen = id;
  syncListenButtons();
  loadTrack(id);
  if (lyricsOn) void loadLyrics(id);
}


/**
 * 挑一張放上唱盤並開始放。不捲動：唱盤在頁面最上面，從 CD 牆或榜單挑歌時跳回頂端，
 * 要再捲過門口、海報牆才回得來；留在原地，音樂直接換，右下角播放列與「放上唱盤」鈕會跟著變。
 */
function pick(id: string): void {
  showOnDeck(id, true);
  const introRunning = document.documentElement.classList.contains('intro-running');
  // 所有入口都走「CD 從牆上拿下 → 飛到唱盤」；開場期間照舊（開場自己會飛）
  if (introRunning) room?.play(id);
  else room?.takeAndPlay(id);
  // 點一下就是這首：開場期間不插手（開場的那一下互動自己會放）
  if (!introRunning) {
    void listenTo(id);
    void wait(5000).then(() => {
      if (!playback.playing && !document.documentElement.classList.contains('player-failed')) document.documentElement.classList.add('nudge-dock');
    });
  }
}

/* ---------- 放映室的門：點按鈕或點 3D 門 → 門打開、鏡頭推近、淡暗、換頁 ---------- */
// 音樂維持播放：Spotify 嵌入播放器沒有音量可控，硬停會是突然斷掉；換頁時播放器本來就跟著頁面結束，
// 畫面暗下去的同時歌自然收掉，不另外做淡出。
const ENTER_MS = { open: 900, dive: 1150, go: 1300 };
let entering = false;
function enterScreening(href: string, note: string): void {
  if (entering) return;
  entering = true;
  const html = document.documentElement;
  const ready = data.screeningReady;
  const r = room;
  const plan = enterPlan({ ready, reduced, hasRoom: !!r, roomBroken: html.classList.contains('no-room') });
  if (plan === 'direct') {
    location.href = href;
    return;
  }
  if (plan === 'animate' && r) {
    html.classList.add('is-entering');
    setTimeout(() => (location.href = href), ENTER_MS.go); // 門動畫丟錯也一定換頁
    try {
      r.setDoor(1, ENTER_MS.open);
      r.dive(ENTER_MS.dive);
    } catch {
      location.href = href;
    }
    return;
  }
  // 放映室還沒開門：門推開一點，講一句話，再關上，不換頁
  const line = $('[data-enter-note]');
  if (line) line.textContent = note;
  html.classList.add('is-knocking');
  r?.setDoor(0.22, 650);
  setTimeout(() => r?.setDoor(0, 800), 2600);
  setTimeout(() => {
    if (line) line.textContent = '';
    html.classList.remove('is-knocking');
    entering = false;
  }, 3700);
}
// 按上一頁回來時（bfcache）把門、鏡頭、遮罩都復原
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  entering = false;
  document.documentElement.classList.remove('is-entering', 'is-knocking');
  room?.endDive();
  room?.setDoor(0, 0);
});

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const enter = target.closest<HTMLElement>('[data-enter]');
  if (enter) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // 另開分頁照瀏覽器預設
    e.preventDefault();
    enterScreening(enter.dataset.enter!, enter.dataset.note ?? '');
    return;
  }
  const play = target.closest<HTMLElement>('[data-play]');
  if (play) {
    pick(play.dataset.play!);
    return;
  }
  const listen = target.closest<HTMLButtonElement>('[data-listen]');
  if (listen) {
    const id = listen.dataset.listen!;
    // 門口、唱盤段的播放鈕：唱盤上不是這首就也走拿下飛入；已在唱盤上（或正在飛）就只管播放。開場期間照舊
    if (!document.documentElement.classList.contains('intro-running') && data.tracks[id]) {
      if (nowPlaying !== id) showOnDeck(id);
      room?.takeAndPlay(id);
    }
    void listenTo(id);
    return;
  }
  // 點到 3D 房間裡的 CD。開場期間不算：選片那一下由開場的手勢處理（光照著的那張也算「指著」，
  // 不擋的話同一下會再 pick 一次：頁面跳到唱盤、歌放兩次，選完回不到門口）
  if (room && isRoomSurface(target) && !document.documentElement.classList.contains('intro-running')) {
    // 用點下去那一點算打到哪張（觸控沒有 hover）。手機點一張先選起來看字幕，再點同一張或按「放上唱盤」才放
    const touch = 'pointerType' in e && (e as PointerEvent).pointerType !== '' && (e as PointerEvent).pointerType !== 'mouse';
    const hit = room.hitAt(e.clientX, e.clientY);
    if (hit.cd) {
      if (touch && shelfSelect(hit.cd)) return;
      pick(hit.cd);
    } else if (hit.door) {
      const link = $('#next [data-enter]');
      if (link) enterScreening(link.dataset.enter!, link.dataset.note ?? '');
    }
  }
});

/* ---------- Spotify 播放器（官方 iFrame API：拿得到播放狀態與秒數） ---------- */
type PlaybackEvent = { data: { isPaused: boolean; position: number; duration: number } };
interface SpotifyController {
  loadUri(uri: string): void;
  play(): void;
  seek(seconds: number): void;
  addListener(ev: 'ready', cb: () => void): void;
  addListener(ev: 'playback_update', cb: (e: PlaybackEvent) => void): void;
}
interface SpotifyIFrameAPI {
  createController(el: HTMLElement, opts: { uri: string; width?: string | number; height?: number; theme?: 'dark' }, cb: (c: SpotifyController) => void): void;
}
let player: SpotifyController | null = null;
let apiReady: Promise<SpotifyIFrameAPI> | null = null;
export const playback = { playing: false, positionMs: 0, durationMs: 0, at: 0 };
/** 第一次真的有聲音的那一刻（開場用來決定什麼時候把鏡頭拉回門口） */
let heardFirstSound: () => void = () => undefined;
const firstSound = new Promise<void>((r) => (heardFirstSound = r));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 播放器目前載著哪首；同一首不要再 loadUri，重載會把剛送出的 play() 吃掉 */
let loadedUri = '';
/** 真的在出聲的是哪首。loadUri 換歌後舊歌就停了，新歌要等播放位置往前走才算數 */
let playingUri = '';
let embedReady = false;
const readyWaiters: (() => void)[] = [];
function markReady(): void {
  embedReady = true;
  readyWaiters.splice(0).forEach((f) => f());
}
/** 嵌入播放器載完才能 play()，載入中送進去的指令會被忽略 */
function whenEmbedReady(): Promise<void> {
  if (embedReady) return Promise.resolve();
  const uri = loadedUri;
  return new Promise((resolve) => {
    readyWaiters.push(resolve);
    // 沒收到 ready、也沒認出新歌的回報也不要卡住：3 秒後還是這首就當作好了
    setTimeout(() => (loadedUri === uri && !embedReady ? markReady() : resolve()), 3000);
  });
}
/**
 * 這次回報是不是目前載入的這首。loadUri 換歌後，上一首還會再回報幾次（長度、位置都是舊的），
 * 把它當成新歌好了會太早 play()（被載入中的播放器吃掉），也會誤以為新歌在出聲。
 */
function isLoadedTrack(d: PlaybackEvent['data']): boolean {
  if (!d.duration) return false;
  const t = data.tracks[loadedUri.slice('spotify:track:'.length)];
  if (d.duration < FULL_TRACK_MS) return d.position < 1500; // 沒登入的 30 秒試聽：剛載好時位置在開頭
  return !t?.durationMs || Math.abs(d.duration - t.durationMs) < 8000;
}
function loadTrack(id: string): void {
  const uri = `spotify:track:${id}`;
  if (!player || loadedUri === uri) return;
  loadedUri = uri;
  playingUri = '';
  embedReady = false;
  playback.durationMs = 0;
  player.loadUri(uri);
}

function loadSpotifyApi(): Promise<SpotifyIFrameAPI> {
  const fault = import.meta.env.DEV ? spotifyFault(location.search) : null;
  if (fault === 'hang') return (apiReady ??= withTimeout(new Promise<SpotifyIFrameAPI>(() => {}), SPOTIFY_LOAD_MS, 'Spotify 播放器'));
  if (fault === 'fail') return (apiReady ??= Promise.reject(new Error('Spotify 播放器載入失敗')));
  apiReady ??= withTimeout(new Promise<SpotifyIFrameAPI>((resolve, reject) => {
    (window as unknown as { onSpotifyIframeApiReady: (api: SpotifyIFrameAPI) => void }).onSpotifyIframeApiReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://open.spotify.com/embed/iframe-api/v1';
    s.async = true;
    s.onerror = () => reject(new Error('Spotify 播放器載入失敗'));
    document.head.append(s);
  }), SPOTIFY_LOAD_MS, 'Spotify 播放器');
  return apiReady;
}

/** 播放器用深色版（API 的 theme: 'dark' → 嵌入網址 theme=0），不要跟封面取色的亮藍、亮紅搶房間的琥珀色 */
/** 先把播放器載好但不播，訪客一按就有聲音（瀏覽器規定要先有點擊才能出聲） */
let preparing: Promise<void> | null = null;
function preparePlayer(id: string): Promise<void> {
  preparing ??= (async () => {
    const box = $('[data-player]')!;
    const mount = document.createElement('div');
    box.replaceChildren(mount);
    const api = await loadSpotifyApi();
    await withTimeout(new Promise<void>((resolve) => {
      api.createController(mount, { uri: `spotify:track:${id}`, width: '100%', height: 80, theme: 'dark' }, (c) => {
        player = c;
        if (import.meta.env.DEV) (window as unknown as { __player: unknown }).__player = c; // 給 .aside 診斷腳本測 seek
        loadedUri = `spotify:track:${id}`;
        document.documentElement.classList.add('has-player');
        c.addListener('ready', markReady);
        c.addListener('playback_update', (e) => {
          if (!embedReady) {
            if (!isLoadedTrack(e.data)) return; // 剛換歌時上一首殘留的回報
            markReady();
          }
          playback.positionMs = e.data.position;
          playback.durationMs = e.data.duration;
          playback.at = performance.now();
          // 被瀏覽器擋下的自動播放會先回報一次 isPaused=false、position=0，約 0.3 秒後才改回暫停。
          // 所以只看播放位置有沒有真的往前走，不單看 isPaused。
          if (e.data.isPaused) setAudible(false);
          else if (e.data.position > 0) {
            setAudible(true);
            jumpToChorus(e.data);
          }
          // 一首放完（試聽 30 秒也算）就從牆上隨機接下一首，不要放完就安靜
          if (ended(e.data.position, e.data.duration)) playNextShuffle();
        });
        resolve();
      });
    }), SPOTIFY_LOAD_MS, 'Spotify 播放器');
  })().catch(() => undefined);
  return preparing;
}

/** 跳過副歌的曲目：同一首重播、或使用者自己拉進度條時不再跳 */
const chorusDone = new Set<string>();
/**
 * 第一次聽到聲音（position 第一次大於 0）的那一個 playback_update 就 seek 到副歌。
 * 更早送的 seek 會被還沒開始播的播放器吃掉；等到有聲音才送，頂多聽到不到一秒的開頭。
 */
function jumpToChorus(d: PlaybackEvent['data']): void {
  const id = loadedUri.slice('spotify:track:'.length);
  const t = data.tracks[id];
  if (!player || !t?.chorusMs || chorusDone.has(id)) return;
  // 試聽版，或剛換歌時上一首殘留的事件（長度對不上）都不跳
  if (d.duration < FULL_TRACK_MS || Math.abs(d.duration - t.durationMs) > 8000) return;
  chorusDone.add(id);
  if (d.position >= t.chorusMs - 3000) return;
  player.seek(t.chorusMs / 1000);
  // 歌詞字幕依 playback 推算位置，先對上新位置，不用等下一次回報
  playback.positionMs = t.chorusMs;
  playback.at = performance.now();
}

function setAudible(on: boolean): void {
  if (on) playingUri = loadedUri;
  if (playback.playing === on) return syncListenButtons(); // 換歌時可能一直是「在放」，按鈕還是要跟著新歌
  playback.playing = on;
  room?.setPlaying(on);
  document.documentElement.classList.toggle('is-playing', on);
  if (on) {
    heardFirstSound();
    document.documentElement.classList.remove('nudge-dock');
  }
  syncListenButtons();
}

/** 播放鈕顯示狀態：正在放的就是這顆按鈕的歌，就寫「正在放」 */
function syncListenButtons(): void {
  for (const b of $$<HTMLButtonElement>('[data-listen]')) {
    b.dataset.label ??= b.textContent ?? '';
    const on = playback.playing && playingUri === `spotify:track:${b.dataset.listen}`;
    if (b.classList.contains('is-on') === on) continue; // 每次播放回報都會進來，沒變就不動 DOM
    b.classList.toggle('is-on', on);
    b.textContent = on ? '正在放' : b.dataset.label;
  }
  // CD 牆抽出那張的「放上唱盤」：挑了不跳走，就在這裡告訴訪客已經在放
  if (scrubPick) {
    const on = playback.playing && playingUri === `spotify:track:${scrubPick.dataset.play}`;
    scrubPick.dataset.label ??= scrubPick.textContent ?? '';
    if (scrubPick.classList.contains('is-on') !== on) {
      scrubPick.classList.toggle('is-on', on);
      scrubPick.textContent = on ? '正在放' : scrubPick.dataset.label;
    }
  }
}

async function listenTo(id: string): Promise<void> {
  if (playback.playing && playingUri === `spotify:track:${id}`) return; // 同一首已經在出聲，不要再 play()
  await preparePlayer(id);
  if (player) {
    loadTrack(id);
    // 不等落針：Spotify 從 play() 到出聲本來就要約 0.5 秒，落針約 0.3 秒，同時開始剛好對上；
    // 等針落下才 play() 會讓點下去到有聲音拖到一秒多（diag-opening 量過 1054ms）
    void room?.cue();
    await whenEmbedReady();
    player.play();
    return;
  }
  // API 載不到或逾時：老實說沒放，不轉唱盤、不亮 ON AIR，給一個直接到 Spotify 聽的連結
  showPlayerFailed(id);
}

function showPlayerFailed(id: string): void {
  const note = document.createElement('p');
  note.className = 'dock__fail';
  const a = document.createElement('a');
  a.href = spotifyTrackUrl(id);
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = '到 Spotify 聽';
  note.append('我的播放器今天沒開起來。', a);
  $('[data-player]')!.replaceChildren(note);
  document.documentElement.classList.remove('nudge-dock');
  document.documentElement.classList.add('player-failed');
}

/* ---------- 歌詞 ---------- */
let lyricsOn = false;
let lyricLines: import('./live/lyrics.ts').LyricLine[] = [];
let lyricIdx = -2;
/** 正在放 30 秒試聽：歌詞時間軸對不上，同步關掉 */
let previewShown = false;
const lyricsBox = $('#lyrics');
const lyricsList = $('[data-lyrics-lines]');
const lyricsStatus = $('[data-lyrics-status]');

async function loadLyrics(id: string): Promise<void> {
  const t = data.tracks[id] as (typeof data.tracks)[string] & { artist: string; durationMs: number };
  if (!t || !lyricsList || !lyricsStatus) return;
  lyricLines = [];
  lyricIdx = -2;
  previewShown = false;
  lyricsList.hidden = false;
  lyricsList.replaceChildren();
  lyricsStatus.textContent = '找歌詞中…';
  const { findLyrics } = await import('./live/lyrics.ts');
  const ly = await findLyrics({ name: t.name, artist: t.artist, durationMs: t.durationMs });
  if (nowPlaying !== id) return; // 等的時候換歌了
  if (ly.kind === 'synced') {
    lyricLines = ly.lines;
    lyricsStatus.textContent = '';
    lyricsList.replaceChildren(...ly.lines.map((l) => Object.assign(document.createElement('li'), { textContent: l.text || '（間奏）' })));
  } else if (ly.kind === 'plain') {
    lyricsStatus.textContent = '這首只有文字歌詞，沒有時間軸，不會跟著跑。';
    lyricsList.replaceChildren(...ly.lines.map((l) => Object.assign(document.createElement('li'), { textContent: l })));
  } else {
    lyricsStatus.textContent = ly.kind === 'instrumental' ? '演奏曲，沒有歌詞。' : '這首還沒有人上傳歌詞。';
  }
}

$('[data-lyrics-toggle]')?.addEventListener('click', (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  lyricsOn = !lyricsOn;
  btn.setAttribute('aria-pressed', String(lyricsOn));
  if (lyricsBox) lyricsBox.hidden = !lyricsOn;
  document.documentElement.dataset.lyrics = String(lyricsOn);
  if (lyricsOn && nowPlaying) void loadLyrics(nowPlaying);
});

/** 每一格：依播放秒數亮起目前這一行（歌詞只放在唱盤面板裡；畫面下方的大字幕會壓在面板上，2026-11-09 業主要求拿掉） */
function tickLyrics(now: number): void {
  const preview = isPreview(playback.durationMs);
  if (lyricsOn && lyricLines.length && lyricsList && preview !== previewShown) {
    previewShown = preview;
    lyricsList.children[lyricIdx]?.removeAttribute('aria-current');
    lyricIdx = -2;
    lyricsList.hidden = preview;
    if (lyricsStatus) lyricsStatus.textContent = preview ? '試聽片段，完整歌詞要登入 Spotify' : '';
  }
  if (lyricsOn && lyricLines.length && lyricsList && !previewShown) {
    const ms = playback.positionMs + (playback.playing ? now - playback.at : 0);
    const i = (() => {
      let lo = 0, hi = lyricLines.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lyricLines[mid]!.t <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return ans;
    })();
    if (i !== lyricIdx) {
      lyricsList.children[lyricIdx]?.removeAttribute('aria-current');
      const li = lyricsList.children[i] as HTMLElement | undefined;
      li?.setAttribute('aria-current', 'true');
      // 只捲歌詞框自己，讓這行置中。不能用 scrollIntoView：它會連整頁一起捲，
      // 訪客捲到別段時，每換一句就被拉回唱盤（2026-11-09 業主回報「上下捲動一直循環」）
      if (li && lyricsBox) {
        const box = lyricsBox.getBoundingClientRect(), at = li.getBoundingClientRect();
        lyricsBox.scrollTo({ top: lyricsBox.scrollTop + at.top - box.top - (lyricsBox.clientHeight - at.height) / 2, behavior: reduced ? 'auto' : 'smooth' });
      }
      lyricIdx = i;
    }
  }
  requestAnimationFrame(tickLyrics);
}
requestAnimationFrame(tickLyrics);

/* ---------- 現場效果：不用選、不用麥克風 ---------- */
type LiveMode = import('./live/stage.ts').LiveMode;
// 放 CD 時錄音室、演唱會、真空管的效果一起開，不用選（燈光只在有聲音時亮，見 stage.ts）
const LIVE: LiveMode = 'on';
document.documentElement.dataset.live = LIVE;
// 燈光節奏：歌詞換句時亮一下、副歌 30 秒能量拉高（cues.ts）。只抓正在出聲的那首的歌詞
const pulse = new LyricPulse();
let cueId = '';
let cueLines: readonly CueLine[] = [];
async function loadCues(id: string): Promise<void> {
  const t = data.tracks[id] as (typeof data.tracks)[string] & { artist: string; durationMs: number };
  if (!t || cueId === id) return;
  cueId = id;
  cueLines = [];
  const { findLyrics } = await import('./live/lyrics.ts'); // 有快取：開歌詞時不會再抓一次
  const ly = await findLyrics({ name: t.name, artist: t.artist, durationMs: t.durationMs }).catch(() => null);
  if (cueId === id && ly?.kind === 'synced') cueLines = ly.lines;
}
function cueFeed(now: number, dt: number): import('./live/audio.ts').Levels {
  const id = playingUri.slice('spotify:track:'.length);
  if (id && id !== cueId) void loadCues(id);
  const preview = isPreview(playback.durationMs);
  const ms = playback.positionMs + (playback.playing ? now - playback.at : 0);
  const ready = id === cueId && !preview;
  return pulse.read(now, dt, id, ms, ready ? cueLines : [], ready ? data.tracks[id]?.chorusMs : null, playback.playing);
}

/** 從唱盤上的封面取主色，給現場燈光用（圖片是同網域，讀得到像素） */
function coverColor(img: HTMLImageElement): [number, number, number] | null {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, 24, 24);
    const px = g.getImageData(0, 0, 24, 24).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [pr, pg, pb] = [px[i]!, px[i + 1]!, px[i + 2]!];
      const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
      if (max < 40 || max - min < 25) continue; // 跳過太暗、太灰的像素
      r += pr; gg += pg; b += pb; n++;
    }
    return n ? [r / n / 255, gg / n / 255, b / n / 255] : null;
  } catch {
    return null;
  }
}
const deckCover = $<HTMLImageElement>('[data-now-cover]');
const syncColor = () => {
  if (!deckCover || !room) return;
  const rgb = coverColor(deckCover);
  if (rgb) room.setLiveColor(new (room.colorCtor())(...rgb));
};
deckCover?.addEventListener('load', syncColor);

/* ---------- 時間範圍切換：句子就是切換鈕 ---------- */
function setRange(range: RangeKey): void {
  if (range === current) return;
  current = range;
  for (const b of $$<HTMLButtonElement>('.range__opt')) {
    const on = b.dataset.rangeOpt === range;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  for (const el of $$('[data-range]')) el.hidden = el.dataset.range !== range;
  // 時間詞直接換字（畫面上一直有字），新字用 120ms 從半透明淡進來
  for (const el of $$('[data-range-label]')) {
    el.textContent = RANGE_LONG[range];
    el.classList.remove('is-swap');
    void el.offsetWidth;
    el.classList.add('is-swap');
  }
  // 抽出的 CD 先收回，計數、歌名、牆長留到翻牌波浪走到一半才換
  rangeSwitching = true;
  if (room) room.setRange(range, false, { onMid: applyRangeMid });
  else applyRangeMid();
  document.dispatchEvent(new Event('rangechange'));
}

/** 換時段到翻牌一半：計數換新的，歌名跟著選中的位置換成新牆上的那張 */
function applyRangeMid(): void {
  rangeSwitching = false;
  syncShelfLength();
  scrubShown = null; // 同一個位置換了一張，要重寫歌名
}

const rangeSeg = $('.range');
rangeSeg?.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.range__opt');
  if (b) setRange(b.dataset.rangeOpt as RangeKey);
});
rangeSeg?.addEventListener('keydown', (e) => {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const next = RANGE_KEYS[(RANGE_KEYS.indexOf(current) + step + RANGE_KEYS.length) % RANGE_KEYS.length]!;
  setRange(next);
  $<HTMLButtonElement>(`.range__opt[data-range-opt="${next}"]`)?.focus();
});

/* ---------- CD 牆：選一張看歌名，點一下放上唱盤 ---------- */
// 不再「往下捲一張一張看」：那樣字幕跟著捲動位置走，滑鼠指著的那張抽出來了，字幕卻講別張。
// 現在只有一個「選中的那張」：桌機滑鼠指到就選；手機點一下選、「上一張／下一張」換；鍵盤左右鍵換。抽出來的就是字幕講的
const shelfEl = $('#shelf');
const scrubName = $('[data-scrub-name]');
const scrubBy = $('[data-scrub-by]');
const scrubI = $('[data-scrub-i]');
const scrubN = $('[data-scrub-n]');
const scrubPick = $<HTMLButtonElement>('.shelf__pick');
let scrubShown: string | null = null;
let shelfSel = 0;
/** 最近一次指標是滑鼠：滑鼠指著哪張就選哪張（觸控沒有 hover） */
let mouseHover = false;
/** 滑鼠還在房間畫面上（不在頁面按鈕、文字上）；每格算一次，見 flushPointer */
let pointerOnRoom = false;
const hoverMemo: HoverMemo = { stable: null, changedAt: -Infinity };
/** 按下時段到翻牌一半之間：歌名與計數維持舊的 */
let rangeSwitching = false;
function syncShelfLength(): void {
  const n = room?.shelfIds().length ?? 0;
  if (scrubN) scrubN.textContent = String(n);
  if (n) shelfSel = Math.min(shelfSel, n - 1);
}
/** 選某一張；回傳有沒有換（手機第一下是選，已經選著再點才放） */
function shelfSelect(id: string): boolean {
  const i = room?.shelfIds().indexOf(id) ?? -1;
  if (i < 0 || i === shelfSel) return false;
  shelfSel = i;
  return true;
}
function shelfInView(): boolean {
  if (!shelfEl) return false;
  const r = shelfEl.getBoundingClientRect();
  return r.top < window.innerHeight * 0.6 && r.bottom > window.innerHeight * 0.4;
}
/** 每格：在 CD 牆這段就抽出選中的那張，字幕跟著它 */
function scrubUpdate(): void {
  if (!shelfEl || !room) return;
  const ids = room.shelfIds();
  const inside = ids.length > 0 && shelfInView();
  // 滑鼠指到哪張就選哪張；路過幾張就移去按「放上唱盤」時退回原本那張（規則見 shelf-hover.ts）
  if (inside && !room.flipping) {
    const over = mouseHover ? room.pointedId() : null;
    const next = hoverPick(hoverMemo, { current: ids[shelfSel] ?? null, over, onRoom: pointerOnRoom, now: performance.now() });
    if (next) shelfSelect(next);
  }
  const id = inside ? ids[shelfSel]! : null;
  // 翻牌中不抽 CD
  room.setScrub(room.flipping ? null : id);
  if (rangeSwitching || id === scrubShown) return;
  scrubShown = id;
  const t = id ? data.tracks[id] : null;
  if (!t) return;
  if (scrubName) {
    const title = document.createElement('span');
    title.className = 'shelf__title';
    title.textContent = quoteTitle(t.name);
    scrubName.replaceChildren(title);
  }
  if (scrubBy) scrubBy.textContent = t.by;
  if (scrubI) scrubI.textContent = String(shelfSel + 1);
  if (scrubPick) {
    scrubPick.dataset.play = id!;
    syncListenButtons();
  }
  // 重播換張動畫：不拿掉 class 再讀 offsetWidth（那會強制整頁重排，滑鼠掃過一排時每格都排一次）
  for (const el of [scrubName, scrubBy]) {
    if (!el) continue;
    if (!el.classList.contains('is-swap')) el.classList.add('is-swap');
    else for (const a of el.getAnimations()) {
      a.currentTime = 0;
      a.play();
    }
  }
}
// 鍵盤：在 CD 牆這段，左右鍵一張張換、Enter 放上唱盤
document.addEventListener('keydown', (e) => {
  if (!scrubShown || !shelfEl || document.activeElement !== document.body) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    pick(scrubShown);
    return;
  }
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  stepShelf(step);
});
/** CD 牆換一張 */
function stepShelf(step: number): void {
  const n = room?.shelfIds().length ?? 0;
  if (!n) return;
  shelfSel = Math.min(n - 1, Math.max(0, shelfSel + step));
}
// 手機：CD 很小不好點準，「上一張／下一張」一次換一張
$$<HTMLButtonElement>('[data-shelf-step]').forEach((b) =>
  b.addEventListener('click', () => stepShelf(Number(b.dataset.shelfStep))),
);

/* ---------- 數字往上滾、進場 ---------- */
(() => {
  const els = $$('[data-roll]');
  els.forEach((el) => {
    const value = el.textContent!.trim();
    const said = Object.assign(document.createElement('span'), { className: 'sr-only', textContent: value });
    const shown = Object.assign(document.createElement('span'), { className: 'roll__digits' });
    shown.setAttribute('aria-hidden', 'true');
    let i = 0;
    for (const ch of value) {
      if (!/\d/.test(ch)) {
        shown.append(ch);
        continue;
      }
      const col = Object.assign(document.createElement('span'), { className: 'roll__col' });
      const strip = Object.assign(document.createElement('span'), { className: 'roll__strip' });
      strip.style.setProperty('--d', ch);
      strip.style.setProperty('--i', String(i++));
      for (let n = 0; n < 10; n++) strip.append(Object.assign(document.createElement('span'), { textContent: String(n) }));
      col.append(strip);
      shown.append(col);
    }
    el.classList.add('roll');
    el.replaceChildren(said, shown);
  });
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
    },
    { rootMargin: '0px 0px -5% 0px', threshold: 0 },
  );
  [...els, ...$$('[data-reveal]')].forEach((el) => io.observe(el));
})();

/* ---------- 房間的時段：午後、微醺、深夜 ---------- */
const MOOD_KEY = 'taste-room:mood';
function savedMood(): SavedMood | null {
  try {
    const v = JSON.parse(localStorage.getItem(MOOD_KEY) ?? 'null') as SavedMood | null;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}
let mood: Mood = pickMood(new Date(), savedMood());
function setMood(next: Mood, remember: boolean): void {
  mood = next;
  document.documentElement.dataset.mood = next;
  for (const b of $$<HTMLButtonElement>('.moods__opt')) {
    const on = b.dataset.mood === next;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  if (remember) {
    try {
      const now = new Date();
      localStorage.setItem(MOOD_KEY, JSON.stringify({ mood: next, slot: moodByClock(now), day: now.toDateString() } satisfies SavedMood));
    } catch {
      /* 私密視窗等情況存不了，不影響使用 */
    }
  }
  void room?.setMood(next);
}
setMood(mood, false);
// 頁面開著跨過時段（例如傍晚 4 點、晚上 9 點）就跟著換；這個時段裡訪客自己選過就不動
setInterval(() => {
  const next = pickMood(new Date(), savedMood());
  if (next !== mood) setMood(next, false);
}, 60_000);
const moods = $('.moods');
moods?.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.moods__opt');
  if (b) setMood(b.dataset.mood as Mood, true);
});
moods?.addEventListener('keydown', (e) => {
  const order: Mood[] = ['afternoon', 'tipsy', 'night'];
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const next = order[(order.indexOf(mood) + step + order.length) % order.length]!;
  setMood(next, true);
  $<HTMLButtonElement>(`.moods__opt[data-mood="${next}"]`)?.focus();
});

/* ---------- 3D 房間 ---------- */
function isRoomSurface(el: Element | null): boolean {
  if (!el) return false;
  if (el.closest('a,button,input,iframe,h1,h2,h3,p,li,dl,.deck__now,.range,.bar')) return false;
  // 開場選片時頁面停在唱盤段（#deck），它蓋滿整個畫面；不算進來的話滑鼠在 CD 牆上移動，房間永遠收到「沒指著」，光不會跟（業主 2026-11-09 抓到）
  if (document.documentElement.classList.contains('intro-running') && el.closest('#deck')) return true;
  return Boolean(el.closest('.moment, .deck__stage'));
}

interface Anchor {
  el: HTMLElement;
  cam: string;
  at: number;
}

async function startRoom(): Promise<void> {
  const canvas = $<HTMLCanvasElement>('#room');
  if (!canvas) return;
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2') && !probe.getContext('webgl')) throw new Error('no webgl');
  const font = '"Noto Sans TC", "PingFang TC", sans-serif';
  await Promise.race([document.fonts.load(`600 150px ${font}`, '放映室'), new Promise((r) => setTimeout(r, 1500))]);
  const { Room, CAMS, widePose, phonePose } = await import('./room/room.ts');
  // 開場選片：光停到哪張（滑鼠指到哪張），字幕就寫這張會放哪首、誰唱、哪張專輯
  const r = new Room(canvas, data, { reducedMotion: reduced, font, onPick: (id) => pick(id), onLit: showCaption });
  room = r;
  if (openerId) r.setLights(false, true); // 有開場：從第一格起是暗場，只有 CD 牆亮；CD 落盤才開燈（沒有開場的路徑維持亮著）
  r.introHome = $('#deck') ? 'deck0' : 'door'; // 開場結束停在頁面第一區，捲動從那裡接手
  if (import.meta.env.DEV) (window as unknown as { __room: unknown }).__room = r; // 給 .aside 診斷腳本讀選片光停在哪張
  if (import.meta.env.DEV) (window as unknown as { __playNext: () => void }).__playNext = () => playNextShuffle(); // 給 diag-fly.js 觸發「放完自動續播」
  r.setFeed(cueFeed);
  void r.setMood(mood, true);
  syncColor();
  // shader 丟到背景編譯，等它編好（最多 2.5 秒）才開始開場與 render loop；等的時候貼圖照常載入
  await Promise.race([r.precompile().catch(() => {}), wait(2500)]);
  const opener = openerId;
  const html = document.documentElement;
  if (opener) {
    html.classList.add('intro-running');
    let started = false; // 正在等這次互動的聲音
    /** 訪客用點擊從轉盤選的：這一下就是使用者手勢，落盤就直接放，不用再點 */
    let chosen = false;
    // 聲音出來、房間亮起來看一下，再拉回門口。開場沒有時限，一直等到第一下互動（或自動播放成功）
    void firstSound.then(() => wait(2400)).then(() => r.resumeIntro());
    // touchend：手機滑完手指離開螢幕，部分瀏覽器算使用者手勢，滑一下就能開播；不算的話照舊等點一下
    const gestureEvents = ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const;
    // 放這首、CD 牆自己會處理播放，不要在同一下互動裡再放另一首
    const gesture = (e: Event) => {
      if (html.classList.contains('onboarding')) return; // 開場對話中的點擊只拿來換下一句
      if ((e.target as Element | null)?.closest?.('[data-listen], [data-play], .opening-skip')) return;
      // 瀏覽器只把滑鼠的 pointerdown、觸控／觸控筆的 pointerup 當成使用者手勢；手機在 pointerdown 就放會被擋
      if (e instanceof PointerEvent && (e.type === 'pointerdown') !== (e.pointerType === 'mouse')) return;
      if (e.type === 'touchend' && r.rouletteRunning) return; // 手機：滑動不算選，要點一下（pointerup）才停轉盤
      // 手機沒有「指著」：點在哪張 CD 上就放那張（光可能剛好走在別張）；點在空白處才放光停的那張
      if (r.rouletteRunning) return choose(true, e instanceof PointerEvent ? r.hitAt(e.clientX, e.clientY).cd : null);
      if (chosen && !html.classList.contains('intro-landed')) return; // 選好了、CD 還在飛：落盤時自己會放
      startMusic();
    };
    const bind = () => gestureEvents.forEach((ev) => window.addEventListener(ev, gesture));
    const unbind = () => gestureEvents.forEach((ev) => window.removeEventListener(ev, gesture));
    function startMusic(): void {
      if (playback.playing) return;
      // 上一下（例如手機滑動）被瀏覽器擋了：這一下是真的點擊就直接再送一次 play()，不用等 4.5 秒的提示
      if (started) return player?.play();
      started = true; // 監聽留著，等真的出聲（firstSound）才拿掉
      html.classList.add('is-cueing');
      const listening = listenTo(html.classList.contains('intro-landed') && nowPlaying ? nowPlaying : opener!); // 落針和播放同時開始
      void Promise.race([firstSound.then(() => true), wait(4500).then(() => false)]).then(async (heard) => {
        if (heard) return html.classList.remove('is-cueing');
        await listening; // 播放器還在載（最多 8 秒）時不提示，等它成功或判定載不到
        html.classList.remove('is-cueing');
        if (playback.playing) return;
        started = false;
        if (html.classList.contains('player-failed')) return; // 載不到：播放列已改成連到 Spotify 的連結
        // 被瀏覽器擋了：針回到懸著，字幕與播放列提示再點一下
        html.classList.add('nudge-dock');
        bind();
      });
    }
    void firstSound.then(unbind);
    bind();
    // 捲動 = 跳過開場：轉盤停在當下那張、直接放上唱盤，針保持懸著、ON AIR 繼續閃，之後第一下互動照樣落針開播
    // 一跳過就收起開場字幕與「直接進房間」：CD 還在飛的那兩秒，訪客已經捲到別段，字幕留著會疊在內容上
    const skip = () => {
      html.classList.add('intro-skipped');
      if (r.rouletteRunning) choose(false);
      r.skipIntro();
    };
    const skipEvents = ['wheel', 'touchmove', 'scroll'] as const;
    // 捲軸、鍵盤、錨點連結也會捲走，只靠 wheel／touchmove 抓不到；捲離開場位置 80px 以上才算
    const y0 = window.scrollY;
    const onSkipEvent = (e: Event) => {
      if (html.classList.contains('onboarding')) return;
      if (e.type !== 'scroll' || Math.abs(window.scrollY - y0) > 80) skip();
    };
    skipEvents.forEach((ev) => window.addEventListener(ev, onSkipEvent, { passive: true }));
    $('.opening-skip')?.addEventListener('click', skip);
    const events = [...skipEvents];
    const fly = (id: string) =>
      r.introPlay(
        id,
        () => {
          r.setLights(true); // CD 落上唱盤：開燈（捲動跳過也會補呼叫 onLand）
          showOnDeck(id, chosen);
          html.classList.add('intro-landed');
          if (chosen) {
            startMusic(); // 點擊選的：落盤就放（點下去約 2 秒，瀏覽器還准許出聲）
            // 選完就帶訪客回第一區看整個房間，不等聲音：聲音晚到或被擋，鏡頭也不會卡在唱盤近拍。
            // 落盤後照時間表推近 1.1 秒、停 1.4 秒、拉回門口 2.1 秒（約 4.6 秒）
            r.resumeIntro();
          }
        },
        () => {
          r.setLights(true); // 保底：任何路徑都不能讓訪客困在暗房裡
          events.forEach((ev) => window.removeEventListener(ev, onSkipEvent));
          html.classList.remove('intro-running', 'is-choosing');
          html.classList.add('intro-done');
        },
      );
    /** 轉盤停下：停在哪張就放哪張。先叫播放器換好這首，落盤時就能直接出聲 */
    function choose(byGesture: boolean, tapped: string | null = null): void {
      const lit = r.stopRoulette();
      const id = (tapped && data.tracks[tapped] ? tapped : lit) ?? opener!;
      chosen = byGesture;
      setOpener(id);
      html.classList.remove('is-choosing');
      void preparePlayer(id).then(() => loadTrack(id));
      fly(id);
    }
    // 進場讓訪客自己挑：柔光隨機停在牆上一張候選 CD，點一下就放那張（桌機指到哪張光就跟到哪張）
    const wall = data.ranges[DEFAULT_RANGE];
    const wallTracks = Object.fromEntries(wall.flatMap((id) => (data.tracks[id] ? [[id, data.tracks[id]!]] : [])));
    // 先講我是誰、為什麼做這個，講完才挑 CD。不能 await：房間的畫面迴圈在後面才啟動，等的話對話期間背景全黑
    // 對話的背景是門口看整個房間；講完鏡頭才滑到 CD 牆開始挑
    if (!forcedOpenerId) r.holdHome();
    void runOnboarding().then(() => {
      if (!forcedOpenerId) r.startRoulette(rouletteCandidates(wall, wallTracks, data.openerArtists), 1600);
      if (r.rouletteRunning) html.classList.add('is-choosing');
      else fly(opener); // 開發用 ?opener=，或牆上沒有可轉的 CD：照舊直接飛這首
    });
  } else html.classList.add('intro-done');
  if (nowPlaying) showOnDeck(nowPlaying);

  let anchors: Anchor[] = [];
  // 鏡頭用的畫面大小跟 3D 畫布同一個（.stage，CSS 100lvh）：Android 網址列收放時 innerHeight 會變，
  // 用它算錨點與長寬比，來回滑動時鏡頭目標會一直跳（2026-11-09 業主 Xperia 1 回報演唱會牆來回滑動卡）
  const stageEl = $('.stage');
  const view = () => ({ w: stageEl?.clientWidth || window.innerWidth, h: stageEl?.clientHeight || window.innerHeight });
  const measure = () => {
    const vh = view().h;
    // 排除 <html>：update() 會把目前鏡頭寫在 html 的 data-cam 上，算進來會在整頁中間多一個假錨點，把鏡頭拉回那一格
    anchors = $$('[data-cam]:not(html)')
      .map((el) => {
        const box = el.getBoundingClientRect();
        return { el, cam: el.dataset.cam!, at: box.top + window.scrollY + box.height / 2 - vh / 2 };
      })
      .sort((a, b) => a.at - b.at);
  };
  measure();
  if (route !== 'opening') {
    const exit = anchors.find((a) => a.el.id === 'next');
    if (exit) window.scrollTo({ top: exit.at, behavior: 'instant' });
    if (route === 'return') r.returnFromScreening(RETURN_MS.cam, RETURN_MS.door);
  }
  window.addEventListener('resize', measure);
  new ResizeObserver(measure).observe(document.body);

  const focusId = $('#month')?.dataset.focusArtist ?? null;
  // 導覽列是伺服器端渲染好的固定元素，只查一次；每格只在位置真的變了才寫屬性
  const whereLinks = $$<HTMLAnchorElement>('.where a');
  let lastHere = '';
  const pose = (name: string) => { const v = view(); return r.isPhone() ? phonePose(name, v.w / v.h) : widePose(name, v.w / v.h); };
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t) as [number, number, number];

  const update = () => {
    if (!anchors.length) return;
    const y = window.scrollY;
    let i = anchors.findIndex((a, k) => y < (anchors[k + 1]?.at ?? Infinity));
    if (i < 0) i = 0;
    const a = anchors[i]!;
    const b = anchors[i + 1];
    let t = b ? Math.min(1, Math.max(0, (y - a.at) / (b.at - a.at))) : 0;
    if (y < a.at) t = 0;
    // 停一下再走：前後各 15% 不動
    t = Math.min(1, Math.max(0, (t - 0.15) / 0.7));
    t = t * t * (3 - 2 * t);
    if (reduced) t = t < 0.5 ? 0 : 1;
    const pa = pose(a.cam);
    const pb = b ? pose(b.cam) : pa;
    r.aim({ pos: mix(pa.pos, pb.pos, t), look: mix(pa.look, pb.look, t), fov: pa.fov + (pb.fov - pa.fov) * t });
    const near = t < 0.5 ? a.cam : (b?.cam ?? a.cam);
    r.setFocusArtist(near === 'wall-close' ? focusId : null);
    document.documentElement.dataset.cam = near;
    const here = near === 'deck2' ? 'deck0' : near === 'wall-close' ? 'wall' : near === 'cinema-end' ? 'cinema' : near.startsWith('gigs') ? 'gigs' : near;
    if (here === lastHere) return;
    lastHere = here;
    for (const a of whereLinks) a.setAttribute('aria-current', String(a.dataset.where === here));
  };

  // 畫面被實色區塊蓋住時不算圖
  const visible = new Set<Element>();
  const vis = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? visible.add(e.target) : visible.delete(e.target);
    r.setRunning(visible.size > 0);
  });
  $$('.moment, .deck').forEach((el) => vis.observe(el));

  // pointermove 只記位置，每格才算一次 elementFromPoint：高回報率滑鼠一秒觸發上百次，每次都做命中測試會吃掉主執行緒
  let pendingPointer: { x: number; y: number } | null = null;
  window.addEventListener(
    'pointermove',
    (e) => {
      mouseHover = e.pointerType === 'mouse';
      pendingPointer = { x: e.clientX, y: e.clientY };
    },
    { passive: true },
  );
  const flushPointer = () => {
    if (!pendingPointer) return;
    const { x, y } = pendingPointer;
    pendingPointer = null;
    pointerOnRoom = mouseHover && isRoomSurface(document.elementFromPoint(x, y));
    r.setPointer(x, y, pointerOnRoom);
  };
  // 觸控不設「指著」：手指一碰（包括開始捲動）就讓牆上那張抽出來，會跟字幕對不起來。點擊時由 hitAt 直接算

  syncShelfLength();
  // 同一時間只排一格：分頁隱藏前排好的那格，回到前景時照樣會跑，visibilitychange 再排一條就變兩條迴圈（每格畫兩次）
  let queued = false;
  const schedule = () => {
    if (queued || document.hidden) return;
    queued = true;
    requestAnimationFrame(loop);
  };
  const loop = (now: number) => {
    queued = false;
    flushPointer();
    update();
    r.pickPointer(); // 先算滑鼠指到哪張，選片才拿得到這一格的結果
    scrubUpdate();
    r.tick(now);
    schedule();
  };
  document.addEventListener('visibilitychange', schedule);
  schedule();
  document.documentElement.classList.add('has-room');
}

// 播放器提早載：Spotify API、嵌入 iframe、曲目都要時間，等 CD 落盤或訪客點了才載會卡一兩秒。
// 頁面一閒下來就先載好開場這首（回到出口時載唱盤上那首），之後換歌只是 loadUri。
// 播放列在開場時只是透明（styles.css .dock），仍在畫面上，嵌入播放器才會真的啟動。
{
  const id = openerId ?? $<HTMLButtonElement>('#deck [data-listen]')?.dataset.listen;
  const go = () => id && void preparePlayer(id);
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 800 });
  else setTimeout(go, 300);
}

startRoom()
  .catch(() => document.documentElement.classList.add('no-room'))
  .finally(() => {
    if (route !== 'return') return;
    // 不論房間有沒有起來都要放開暗場；成功時等第一幀畫出來再淡入
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('is-returning-go')));
  });

initShare();
