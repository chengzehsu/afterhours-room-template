"""Netflix 觀看紀錄 CSV → 以「作品」為單位的清單（不看集數）。

分類規則放在 data/netflix-rules.json（個人資料，不公開）；沒有就用 tools/netflix/rules.example.json。
- exclude：不是自己看的作品（家人、同住的人）
- kids：兒童節目
- anime_series／anime_movies：要算成「動畫」的作品（CSV 看不出是不是動畫）
- movie_with_colon：片名本身有「: 」、但其實是電影
- date_format：CSV 的 Date 欄位格式，跟 Netflix 帳號的語系有關（美式是 %m/%d/%y）
- split：同名但其實是兩部作品（例如動畫版與真人版），依集名裡有沒有 marker 分開；名稱後綴「（動畫）」會算成動畫
"""
import csv, datetime as dt, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RULES_FILE = ROOT / 'data' / 'netflix-rules.json'
EXAMPLE_RULES = Path(__file__).with_name('rules.example.json')
_SETS = ('exclude', 'kids', 'anime_series', 'anime_movies', 'movie_with_colon')


def load_rules(path=None):
    """讀分類規則；沒指定路徑時先找 data/netflix-rules.json，沒有就用範例。"""
    p = Path(path) if path else (RULES_FILE if RULES_FILE.exists() else EXAMPLE_RULES)
    raw = json.loads(p.read_text(encoding='utf-8'))
    rules = {k: set(raw.get(k, [])) for k in _SETS}
    rules['date_format'] = raw.get('date_format', '%m/%d/%y')
    rules['split'] = {x['title']: x for x in raw.get('split', [])}
    return rules


def load_works(path, rules=None):
    """回傳 {作品名: {'category', 'days', 'episodes', 'first', 'last'}}，已排除非本人觀看的作品。"""
    r = rules or load_rules()
    SPLIT = {x['title']: x for x in r.get('split', [])} if isinstance(r.get('split'), list) else r.get('split', {})
    EXCLUDE, KIDS = r['exclude'], r['kids']
    ANIME_SERIES, ANIME_MOVIES, MOVIE_WITH_COLON = r['anime_series'], r['anime_movies'], r['movie_with_colon']
    rows = list(csv.DictReader(open(path, encoding='utf-8')))
    has_ep = {x['Title'].split(': ')[0].strip() for x in rows if ': ' in x['Title']}
    works = {}
    for x in rows:
        t = x['Title']; s = t.split(': ')[0].strip()
        if s in EXCLUDE or s in KIDS or not s:
            continue
        sp = SPLIT.get(s)
        if sp:  # 同名但其實是兩部作品
            s = sp['match'] if sp['marker'] in t else sp['other']
        base = sp['title'] if sp else s
        if s not in works:
            series = (': ' in t or base in has_ep) and base not in MOVIE_WITH_COLON
            if base in ANIME_SERIES or base in ANIME_MOVIES or s.endswith('（動畫）'):
                c = '動畫'
            elif series:
                c = '影集'
            else:
                c = '電影'
            works[s] = {'category': c, 'is_series': series, 'query': base, 'days': set(), 'episodes': 0}
        works[s]['days'].add(dt.datetime.strptime(x['Date'].strip(), r['date_format']).date())
        works[s]['episodes'] += 1
    return works
