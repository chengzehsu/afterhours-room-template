/**
 * 現場效果：疊在烘焙好的房間上，放 CD 時一起開，不用選，也不跟著拍子動。
 * 房間穩穩調暗、染成封面色與燈絲琥珀各半；門上方的 ON AIR 亮起；VU 表跟音量；櫃上一台管機的燈絲亮著。
 * 2026-11-08 拿掉：天花板光束、薄霧、麥克風、重低音（低音推亮房間、鼓點閃、喇叭振膜）。
 */
import * as THREE from 'three';
import { onAirScale } from './on-air.ts';
import type { Levels } from './audio.ts';
import { IGNITE_MS, flicker as waitFlicker, ignite } from './flicker.ts';

/** 現場燈光：放 CD 時錄音室、演唱會、真空管的效果一起開，不用另外選；off 只給「不要任何效果」用 */
export type LiveMode = 'off' | 'on';

/** 燈絲的琥珀色：不跟封面色走，真空管就是這個顏色 */
/** ON AIR 等待閃爍的節奏種子：固定，每次進場同一套節奏 */
const FLICKER_SEED = 1964;
const FILAMENT = new THREE.Color(1, 0.52, 0.2);


function label(text: string, fg: string, bg: string, w = 512, h = 160): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `600 ${Math.round(h * 0.62)}px Switzer, "Noto Sans TC", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** VU 表的錶面：弧形刻度，右邊一段紅色 */
function vuFace(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9dcc0';
  g.fillRect(0, 0, 256, 160);
  g.lineWidth = 3;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1.2 + (i / 10) * 0.6);
    g.strokeStyle = i >= 8 ? '#b3261e' : '#2b2216';
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 112, 150 + Math.sin(a) * 112);
    g.lineTo(128 + Math.cos(a) * (i % 5 === 0 ? 92 : 100), 150 + Math.sin(a) * (i % 5 === 0 ? 92 : 100));
    g.stroke();
  }
  g.fillStyle = '#2b2216';
  g.font = '600 26px Switzer, sans-serif';
  g.textAlign = 'center';
  g.fillText('VU', 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 柔邊的暗色圓斑：烘焙過的櫃面不接即時陰影，墊在道具底下當接觸陰影 */
function contactShadow(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** 管機放在音響櫃面（y 0.7）左後方、唱盤座左邊：deck0 全景完整入鏡，deck2 近拍左上角還看得到管子 */
export const TUBE_AMP_POS = { x: -0.46, y: 0.7, z: -3.8 } as const;

interface TubeAmp {
  root: THREE.Group;
  /** 會跟著淡入淡出的材質，和它完全出現時的透明度 */
  fades: [THREE.Material, number][];
  filaments: THREE.MeshBasicMaterial[];
  glows: THREE.SpriteMaterial[];
}

/** 唱盤左後方的小管機（位置由 test/tube-placement.test.ts 的投影驗證）：胡桃木底座、金屬面板、四支玻璃管，管裡的燈絲會亮 */
function tubeAmp(): TubeAmp {
  const root = new THREE.Group();
  root.position.set(TUBE_AMP_POS.x, TUBE_AMP_POS.y, TUBE_AMP_POS.z);
  root.visible = false;
  const fades: [THREE.Material, number][] = [];
  const fade = <M extends THREE.Material>(m: M, full = 1): M => {
    m.transparent = true;
    m.opacity = 0;
    fades.push([m, full]);
    return m;
  };

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.24),
    fade(new THREE.MeshBasicMaterial({ map: contactShadow(), depthWrite: false })),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.13), fade(new THREE.MeshStandardMaterial({ color: 0x3d2915, roughness: 0.45 })));
  base.position.y = 0.025;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.004, 0.11), fade(new THREE.MeshStandardMaterial({ color: 0x8a8378, metalness: 0.8, roughness: 0.35 })));
  plate.position.y = 0.052;
  root.add(shadow, base, plate);

  const filaments: THREE.MeshBasicMaterial[] = [];
  const glows: THREE.SpriteMaterial[] = [];
  // 兩支小的前級管、兩支大的功率管
  const tubes: [number, number, number][] = [
    [-0.12, 0.018, 0.06],
    [-0.06, 0.018, 0.06],
    [0.03, 0.026, 0.095],
    [0.11, 0.026, 0.095],
  ];
  for (const [x, r, h] of tubes) {
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 24, 1, true),
      fade(new THREE.MeshStandardMaterial({ color: 0xd8cbb4, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide }), 0.28),
    );
    glass.position.set(x, 0.054 + h / 2, 0);
    const top = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass.material);
    top.position.set(x, 0.054 + h, 0);
    const fm = new THREE.MeshBasicMaterial({ color: FILAMENT.clone(), toneMapped: false, transparent: true, opacity: 0 });
    const filament = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, h * 0.55, 10), fm);
    filament.position.set(x, 0.054 + h * 0.42, 0);
    // 管子周圍一圈暈光：相加混色的小圓片，永遠面向鏡頭
    const gm = new THREE.SpriteMaterial({ color: FILAMENT.clone(), toneMapped: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, map: glowDot() });
    const glow = new THREE.Sprite(gm);
    glow.scale.setScalar(r * 8); // 13 在近拍時會被泛光放大成整片光團
    glow.position.set(x, 0.054 + h * 0.42, 0);
    root.add(glass, top, filament, glow);
    filaments.push(fm);
    glows.push(gm);
  }
  return { root, fades, filaments, glows };
}

function glowDot(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export interface BakedLook {
  dim: number;
  tint: THREE.Color;
  tintAmt: number;
  flash: number;
}

export class Stage {
  private group = new THREE.Group();
  private onAir: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private needles: THREE.Object3D[] = [];
  private cones: THREE.Mesh[] = [];
  private amp: TubeAmp;
  /** 0 → 1：真空管模式自己的淡入淡出（切去別的模式時管機要淡掉） */
  private tubeAmt = 0;
  private mode: LiveMode = 'on';
  private amount = 0; // 0 → 1：模式切換時淡入淡出
  private color = new THREE.Color(1, 0.75, 0.5);
  readonly look: BakedLook = { dim: 1, tint: new THREE.Color(1, 1, 1), tintAmt: 0, flash: 0 };

  constructor(scene: THREE.Scene, private reducedMotion: boolean) {
    scene.add(this.group);

    // ON AIR：格柵牆上方
    this.onAir = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.16),
      new THREE.MeshBasicMaterial({ map: label('ON AIR', '#ffe9e4', '#b3261e'), toneMapped: false }),
    );
    this.onAir.position.set(0, 2.45, -3.93);
    this.group.add(this.onAir);

    // 一對 VU 表：唱盤左邊
    for (const x of [-0.62, -0.42]) {
      const meter = new THREE.Group();
      meter.position.set(x, 0.78, -3.5);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), new THREE.MeshBasicMaterial({ map: vuFace(), toneMapped: false }));
      face.position.z = 0.031;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.06), new THREE.MeshStandardMaterial({ color: 0x3d2915, roughness: 0.5 }));
      const needle = new THREE.Group();
      needle.position.set(0, -0.045, 0.033);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.003, 0.075), new THREE.MeshBasicMaterial({ color: 0x1a1410 }));
      bar.position.y = 0.0375;
      needle.add(bar);
      meter.add(body, face, needle);
      this.group.add(meter);
      this.needles.push(needle);
    }

    // 喇叭單體：疊在烘焙的單體前面，跟著低音前後動
    for (const x of [-1.55, 1.55]) {
      for (const [y, r] of [[0.33, 0.12], [0.72, 0.06]] as const) {
        const cone = new THREE.Mesh(new THREE.CircleGeometry(r * 0.82, 48), new THREE.MeshStandardMaterial({ color: 0x1b140c, roughness: 0.9 }));
        cone.position.set(x, y, -3.432);
        cone.visible = false;
        this.group.add(cone);
        this.cones.push(cone);
      }
    }

    this.amp = tubeAmp();
    this.group.add(this.amp.root);
  }

  setMode(mode: LiveMode): void {
    this.mode = mode;
  }

  setColor(c: THREE.Color): void {
    // 太暗的封面色會讓光束看不見：提高明度
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    this.color.setHSL(hsl.h, Math.min(1, hsl.s * 1.2 + 0.15), Math.max(0.55, hsl.l));
  }

  /** wake：有聲音的程度（0～1）；surge：剛出聲那一下（1 → 0） */
  /** 開場懸針等待：ON AIR 一明一滅邀請訪客（減少動態時改成恆亮） */
  blink = false;
  private wasPlaying = false;
  private igniteAt = -1;
  private waitSince = -1;

  update(lv: Levels, now: number, dt: number, playing: boolean, wake = playing ? 1 : 0, surge = 0): void {
    const goal = this.mode === 'off' || !playing ? 0 : 1;
    this.amount += (goal - this.amount) * (1 - Math.exp(-dt * 3));
    const a = this.amount;
    // 放歌時一起開：房間調暗染色、真空管機亮、ON AIR、VU 表
    const tube = this.mode === 'on';
    const calm = this.reducedMotion;
    this.tubeAmt += ((tube && playing ? 1 : 0) - this.tubeAmt) * (1 - Math.exp(-dt * 3));
    const t = this.tubeAmt;
    // 重低音特效（低音推亮房間、鼓點閃、喇叭振膜、燈絲跟低音）2026-11-08 使用者覺得太爛拿掉：
    // 放歌時房間就穩穩地調暗、染成封面色與燈絲琥珀各半，不跟著拍子動
    this.look.flash = 0;
    this.look.dim = 1 - a * 0.5;
    this.look.tint.copy(this.color).lerp(FILAMENT, 0.5);
    this.look.tintAmt = a * 0.6;

    // 天花板光束（spotlight）2026-11-08 使用者覺得多餘拿掉了：現場感靠房間調暗染色、鼓點閃與真空管

    // ON AIR、VU、喇叭
    // ON AIR：一出聲就亮，剛亮的那半秒像霓虹燈閃兩下
    const flicker = surge > 0.5 && !calm && Math.sin(now / 45) > 0.2 ? 0.3 : 1;
    if (playing && !this.wasPlaying) this.igniteAt = now; // 剛按下去：跑一次點亮
    this.wasPlaying = playing;
    if (!this.blink || playing) this.waitSince = -1;
    else if (this.waitSince < 0) this.waitSince = now;
    const beckon = this.blink && !playing ? waitFlicker(now - this.waitSince, FLICKER_SEED, calm) : 0;
    const sinceIgnite = now - this.igniteAt;
    const igniting = !calm && playing && this.igniteAt >= 0 && sinceIgnite < IGNITE_MS;
    // 點亮的 600ms 由 ignite 全權決定（不然 wake 一上來就蓋掉閃爍），結束時剛好是 1，接上播放中的恆亮
    const lit = igniting ? ignite(sinceIgnite) : Math.max(a, wake, beckon);
    // 燈箱是實心的：沒通電時是暗紅玻璃（不透明），亮的時候字剛好到白、只留一點泛光（舊值推到 1.9，整塊爆白、光暈糊到下方燈箱牆）
    const glow = lit * flicker;
    this.onAir.material.color.setScalar(onAirScale(glow));
    this.needles.forEach((n, i) => {
      // 沒聲音時指針躺在最左邊，出聲時跳起來（剛出聲那下多甩一點）
      const v = Math.min(1, (lv.level * 1.4 + (i ? lv.treble : lv.mid) * 0.3) * wake + surge * 0.5);
      n.rotation.z = THREE.MathUtils.lerp(0.6, -0.6, v);
    });
    for (const c of this.cones) c.visible = a > 0.01; // 喇叭振膜不再跟低音推

    // 管機：燈絲常亮的暖光，只有一點點不穩的微光（減少動態時不抖）；不跟低音
    const amp = this.amp;
    amp.root.visible = t > 0.01;
    if (amp.root.visible) {
      for (const [m, full] of amp.fades) m.opacity = t * full;
      amp.filaments.forEach((m, i) => {
        const shimmer = calm ? 0 : Math.sin(now / 90 + i * 2.1) * Math.sin(now / 37 + i) * 0.05;
        const heat = 0.75 + shimmer;
        m.opacity = t;
        // 亮度推過 1（不經色調對應），泛光才抓得到
        m.color.copy(FILAMENT).multiplyScalar(1 + heat * 1.6);
        const g = amp.glows[i]!;
        g.opacity = t * Math.min(1, 0.35 + heat * 0.4);
        g.color.copy(FILAMENT).multiplyScalar(0.7 + heat * 0.4); // 最高 1.1，只讓泛光抓到一點
      });
    }

  }
}
