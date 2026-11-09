// 回歸：兩間房的名字（業主 2026-11-09）。「播放室」跟「放映室」只差一個字、都在講「放」，訪客分不出哪間聽、哪間看，
// 改成「聽歌的地方」「看劇的地方」；也不准用「看片」（台灣語感會聯想到成人片）。3D 門上的招牌「放映室」是門牌，刻意保留，不在這裡檢查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPage } from '../src/page/render.ts';
import { onboardLines } from '../src/core/onboard.ts';
import { buildScenes } from '../src/share/scene.ts';
import type { TasteProfile } from '../src/core/profile.ts';

const BANNED = /播放室|看片/;
const profile = JSON.parse(readFileSync(new URL('../src/data/profile.json', import.meta.url), 'utf8')) as TasteProfile;
const visible = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

test('聽歌的地方（首頁）：畫面上沒有「播放室」「看片」，頂列與出口用新名字', () => {
  const html = visible(renderPage(profile, { screeningReady: true }));
  assert.doesNotMatch(html, BANNED);
  assert.match(html, /class="bar__home"[^>]*>聽歌的地方</);
  assert.match(html, /推開門，過去看劇/);
});

test('看劇的地方（放映室頁）：HTML 裡沒有「播放室」「看片」，回去的按鈕叫「回去聽歌」', () => {
  const html = visible(readFileSync(new URL('../screening/index.html', import.meta.url), 'utf8'));
  assert.doesNotMatch(html, BANNED);
  assert.match(html, /回去聽歌/);
  assert.match(html, /<title>看劇的地方<\/title>/);
});

test('開場對話與分享圖文字：沒有「播放室」「看片」', () => {
  assert.doesNotMatch(onboardLines({ name: '阿明', alias: 'Ming' }, 68, true).join(''), BANNED);
  // 兩間都有資料：首頁並排卡、放映室卡、限動與貼文都會產生，全部檢查
  const scenes = buildScenes({ name: 'Alex Lin', personaTitle: 'NOVA 和晚風樂團', covers: ['c1', 'c2', 'c3', 'c4'], posters: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], screeningLine: '《化學老師》我回來看了 37 天' });
  const all = Object.values(scenes).filter(Boolean);
  assert.ok(all.length >= 4, `產生的分享圖太少：${all.length}`);
  for (const s of all) for (const t of s!.texts) assert.doesNotMatch(t.text, BANNED, t.text);
});
