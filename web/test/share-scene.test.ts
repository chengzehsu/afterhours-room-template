import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildScenes, fitText, parseStory, pickCovers, pickPosters, screeningLine, sceneTextSvg, sceneBackgroundSvg,
  shareTags, textWidth, xmlEscape, siteUrl, SITE_DEFAULT, type Scene,
} from '../src/share/scene.ts';

const track = (albumId: string, lg?: string) => ({ album: { id: albumId, picture: lg ? { lg } : undefined } });

test('xmlEscape 跳脫 & < > 與引號', () => {
  assert.equal(xmlEscape(`A&B <i> "q" 'x'`), 'A&amp;B &lt;i&gt; &quot;q&quot; &apos;x&apos;');
});

test('pickCovers 依序、同專輯只取一次、沒圖的略過', () => {
  const tracks = [track('a', 'm/a.jpg'), track('a', 'm/a.jpg'), track('b'), track('c', 'm/c.jpg'), track('d', 'm/d.jpg'), track('e', 'm/e.jpg')];
  assert.deepEqual(pickCovers(tracks, 3), ['m/a.jpg', 'm/c.jpg', 'm/d.jpg']);
  assert.deepEqual(pickCovers([], 3), []);
});

test('pickPosters 依 days 由多到少，同天數維持原順序，沒海報略過', () => {
  const shelf = [
    { title: 'A', days: 1, poster: 'p/a.jpg' }, { title: 'B', days: 5, poster: 'p/b.jpg' },
    { title: 'C', days: 5, poster: 'p/c.jpg' }, { title: 'D', days: 9, poster: null }, { title: 'E', days: 2, poster: 'p/e.jpg' },
  ];
  assert.deepEqual(pickPosters(shelf, 3).map((p) => p.poster), ['p/b.jpg', 'p/c.jpg', 'p/e.jpg']);
});

test('screeningLine 取第一名；只看過一天或沒資料時回 null', () => {
  assert.equal(screeningLine([{ title: '化學老師', days: 37, poster: 'x' }, { title: 'B', days: 3, poster: 'y' }]), '《化學老師》我回來看了 37 天');
  assert.equal(screeningLine([{ title: 'A', days: 1, poster: 'x' }]), null);
  assert.equal(screeningLine([]), null);
});

test('parseStory 讀 window.STORY 並回傳 shelf；壞檔回 null', () => {
  const src = 'window.STORY = {"owner":"X","shelf":[{"title":"T","days":2,"poster":"media/p.jpg"}]};\n';
  assert.equal(parseStory(src)?.shelf[0]?.title, 'T');
  assert.equal(parseStory('nope'), null);
  assert.equal(parseStory('window.STORY = {bad'), null);
});

test('textWidth 全形算 1em、半形約 0.56em', () => {
  assert.equal(textWidth('播放室', 40), 120);
  assert.ok(textWidth('abcd', 100) < 300 && textWidth('abcd', 100) > 150);
});

test('fitText 太寬就縮字，縮到底還是太寬就加刪節號，並且不超寬', () => {
  assert.deepEqual(fitText('短', 22, 480), { text: '短', size: 22 });
  const a = fitText('一'.repeat(30), 22, 480);
  assert.ok(a.size < 22 && a.size >= 18 && textWidth(a.text, a.size) <= 480);
  const b = fitText('一'.repeat(80), 22, 480);
  assert.equal(b.size, 18);
  assert.ok(b.text.endsWith('…') && textWidth(b.text, b.size) <= 480);
});

const input = {
  name: 'Alex Lin', personaTitle: 'NOVA 和晚風樂團，我一整年都在聽',
  covers: ['c1', 'c2', 'c3', 'c4'], posters: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], screeningLine: '《化學老師》我回來看了 37 天',
};
const boxes = (s: Scene) => [
  ...s.images.map((i) => ({ x0: i.x, x1: i.x + i.w, y0: i.y, y1: i.y + i.h })),
  ...s.texts.map((t) => { const w = textWidth(t.text, t.size); return { x0: t.x - w / 2, x1: t.x + w / 2, y0: t.y - t.size / 2, y1: t.y + t.size / 2 }; }),
];

test('首頁卡：1200x630，兩邊各 3 張，名字在中央', () => {
  const s = buildScenes(input).ogHome;
  assert.equal(s.w, 1200); assert.equal(s.h, 630);
  assert.equal(s.mood, 'both');
  assert.equal(s.images.length, 6);
  assert.equal(s.images.filter((i) => i.w === 130 && i.h === 130).length, 3);
  assert.equal(s.images.filter((i) => i.w === 104 && i.h === 156).length, 3);
  assert.ok(s.texts.some((t) => t.text === 'Alex Lin' && t.x === 600 && t.size === 34));
  assert.ok(s.texts.some((t) => t.text === '聽歌' && t.x === 360) && s.texts.some((t) => t.text === '看劇' && t.x === 840));
});

test('首頁卡：全部內容在中央 87% 安全範圍，聽歌／看劇與名字從中間裁成正方形仍在', () => {
  const s = buildScenes(input).ogHome;
  for (const b of boxes(s)) { assert.ok(b.x0 >= 0.065 * 1200 - 1 && b.x1 <= 0.935 * 1200 + 1, JSON.stringify(b)); assert.ok(b.y0 >= 0 && b.y1 <= 630); }
  const sq = (t: string) => boxes({ ...s, images: [], texts: s.texts.filter((x) => x.text === t) })[0]!;
  for (const t of ['Alex Lin', '聽歌', '看劇']) { const b = sq(t); assert.ok(b.x0 >= 285 && b.x1 <= 915, t); }
});

test('首頁卡：沒有放映室資料時只有「聽歌的地方」，置中，沒有門縫', () => {
  const s = buildScenes({ ...input, posters: [], screeningLine: null }).ogHome;
  assert.equal(s.mood, 'warm');
  assert.equal(s.images.length, 3);
  assert.ok(!s.texts.some((t) => t.text === '看劇' || t.text === '看劇的地方'));
  assert.ok(s.texts.some((t) => t.text === '聽歌的地方' && t.x === 600));
});

test('放映室卡：5 張 150x225 置中，名字＋「看劇的地方」', () => {
  const s = buildScenes(input).ogScreening!;
  assert.equal(s.images.length, 5);
  assert.ok(s.images.every((i) => i.w === 150 && i.h === 225 && i.y === s.images[0]!.y)) // 位置由版面算出，只要求同一排;
  assert.equal(s.images[0]!.x, 600 - (5 * 150 + 4 * 18) / 2);
  assert.ok(s.texts.some((t) => t.text === '看劇的地方' && t.size === 64));
  assert.equal(s.mood, 'cool');
});

test('沒有放映室資料就不產生放映室的圖', () => {
  const r = buildScenes({ ...input, posters: [], screeningLine: null });
  assert.equal(r.ogScreening, undefined); assert.equal(r.storyScreening, undefined); assert.equal(r.postScreening, undefined);
});

test('限時動態 1080x1920：內容在上下 250px 以外，在畫面內', () => {
  const r = buildScenes(input);
  for (const s of [r.storyHome, r.storyScreening!]) {
    assert.equal(s.w, 1080); assert.equal(s.h, 1920);
    for (const b of boxes(s)) { assert.ok(b.y0 >= 250 && b.y1 <= 1670, JSON.stringify(b)); assert.ok(b.x0 >= 0 && b.x1 <= 1080, JSON.stringify(b)); }
  }
});

test('貼文 1080x1350：內容在畫面內；每個房間都有', () => {
  const r = buildScenes(input);
  for (const s of [r.postHome, r.postScreening!]) {
    assert.equal(s.w, 1080); assert.equal(s.h, 1350);
    for (const b of boxes(s)) { assert.ok(b.x0 >= 0 && b.x1 <= 1080 && b.y0 >= 0 && b.y1 <= 1350, JSON.stringify(b)); }
  }
});

test('封面或海報不夠時照實排，不補空格', () => {
  const s = buildScenes({ ...input, covers: ['c1'], posters: ['p1', 'p2'] });
  assert.equal(s.ogHome.images.filter((i) => i.h === 130).length, 1);
  assert.equal(s.ogScreening!.images.length, 2);
  assert.equal(s.storyHome.images.length, 1);
});

test('文字 SVG 跳脫第三方字串，背景 SVG 是合法的 XML 開頭', () => {
  const s = buildScenes({ ...input, screeningLine: '《A&B <x>》我回來看了 9 天' }).ogHome;
  const svg = sceneTextSvg(s);
  assert.ok(svg.includes('A&amp;B &lt;x&gt;') && !svg.includes('<x>'));
  assert.ok(svg.includes('Noto Sans TC, Noto Sans CJK TC, PingFang TC, sans-serif'));
  assert.ok(sceneBackgroundSvg(s).startsWith('<svg'));
});

test('siteUrl：預設網域、去尾斜線、只收 https', () => {
  assert.equal(siteUrl(undefined), SITE_DEFAULT);
  assert.equal(siteUrl('https://x.example/'), 'https://x.example');
  assert.equal(siteUrl('javascript:alert(1)'), SITE_DEFAULT);
  assert.equal(siteUrl('http://x.example'), SITE_DEFAULT);
});

test('shareTags：必要標籤齊全、og:image 完整網址、屬性值跳脫', () => {
  const html = shareTags({
    title: 'A "x" & B', description: 'd', url: 'https://s.example/', image: 'https://s.example/share/og.jpg',
    imageAlt: 'alt', icon32: 'share/i32.png', icon180: 'share/i180.png',
  });
  for (const k of ['og:title', 'og:description', 'og:image"', 'og:image:width" content="1200"', 'og:image:height" content="630"', 'og:image:alt', 'og:url', 'og:site_name', 'og:locale" content="zh_TW"', 'og:type', 'twitter:card" content="summary_large_image"', 'rel="icon"', 'rel="apple-touch-icon" sizes="180x180"']) {
    assert.ok(html.includes(k), k);
  }
  assert.ok(html.includes('content="https://s.example/share/og.jpg"'));
  assert.ok(html.includes('A &quot;x&quot; &amp; B'));
  assert.ok(!html.includes('A "x"'));
});

test('pickPosters 換片：主人指定「大叔 → 沒有執照的律師」，換在原本的位置，不重複', () => {
  const shelf = [
    { title: '化學老師', days: 37, poster: 'p/bb.jpg' },
    { title: '藥鋪少女的低語', days: 33, poster: 'p/ks.jpg' },
    { title: '大叔', days: 32, poster: 'p/as.jpg' },
    { title: '送行的魔法師', days: 32, poster: 'p/fr.jpg' },
    { title: '沒有執照的律師', days: 12, poster: 'p/suits.jpg' },
  ];
  const got = pickPosters(shelf, 4, { 大叔: '沒有執照的律師' }).map((p) => p.title);
  assert.deepEqual(got, ['化學老師', '藥鋪少女的低語', '沒有執照的律師', '送行的魔法師']);
  // 要換成的片不在片櫃（或沒海報）：照樣拿掉被換的那部，往後補
  assert.deepEqual(pickPosters(shelf, 3, { 大叔: '不存在的片' }).map((p) => p.title), ['化學老師', '藥鋪少女的低語', '送行的魔法師']);
});

// 版面節奏：同一欄上下相鄰的兩段（字或圖）至少留這麼多；文字的範圍用 y 為中心、上下各半個字高
function columnGaps(s: ReturnType<typeof buildScenes>['ogHome']) {
  type Box = { top: number; bottom: number; left: number; right: number; what: string };
  const boxes: Box[] = [
    ...s.texts.map((t) => { const w = textWidth(t.text, t.size); return { top: t.y - t.size / 2, bottom: t.y + t.size / 2, left: t.x - w / 2, right: t.x + w / 2, what: t.text }; }),
    ...s.images.map((m) => ({ top: m.y, bottom: m.y + m.h, left: m.x, right: m.x + m.w, what: 'img' })),
  ].sort((a, b) => a.top - b.top);
  const gaps: { gap: number; a: string; b: string }[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    if (a.right <= b.left || b.right <= a.left) continue; // 不同欄
    if (a.what === 'img' && b.what === 'img') continue; // 同一組圖之間的間距另外定
    if (b.top < a.bottom - 0.5 && b.bottom > a.top) { gaps.push({ gap: b.top - a.bottom, a: a.what, b: b.what }); continue; }
    gaps.push({ gap: b.top - a.bottom, a: a.what, b: b.what });
    break;
  }
  return gaps;
}

test('間距：每張圖同一欄上下相鄰的字與圖至少留 24px（直式 32px），不重疊', () => {
  const sc = buildScenes({ name: 'Alex Lin', personaTitle: 'NOVA 和晚風樂團，我一整年都在聽', covers: ['a', 'b', 'c', 'd'], posters: ['1', '2', '3', '4', '5', '6'], screeningLine: '《化學老師》我回來看了 37 天' });
  for (const [k, s] of Object.entries(sc)) {
    if (!s) continue;
    const min = s.h > 630 ? 32 : 24;
    for (const g of columnGaps(s)) assert.ok(g.gap >= min, `${k}：「${g.a}」到「${g.b}」只隔 ${g.gap}px（至少 ${min}）`);
  }
});

test('間距：中文那幾行不加字距（全形標點本身就有空間，再加會鬆散）', () => {
  const sc = buildScenes({ name: 'Alex Lin', personaTitle: 'NOVA 和晚風樂團，我一整年都在聽', covers: ['a', 'b', 'c'], posters: ['1', '2', '3', '4', '5'], screeningLine: '《化學老師》我回來看了 37 天' });
  for (const [k, s] of Object.entries(sc)) for (const t of s?.texts ?? []) if (/[一-鿿]/.test(t.text)) assert.ok(!t.spacing, `${k}：「${t.text}」有字距 ${t.spacing}`);
});
