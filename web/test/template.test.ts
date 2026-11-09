import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndexHtml } from '../src/page/template.ts';
import { renderPage } from '../src/page/render.ts';
import type { TasteProfile } from '../src/core/profile.ts';

const base = JSON.parse(readFileSync(new URL('../src/data/profile.json', import.meta.url), 'utf8')) as TasteProfile;
// 建置時 Vite 已把 module script 注入 head，模擬那個狀態
const template = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace('</head>', '<script type="module" src="./assets/main.js"></script>\n</head>');

/** 把 $ 替換序列塞進第三方控制的名稱（歌名、歌手名） */
function dollarProfile(): TasteProfile {
  const p = structuredClone(base);
  const music = p.music!;
  const ids = music.ranges.month.tracks.slice(0, 3).map((t) => t.id);
  const names = ['A$`B', "C$'D", 'E$&F'];
  // 同一首歌會出現在三個時段，全部一起改名，room-data 才看得到
  for (const r of Object.values(music.ranges)) {
    for (const t of r.tracks) {
      const i = ids.indexOf(t.id);
      if (i >= 0) t.name = names[i]!;
    }
  }
  music.ranges.month.artists[0]!.name = '$$$';
  return p;
}

const roomJson = (html: string) => JSON.parse(html.match(/<script type="application\/json" id="room-data">([\s\S]*?)<\/script>/)![1]!);

test('名稱裡的 $ 替換序列逐字保留，不會複製樣板片段', () => {
  const p = dollarProfile();
  const out = buildIndexHtml(template, p);
  assert.ok(out.includes(renderPage(p, { screeningReady: false })), '頁面內容要逐字等於 renderPage 的輸出');
  assert.equal(out.match(/<!doctype/gi)?.length, 1);
  assert.equal(out.match(/<head>/g)?.length, 1);
  assert.equal(out.match(/id="room-data"/g)?.length, 1);
});

test('room-data 在名稱含 $ 序列時仍是合法 JSON，名稱不變', () => {
  const p = dollarProfile();
  const data = roomJson(buildIndexHtml(template, p));
  const names = Object.values(data.tracks as Record<string, { name: string }>).map((t) => t.name);
  for (const n of ['A$`B', "C$'D", 'E$&F']) assert.ok(names.includes(n), `room-data 要含 ${n}`);
});

test('owner.name 進 <title> 與 meta content 前會轉義', () => {
  const p = structuredClone(base);
  p.owner.name = 'X"><script>alert(1)</script> Y';
  const out = buildIndexHtml(template, p);
  const head = out.slice(0, out.indexOf('</head>'));
  assert.ok(!head.includes('<script>alert(1)'));
  assert.match(head, /content="X&quot;&gt;&lt;script&gt;/);
});

test('ownerUrl 只接受 https://open.spotify.com/ 開頭，其他改用預設', () => {
  const p = structuredClone(base);
  p.owner.url = 'javascript:alert(1)';
  const html = renderPage(p);
  assert.ok(!html.includes('javascript:'));
  assert.match(html, /href="https:\/\/open\.spotify\.com"/);
});
