import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DARK_LEVEL, lightGains, lightsDuration, parseLightStyle, type LightStyle } from '../src/room/lights.ts';

const STYLES: LightStyle[] = ['cascade', 'fade', 'flicker'];
const KEYS = ['wall', 'deck', 'lamp', 'frame', 'hemi', 'marquee', 'room'] as const;

test('暗場：CD 牆主燈全亮，其他剩暗場亮度', () => {
  for (const s of STYLES) {
    const g = lightGains(0, s);
    assert.equal(g.wall, 1);
    for (const k of KEYS.filter((k) => k !== 'wall')) assert.equal(g[k], DARK_LEVEL, `${s}.${k}`);
  }
  assert.equal(DARK_LEVEL, 0.4);
});

test('開燈後所有增益都是 1', () => {
  for (const s of STYLES) for (const k of KEYS) assert.equal(lightGains(1, s)[k], 1, `${s}.${k}`);
});

test('增益永遠在暗場亮度到 1 之間（沒有色調映射，不能超過 1）', () => {
  for (const s of STYLES) {
    for (let p = -0.2; p <= 1.2; p += 0.003) {
      for (const k of KEYS) {
        const v = lightGains(p, s)[k];
        assert.ok(v >= DARK_LEVEL - 1e-9 && v <= 1 + 1e-9, `${s}.${k} p=${p} v=${v}`);
      }
    }
  }
});

test('cascade：唱盤燈 → 檯燈 → 相框燈 → 全室，依序先亮', () => {
  const reach = (k: (typeof KEYS)[number]) => {
    for (let p = 0; p <= 1; p += 0.001) if (lightGains(p, 'cascade')[k] > DARK_LEVEL + 0.01) return p;
    return 1;
  };
  assert.ok(reach('deck') < reach('lamp'));
  assert.ok(reach('lamp') < reach('frame'));
  assert.ok(reach('frame') < reach('room'));
  // 全室（烘焙表面與環境光）最後才到 1
  const full = (k: (typeof KEYS)[number]) => {
    for (let p = 0; p <= 1; p += 0.001) if (lightGains(p, 'cascade')[k] >= 0.999) return p;
    return 1;
  };
  assert.ok(full('deck') <= full('lamp') && full('lamp') <= full('frame') && full('frame') <= full('room'));
});

test('cascade 與 fade 單調不減', () => {
  for (const s of ['cascade', 'fade'] as const) {
    for (const k of KEYS) {
      let prev = -1;
      for (let p = 0; p <= 1; p += 0.002) {
        const v = lightGains(p, s)[k];
        assert.ok(v >= prev - 1e-9, `${s}.${k} p=${p}`);
        prev = v;
      }
    }
  }
});

test('fade：除了牆燈，全室同一個增益', () => {
  const g = lightGains(0.5, 'fade');
  for (const k of KEYS.filter((k) => k !== 'wall')) assert.equal(g[k], g.room);
  assert.ok(g.room > DARK_LEVEL && g.room < 1);
});

test('flicker：中途會暗下來再亮（不單調），結尾穩定在 1', () => {
  let dips = 0;
  let prev = lightGains(0.001, 'flicker').room;
  for (let p = 0.002; p < 1; p += 0.002) {
    const v = lightGains(p, 'flicker').room;
    if (v < prev - 0.1) dips++;
    prev = v;
  }
  assert.ok(dips >= 2, `閃了 ${dips} 次`);
  assert.equal(lightGains(0.999, 'flicker').room > 0.9, true);
});

test('時長與樣式解析', () => {
  assert.equal(lightsDuration('cascade'), 1200);
  assert.equal(lightsDuration('fade'), 1200);
  assert.equal(lightsDuration('flicker'), 600);
  assert.equal(parseLightStyle('fade'), 'fade');
  assert.equal(parseLightStyle('flicker'), 'flicker');
  assert.equal(parseLightStyle('nonsense'), 'cascade');
  assert.equal(parseLightStyle(null), 'cascade');
});
