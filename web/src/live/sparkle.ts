/** 串燈與燭火：在 Blender 記下的位置疊上會閃的光點，光暈後製會讓它們發亮。午後關著。 */
import * as THREE from 'three';

interface LightsJson {
  fairy: [number, number, number][];
  candles: [number, number, number][];
}

function glowSprite(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,220,170,0.8)');
  grd.addColorStop(1, 'rgba(255,180,100,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Sparkle {
  private fairy: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private flames: THREE.Sprite[] = [];
  private on = 0;
  private goal = 0;

  constructor(private scene: THREE.Scene, private reducedMotion: boolean) {}

  async load(url: string): Promise<void> {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as LightsJson;
    const tex = glowSprite();

    const pos = new Float32Array(data.fairy.flat());
    const seed = new Float32Array(data.fairy.map(() => Math.random() * 100));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.fairy = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, time: { value: 0 }, on: { value: 0 }, twinkle: { value: this.reducedMotion ? 0 : 1 } },
        vertexShader: `
          attribute float seed; uniform float time; uniform float twinkle; varying float vB;
          void main() {
            // 整串一起慢慢呼吸（約 4.5 秒一輪），每顆再帶一點自己的節奏，偶爾一顆輕輕閃一下（像老燈泡接觸不良）
            float breath = 0.91 + 0.09 * sin(time * 1.396);
            float own = 1.0 + 0.06 * sin(time * (0.5 + fract(seed) * 0.7) + seed);
            float ph = fract(time * 0.067 + fract(seed * 7.13));
            float blink = ph < 0.012 ? 0.45 : (ph < 0.02 ? 0.85 : 1.0);
            vB = mix(0.92, breath * own * blink, twinkle);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = 26.0 / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform sampler2D map; uniform float on; varying float vB;
          void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vec3(1.0, 0.78, 0.48) * t.a * vB * on * 1.6, 1.0); }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.scene.add(this.fairy);

    const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffb25c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, toneMapped: false });
    for (const p of data.candles) {
      const s = new THREE.Sprite(mat.clone());
      s.position.set(p[0], p[1] + 0.012, p[2]);
      s.scale.set(0.045, 0.075, 1);
      this.scene.add(s);
      this.flames.push(s);
    }
  }

  setMood(mood: 'afternoon' | 'tipsy' | 'night'): void {
    this.goal = mood === 'afternoon' ? 0 : 1;
  }

  update(now: number, dt: number): void {
    this.on += (this.goal - this.on) * (1 - Math.exp(-dt * 2.5));
    if (this.fairy) {
      const u = this.fairy.material.uniforms;
      u.time!.value = now / 1000;
      u.on!.value = this.on;
    }
    this.flames.forEach((f, i) => {
      // 燭火：用幾個不同頻率的正弦疊出不規則的晃動；減少動態時不晃
      const flick = this.reducedMotion ? 1 : 0.85 + 0.1 * Math.sin(now / 90 + i * 3) + 0.05 * Math.sin(now / 37 + i);
      f.material.opacity = this.on * flick;
      f.scale.y = 0.075 * (this.reducedMotion ? 1 : 0.9 + 0.15 * Math.sin(now / 120 + i * 5));
    });
  }
}
