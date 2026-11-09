"""為片櫃作品抓劇情簡介：TMDB /{kind}/{id}，language=zh-TW；空的再試 zh-HK；仍空就不給（不用簡體、不用英文）。
結果快取在 data/tmdb-overviews.json（{'kind-id': '簡介' 或 ''}），已有的不重抓。

用法：build_story.py 加 --fetch-overviews 會補抓片櫃作品還沒快取的簡介；不加就只讀快取，不連網。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'data' / 'tmdb-overviews.json'
LANGS = ('zh-TW', 'zh-HK')
# 只有簡體寫法的常見字：TMDB 的 zh-TW 沒有人翻時有時會回簡體，出現就當作這個語言沒有簡介
SIMPLIFIED = set('业东两严个为乐习书买产亲从们价优会传侧儿党兰关写军农决况净凤击则创办务动劳势医华单卖卫历县双发变叶号听启员响团园国图块处备够头夺奖妇学宁宝实对导尔层岁岛币帅师带帮开归当录忆怀态总战户执扩护报担拥拨择损换据摇敌数断无旧时显晓杀杂权条来杨极构标栋样档桥检楼横欢气汇汉没泪泽浅测济浓涌润涨点烦烧热爱爷牺状独猫环现画疯确离种积称窃竞笔笼筑类约级纪纯纱组细终结绝统继维绿网罗职联肤胜脑脚腾艺节药获虽补装见观规视览觉计订认讨让训议记讲许论设访证评识诉词译试话该详语误说请诸诺读谁调谈谢谱贝负贡贤败账货质贩贪购贯贵贸费贺资赌赛赶趋跃车轨转轮软轻载较辅辆辈输边辽达迁过运还这进远违连迟适选递逻遗邮邻郑释针钟钢钱铁银链锁错锦键镇长门闪闭问闲间闷闹队阳阴阵阶际陆陈险随隐难雾静页顶项顺须顾顿预领颇频题颜额风飞饭饮饱馆马驱驶驻驾验骑骗鱼鲜鸟鸡麦齿龙龟')


def looks_simplified(text):
    return sum(1 for c in text if c in SIMPLIFIED) >= 2


def pick(by_lang):
    """by_lang: {'zh-TW': '...', 'zh-HK': '...'}；回傳第一個非空、不像簡體的，沒有就空字串。"""
    for lang in LANGS:
        t = (by_lang.get(lang) or '').strip()
        if t and not looks_simplified(t):
            return t
    return ''


def fetch_all(items, get):
    """items: [(kind, id)]；get(path, **params) 是 enrich.get。回傳整份快取，新查的會寫回。"""
    cache = json.load(open(CACHE)) if CACHE.exists() else {}
    for kind, tid in items:
        key = f'{kind}-{tid}'
        if key in cache:
            continue
        got = {}
        for lang in LANGS:
            got[lang] = get(f'/{kind}/{tid}', language=lang).get('overview') or ''
            if got[lang].strip() and not looks_simplified(got[lang]):
                break
        cache[key] = pick(got)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False))
    return cache
