"""為片櫃作品挑 YouTube 官方預告：TMDB /{kind}/{id}/videos，結果快取在 data/tmdb-videos.json，重跑只查新的。

用法：build_story.py 加 --fetch-trailers 會補抓片櫃作品還沒快取的預告；不加就只讀快取，不連網。
"""
import json, sys
from pathlib import Path

LANG_RANK = {'zh-TW': 0, 'zh': 1, 'en': 2}


def _lang(v):
    l = v.get('iso_639_1')
    if l == 'zh' and v.get('iso_3166_1') == 'TW':
        return 'zh-TW'
    return l


def pick_trailer(videos):
    """site=YouTube、type=Trailer；official 優先，語言 zh-TW > zh > en > 其他。回傳 {yt, lang} 或 None。"""
    ok = [v for v in (videos or []) if v.get('site') == 'YouTube' and v.get('type') == 'Trailer' and v.get('key')]
    if not ok:
        return None
    best = min(ok, key=lambda v: (not v.get('official'), LANG_RANK.get(_lang(v), 4 if _lang(v) is None else 3)))  # min 取第一個，順序穩定
    return {'yt': best['key'], 'lang': _lang(best) or 'und'}


ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'data' / 'tmdb-videos.json'


def fetch_all(items, get):
    """items: [(kind, id)]；get(path, **params) 是 enrich.get。回傳 {'kind-id': [videos]}，新查的會寫回快取。"""
    cache = json.load(open(CACHE)) if CACHE.exists() else {}
    for kind, tid in items:
        key = f'{kind}-{tid}'
        if key in cache:
            continue
        r = get(f'/{kind}/{tid}/videos', include_video_language='zh,en,null')
        cache[key] = [{k: v.get(k) for k in ('key', 'site', 'type', 'official', 'iso_639_1', 'iso_3166_1')} for v in r.get('results', [])]
        CACHE.write_text(json.dumps(cache, ensure_ascii=False))
    return cache


def trailer_for(cache, kind, tid):
    return pick_trailer(cache.get(f'{kind}-{tid}'))
