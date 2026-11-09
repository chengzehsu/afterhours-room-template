/** 播放室：Three.js 場景、CD 牆、唱盤動畫與跟著捲動的攝影機。 */
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { frameGap, type PaceState } from './pace.ts';
import { LEVELS, forcedLevel, initialQuality, stepQuality, WINDOW_FRAMES } from './quality.ts';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { breathing, type Levels } from '../live/audio.ts';
import { Sparkle } from '../live/sparkle.ts';
import { type LiveMode, Stage } from '../live/stage.ts';
import { DEFAULT_RANGE, RANGE_KEYS, type RangeKey } from '../core/profile.ts';
import type { RoomData } from '../page/render.ts';
import { ROOM } from './palette.ts';
import { fitWallFov } from './fit.ts';
import { GIGS_CAM, gigsThirdOf } from './gigs-cam.ts';
import { loadGigWall } from './gig-wall.ts';
import { boxLook } from './poster-light.ts';
import { cellWidthFor, type PosterRig, posters } from './posters.ts';
import { cinemaDoor, crate, deck, DOOR, doorRig, type DoorRig, frames, SHELF, shell, shelfBoard } from './props.ts';
import { DARK_LEVEL, lightGains, lightsDuration, parseLightStyle, type LightGains, type LightStyle } from './lights.ts';
import { diveEnd, planIntro, tempStart } from '../core/opening.ts';
import { FLIP_INSTANT, FLIP_TIMING, flipAngle, flipMidpoint, flipPlan, type FlipKind } from './flip.ts';
import { decoded, photo, texturesIn, whenLoaded } from './textures.ts';
import { nextLit } from './roulette-step.ts';
import { EMPTY_DECK, hiddenIds, land, takeOff, type DeckSlots } from './now-playing-slot.ts';

declare global {
  interface Window {
    /** 開發模式才有：預編完的 program 快取鍵，以及之後在繪製當下才編的 program */
    __shaderLog?: {
      pre?: { at: number; ms: number; error: string | null; parallel: boolean; keys: string[] };
      drawn: { at: number; name: string; key: string }[];
      sync: (drawn: boolean) => void;
    };
    __shaderDiff?: () => unknown;
    /** 開發模式才有：GPU 上的貼圖與 program 數、預先上傳了幾張、佇列裡還有幾張（.aside/diag-jank.js 用） */
    __glInfo?: { preUploaded: number; read: () => { textures: number; programs: number; pending: number; preUploaded: number; unready: number } };
  }
}


export type Mood = 'afternoon' | 'tipsy' | 'night';
export const MOODS: Mood[] = ['afternoon', 'tipsy', 'night'];

/** 即時物件（CD、唱片、相框照片）的燈光，要和烘焙的房間對得上 */
const MOOD_LIGHT: Record<Mood, { sky: number; ground: number; hemi: number; spot: number; spots: number[]; lamp: number; lampIntensity: number }> = {
  afternoon: { sky: 0xeef2ff, ground: 0x6b5236, hemi: 1.1, spot: 0xfff1de, spots: [9, 8, 6], lamp: 0xffd9a8, lampIntensity: 0 },
  tipsy: { sky: 0xffd2a8, ground: 0x2b2216, hemi: 0.35, spot: 0xffb36b, spots: [22, 16, 10], lamp: 0xffa45a, lampIntensity: 4 },
  night: { sky: 0x9fb4ff, ground: 0x15110c, hemi: 0.25, spot: 0xffc58a, spots: [18, 14, 0], lamp: 0xff9a4d, lampIntensity: 3 },
};

/** 兩張烘焙貼圖之間交融；不受即時燈光影響 */
function bakedMaterial(flat = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    // flat：同一支 shader，但輸出單一顏色（live 門板用），照樣吃 dim／tint／flash
    defines: flat ? { FLAT: '' } : {},
    uniforms: {
      ...(flat ? { base: { value: new THREE.Color(0x5e2219) } } : {}),
      mapA: { value: null },
      mapB: { value: null },
      mixT: { value: 1 },
      dim: { value: 1 },
      tint: { value: new THREE.Color(1, 1, 1) },
      tintAmt: { value: 0 },
      flash: { value: 0 },
      power: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vWorld; void main() { vUv = uv; vWorld = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D mapA; uniform sampler2D mapB; uniform float mixT;
      uniform float dim; uniform vec3 tint; uniform float tintAmt; uniform float flash;
      uniform float power;
      #ifdef FLAT
      uniform vec3 base;
      #endif
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        #ifdef FLAT
        vec3 col = base;
        #else
        vec3 col = mix(texture2D(mapA, vUv).rgb, texture2D(mapB, vUv).rgb, mixT);
        #endif
        // 暗場的光池：CD 牆那一圈（邊緣柔化 0.6m）維持原亮度，其他地方剩 DARK；power 到 1 就全亮
        vec3 outside = max(abs(vWorld - vec3(-4.0, 1.425, 0.0)) - vec3(0.35, 1.125, 1.8), 0.0);
        float pool = 1.0 - smoothstep(0.0, 0.6, length(outside));
        col *= mix(float(${DARK_LEVEL}), 1.0, max(pool, power));
        col *= dim;
        col = mix(col, col * tint * 1.6, tintAmt);
        col += tint * flash * 0.06;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
}

export interface CamPose {
  pos: [number, number, number];
  look: [number, number, number];
  fov: number;
}

/** 攝影機定點。phone 是直式螢幕用的版本（往後退、視角放寬） */
/** 寬螢幕的鏡頭姿勢；CD 牆依寬高比放寬視角（fit.ts） */
export function widePose(name: string, aspect: number): CamPose {
  const p = CAMS[name]!.wide;
  if (name !== 'wall') return p; // wall-close 是近拍，本來就只框一部分
  const fov = fitWallFov(p.fov, aspect);
  return fov === p.fov ? p : { ...p, fov };
}

/** 手機鏡頭。矮的手機（寬高比 > 0.5，例如 375×667）畫面矮、文字跟 3D 搶位置，個別鏡頭微調：
 * 出口往下看（大標會升到招牌高度，招牌往上移才不會夾在大標中間）、CD 牆往上看 */
export function phonePose(name: string, aspect: number): CamPose {
  const p = CAMS[name]!.phone;
  if (aspect <= 0.5) return p;
  if (name === 'cinema') return { ...p, look: [p.look[0], p.look[1] - 0.55, p.look[2]] };
  if (name === 'gigs') return GIGS_CAM.phoneShort;
  if (gigsThirdOf(name) >= 0) return GIGS_CAM.thirds.short[gigsThirdOf(name)]!;
  // CD 牆：矮手機上面是說明文字、下面是第幾張與歌名，中間只剩約 185px；牆原本 175px 高、偏上壓到說明。
  // 視角放寬讓牆小一點，放進兩段文字中間（375×667 截圖量過）
  if (name === 'wall') return { ...p, look: [p.look[0], p.look[1] - 0.06, p.look[2]], fov: 86 };
  return p;
}

export const CAMS: Record<string, { wide: CamPose; phone: CamPose }> = {
  door: {
    wide: { pos: [0.5, 1.62, 3.6], look: [-0.5, 1.2, -3.6], fov: 54 },
    phone: { pos: [0.3, 1.6, 3.8], look: [-0.6, 1.15, -3.6], fov: 72 },
  },
  'wall-close': {
    wide: { pos: [-2.15, 1.7, 0.75], look: [-4, 1.95, 0.9], fov: 48 },
    phone: { pos: [-1.9, 1.75, 0.95], look: [-4, 1.95, 0.95], fov: 70 },
  },
  wall: {
    // 鏡頭往後退、往左轉，讓牆偏到右邊，左側文字不壓封面（scratchpad/g/overlap.mjs 量過 1280–1920 寬都不重疊）
    wide: { pos: [0.35, 1.45, 0], look: [-4, 1.45, 1.1], fov: 52 },
    phone: { pos: [0.6, 1.45, 0], look: [-4, 1.45, 0], fov: 74 },
  },
  deck0: {
    wide: { pos: [0, 1.75, -1.85], look: [0, 0.8, -3.65], fov: 46 },
    phone: { pos: [0, 1.85, -1.5], look: [0, 0.8, -3.65], fov: 66 },
  },
  deck1: {
    wide: { pos: [0.05, 1.28, -2.95], look: [-0.02, 0.8, -3.66], fov: 44 },
    phone: { pos: [0.05, 1.35, -2.85], look: [-0.02, 0.8, -3.66], fov: 62 },
  },
  deck2: {
    wide: { pos: [0.1, 1.02, -3.28], look: [-0.05, 0.81, -3.66], fov: 40 },
    phone: { pos: [0.08, 1.06, -3.22], look: [-0.05, 0.81, -3.66], fov: 58 },
  },
  brick: {
    wide: { pos: [0.2, 1.6, -1.0], look: [2.3, 1.75, -4], fov: 46 },
    phone: { pos: [0.4, 1.6, -0.6], look: [2.3, 1.75, -4], fov: 66 },
  },
  window: {
    // L 型轉角窗（後牆 x -4~-1.7＋左牆 z -4~-2.3）：鏡頭斜看轉角，兩段窗都進畫面
    wide: { pos: [-0.2, 1.55, -0.6], look: [-2.7, 1.5, -3.1], fov: 50 },
    phone: { pos: [0.6, 1.55, 0.2], look: [-2.2, 1.5, -2.6], fov: 70 },
  },
  lights: {
    wide: { pos: [0, 1.5, 2.2], look: [0, 3.0, -2.2], fov: 58 },
    phone: { pos: [0, 1.5, 2.8], look: [0, 3.0, -2.2], fov: 76 },
  },
  // 後牆燈箱牆：從唱盤往後拉、正對燈箱，整組框進畫面，參數怎麼算的見 gigs-cam.ts。手機另有推近左、中、右三段的 gigs-t1／t2／t3（桌機不用，同總覽）
  gigs: { wide: GIGS_CAM.wide, phone: GIGS_CAM.phone },
  'gigs-t1': { wide: GIGS_CAM.wide, phone: GIGS_CAM.thirds.phone[0]! },
  'gigs-t2': { wide: GIGS_CAM.wide, phone: GIGS_CAM.thirds.phone[1]! },
  'gigs-t3': { wide: GIGS_CAM.wide, phone: GIGS_CAM.thirds.phone[2]! },
  cinema: {
    wide: { pos: [1.55, 1.62, -1.1], look: [3.25, 1.5, -4], fov: 50 },
    phone: { pos: [1.9, 1.6, -0.6], look: [3.25, 1.5, -4], fov: 70 },
  },
  // 捲到頁尾：頁尾把出口文字往上推，手機鏡頭跟著抬頭，門與招牌降到文字下方、頁尾上方的空檔，不被「推開門」蓋住。桌機不變
  'cinema-end': {
    wide: { pos: [1.55, 1.62, -1.1], look: [3.25, 1.5, -4], fov: 50 },
    phone: { pos: [1.9, 1.6, -0.6], look: [3.25, 2.55, -4], fov: 70 },
  },
};

/** 翻牌中的一個位子：start 之後繞垂直軸轉，轉到 half 時換面 */
interface CdFlip {
  kind: FlipKind;
  start: number;
  half: number;
  dur: number;
  /** 換上的新面；exit 是 null（翻到側面就移除） */
  next: { id: string; tex: THREE.Texture | null } | null;
  swapped: boolean;
}

export interface RangeCallbacks {
  /** 翻牌波浪走到一半：文字、計數、牆長在這時換 */
  onMid?: () => void;
  /** 全部翻完（含等貼圖）：這時才抽出新的那張 */
  onEnd?: () => void;
}

interface Cd {
  id: string;
  mesh: THREE.Mesh;
  front: THREE.MeshStandardMaterial;
  artistIds: string[];
  home: THREE.Vector3;
  flip: CdFlip | null;
  dim: number;
  hover: number;
  /** 正在放的那張被拿去唱盤了：這個位子是空的（mesh 藏起來） */
  vacant: boolean;
  /** 放回牆上的滑回動畫開始時間；null = 沒在滑 */
  back: number | null;
}

export interface RoomOptions {
  reducedMotion: boolean;
  font: string;
  onPick: (trackId: string) => void;
  /** 開場選片：光換到另一張（或滑鼠指到另一張）時通知，字幕顯示會放哪一首 */
  onLit?: (trackId: string) => void;
}

const CD_W = 0.3;
const CD_H = 0.28;
const CD_D = 0.024;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * CD 牆柔光依房間時段打折：午後整間已經很亮，照原強度會把封面洗白（使用者 2026-11-08、11-09 兩次回報太亮）。
 * 渲染器沒有色調映射，封面算出來超過 1 就直接變白、超過泛光門檻 0.86 還會暈開；
 * 午後 CD 牆主燈（MOOD_LIGHT.afternoon.spots[0]）也因此從 18 降到 9，選中那張加柔光後約 0.8，留在門檻內。
 */
// 2026-11-09 業主抓到微醺選中那張 CD 爆白：audit:brightness wall 鏡頭量到 微醺 2.05%、深夜 0.98% 像素 ≥250（午後 0.15 只有 0.01%）
const CD_LIGHT_MOOD: Record<Mood, number> = { afternoon: 0.15, tipsy: 0.3, night: 0.3 };

/** CD 背後的光暈：中心亮、往外平滑淡出到全透明（邊緣不留硬邊） */
function haloTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  r.addColorStop(0.7, 'rgba(255,255,255,0.1)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function slot(index: number): THREE.Vector3 {
  const c = index % SHELF.cols;
  const r = Math.floor(index / SHELF.cols);
  return new THREE.Vector3(SHELF.x + 0.01, SHELF.y0 - r * SHELF.dy, SHELF.z0 - c * SHELF.dz);
}

export class Room {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  /** 積木版的靜態家具；烘焙好的 room.glb 載入後就拿掉 */
  private fixed = new THREE.Group();
  private camera = new THREE.PerspectiveCamera(54, 1, 0.05, 30);
  /** 牆上每個位子一個 CD，順序就是位子；id 會在翻牌換面時改，所以用位子當主鍵 */
  private slots: Cd[] = [];
  /** mesh → CD。不放進 userData，introPlay 會 clone mesh，userData 得能轉 JSON */
  private cdOfMesh = new WeakMap<THREE.Object3D, Cd>();
  private range: RangeKey | null = null;
  private flipJob: { cb: RangeCallbacks; midAt: number; midDone: boolean } | null = null;
  private queued: { range: RangeKey; cb: RangeCallbacks } | null = null;
  private plastic = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.35, metalness: 0.1 });
  private deck;
  private bulbs: THREE.Mesh[];
  private doorRig: DoorRig;
  private posterRig: PosterRig | null = null;
  private postersReady: Promise<void> = Promise.resolve();
  /** 上一次寫進燈箱的放歌程度（wake），變了才重寫 */
  private posterWake = 0;
  /** 門：t 目前開了幾成（0–1），to 目標；1 = 轉到 DOOR.maxAngle */
  private door = { t: 0, from: 0, to: 0, start: 0, dur: 0 };
  private doorHover = false;
  private precompiling = false;
  private bakedRoot: THREE.Object3D | null = null;
  private dive_: { start: number; dur: number; fromPos: THREE.Vector3; fromLook: THREE.Vector3; fromFov: number; toPos: THREE.Vector3; toLook: THREE.Vector3; toFov: number; release?: boolean } | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(2, 2);
  private pointerActive = false;
  private hovered: Cd | null = null;
  /** 這一格 main.ts 已經先呼叫過 pickPointer() */
  private pickedThisFrame = false;
  /** 滑鼠底下那張（射線打到的），跟「抽出來的那張」分開：在 CD 牆時抽出來的永遠是選中的那張 */
  private pointed: Cd | null = null;
  /** 捲動挑 CD：沒有滑鼠指著時，由捲動位置決定抽出哪一張 */
  private scrubId: string | null = null;
  /**
   * CD 牆的柔光：跟著目前選中（捲動抽出或滑鼠指著）的那張走。
   * 兩層：邊緣全柔化的窄角投射燈照亮封面；CD 背後貼一片中心亮、往外淡出的暖光，亮度推過 1 讓泛光暈開。
   * 燈一開始就加進場景、只調亮度不切 visible：燈的數量一變，所有材質都要重新編譯。
   */
  private cdSpot!: THREE.SpotLight;
  private cdHalo!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private cdLightAmt = 0;
  /**
   * 開場選片：柔光隨機停在一張候選 CD，不自己跳；滑鼠指到別張就跟過去，訪客點一下停在哪張就放哪張（stopRoulette）。
   * 不用快速亂跳：使用者覺得焦躁（2026-11-08）。桌機滑鼠指到哪張，光就移過去停住；手機點任何地方就停在當下亮的那張。
   */
  private roulette: { ids: string[]; at: number; lit: string; next: number; told?: boolean } | null = null;
  private cdLightAt = new THREE.Vector3();
  private shelfOrder: string[] = [];
  private focusArtist: string | null = null;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private goalPos = new THREE.Vector3();
  private goalLook = new THREE.Vector3();
  private goalFov = 54;
  private spinning = false;
  private spin = 0;
  private swap: { start: number; next: string } | null = null;
  /** 唱盤上（deck）與正飛向唱盤（flying）的歌：這兩首在 CD 牆上的位子要空著 */
  private deckSlots: DeckSlots = EMPTY_DECK;
  private hiddenFor: DeckSlots | null = null;
  private hiddenSet: ReadonlySet<string> = new Set();
  /** 從牆上拿下的 CD 飛向唱盤用的那一片，建一次重複用（不每次 new 材質，避免重編 shader）；平常藏著，預編時會一起編到 */
  private flyMesh!: THREE.Mesh;
  private flight: { id: string; start: number; from: THREE.Vector3; temp: boolean } | null = null;
  private armAngle = 0.15;
  private armGoal = 0.15;
  /** 唱針抬起的程度：1 = 抬著，0 = 放在唱片上 */
  private lift = 1;
  /** 開場落在唱盤後，針懸在唱片上方等第一下互動；一出聲或換片就解除 */
  private hover = false;
  private liftGoal = 1;
  /** 訪客按了播放、還在等聲音：唱盤先轉、唱臂先落針 */
  private cueing = false;
  private cueUntil = 0;
  private needleWaiters: (() => void)[] = [];
  private running = true;
  /** 上次滑鼠移動的時間，閒置降格率要看它 */
  private pointerAt = -Infinity;
  private quality = initialQuality();
  private qualityForced = forcedLevel(window.location.search) !== null;
  private qualityFrames: number[] = [];
  private prevFast = false;
  private last = performance.now();
  private first = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private data: RoomData,
    private opts: RoomOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    const forced = forcedLevel(window.location.search);
    if (forced !== null) this.quality = { level: forced, strikes: 0 };
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, LEVELS[this.quality.level]!.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // 房間的光影在 Blender 已經用 AgX 處理過，這裡不再做色調映射，避免偏暗偏色
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(ROOM.floor);

    this.lights();
    document.documentElement.dataset.lights = 'on';
    this.scene.add(this.fixed);
    shell(this.fixed);
    shelfBoard(this.fixed);
    this.deck = deck(this.fixed, this.scene);
    this.deck.arm.rotation.order = 'YXZ'; // 先轉向唱片、再在自己的橫軸上抬針放針
    const pic = (u: string | null) => (u ? photo(u, this.renderer) : null);
    frames(this.fixed, this.scene, data.loyal.map((a) => pic(a.lg)));
    crate(this.fixed, this.scene, data.newcomers.map((a) => pic(a.lg)));
    this.bulbs = cinemaDoor(this.fixed, this.scene, opts.font);
    this.doorRig = doorRig(this.scene, () => bakedMaterial(true));
    // 後牆燈箱牆：位置讀烘焙輸出的 room/lights.json 的 lightbox 與 occluders（沒有就用預設），照片與 atlas 畫好才放進場景
    // （precompile、loadBaked 都會等），貼圖不會等到第一次畫出才上傳
    if (data.gigs?.length) {
      this.postersReady = loadGigWall(new URL('room/lights.json', document.baseURI).href)
        .then(async (wall) => {
          const rig = posters(data.gigs, opts.font, document.baseURI, wall, { cellW: cellWidthFor(this.quality.level), anisotropy: Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) });
          await rig.ready;
          this.posterRig = rig;
          this.scene.add(rig.group);
          this.writePosterLook();
          await this.upload(rig.group);
        })
        .catch(() => {});
    }
    // 放映室有給門洞圖（從最後一格機位看進客廳）就換上，推近時看到的是隔壁真的房間；沒有就維持暖光漸層
    new THREE.TextureLoader().load(new URL('screening/doorway.jpg', document.baseURI).href, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = this.doorRig.glow.material as THREE.MeshBasicMaterial;
      mat.map = tex;
      this.doorRig.glow.userData.photo = true;
    });
    void this.loadBaked();
    this.stage = new Stage(this.scene, opts.reducedMotion);
    this.sparkle = new Sparkle(this.scene, opts.reducedMotion);
    // 門洞遮罩用 stencil：後製的緩衝區要帶 stencil，不然經過 composer 就失效
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr0 = this.renderer.getPixelRatio();
    this.composer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(size.width * pr0, size.height * pr0, { type: THREE.HalfFloatType, stencilBuffer: true }),
    );
    this.composer.setSize(size.width, size.height);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.35, 0.6, 0.86);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    if (data.signature) this.setLabel(data.signature);
    this.setRange(DEFAULT_RANGE, true);
    {
      // 飛行用的 CD：跟牆上的同款材質（封面先借第一格的，預編才會編到「有貼圖」那一種）
      const front = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.05, color: 0xffffff });
      front.map = this.slots[0]?.front.map ?? null;
      this.flyMesh = new THREE.Mesh(new THREE.BoxGeometry(CD_D, CD_H, CD_W), [front, this.plastic, this.plastic, this.plastic, this.plastic, this.plastic]);
      this.flyMesh.rotation.order = 'ZYX';
      this.flyMesh.castShadow = true;
      this.flyMesh.visible = false;
      this.scene.add(this.flyMesh);
    }
    this.applyQuality(true);
    window.addEventListener('resize', () => this.resize());
    if (import.meta.env.DEV) {
      const gl = { preUploaded: 0, read: () => ({ textures: this.renderer.info.memory.textures, programs: this.renderer.info.programs?.length ?? 0, pending: this.uploads.length, preUploaded: gl.preUploaded, unready: this.unreadyCovers() }) };
      window.__glInfo = gl;
    }
    void this.upload(this.scene);
    void this.preloadCovers();
  }

  /** 換上 Blender 烘焙好的房間；檔案不存在就維持積木版 */
  private async loadBaked(): Promise<void> {
    const url = new URL('room/room.glb', document.baseURI).href;
    const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (!head?.ok) return;
    const draco = new DRACOLoader().setDecoderPath(new URL('draco/', document.baseURI).href);
    const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url);
    draco.dispose();
    await this.postersReady; // 海報要在換上之前就進場景，預編才編得到
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // 用材質名稱分辨（重新壓縮後物件名稱可能會變，材質名稱不會）
      const tag = `${(mesh.material as THREE.Material).name} ${mesh.name}`;
      const name = tag.includes('window_view') ? 'view' : tag.includes('shell') ? 'shell' : 'props';
      const mat = bakedMaterial();
      mesh.material = mat;
      this.bakedMats.set(name, mat);
    });
    await this.setMood(this.mood, true);
    const before = new Set(this.scene.children);
    await this.sparkle.load(new URL('room/lights.json', document.baseURI).href);
    this.sparkle.setMood(this.mood);
    // 燈串載入時直接掛到場景上，沒編譯就會被畫到；移進烘焙房間，一起預編、一起換上
    for (const o of this.scene.children.filter((c) => !before.has(c))) gltf.scene.add(o);
    // 換上之前先在背景編好新材質，不然換上的那一格會同步卡住
    await this.compileFor(gltf.scene, this.scene);
    await this.warmPrograms();
    // 烘焙貼圖很大，換上那一格才上傳會是一個長任務
    await this.upload(gltf.scene);
    this.scene.remove(this.fixed);
    this.scene.add(gltf.scene);
    this.bakedRoot = gltf.scene;
    this.baked = true;
  }

  /**
   * 開始 render loop 之前呼叫：把目前場景和後製 pass 的 shader 丟到背景編譯，編好才 resolve。
   * 後製 pass 的全螢幕材質不在場景裡，所以放進一個暫時的場景一起編，不必在畫面外多畫一格。
   */
  async precompile(): Promise<void> {
    const t0 = performance.now();
    await Promise.race([this.postersReady, new Promise((r) => setTimeout(r, 1800))]);
    if (import.meta.env.DEV) {
      const known = new Set<string>();
      const log: NonNullable<Window['__shaderLog']> = {
        drawn: [],
        sync: (drawn) => {
          for (const p of this.renderer.info.programs ?? []) {
            if (known.has(p.cacheKey)) continue;
            known.add(p.cacheKey);
            if (drawn) log.drawn.push({ at: Math.round(performance.now()), name: p.name, key: p.cacheKey });
          }
        },
      };
      window.__shaderLog = log;
      window.__shaderDiff = () => {
        const pre = (log.pre?.keys ?? []).map((k) => k.split(','));
        return log.drawn.map(({ at, name, key }) => {
          const f = key.split(',');
          let best: [number, string | null, string | null][] | null = null;
          for (const g of pre) {
            const d: [number, string | null, string | null][] = [];
            for (let i = 0; i < Math.max(f.length, g.length); i++) if (f[i] !== g[i]) d.push([i, g[i] ?? null, f[i] ?? null]);
            if (!best || d.length < best.length) best = d;
          }
          return { at, name, afterPre: log.pre ? at >= log.pre.at : false, fields: f.length, nDiff: best?.length ?? null, diff: best?.slice(0, 12) ?? null };
        });
      };
    }
    // OutputPass 第一次 render 才依輸出色彩空間補 define，key 會跟著變；先補上同一組再編（色調映射是 NoToneMapping，不用補）
    if (THREE.ColorManagement.getTransfer(this.renderer.outputColorSpace) === THREE.SRGBTransfer) this.output.material.defines = { SRGB_TRANSFER: '' };
    const warm = new THREE.Scene();
    const geo = new THREE.PlaneGeometry(2, 2);
    const b = this.bloom;
    for (const m of [b.materialHighPassFilter, ...b.separableBlurMaterials, b.compositeMaterial, b.blendMaterial, this.output.material]) {
      const quad = new THREE.Mesh(geo, m);
      quad.frustumCulled = false;
      warm.add(quad);
    }
    let error: string | null = null;
    this.precompiling = true;
    this.doorRig.group.visible = true; // traverseVisible 才會編到門的材質
    // 其他之後才出現的東西（現場模式的光束、喇叭、管機）也一起編。compile 是同步走過看得見的物件，呼叫完就還原。
    // 燈不動：多一盞燈會讓所有材質的快取鍵都變
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.visible || (o as THREE.Light).isLight) return;
      hidden.push(o);
      o.visible = true;
    });
    const unhide = () => hidden.splice(0).forEach((o) => (o.visible = false));
    try {
      const jobs = [this.compileFor(this.scene, this.scene), this.compileFor(this.shadowStandIns(), this.scene), this.compileFor(warm, null)];
      unhide();
      await Promise.all(jobs);
      await this.warmPrograms();
    } catch (e) {
      error = String(e);
      throw e;
    } finally {
      unhide();
      this.precompiling = false;
      this.doorRig.group.visible = this.door.t > 0.0005 || this.door.to > 0;
      geo.dispose();
      if (import.meta.env.DEV) {
        window.__shaderLog!.pre = {
          at: Math.round(performance.now()),
          ms: Math.round(performance.now() - t0),
          error,
          parallel: this.renderer.extensions.has('KHR_parallel_shader_compile'),
          keys: (this.renderer.info.programs ?? []).map((p) => p.cacheKey),
        };
      }
    }
  }

  /**
   * 陰影貼圖是用 three 內部的深度材質畫的，不在場景裡。照 WebGLShadowMap.getDepthMaterial 的規則
   * （面向翻轉、沿用原材質的 map／alphaMap／alphaTest），每種投影組合做一個替身拿去預編。
   * 替身材質不 dispose：dispose 會把共用的 program 一起釋放掉。
   */
  private shadowStandIns(): THREE.Scene {
    const out = new THREE.Scene();
    const flip = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
    const seen = new Set<string>();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.castShadow) return;
      for (const m of [mesh.material].flat() as THREE.MeshStandardMaterial[]) {
        const side = m.shadowSide ?? flip[m.side];
        const key = [side, !!m.map, !!m.alphaMap, m.alphaTest > 0, Object.keys(mesh.geometry.attributes).join('|')].join();
        if (seen.has(key)) continue;
        seen.add(key);
        const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side, map: m.map ?? null, alphaMap: m.alphaMap ?? null, alphaTest: m.alphaTest });
        out.add(new THREE.Mesh(mesh.geometry, depth));
      }
    });
    return out;
  }

  /** 實際繪製是畫進 composer 的線性緩衝區，編譯也要用同一個目標，程式快取的 key 才會對上 */
  private compileFor(obj: THREE.Object3D, target: THREE.Scene | null): Promise<unknown> {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer?.readBuffer ?? null);
    try {
      return this.renderer.compileAsync(obj, this.camera, target);
    } finally {
      this.renderer.setRenderTarget(prev);
    }
  }

  /**
   * compileAsync 只等到 shader 編好。three 要到第一次畫某個 program 時才查錯誤訊息與 uniform／attribute 位置（onFirstUse），
   * 每一項都是同步等 GPU 行程回話的呼叫，全擠在第一格就變成一個長任務。先在這裡查掉，每 6 毫秒讓出一次主執行緒。
   * 查過的 program 會快取結果，重複呼叫不花時間。
   */
  private async warmPrograms(): Promise<void> {
    let slice = performance.now();
    for (const p of this.renderer.info.programs ?? []) {
      p.getUniforms();
      if (performance.now() - slice < 6) continue;
      await new Promise((r) => setTimeout(r));
      slice = performance.now();
    }
  }

  private uploads: { tex: THREE.Texture; done: () => void }[] = [];
  private uploaded = new WeakSet<THREE.Texture>();
  /** 圖載好、排過上傳了（載入失敗也算，免得翻牌永遠等）。翻牌換面前要看這個 */
  private settled = new WeakSet<THREE.Texture>();
  private draining = false;

  /**
   * three 要到第一次畫到某張貼圖才上傳（含解碼、產生 mipmap），畫面外的 CD 封面、相框照片會在第一次入鏡那一格一起上傳。
   * 這裡改成圖一載好就排隊，在畫格之間上傳，每 6 毫秒讓出一次主執行緒。resolve = 這批都傳完了。
   */
  private upload(root: THREE.Object3D | THREE.Texture, urgent = false): Promise<void> {
    const list = (root as THREE.Texture).isTexture ? [root as THREE.Texture] : texturesIn(root as THREE.Object3D);
    const jobs = list
      .filter((t) => !this.uploaded.has(t))
      .map((tex) =>
        whenLoaded(tex).then(
          () =>
            new Promise<void>((done) => {
              if (urgent) this.uploads.unshift({ tex, done });
              else this.uploads.push({ tex, done });
              void this.drain();
            }),
        ),
      );
    return Promise.all(jobs).then(() => {});
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    let slice = performance.now();
    while (this.uploads.length) {
      if (performance.now() - slice >= 6) {
        await new Promise((r) => setTimeout(r));
        slice = performance.now();
      }
      const { tex, done } = this.uploads.shift()!;
      if (tex.image && !this.uploaded.has(tex)) {
        this.renderer.initTexture(tex);
        this.uploaded.add(tex);
        if (import.meta.env.DEV && window.__glInfo) window.__glInfo.preUploaded++;
      }
      this.settled.add(tex);
      done();
    }
    this.draining = false;
  }

  private bakedMats = new Map<string, THREE.ShaderMaterial>();
  private mood: Mood = 'tipsy';
  private moodFade: { start: number } | null = null;
  private texCache = new Map<string, Promise<THREE.Texture>>();

  private moodTexture(mood: Mood, part: string): Promise<THREE.Texture> {
    const key = `${mood}_${part}`;
    if (!this.texCache.has(key)) {
      const url = new URL(`room/${key}.jpg`, document.baseURI).href;
      this.texCache.set(
        key,
        new THREE.TextureLoader().loadAsync(url).then(async (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.flipY = false; // glTF 的 UV 方向
          t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          await decoded(t);
          return t;
        }),
      );
    }
    return this.texCache.get(key)!;
  }

  /** 換場景：烘焙貼圖交融、即時燈光換色 */
  async setMood(mood: Mood, instant = false): Promise<void> {
    this.mood = mood;
    this.applyMoodLights(mood);
    this.sparkle?.setMood(mood);
    if (!this.bakedMats.size) return;
    const parts = { shell: 'shell', props: 'props', view: 'view' } as const;
    const loaded = await Promise.all(
      (Object.keys(parts) as (keyof typeof parts)[]).map(async (k) => [k, await this.moodTexture(mood, parts[k]).catch(() => null)] as const),
    );
    if (this.mood !== mood) return; // 等貼圖時又換了
    for (const [k, tex] of loaded) {
      const mat = this.bakedMats.get(k);
      if (!mat || !tex) continue;
      const u = mat.uniforms;
      if (instant || this.opts.reducedMotion || !u.mapA!.value) {
        u.mapA!.value = tex;
        u.mapB!.value = tex;
        u.mixT!.value = 1;
      } else {
        u.mapA!.value = u.mixT!.value >= 0.5 ? u.mapB!.value : u.mapA!.value;
        u.mapB!.value = tex;
        u.mixT!.value = 0;
      }
    }
    this.moodFade = instant || this.opts.reducedMotion ? null : { start: performance.now() };
  }

  private moodLights: { hemi?: THREE.HemisphereLight; spots: THREE.SpotLight[]; points: THREE.PointLight[]; marquee?: THREE.PointLight } = { spots: [], points: [] };

  // 開燈：power 0 = 暗場、1 = 開燈。各盞燈的基準強度在 MOOD_LIGHT，乘上增益後寫入只在 writeLights 一處
  private lightPower = 1;
  private lightGoal = 1;
  private lightStyle: LightStyle = import.meta.env.DEV ? parseLightStyle(new URLSearchParams(location.search).get('lightsOn')) : 'cascade';
  private lightAnim: { from: number; start: number } | null = null;
  private gains: LightGains = lightGains(1, 'cascade');
  private static readonly MARQUEE = 0.8;

  /** 開燈／關燈。instant 或減少動態時直接切換；已經朝同一個目標在走就不重來 */
  setLights(on: boolean, instant = false): void {
    document.documentElement.dataset.lights = on ? 'on' : 'off';
    const goal = on ? 1 : 0;
    if (!instant && !this.opts.reducedMotion && goal === this.lightGoal) return;
    this.lightGoal = goal;
    if (instant || this.opts.reducedMotion || goal === this.lightPower) {
      this.lightAnim = null;
      this.lightPower = goal;
      this.writeLights();
      return;
    }
    this.lightAnim = { from: this.lightPower, start: performance.now() };
  }

  get lightsOn(): boolean {
    return this.lightGoal === 1;
  }

  /** 每格推進 power，有變才重寫燈 */
  private tickLights(now: number): void {
    const a = this.lightAnim;
    if (!a) return;
    const t = Math.min(1, (now - a.start) / lightsDuration(this.lightStyle));
    this.lightPower = a.from + (this.lightGoal - a.from) * t;
    if (t >= 1) this.lightAnim = null;
    this.writeLights();
  }

  /** 即時燈強度 = 時段基準 × 開燈增益。換時段、開燈都走這裡，暗場不會被蓋掉 */
  private writeLights(): void {
    const m = MOOD_LIGHT[this.mood];
    const g = (this.gains = lightGains(this.lightPower, this.lightStyle));
    const { hemi, spots, points, marquee } = this.moodLights;
    if (hemi) hemi.intensity = m.hemi * g.hemi;
    const spotGain = [g.wall, g.deck, g.frame];
    spots.forEach((sp, i) => (sp.intensity = (m.spots[i] ?? 0) * (spotGain[i] ?? 1)));
    points.forEach((pt) => (pt.intensity = m.lampIntensity * g.lamp));
    if (marquee) marquee.intensity = Room.MARQUEE * g.marquee;
    this.writePosterLook();
  }

  /** 燈箱牆的光：自發光，跟著時段、開燈（g.frame）與放歌（wake）走 */
  private writePosterLook(): void {
    if (!this.posterRig) return;
    this.posterRig.look(boxLook(this.mood, this.gains.frame, this.wake));
  }

  private applyMoodLights(mood: Mood): void {
    const m = MOOD_LIGHT[mood];
    const { hemi, spots, points } = this.moodLights;
    if (hemi) {
      hemi.color.set(m.sky);
      hemi.groundColor.set(m.ground);
    }
    spots.forEach((sp) => sp.color.set(m.spot));
    points.forEach((pt) => pt.color.set(m.lamp));
    this.writeLights();
  }

  private baked = false;
  private stage: Stage;
  private sparkle: Sparkle;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private output: OutputPass;
  private levels: Levels = breathing(0);
  private feedFn: ((now: number, dt: number) => Levels) | null = null;
  private playing = false;

  private lights(): void {
    const hemi = new THREE.HemisphereLight(0xffe9cc, 0x2b2216, 0.55);
    this.scene.add(hemi);
    this.moodLights.hemi = hemi;
    const spot = (pos: [number, number, number], target: [number, number, number], intensity: number, angle: number, shadow = false) => { // taste-skill-ignore: 3D 場景的投影，不是 CSS 陰影
      const s = new THREE.SpotLight(ROOM.warmLight, intensity, 9, angle, 0.55, 1.4);
      s.position.set(...pos);
      s.target.position.set(...target);
      if (shadow) {
        s.castShadow = true;
        s.shadow.mapSize.set(1024, 1024);
        s.shadow.bias = -0.0004;
      }
      this.scene.add(s, s.target);
      this.moodLights.spots.push(s);
      return s;
    };
    spot([-1.6, 3.1, 0], [-4, 1.45, 0], 26, 0.75, true); // CD 牆
    spot([0.2, 3.1, -2.4], [0, 0.75, -3.66], 22, 0.5, true); // 唱盤
    spot([1.6, 3.1, 0], [4, 1.55, 0], 16, 0.7); // 相框
    const lamp = new THREE.PointLight(ROOM.bulb, 5, 5, 1.6);
    lamp.position.set(-1.05, 2.5, -1.1);
    this.scene.add(lamp);
    this.moodLights.points.push(lamp);
    // CD 牆柔光（說明見 cdSpot 欄位）
    this.cdSpot = new THREE.SpotLight(ROOM.warmLight, 0, 3.4, 0.17, 1, 1.5);
    this.cdSpot.position.set(-2.75, 2.9, 0);
    this.scene.add(this.cdSpot, this.cdSpot.target);
    this.cdHalo = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.95),
      new THREE.MeshBasicMaterial({ map: haloTexture(), color: 0xffb070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.cdHalo.rotation.y = Math.PI / 2; // 面向房間（+x），貼在 CD 櫃背板前、CD 後面
    this.scene.add(this.cdHalo);
    const marquee = new THREE.PointLight(ROOM.bulb, Room.MARQUEE, 3, 1.8);
    marquee.position.set(3.25, 2.4, -3.6);
    this.scene.add(marquee);
    this.moodLights.marquee = marquee;
  }

  private coverOf(id: string): THREE.Texture | null {
    const sm = this.data.tracks[id]?.sm;
    return sm ? photo(sm, this.renderer) : null;
  }

  private ready(tex: THREE.Texture | null): boolean {
    return !tex || this.settled.has(tex);
  }

  /** 開發模式用：看得見的 CD 裡，封面貼圖還沒載好上傳的有幾張 */
  private unreadyCovers(): number {
    return this.slots.filter((cd) => cd.mesh.visible && !this.ready(cd.front.map)).length;
  }

  /** 換上這個位子的新身分：封面、id、藝人 */
  private faceTo(cd: Cd, id: string): void {
    const map = this.coverOf(id);
    if ((map === null) !== (cd.front.map === null)) cd.front.needsUpdate = true;
    cd.front.map = map;
    cd.id = id;
    cd.artistIds = this.data.tracks[id]?.artistIds ?? [];
    cd.mesh.userData.id = id;
  }

  private makeCd(id: string, at: THREE.Vector3): Cd {
    const front = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.05, color: 0xffffff });
    // 面的順序：+x（封面朝房間）、-x、+y、-y、+z、-z
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(CD_D, CD_H, CD_W), [front, this.plastic, this.plastic, this.plastic, this.plastic, this.plastic]);
    mesh.rotation.order = 'ZYX'; // 先繞垂直軸翻，再往後靠：翻牌時傾斜角度留在牆的方向
    mesh.position.copy(at);
    mesh.rotation.z = -0.06; // 往後靠在背板上
    mesh.castShadow = true;
    const cd: Cd = { id, mesh, front, artistIds: [], home: at.clone(), flip: null, dim: 1, hover: 0, vacant: false, back: null };
    this.cdOfMesh.set(mesh, cd);
    this.faceTo(cd, id);
    this.scene.add(mesh);
    void this.upload(mesh);
    return cd;
  }

  private cdById(id: string): Cd | undefined {
    return this.slots.find((c) => c.id === id && c.flip?.kind !== 'exit' && !c.vacant);
  }

  /** 翻牌進行中（含等貼圖）。main.ts 靠它暫停捲動抽出 */
  get flipping(): boolean {
    return this.flipJob !== null;
  }

  /** 背景把三個時段的封面都排進上傳佇列：當下的先，另外兩個隔一下再排。切換時才不用等圖 */
  private async preloadCovers(): Promise<void> {
    const cap = SHELF.cols * SHELF.rows;
    const order = [this.range ?? DEFAULT_RANGE, ...RANGE_KEYS.filter((k) => k !== (this.range ?? DEFAULT_RANGE))];
    for (const k of order) {
      const texs = this.data.ranges[k].slice(0, cap).map((id) => this.coverOf(id)).filter((t): t is THREE.Texture => !!t);
      await Promise.all(texs.map((t) => this.upload(t)));
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  /**
   * 換時間範圍：每個位子原地翻牌，轉到側面時換成新時段的第 i 張，再轉回來。
   * 多出來的位子從側面翻進來，少掉的翻到側面就移除。翻牌中再切換就排隊，翻完接著翻。
   * instant = 直接換（開場、還沒顯示時）。
   */
  setRange(range: RangeKey, instant = false, cb: RangeCallbacks = {}): void {
    if (this.flipJob) {
      this.queued = { range, cb };
      return;
    }
    if (range === this.range) {
      cb.onMid?.();
      cb.onEnd?.();
      return;
    }
    const ids = this.data.ranges[range].slice(0, SHELF.cols * SHELF.rows);
    this.range = range;
    this.shelfOrder = ids;
    if (instant) {
      ids.forEach((id, i) => {
        const cd = this.slots[i];
        if (cd) this.faceTo(cd, id);
        else this.slots[i] = this.makeCd(id, slot(i));
      });
      for (const cd of this.slots.splice(ids.length)) this.remove(cd);
      cb.onMid?.();
      cb.onEnd?.();
      return;
    }
    const now = performance.now();
    const timing = this.opts.reducedMotion ? FLIP_INSTANT : FLIP_TIMING;
    const plan = flipPlan(this.slots.length, ids.length, SHELF.cols, timing);
    for (const p of plan) {
      const id = ids[p.index];
      let cd = this.slots[p.index];
      if (p.kind === 'enter') {
        cd = this.makeCd(id!, slot(p.index));
        cd.mesh.visible = false;
        cd.mesh.rotation.y = Math.PI / 2;
        this.slots[p.index] = cd;
      }
      const tex = id ? this.coverOf(id) : null;
      if (tex) void this.upload(tex, true);
      cd!.flip = { kind: p.kind, start: now + p.start, half: p.swapAt - p.start, dur: timing.dur, next: id ? { id, tex } : null, swapped: false };
    }
    this.flipJob = { cb, midAt: now + flipMidpoint(plan), midDone: false };
  }

  private tickFlip(cd: Cd, now: number): boolean {
    const f = cd.flip!;
    let el = now - f.start;
    if (el < 0) return false;
    if (!f.swapped && el >= f.half) {
      if (f.next && !this.ready(f.next.tex)) {
        // 新封面還沒好：停在側面等，不能讓黑色封面露出來
        f.start = now - f.half;
        el = f.half;
      } else {
        f.swapped = true;
        if (!f.next) return true;
        if (f.kind === 'turn') this.faceTo(cd, f.next.id);
        cd.mesh.visible = true;
      }
    }
    const t = f.dur ? el / f.dur : 1;
    if (f.swapped && t >= 1) {
      cd.mesh.rotation.y = 0;
      cd.flip = null;
    } else {
      cd.mesh.rotation.y = f.swapped ? flipAngle(t) : f.kind === 'enter' ? Math.PI / 2 : flipAngle(Math.min(t, 0.4999));
    }
    return false;
  }

  private finishFlip(now: number): void {
    const job = this.flipJob;
    if (!job) return;
    if (!job.midDone && now >= job.midAt) {
      job.midDone = true;
      job.cb.onMid?.();
    }
    if (this.slots.some((c) => c.flip)) return;
    if (!job.midDone) job.cb.onMid?.();
    this.flipJob = null;
    job.cb.onEnd?.();
    const q = this.queued;
    this.queued = null;
    if (q) this.setRange(q.range, false, q.cb);
  }

  private remove(cd: Cd): void {
    this.scene.remove(cd.mesh);
    cd.mesh.geometry.dispose();
    cd.front.dispose();
  }

  /** 讓 main.ts 不用自己載入 three 也能建立顏色 */
  colorCtor(): typeof THREE.Color {
    return THREE.Color;
  }

  /**
   * 開場短片（約 7 秒）：鏡頭在 CD 牆前 → 這張 CD 滑出、沿弧線飛到唱盤（鏡頭跟著）
   * → 落下、推近、唱臂放下開始轉 → 拉遠回到門口。開場期間鏡頭不跟捲動，結束後交還。
   * onLand：唱片放上去的那一刻；onEnd：回到門口。
   */
  introPlay(id: string, onLand: () => void, onEnd: () => void): void {
    const cd = this.cdById(id);
    const plan = planIntro(!!cd, this.opts.reducedMotion);
    const to = new THREE.Vector3(-0.05, 0.7 + 0.16, -3.66);
    const T = Room.T;
    const base = { id, onLand, onEnd, landed: false, waitUntil: Infinity };
    this.first = false;
    if (!plan.animate) {
      // 減少動態：不飛。直接進到「唱片已在唱盤上、針懸著」那一段，之後跟一般流程一樣等第一下互動才拉回門口
      const p = this.isPhone() ? CAMS.deck2!.phone : CAMS.deck2!.wide;
      this.camPos.set(...p.pos);
      this.camLook.set(...p.look);
      this.camera.fov = p.fov;
      this.intro = { ...base, start: performance.now() - (T.wait + T.slide + T.fly + T.zoom - 0.05) * 1000, flyer: null, temp: false, from: to.clone(), to };
      return;
    }
    let flyer: THREE.Mesh;
    let from: THREE.Vector3;
    let start = performance.now();
    if (cd) {
      flyer = cd.mesh.clone();
      flyer.material = (cd.mesh.material as THREE.Material[]).map((m) => m.clone());
      from = cd.mesh.position.clone();
    } else {
      // 歌不在牆上：用這首的封面臨時做一片，從第一格附近放大滑出；封面傳上 GPU 後才開始計時，免得飛一片黑的
      from = new THREE.Vector3(...tempStart(slot(0).toArray() as [number, number, number]));
      const tmp = this.makeCd(id, from);
      flyer = tmp.mesh;
      start = Infinity;
      void Promise.race([this.upload(flyer, true), new Promise((r) => setTimeout(r, 4000))]).then(() => {
        if (this.intro?.flyer === flyer) this.intro.start = performance.now();
      });
    }
    flyer.visible = false;
    this.scene.add(flyer);
    this.intro = { ...base, start, flyer, temp: !cd, from, to };
    // 轉盤之後鏡頭已經在 CD 牆前，從那裡平順轉向這張；沒有轉盤（直接呼叫）時才把鏡頭搬到牆前
    if (!this.cameFromRoulette) {
      const p = this.isPhone() ? phonePose('wall', this.camera.aspect) : CAMS.wall!.wide;
      this.camPos.set(...p.pos);
      this.camLook.set(from.x, from.y, from.z);
      this.camera.fov = p.fov;
    }
  }

  /**
   * 開場選片：鏡頭停在 CD 牆前（glideMs > 0 時從目前位置滑過去），柔光隨機停在一張候選 CD。只用牆上有、而且這個畫面看得到的那幾張
   * （手機鏡頭比較近，看得到的比較少）；看得到的不到 3 張就用全部候選。
   */
  startRoulette(ids: readonly string[], glideMs = 0): void {
    const p = this.isPhone() ? phonePose('wall', this.camera.aspect) : widePose('wall', this.camera.aspect);
    this.homeHold = false;
    // 看得到哪幾張：用 CD 牆的鏡頭姿勢算（鏡頭可能還在門口、正要滑過去）
    const probe = new THREE.PerspectiveCamera(p.fov, this.camera.aspect, this.camera.near, this.camera.far);
    probe.position.set(...p.pos);
    probe.lookAt(...p.look);
    probe.updateProjectionMatrix();
    probe.updateMatrixWorld();
    if (glideMs > 0 && !this.opts.reducedMotion) {
      // 開場對話結束：從門口慢慢滑到 CD 牆再開始挑
      this.glide = { start: performance.now(), dur: glideMs, from: { pos: this.camPos.toArray(), look: this.camLook.toArray(), fov: this.camera.fov }, to: p };
    } else {
      this.glide = null;
      this.camPos.set(...p.pos);
      this.camLook.set(...p.look);
      this.camera.fov = p.fov;
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
    }
    this.goalPos.set(...p.pos);
    this.goalLook.set(...p.look);
    this.goalFov = p.fov;
    const onWall = ids.filter((id) => this.cdById(id));
    const seen = onWall.filter((id) => {
      const v = this.cdById(id)!.home.clone().project(probe);
      return Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.8 && v.z < 1;
    });
    const pool = seen.length >= 3 ? seen : onWall;
    if (!pool.length) return;
    // 排成一條路：從隨機一張開始，每次走到最近、還沒走過的那張，光就沿著牆順順地移動，不會忽遠忽近
    const left = [...pool];
    const path = left.splice(Math.floor(Math.random() * left.length), 1);
    while (left.length) {
      const here = this.cdById(path.at(-1)!)!.home;
      let k = 0;
      left.forEach((id, i) => {
        if (this.cdById(id)!.home.distanceTo(here) < this.cdById(left[k]!)!.home.distanceTo(here)) k = i;
      });
      path.push(...left.splice(k, 1));
    }
    this.roulette = { ids: path, at: 0, lit: path[0]!, next: performance.now() + Room.STROLL_MS };
  }

  /**
   * 開場對話（主人口吻的自我介紹）期間：鏡頭固定在門口看整個房間，捲動不帶走鏡頭。
   * 對話結束呼叫 startRoulette(ids, glideMs) 才離開。
   */
  private homeHold = false;
  private glide: { start: number; dur: number; from: CamPose; to: CamPose } | null = null;
  holdHome(): void {
    const p = this.isPhone() ? phonePose('door', this.camera.aspect) : widePose('door', this.camera.aspect);
    this.homeHold = true;
    this.glide = null;
    this.camPos.set(...p.pos);
    this.goalPos.set(...p.pos);
    this.camLook.set(...p.look);
    this.goalLook.set(...p.look);
    this.camera.fov = this.goalFov = p.fov;
    this.first = false;
  }
  private tickGlide(now: number): void {
    const g = this.glide;
    if (!g) return;
    const t = Math.min(1, (now - g.start) / g.dur);
    const e = easeInOut(t);
    this.goalPos.set(...(g.from.pos.map((v, i) => v + (g.to.pos[i]! - v) * e) as [number, number, number]));
    this.goalLook.set(...(g.from.look.map((v, i) => v + (g.to.look[i]! - v) * e) as [number, number, number]));
    this.goalFov = g.from.fov + (g.to.fov - g.from.fov) * e;
    if (t >= 1) this.glide = null;
  }

  /** 停下轉盤，回傳停在哪張（沒有在轉 = null） */
  private cameFromRoulette = false;
  stopRoulette(): string | null {
    const r = this.roulette;
    this.roulette = null;
    this.cameFromRoulette = !!r;
    return r?.lit ?? null;
  }

  get rouletteRunning(): boolean {
    return this.roulette !== null;
  }

  /** 選片時每張停多久（毫秒）：光不再自己走，保留給 roulette.next 的初值 */
  private static readonly STROLL_MS = 1800;
  /**
   * 選片每格：光停在隨機挑的那一張，不自己往下跳（業主：「不用快速跳過，隨機照一張、引導使用者選」）。
   * 滑鼠指到牆上別張才跟過去；鏡頭還在從門口滑過來時不理滑鼠（鏡頭在動，滑鼠底下的 CD 會一直變，看起來像快速跳過）。
   */
  private stepRoulette(_now: number, pointed: Cd | null): Cd | null {
    const r = this.roulette!;
    const was = r.lit;
    r.lit = nextLit(r.lit, pointed?.id ?? null, !!this.glide);
    if (r.lit !== was || !r.told) {
      r.told = true;
      this.opts.onLit?.(r.lit);
    }
    return this.cdById(r.lit) ?? null;
  }

  /** 把開場用的飛行 CD 從場景拿掉；臨時做的那片連註冊與材質一起丟掉 */
  private dropFlyer(it: NonNullable<Room['intro']>): void {
    const f = it.flyer;
    if (!f) return;
    this.scene.remove(f);
    if (it.temp) {
      this.cdOfMesh.delete(f);
      f.geometry.dispose();
      (f.material as THREE.Material[]).forEach((m) => m !== this.plastic && m.dispose());
    }
  }

  /** 開場的 CD 落到唱盤上：換成這張的唱片，唱臂移到唱片上方、針懸著，等第一下互動才落針 */
  private landIntro(it: NonNullable<Room['intro']>): void {
    it.landed = true;
    this.dropFlyer(it);
    this.deckSlots = land(takeOff(this.deckSlots, it.id)); // 開場選的那張：牆上空出位置
    this.setLabel(it.id);
    this.hover = true;
    it.onLand();
  }

  /** 開場途中訪客捲動、點擊或按鍵：直接跳到結尾 */
  skipIntro(): void {
    const it = this.intro;
    if (!it) return;
    this.dropFlyer(it);
    this.intro = null;
    this.deckSlots = land(takeOff(this.deckSlots, it.id));
    this.setLabel(it.id);
    this.hover = true;
    if (!it.landed) it.onLand();
    it.onEnd();
  }

  get introRunning(): boolean {
    return this.intro !== null;
  }

  private intro: {
    start: number;
    /** null = 減少動態，不飛 */
    flyer: THREE.Mesh | null;
    /** flyer 是臨時做的（歌不在牆上） */
    temp: boolean;
    from: THREE.Vector3;
    to: THREE.Vector3;
    id: string;
    onLand: () => void;
    onEnd: () => void;
    landed: boolean;
    /** 落到唱盤後停住，Infinity = 一直等到 resumeIntro() */
    waitUntil: number;
  } | null = null;

  /** 訪客按了播放（或不想等了）：鏡頭繼續，拉回門口 */
  resumeIntro(): void {
    if (this.intro) this.intro.waitUntil = 0;
  }

  /** 開場最後退回哪個鏡頭：頁面第一區（main.ts 依有沒有唱盤段設定） */
  introHome = 'door';

  /** 開場的時間表（秒） */
  // 轉盤選定後才飛：wait／slide／fly 縮短（原本 0.7／0.6／2.2），點下去約 2 秒落盤出聲，還在瀏覽器准許出聲的時間內
  private static readonly T = { wait: 0.15, slide: 0.4, fly: 1.4, zoom: 1.1, hold: 1.4, back: 2.1 };

  private tickIntro(now: number): void {
    const it = this.intro;
    if (!it) return;
    const T = Room.T;
    let sec = (now - it.start) / 1000;
    const f = it.flyer!;
    const phone = this.isPhone();
    const pose = (n: string) => (phone ? CAMS[n]!.phone : widePose(n, this.camera.aspect));
    const v = (a: [number, number, number]) => new THREE.Vector3(...a);
    const mixPose = (a: CamPose, b: CamPose, k: number) => {
      // 位置直線內插；朝向用「方向」內插再固定注視距離，轉頭速度才會均勻
      const pa = v(a.pos);
      const pb = v(b.pos);
      const pos = pa.clone().lerp(pb, k);
      const da = v(a.look).sub(pa);
      const db = v(b.look).sub(pb);
      const dist = da.length() + (db.length() - da.length()) * k;
      const dir = da.normalize().lerp(db.normalize(), k).normalize();
      this.goalPos.copy(pos);
      this.goalLook.copy(pos).add(dir.multiplyScalar(dist));
      this.goalFov = a.fov + (b.fov - a.fov) * k;
    };
    const wallLook: CamPose = { ...pose('wall'), look: [it.from.x, it.from.y, it.from.z] };
    const slideOut = it.from.clone().add(new THREE.Vector3(0.35, 0.05, 0));
    const t1 = T.wait;
    const t2 = t1 + T.slide;
    const t3 = t2 + T.fly;
    const t4 = t3 + T.zoom;
    const t5 = t4 + T.hold;
    const t6 = t5 + T.back;

    // 跳格保護：畫面被蓋住或分頁暫停時這裡不會跑，回來時 sec 可能一口氣跳過落盤或等待段。
    // 過了落盤點還沒落盤就先補落盤；還沒放行（waitUntil）就停在等待段，不能自己走到結束
    if (sec >= t3 && !it.landed) this.landIntro(it);
    if (sec >= t4 && now < it.waitUntil) {
      it.start = now - t4 * 1000;
      sec = t4;
    }

    if (sec < t1) {
      mixPose(wallLook, wallLook, 0);
    } else if (sec < t2) {
      // 從牆上滑出來
      f.visible = true;
      this.deckSlots = takeOff(this.deckSlots, it.id); // 從牆上滑出的這一格起，牆上那張就不在了
      const k = smooth((sec - t1) / T.slide);
      f.position.copy(it.from).lerp(slideOut, k);
      if (it.temp) f.scale.setScalar(0.2 + 0.8 * k);
      mixPose(wallLook, wallLook, 0);
    } else if (sec < t3) {
      // 沿弧線飛到唱盤，鏡頭跟著轉過去
      const k = easeInOut((sec - t2) / T.fly);
      const mid = new THREE.Vector3((slideOut.x + it.to.x) / 2, Math.max(slideOut.y, it.to.y) + 0.7, (slideOut.z + it.to.z) / 2);
      const p = slideOut
        .clone()
        .multiplyScalar((1 - k) ** 2)
        .add(mid.clone().multiplyScalar(2 * k * (1 - k)))
        .add(it.to.clone().multiplyScalar(k * k));
      f.position.copy(p);
      // 封面（+x 面）往上翻到朝天、封面上緣朝房間後方：全程看得到封面、不倒。
      // 原本往另一邊翻，飛到六成就背對鏡頭，最後封面朝下落在唱盤上（模擬見 scratchpad fly.mjs）
      f.rotation.set(0, -k * Math.PI * 0.5, -0.06 + k * (Math.PI / 2 + 0.06));
      f.scale.setScalar(1 - k * 0.15);
      const d0 = pose('deck0');
      this.goalPos.copy(v(wallLook.pos).lerp(v(d0.pos), k));
      this.goalLook.copy(p); // 鏡頭一路盯著這張 CD
      this.goalFov = wallLook.fov + (d0.fov - wallLook.fov) * k;
    } else if (sec < t4) {
      // 落下、換成這張的唱片，推近
      if (!it.landed) this.landIntro(it);
      mixPose(pose('deck0'), pose('deck2'), easeInOut((sec - t3) / T.zoom));
    } else if (sec < t5) {
      // 停在唱盤上等第一下互動（沒有時限）：把時間軸凍在這一段的開頭
      if (now < it.waitUntil) it.start = now - t4 * 1000;
      mixPose(pose('deck2'), pose('deck2'), 0);
    } else if (sec < t6) {
      // 退回頁面第一區的鏡頭（有唱盤段就是 deck0，開場結束後捲動從那裡接手）
      mixPose(pose('deck2'), pose(this.introHome), easeInOut((sec - t5) / T.back));
    } else {
      const done = it.onEnd;
      this.intro = null;
      done();
    }
  }

  /* ---------- 放映室的門 ---------- */

  /** 門開到幾成（0 關、1 全開 = DOOR.maxAngle），ms 內走完；減少動態時直接到位 */
  setDoor(open: number, ms: number): void {
    const d = this.door;
    if (open > d.t && d.t <= 0.0005) this.sampleDoor();
    d.from = d.t;
    d.to = open;
    d.start = performance.now();
    d.dur = this.opts.reducedMotion ? 0 : ms;
  }

  doorAmount(): number {
    return this.door.t;
  }

  /** 滑鼠（或剛按下的觸控點）正指著門 */
  doorHovered(): boolean {
    return this.doorHover;
  }

  /** 點擊當下這一點打到哪張 CD、有沒有打到放映室的門。觸控沒有 hover，不能靠「上一格指著哪張」 */
  hitAt(clientX: number, clientY: number): { cd: string | null; door: boolean } {
    const p = this.toNdc(clientX, clientY, new THREE.Vector2());
    this.raycaster.setFromCamera(p, this.camera);
    const hit = this.raycaster.intersectObjects(this.slots.filter((c) => c.flip?.kind !== 'exit' && c.mesh.visible).map((c) => c.mesh), false)[0];
    const cd = hit ? (this.cdOfMesh.get(hit.object)?.id ?? null) : null;
    const door = !cd && this.door.to === 0 && Boolean(document.documentElement.dataset.cam?.startsWith('cinema')) && this.raycaster.intersectObject(this.doorRig.hit, false).length > 0;
    return { cd, door };
  }

  /** 鏡頭從目前位置往門洞推近。推到定位就停住，等 endDive() */
  dive(ms: number): void {
    const end = diveEnd({ pos: this.camPos.toArray(), look: this.camLook.toArray(), fov: this.camera.fov });
    this.dive_ = {
      start: performance.now(),
      dur: ms,
      fromPos: this.camPos.clone(),
      fromLook: this.camLook.clone(),
      fromFov: this.camera.fov,
      toPos: new THREE.Vector3(...end.pos),
      toLook: new THREE.Vector3(...end.look),
      toFov: end.fov,
    };
  }

  /**
   * 從放映室回來：鏡頭從 dive() 的終點開始、camMs 內拉回出口那一格，門從全開 doorMs 內關上。
   * 減少動態時什麼都不做：門本來就關著，鏡頭由捲動直接到位。
   */
  returnFromScreening(camMs: number, doorMs: number): void {
    if (this.opts.reducedMotion) return;
    const to = this.isPhone() ? CAMS.cinema!.phone : CAMS.cinema!.wide;
    const from = diveEnd(to);
    this.first = false;
    this.camPos.set(...from.pos);
    this.camLook.set(...from.look);
    this.camera.fov = from.fov;
    this.dive_ = {
      start: performance.now(),
      dur: camMs,
      fromPos: new THREE.Vector3(...from.pos),
      fromLook: new THREE.Vector3(...from.look),
      fromFov: from.fov,
      toPos: new THREE.Vector3(...to.pos),
      toLook: new THREE.Vector3(...to.look),
      toFov: to.fov,
      release: true,
    };
    this.sampleDoor();
    this.door.t = 1;
    this.setDoor(0, doorMs);
  }

  /** 結束推近，鏡頭回到跟著捲動（從 bfcache 返回時用） */
  endDive(): void {
    this.dive_ = null;
  }

  private tickDive(now: number): void {
    const v = this.dive_;
    if (!v) return;
    const e = smooth(clamp01((now - v.start) / v.dur));
    this.goalPos.copy(v.fromPos).lerp(v.toPos, e);
    this.goalLook.copy(v.fromLook).lerp(v.toLook, e);
    this.goalFov = v.fromFov + (v.toFov - v.fromFov) * e;
    if (v.release && now - v.start >= v.dur) this.dive_ = null;
  }

  private tickDoor(now: number): void {
    const d = this.door;
    const moving = d.t !== d.to;
    if (moving) {
      const k = d.dur ? clamp01((now - d.start) / d.dur) : 1;
      // 推開：先快後慢；關上：慢慢帶回來
      const e = d.to > d.from ? 1 - (1 - k) ** 3 : smooth(k);
      d.t = k >= 1 ? d.to : d.from + (d.to - d.from) * e;
    }
    const rig = this.doorRig;
    const show = d.t > 0.0005 || d.to > 0;
    rig.group.visible = show || this.precompiling;
    if (show) {
      rig.hinge.rotation.y = d.t * DOOR.maxAngle; // 正角度 = 往牆後（-z）開
      const glow = (rig.glow.material as THREE.MeshBasicMaterial).color;
      if (rig.glow.userData.photo) {
        // 門洞是放映室的照片：開門時從暗慢慢亮到原色，只留一點暖，不要超過 1 免得照片被泛光吃掉
        const m = 0.25 + 0.75 * d.t;
        glow.setRGB(1.0 * m, 0.94 * m, 0.86 * m);
      } else {
        const m = 0.35 + 0.95 * d.t + 0.05 * Math.sin(now / 90);
        glow.setRGB(1.3 * m, 0.72 * m, 0.38 * m); // 紅要明顯大於綠，不然超過 1 被截平後會變黃綠
      }
    }
    const state = d.t <= 0.0005 && !moving && d.to === 0 ? 'closed' : d.t !== d.to ? (d.to > d.t ? 'opening' : 'closing') : d.t >= 0.999 ? 'open' : 'ajar';
    const ds = document.documentElement.dataset;
    if (ds.door !== state) ds.door = state;
    const tt = d.t.toFixed(1);
    if (ds.doorT !== tt) ds.doorT = tt;
  }

  /**
   * 開門當下從烘焙貼圖取樣門板顏色，讓疊上去的 live 門板跟烘焙門看起來一樣。
   * 射線打到烘焙的門，用命中的 UV 到當下心情的貼圖上取 4×4 像素平均；取不到就用 #5e2219。
   */
  private sampleDoor(): void {
    const fallback = 0x5e2219;
    const rig = this.doorRig;
    const read = (x: number, y: number): THREE.Color => {
      try {
        if (!this.bakedRoot) throw new Error('no baked');
        this.raycaster.set(new THREE.Vector3(x, y, -3.0), new THREE.Vector3(0, 0, -1));
        const hit = this.raycaster.intersectObject(this.bakedRoot, true)[0];
        const mat = (hit?.object as THREE.Mesh | undefined)?.material as THREE.ShaderMaterial | undefined;
        const tex = mat?.uniforms.mapB?.value as THREE.Texture | null | undefined;
        const img = tex?.image as CanvasImageSource & { width: number; height: number };
        if (!hit?.uv || !img) throw new Error('no hit');
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, hit.uv.x * img.width - 2, hit.uv.y * img.height - 2, 4, 4, 0, 0, 1, 1);
        const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
        return new THREE.Color().setRGB(r! / 255, gg! / 255, b! / 255, THREE.SRGBColorSpace);
      } catch {
        return new THREE.Color(fallback);
      }
    };
    (rig.slab.uniforms.base!.value as THREE.Color).copy(read(3.25, 1.02));
    (rig.panels[0]!.uniforms.base!.value as THREE.Color).copy(read(3.25, 0.55));
    (rig.panels[1]!.uniforms.base!.value as THREE.Color).copy(read(3.25, 1.5));
  }

  setLive(mode: LiveMode): void {
    this.stage.setMode(mode);
  }

  setLiveColor(c: THREE.Color): void {
    this.stage.setColor(c);
  }

  /** 每一格要讀的音量來源（麥克風）；null = 慢呼吸 */
  setFeed(fn: ((now: number, dt: number) => Levels) | null): void {
    this.feedFn = fn;
  }

  /** 聲音真的出來（或停了）。從靜到響的那一下會觸發一次「點亮」 */
  setPlaying(on: boolean): void {
    if (on && !this.playing) this.surge = 1;
    if (on) this.hover = false;
    if (!on && this.playing) this.cueing = false; // 暫停：抬針、收臂
    this.playing = on;
  }

  /**
   * 訪客按了播放：唱盤開始轉、唱臂移到唱片上再放針。
   * 針碰到唱片時 resolve（呼叫端不等它就送出播放：Spotify 出聲本來就慢約 0.5 秒，跟落針剛好對上）。
   * 畫面沒在算圖（被實色區塊蓋住、分頁在背景）時，最多等 2.5 秒就放行。
   */
  cue(): Promise<void> {
    this.cueing = true;
    this.cueUntil = performance.now() + 9000; // 一直沒聲音就把唱臂收回去
    if (this.needleDown()) return Promise.resolve();
    return new Promise((resolve) => {
      this.needleWaiters.push(resolve);
      setTimeout(resolve, 2500);
    });
  }

  private static readonly ARM_PARK = 0.15;
  private static readonly ARM_PLAY = -0.38;
  private needleDown(): boolean {
    return this.lift < 0.06 && Math.abs(this.armAngle - Room.ARM_PLAY) < 0.02;
  }
  /** 0 → 1：有聲音時房間醒過來的程度 */
  private wake = 0;
  /** 1 → 0：剛出聲那一下的湧光，約 1.5 秒退掉 */
  private surge = 0;
  /** 唱片轉速（弧度／秒），起轉、停轉都有慣性 */
  private spinVel = 0;

  setFocusArtist(id: string | null): void {
    this.focusArtist = id;
  }

  private setLabel(id: string): void {
    const t = this.data.tracks[id];
    const mat = this.deck.label.material;
    // 放上新唱片時把封面轉正：spin 一直累加，不歸零的話新封面會接著上一張停下的角度，常常是倒的
    if (!this.spinning) {
      this.spin = 0;
      this.spinVel = 0;
      this.deck.record.rotation.y = 0;
    }
    if (t?.lg) {
      mat.map = photo(t.lg, this.renderer);
      mat.color.set(0xffffff);
    } else {
      mat.map = null;
      mat.color.set(ROOM.tan);
    }
    mat.needsUpdate = true;
  }

  /** 換唱片：唱臂先離開，唱片抬起換貼紙再放下，唱臂回到唱片上開始轉 */
  play(id: string): void {
    this.hover = false;
    const lg = this.data.tracks[id]?.lg;
    if (lg) void this.upload(photo(lg, this.renderer)); // 換片動畫 0.7 秒後才貼上，先傳好
    if (this.opts.reducedMotion) {
      this.setLabel(id);
      return;
    }
    this.swap = { start: performance.now(), next: id };
  }

  private static readonly FLY = { slide: 0.25, fly: 1.0 };
  private static readonly DECK_AT = new THREE.Vector3(-0.05, 0.7 + 0.16, -3.66);

  /**
   * 所有播放入口共用：CD 從牆上拿下 → 沿弧線飛到唱盤 → 落下換標籤（約 1.25 秒）。鏡頭不動。
   * 牆上沒有這張（換了時段、或不在這面牆）就用臨時的 CD 從第一格附近放大飛出，跟開場一樣。
   * 減少動態：直接換片。已在唱盤上或已在飛的同一首：什麼都不做、回傳 false（呼叫端照舊只管播放）。
   * 落盤之前唱臂維持收著，落盤後才接 cue() 的轉盤與落針；聲音不等這些（見 main.ts listenTo）。
   */
  takeAndPlay(id: string): boolean {
    if (this.deckSlots.deck === id || this.deckSlots.flying === id) return false;
    this.hover = false;
    const lg = this.data.tracks[id]?.lg;
    if (lg) void this.upload(photo(lg, this.renderer)); // 落盤時要貼，先傳好
    if (this.opts.reducedMotion) {
      this.deckSlots = land(takeOff(this.deckSlots, id));
      this.setLabel(id);
      return true;
    }
    if (this.flight) this.landFlight(); // 連點：前一張直接落下，再飛新的
    this.swap = null;
    const cd = this.cdById(id);
    const map = cd ? cd.front.map : this.coverOf(id);
    const front = (this.flyMesh.material as THREE.MeshStandardMaterial[])[0]!;
    if ((map === null) !== (front.map === null)) front.needsUpdate = true;
    front.map = map;
    const from = cd ? cd.mesh.position.clone() : new THREE.Vector3(...tempStart(slot(0).toArray() as [number, number, number]));
    const fl = { id, start: performance.now(), from, temp: !cd };
    this.flight = fl;
    this.deckSlots = takeOff(this.deckSlots, id);
    if (!cd && map) {
      // 臨時 CD：封面傳上 GPU 後才開始計時，免得飛一片黑的（最多等 4 秒）
      fl.start = Infinity;
      void Promise.race([this.upload(map, true), new Promise((r) => setTimeout(r, 4000))]).then(() => {
        if (this.flight === fl) fl.start = performance.now();
      });
    }
    return true;
  }

  private landFlight(): void {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    this.flyMesh.visible = false;
    this.flyMesh.scale.setScalar(1);
    this.deckSlots = land(this.deckSlots); // 唱盤上換成這張，上一張才放回牆上
    this.setLabel(f.id);
  }

  private tickFlight(now: number): void {
    const f = this.flight;
    if (!f) return;
    const sec = (now - f.start) / 1000;
    if (!(sec >= 0)) return;
    const { slide, fly } = Room.FLY;
    const m = this.flyMesh;
    const to = Room.DECK_AT;
    const slideOut = f.from.clone().add(new THREE.Vector3(0.35, 0.05, 0));
    m.visible = true;
    if (sec < slide) {
      const k = smooth(sec / slide);
      m.position.copy(f.from).lerp(slideOut, k);
      m.rotation.set(0, 0, -0.06);
      m.scale.setScalar(f.temp ? 0.2 + 0.8 * k : 1);
    } else if (sec < slide + fly) {
      const k = easeInOut((sec - slide) / fly);
      const mid = new THREE.Vector3((slideOut.x + to.x) / 2, Math.max(slideOut.y, to.y) + 0.7, (slideOut.z + to.z) / 2);
      m.position.copy(slideOut).multiplyScalar((1 - k) ** 2).add(mid.multiplyScalar(2 * k * (1 - k))).add(to.clone().multiplyScalar(k * k));
      m.rotation.set(0, -k * Math.PI * 0.5, -0.06 + k * (Math.PI / 2 + 0.06)); // 同開場：封面朝上落盤
      m.scale.setScalar(1 - k * 0.15);
    } else {
      this.landFlight();
    }
  }

  /** 診斷用（.aside/diag-fly.js）：飛行狀態、牆上每個位子藏不藏、鏡頭位置 */
  debugFly(): { deck: string | null; flying: string | null; flyerVisible: boolean; wall: { id: string; visible: boolean; back: boolean }[]; cam: number[] } {
    return {
      deck: this.deckSlots.deck,
      flying: this.deckSlots.flying,
      flyerVisible: this.flyMesh.visible,
      wall: this.slots.map((c) => ({ id: c.id, visible: c.mesh.visible, back: c.back !== null })),
      cam: this.camera.position.toArray(),
    };
  }

  /** 由捲動算出的攝影機目標 */
  aim(pose: CamPose): void {
    if (this.intro || this.roulette || this.dive_ || this.homeHold || this.glide) return;
    this.goalPos.set(...pose.pos);
    this.goalLook.set(...pose.look);
    this.goalFov = pose.fov;
    if (this.first || this.opts.reducedMotion) {
      this.camPos.copy(this.goalPos);
      this.camLook.copy(this.goalLook);
      this.camera.fov = this.goalFov;
      this.first = false;
    }
  }

  /**
   * 算滑鼠指到哪張 CD。要在選片之前算：以前放在 tick() 裡，main.ts 的選片在 tick 之前跑，
   * 拿到的永遠是上一格的結果，快速掃過時發光那張慢一格（2026-11-09 diag-cdlight 連兩輪 2/9 步沒跟上）
   */
  pickPointer(): void {
    this.pickedThisFrame = true;
    this.pointed = null;
    if (!this.pointerActive) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.slots.filter((c) => c.flip?.kind !== 'exit' && c.mesh.visible).map((c) => c.mesh), false)[0];
    if (hit) this.pointed = this.cdOfMesh.get(hit.object) ?? null;
  }

  setPointer(clientX: number, clientY: number, active: boolean): void {
    this.pointerActive = active;
    this.pointerAt = performance.now();
    this.toNdc(clientX, clientY, this.pointer);
  }

  /** 點擊時回傳被點到的 CD */
  /** 牆上 CD 的順序（目前的時間範圍），捲動挑 CD 用 */
  shelfIds(): readonly string[] {
    return this.shelfOrder;
  }

  /** CD 牆柔光：選中的那張有光，換一張時光滑過去；沒選（不在 CD 牆）就淡掉。放歌時跟低音輕輕呼吸 */
  private updateCdLight(dt: number): void {
    const cd = this.hovered;
    // 選片時光慢慢滑過去；平常跟滑鼠要快（時間常數約 33ms，停手 120ms 剩不到 3%），快速掃過時光才不會落在好幾張後面
    // 速率 20 時 diag-cdlight 量到停手 120ms 還偏 3.7cm（2026-11-09）
    const k = 1 - Math.exp(-dt * (this.roulette ? 2.4 : 30));
    if (cd) {
      if (this.cdLightAmt < 0.02) this.cdLightAt.copy(cd.home); // 從暗處亮起時直接出現在那張，不從上一次的位置滑過來
      else this.cdLightAt.lerp(cd.home, this.opts.reducedMotion ? 1 : k);
    }
    this.cdLightAmt += ((cd ? 1 : 0) - this.cdLightAmt) * (1 - Math.exp(-dt * 4));
    const a = this.cdLightAmt;
    const breath = 1; // 不跟低音呼吸（重低音特效 2026-11-08 拿掉）
    const moodK = CD_LIGHT_MOOD[this.mood];
    const p = this.cdLightAt;
    this.cdSpot.target.position.set(p.x, p.y, p.z);
    this.cdSpot.position.set(-2.75, p.y + 1.1, p.z + 0.15);
    this.cdSpot.intensity = a * 9 * breath * moodK;
    this.cdHalo.position.set(SHELF.x - 0.015, p.y, p.z); // 背板（-3.95）與 CD 背面（-3.932）之間
    this.cdHalo.material.opacity = a * 0.9 * moodK;
    // 不超過 1：加法疊在 CD 上，推過 1 會直接爆白（渲染器沒有色調映射）
    this.cdHalo.material.color.setRGB(1.0 * breath, 0.66 * breath, 0.34 * breath);
  }

  /** 捲動挑 CD：指定抽出哪一張；null = 不在 CD 牆這段 */
  setScrub(id: string | null): void {
    this.scrubId = id;
  }

  /** 滑鼠底下那張 CD（沒有就 null） */
  pointedId(): string | null {
    return this.pointed?.id ?? null;
  }

  pick(): string | null {
    return this.hovered?.id ?? null;
  }

  setRunning(on: boolean): void {
    this.running = on;
    if (on) this.last = performance.now();
  }

  /** 把目前的畫質等級套到渲染器。陰影只縮貼圖尺寸，不換類型，免得所有材質重新編譯 */
  private applyQuality(initial = false): void {
    const l = LEVELS[this.quality.level]!;
    const pr = Math.min(window.devicePixelRatio, l.pixelRatio);
    // 像素密度沒變就不重配緩衝區：setSize 會在這一格同步重建 composer 與泛光的所有 render target
    const resize = initial || pr !== this.renderer.getPixelRatio();
    if (resize) {
      this.renderer.setPixelRatio(pr);
      this.composer.setPixelRatio(pr);
    }
    this.bloom.enabled = l.bloom;
    for (const s of this.moodLights.spots) {
      if (!s.castShadow || s.shadow.mapSize.x === l.shadowMap) continue;
      s.shadow.mapSize.set(l.shadowMap, l.shadowMap);
      s.shadow.map?.dispose();
      s.shadow.map = null;
    }
    document.documentElement.dataset.quality = l.name;
    if (resize) this.resize(true);
  }

  /** 收集全速畫格的間隔，湊滿一個窗口就交給控制器判斷 */
  private sampleFrame(now: number, fullSpeed: boolean): void {
    if (!fullSpeed) {
      this.prevFast = false;
      return;
    }
    if (this.prevFast) this.qualityFrames.push(now - this.last);
    this.prevFast = true;
    if (this.qualityFrames.length < WINDOW_FRAMES) return;
    if (this.qualityForced) {
      this.qualityFrames = [];
      return;
    }
    const next = stepQuality(this.quality, {
      frames: this.qualityFrames,
      hidden: document.hidden,
      sinceLoadMs: now,
      dpr: window.devicePixelRatio,
    });
    this.qualityFrames = [];
    const changed = next.level !== this.quality.level;
    this.quality = next;
    if (changed) {
      this.applyQuality();
      this.prevFast = false;
    }
  }

  /**
   * 畫布外層（.stage）的大小：CSS 用 100lvh，Android 網址列收放時不變。
   * 不能用 innerHeight：來回快速滑動時網址列一收一放就 resize 一次，每次同步重建 composer 與泛光的 render target，
   * 業主的 Sony Xperia 1 在演唱會牆來回滑動會卡（2026-11-09）
   */
  private stageSize(): { w: number; h: number } {
    const el = this.canvas.parentElement ?? this.canvas;
    return { w: el.clientWidth || window.innerWidth, h: el.clientHeight || window.innerHeight };
  }
  private sized = { w: 0, h: 0 };

  /** 指標座標換成畫布的 NDC（畫布比視窗高時，用 innerHeight 換算會偏掉） */
  private toNdc(clientX: number, clientY: number, out: THREE.Vector2): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return out.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  resize(force = false): void {
    const { w, h } = this.stageSize();
    // 大小沒變就不重建緩衝區（像素密度變了由呼叫端傳 force）
    if (!force && w === this.sized.w && h === this.sized.h) return;
    this.sized = { w, h };
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.bloom?.setSize(Math.round(w / 2), Math.round(h / 2));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  isPhone(): boolean {
    return window.innerWidth / window.innerHeight < 0.8;
  }

  /** 這一格的狀態：有沒有動畫在跑、還有多少東西沒追到目標 */
  private pace(now: number): PaceState {
    let moving = !!this.intro || !!this.glide || !!this.roulette || !!this.swap || !!this.flight || !!this.moodFade || !!this.lightAnim || this.playing || this.cueing || !!this.dive_ || this.door.t !== this.door.to;
    let residual = Math.max(
      this.camPos.distanceTo(this.goalPos),
      this.camLook.distanceTo(this.goalLook),
      Math.abs(this.goalFov - this.camera.fov),
      Math.abs(this.armGoal - this.armAngle),
      Math.abs(this.liftGoal - this.lift),
      Math.abs(this.spinVel),
      this.wake,
      this.surge,
    );
    if (this.flipJob) moving = true;
    for (const cd of this.slots) {
      residual = Math.max(residual, Math.abs((this.hovered === cd ? 1 : 0) - cd.hover), Math.abs(this.dimGoal(cd) - cd.dim), cd.back !== null ? 1 : 0);
    }
    return { busy: moving, residual, now, pointerAt: this.pointerAt };
  }

  private dimGoal(cd: Cd): number {
    return this.focusArtist && !cd.artistIds.includes(this.focusArtist) ? 0.22 : 1;
  }

  tick(now: number): void {
    if (!this.running) {
      this.last = now;
      return;
    }
    // 閒置時降格率：還沒到時間就跳過這格，dt 留到下一次真的畫時一起算
    // 減 4 毫秒是容許 requestAnimationFrame 的時間誤差，60Hz 時剛好每 3 格畫 1 格
    const gap = frameGap(this.pace(now));
    if (now - this.last < gap - 4) return;
    this.sampleFrame(now, gap === 0);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    if (this.moodFade) {
      const t = Math.min(1, (now - this.moodFade.start) / 1200);
      const e = t * t * (3 - 2 * t);
      for (const mat of this.bakedMats.values()) mat.uniforms.mixT!.value = e;
      if (t >= 1) this.moodFade = null;
    }

    this.tickLights(now);

    // 攝影機往目標慢慢靠
    // 開場腳本先算這一格的鏡頭位置，鏡頭再更新，才不會慢一格
    this.tickIntro(now);
    // 先記住這一格開始時還在不在滑：tickGlide 在最後一格會把 glide 清掉，若用清掉後的值，最後一格改成平滑追，低幀率時鏡頭會多飄一段
    const gliding = !!this.glide;
    this.tickGlide(now);
    this.tickDive(now);
    this.tickDoor(now);

    // 開場的路徑本身已經有緩動，直接照走；平常跟著捲動時才慢慢追
    const k = this.opts.reducedMotion || this.intro || this.dive_ || gliding ? 1 : 1 - Math.exp(-dt * 6);
    this.camPos.lerp(this.goalPos, k);
    this.camLook.lerp(this.goalLook, k);
    this.camera.fov += (this.goalFov - this.camera.fov) * k;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();

    // 滑鼠指到哪張 CD：main.ts 每格在選片（scrubUpdate）之前呼叫 pickPointer()；沒呼叫過的格（例如沒有選片的頁面）在這裡補算
    if (!this.pickedThisFrame) this.pickPointer();
    this.pickedThisFrame = false;
    this.hovered = this.pointed;
    // 在 CD 牆（有選中的那張）時抽出選中的，不抽滑鼠經過的：字幕講的跟亮的才會是同一張
    if (this.scrubId) this.hovered = this.cdById(this.scrubId) ?? this.hovered;
    if (this.roulette) this.hovered = this.stepRoulette(now, this.hovered);
    // 滑鼠指到放映室的門（只有鏡頭在出口時才算）
    this.doorHover = false;
    if (this.pointerActive && !this.hovered && this.door.to === 0 && document.documentElement.dataset.cam?.startsWith('cinema')) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      this.doorHover = this.raycaster.intersectObject(this.doorRig.hit, false).length > 0;
    }
    this.canvas.style.cursor = this.pointed || this.doorHover ? 'pointer' : ''; // 手指形只在滑鼠真的在 CD 或門上
    // 發光（抽出來）的是哪張，給手機稽核比對字幕用；只在換張時寫
    const lit = this.hovered?.id ?? '';
    if (this.canvas.dataset.lit !== lit) this.canvas.dataset.lit = lit;
    this.updateCdLight(dt);

    if (this.hiddenFor !== this.deckSlots) {
      this.hiddenFor = this.deckSlots;
      this.hiddenSet = hiddenIds(this.deckSlots);
    }
    let gone = false;
    for (const cd of this.slots) {
      if (cd.flip && this.tickFlip(cd, now)) {
        this.remove(cd);
        cd.flip = { ...cd.flip, kind: 'exit' };
        gone = true;
        continue;
      }
      cd.mesh.position.copy(cd.home);
      // 正在放的那張不在牆上；換歌後上一張放回：在畫面內就輕輕滑回（0.6 秒），不在畫面內直接歸位。翻牌中不另外滑
      const vac = this.hiddenSet.has(cd.id);
      if (vac) cd.mesh.visible = false;
      else if (cd.vacant) {
        cd.mesh.visible = !(cd.flip?.kind === 'enter' && !cd.flip.swapped);
        if (!cd.flip && !this.opts.reducedMotion) {
          this.camera.updateMatrixWorld();
          const ndc = cd.home.clone().project(this.camera);
          if (Math.abs(ndc.x) < 1.1 && Math.abs(ndc.y) < 1.1 && ndc.z < 1) cd.back = now;
        }
      }
      cd.vacant = vac;
      if (cd.back !== null) {
        const bk = smooth(Math.min(1, (now - cd.back) / 600));
        cd.mesh.position.x += (1 - bk) * 0.35;
        cd.mesh.position.y += (1 - bk) * 0.05;
        if (bk >= 1) cd.back = null;
      }
      const hoverGoal = this.hovered === cd ? 1 : 0;
      cd.hover += (hoverGoal - cd.hover) * (this.opts.reducedMotion ? 1 : 1 - Math.exp(-dt * 14));
      cd.mesh.position.x += cd.hover * 0.07;
      cd.mesh.rotation.z = -0.06 + cd.hover * 0.06;
      cd.dim += (this.dimGoal(cd) - cd.dim) * (1 - Math.exp(-dt * 5));
      cd.front.color.setScalar(cd.dim);
    }
    if (gone) this.slots = this.slots.filter((c) => !(c.flip?.kind === 'exit' && c.flip.swapped));
    this.finishFlip(now);
    this.tickFlight(now);

    // 換唱片的流程（約 1.6 秒）
    if (this.swap) {
      const s = (now - this.swap.start) / 1000;
      const rec = this.deck.record;
      // 換片時唱針一定抬著、唱臂收回架上
      this.spinning = false;
      this.liftGoal = 1;
      this.armGoal = this.lift > 0.9 ? Room.ARM_PARK : this.armAngle;
      const lift = s < 0.35 ? 0 : s < 0.7 ? smooth((s - 0.35) / 0.35) : s < 0.85 ? 1 : s < 1.2 ? 1 - smooth((s - 0.85) / 0.35) : 0;
      rec.position.y = 0.111 + lift * 0.12;
      if (s >= 0.7 && rec.userData.next !== this.swap.next) {
        rec.userData.next = this.swap.next;
        this.setLabel(this.swap.next);
      }
      if (s > 1.6) this.swap = null;
    } else if (this.flight) {
      // CD 還在飛：唱盤先不轉、唱臂收著，落盤後才轉起來落針
      this.spinning = false;
      this.liftGoal = 1;
      this.armGoal = this.lift > 0.9 ? Room.ARM_PARK : this.armAngle;
    } else {
      if (this.cueing && !this.playing && now > this.cueUntil) this.cueing = false;
      if (this.playing || this.cueing) {
        // 開始：唱盤先轉，唱臂移到唱片上方，到位了才放針
        this.spinning = !this.opts.reducedMotion;
        this.armGoal = Room.ARM_PLAY;
        this.liftGoal = Math.abs(this.armAngle - Room.ARM_PLAY) < 0.02 ? 0 : 1;
      } else if (this.hover) {
        // 開場懸針：唱臂移到唱片上方，針抬著不落
        this.spinning = false;
        this.armGoal = Room.ARM_PLAY;
        this.liftGoal = 1;
      } else {
        // 停止：先抬針，抬起來了才把唱臂收回架上
        this.spinning = false;
        this.liftGoal = 1;
        this.armGoal = this.lift > 0.9 ? Room.ARM_PARK : this.armAngle;
      }
    }
    const ease = (rate: number) => 1 - Math.exp(-dt * rate);
    this.wake += ((this.playing ? 1 : 0) - this.wake) * ease(2);
    // 放歌時燈箱降到約 30%，讓唱片與 ON AIR 當主角
    if (this.posterRig && Math.abs(this.wake - this.posterWake) > 0.003) {
      this.posterWake = this.wake;
      this.writePosterLook();
    }
    this.surge *= Math.exp(-dt * 1.8);
    this.lift += (this.liftGoal - this.lift) * ease(9);
    this.armAngle += (this.armGoal - this.armAngle) * ease(5);
    this.deck.arm.rotation.y = this.armAngle;
    this.deck.arm.rotation.x = -0.09 * this.lift; // 負值 = 唱頭往上抬
    if (this.needleWaiters.length && this.needleDown()) this.needleWaiters.splice(0).forEach((f) => f());
    const hovering = this.hover && !this.playing && !this.cueing;
    this.stage.blink = hovering;
    const needle = this.needleDown() ? 'down' : hovering && this.lift > 0.9 && Math.abs(this.armAngle - Room.ARM_PLAY) < 0.03 ? 'hover' : 'moving';
    const onair = this.playing ? 'on' : hovering ? 'blink' : 'off';
    const ds = document.documentElement.dataset;
    if (ds.needle !== needle) ds.needle = needle;
    if (ds.onair !== onair) ds.onair = onair;
    const rpm33 = (33.3 / 60) * Math.PI * 2;
    this.spinVel += ((this.spinning ? rpm33 : 0) - this.spinVel) * ease(this.spinning ? 1.4 : 2.2);
    this.spin += dt * this.spinVel;
    this.deck.record.rotation.y = -this.spin;

    // 跑馬燈：燈泡輪流亮，減少動態時全亮
    this.bulbs.forEach((b, i) => {
      const m = b.material as THREE.MeshStandardMaterial;
      // 開門時燈泡跑得快一點，像在招手
      const step = this.door.to > 0 ? 90 : 260;
      m.emissiveIntensity = this.opts.reducedMotion ? 0.45 : 0.18 + (Math.floor(now / step + i / 2) % 3 === 0 ? 0.5 : 0.08);
    });

    this.sparkle.update(now, dt);

    // 現場模式
    this.levels = this.feedFn ? this.feedFn(now, dt) : breathing(now);
    const surge = this.surge * (this.opts.reducedMotion ? 0.35 : 1);
    this.stage.update(this.levels, now, dt, this.playing, this.wake, surge);
    const look = this.stage.look;
    // 沒聲音時房間稍暗；出聲那一下整間亮起來再回穩
    const roomDim = look.dim * (0.86 + 0.14 * this.wake) + surge * 0.22;
    const shade = (mat: THREE.ShaderMaterial) => {
      const u = mat.uniforms;
      u.dim!.value = roomDim;
      (u.tint!.value as THREE.Color).copy(look.tint);
      u.tintAmt!.value = look.tintAmt;
      u.flash!.value = look.flash;
    };
    this.bakedMats.forEach(shade);
    this.doorRig.mats.forEach(shade);
    // 光池遮罩：窗外（view）午後室內沒開燈也照樣亮，power 固定 1
    this.bakedMats.forEach((mat, k) => (mat.uniforms.power!.value = k === 'view' ? 1 : this.gains.room));
    this.doorRig.mats.forEach((mat) => (mat.uniforms.power!.value = this.gains.room));
    this.bloom.strength = 0.35 + (1 - look.dim) * 0.9 + surge * 1.1;
    if (import.meta.env.DEV) window.__shaderLog?.sync(false);
    this.composer.render(dt);
    if (import.meta.env.DEV) window.__shaderLog?.sync(true);
  }
}
