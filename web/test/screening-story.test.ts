import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// web/public/screening/story.js 是 build_story.py 的輸出：window.STORY = {...};
const src = readFileSync(new URL('../public/screening/story.js', import.meta.url), 'utf8');
const story = JSON.parse(src.slice(src.indexOf('=') + 1).trim().replace(/;$/, ''));
type Item = { id: string; title: string; overview?: string; poster: string };
const shelf: Item[] = story.shelf;

test('story.favorites 的每個 id 都在片櫃、不重複、有海報', () => {
  assert.ok(Array.isArray(story.favorites) && story.favorites.length > 0);
  assert.equal(new Set(story.favorites).size, story.favorites.length);
  for (const id of story.favorites) {
    const it = shelf.find((s) => s.id === id);
    assert.ok(it, `片櫃找不到 ${id}`);
    assert.ok(it.poster, `${it.title} 沒海報`);
  }
});

test('簡介：有就是非空繁中字串（含中文、沒有簡體專用字），沒有就省略欄位而不是空字串', () => {
  const simplified = /[们这国说为对时学开关见长个来会还让从过现发动实间头问点书买业东两严乐习亲产优传体价儿党写军农决况净击创则办务劳势医华单卖卫历县双变叶号听员响团园图块处备够夺奖妇宁宝导尔层岁岛币帮带师帅归当录忆怀态总战户执护报担择拥据损换摇敌数断无旧显杀杂权条杨构样标栋档桥检楼欢汇汉没泪济浅测浓涌润涨烦烧热爱爷牺状独猫环画疯确离种积称窃竞笔类约级纪纯细终组结绝统继维绿网罗职联肤胜脑脚艺节药获虽补装观规视览觉计订认讨训议记讲许论设访证评识诉词译试话该详语误请诸诺读调谁谈谢谱货负贡贤败账质贩贪购贯贵贸费贺资赌赛赶趋跃车轨轮软转轻载较辅辆辈输边辽达迁运进远违连迟适选逻递遗邮邻郑释针钟钢钱铁银链锁错键锦镇门闪闭闲闷闹队阳阴阵阶际陆陈险随隐难雾静页顶项顺须顾顿预领颇频题颜额风飞饭饮饱馆马驱驶驻驾验骑骗鱼鲜鸟鸡麦龙龟]/;
  let n = 0;
  for (const it of shelf) {
    if (!('overview' in it)) continue;
    n++;
    assert.equal(typeof it.overview, 'string', it.title);
    assert.ok(it.overview!.trim().length > 0, `${it.title} 簡介是空的，應該省略欄位`);
    assert.ok(/[一-鿿]/.test(it.overview!), `${it.title} 簡介沒有中文`);
    assert.ok(!simplified.test(it.overview!), `${it.title} 簡介含簡體字：${it.overview!.slice(0, 30)}`);
  }
  assert.ok(n > 0, '片櫃完全沒有簡介');
});
