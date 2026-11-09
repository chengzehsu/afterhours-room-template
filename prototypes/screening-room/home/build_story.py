"""從 data/netflix-works.json 算出放映室原型要用的故事與片櫃，並下載片櫃用的海報與劇照到 media/。

用法：python3 -I prototypes/screening-room/home/build_story.py
"""
import collections
import datetime as dt
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
# 輸出位置：預設是原型資料夾；正式頁面用 --out web/public/screening
if '--out' in sys.argv:
    HERE = (Path.cwd() / sys.argv[sys.argv.index('--out') + 1]).resolve()
    HERE.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'tools' / 'netflix'))
from classify import load_works  # noqa: E402

MEDIA = HERE / 'media'
ORDER = ['電影', '影集', '動畫', '實境秀']
LANG = {'ja': '日本', 'ko': '韓國', 'zh': '華語', 'cn': '華語', 'en': '英語', 'es': '西班牙語', 'fr': '法語', 'hi': '印度', 'th': '泰國'}

works = load_works(str(ROOT / 'data' / 'raw' / 'NetflixViewingHistory.csv'))
meta = {o['title']: o for o in json.load(open(ROOT / 'data' / 'netflix-works.json'))}
owner_full = json.load(open(ROOT / 'web' / 'src' / 'data' / 'profile.json'))['owner']['name'].strip()
owner = owner_full.split()[0]
end = max(max(w['days']) for w in works.values())
since = {'month': end - dt.timedelta(days=28), 'half': end - dt.timedelta(days=182), 'year': end - dt.timedelta(days=365)}
ndays = {k: len(w['days']) for k, w in works.items()}

# 片櫃：這一年看過的，加上全期回來看最多天的前 60 部；只收有 TMDB 海報的
year_set = {k for k, w in works.items() if max(w['days']) >= since['year']}
top_all = set(sorted(works, key=lambda k: -ndays[k])[:60])
# 業主的最愛（owner.json favorites.screen）一律併入片櫃，依業主給的順序；找不到作品或沒海報就跳過
_fav_names = json.load(open(ROOT / 'web' / 'src' / 'data' / 'owner.json')).get('favorites', {}).get('screen', [])
fav_keys = [k for k in _fav_names if k in works and k in meta and meta[k]['tmdb'] and meta[k]['tmdb'].get('poster_path')]
pick = [k for k in year_set | top_all | set(fav_keys) if meta[k]['tmdb'] and meta[k]['tmdb'].get('poster_path')]
pick.sort(key=lambda k: (ORDER.index(meta[k]['category']), -ndays[k], k))

jobs, shelf = [], []
for k in pick:
    t = meta[k]['tmdb']
    key = f"{t['kind']}-{t['id']}"
    w = works[k]
    item = {
        'id': key, 'title': k, 'kind': meta[k]['category'], 'year': (t.get('date') or '')[:4] or None,
        'days': ndays[k], 'first': min(w['days']).isoformat(), 'last': max(w['days']).isoformat(),
        'origin': LANG.get(t.get('original_language'), '其他'), 'genres': [g for g in t.get('genres', []) if g not in ('動畫', '實境秀')][:3],
        'in': {r: any(d >= s for d in w['days']) for r, s in since.items()},
        'poster': f'media/p-{key}.jpg', 'backdrop': f'media/b-{key}.jpg' if t.get('backdrop_path') else None,
        'alt': t.get('original_title') if t.get('original_title') != k else None,
    }
    shelf.append(item)
    jobs.append((f"https://image.tmdb.org/t/p/w342{t['poster_path']}", MEDIA / f'p-{key}.jpg'))
    if t.get('backdrop_path'):
        jobs.append((f"https://image.tmdb.org/t/p/w780{t['backdrop_path']}", MEDIA / f'b-{key}.jpg'))

# 預告：只讀 data/tmdb-videos.json 快取；加 --fetch-trailers 才連 TMDB 補抓（權杖只在本機讀）
import trailers  # noqa: E402
if '--fetch-trailers' in sys.argv:
    import enrich  # noqa: E402
    trailers.fetch_all([tuple(i['id'].split('-', 1)) for i in shelf], enrich.get)
_tcache = json.load(open(trailers.CACHE)) if trailers.CACHE.exists() else {}
for item in shelf:
    item['trailer'] = trailers.pick_trailer(_tcache.get(item['id']))
print(f"預告 {sum(1 for i in shelf if i['trailer'])}/{len(shelf)} 部")

# 劇情簡介：只讀 data/tmdb-overviews.json 快取；加 --fetch-overviews 才連 TMDB 補抓（zh-TW → zh-HK，空的就不給）
import overviews  # noqa: E402
if '--fetch-overviews' in sys.argv:
    import enrich  # noqa: E402
    overviews.fetch_all([tuple(i['id'].split('-', 1)) for i in shelf], enrich.get)
_ocache = json.load(open(overviews.CACHE)) if overviews.CACHE.exists() else {}
for item in shelf:
    if _ocache.get(item['id']):
        item['overview'] = _ocache[item['id']]
print(f"簡介 {sum(1 for i in shelf if i.get('overview'))}/{len(shelf)} 部")

MEDIA.mkdir(exist_ok=True)


def get(job):
    url, dest = job
    if dest.exists() and dest.stat().st_size:
        return 0
    tmp = dest.with_suffix('.part')
    subprocess.run(['curl', '-sSfL', '--retry', '4', '--retry-all-errors', '-o', str(tmp), url], check=True)
    tmp.replace(dest)
    return 1


with ThreadPoolExecutor(6) as ex:
    new = sum(ex.map(get, jobs))

# 代表作、包場、牆上海報（同前一版）
sig = max(works, key=lambda k: (ndays[k], max(works[k]['days'])))
months = collections.defaultdict(lambda: collections.defaultdict(set))
for k, w in works.items():
    for d in w['days']:
        months[d.strftime('%Y-%m')][k].add(d)
dom = None
for m, per in months.items():
    alld = set().union(*per.values())
    if len(alld) < 10:
        continue
    k = max(per, key=lambda x: len(per[x]))
    share = len(per[k]) / len(alld)
    if not dom or share > dom['share']:
        dom = {'month': m, 'title': k, 'days': len(per[k]), 'of': len(alld), 'share': share}

favorites = [f"{meta[k]['tmdb']['kind']}-{meta[k]['tmdb']['id']}" for k in fav_keys]
counts = {r: sum(1 for s in shelf if s['in'][r]) for r in since}



# ---------------------------------------------------------------- 時間軸：一個月一格（只算作品數與天數，不看集數）
def media_of(k):
    t = meta[k]['tmdb']
    if not t:
        return None, None
    key = f"{t['kind']}-{t['id']}"
    p = b = None
    if t.get('poster_path'):
        p = f'media/p-{key}.jpg'
        jobs2.append((f"https://image.tmdb.org/t/p/w342{t['poster_path']}", MEDIA / f'p-{key}.jpg'))
    if t.get('backdrop_path'):
        b = f'media/b-{key}.jpg'
        jobs2.append((f"https://image.tmdb.org/t/p/w780{t['backdrop_path']}", MEDIA / f'b-{key}.jpg'))
    return p, b


jobs2 = []
first_m = min(min(w['days']) for w in works.values()).replace(day=1)
months_list = []
y, m = first_m.year, first_m.month
while (y, m) <= (end.year, end.month):
    months_list.append(f'{y}-{m:02d}')
    m += 1
    if m == 13:
        y, m = y + 1, 1
timeline = []
for mk in months_list:
    per = months.get(mk, {})
    alld = set().union(*per.values()) if per else set()
    kinds = collections.Counter(meta[k]['category'] for k in per)
    top = max(per, key=lambda x: (len(per[x]), x)) if per else None
    entry = {'m': mk, 'works': len(per), 'days': len(alld), 'kinds': dict(kinds)}
    if top:
        p, b = media_of(top)
        entry['top'] = {'title': top, 'days': len(per[top]), 'kind': meta[top]['category'], 'poster': p, 'backdrop': b}
    timeline.append(entry)
busiest = max(timeline, key=lambda e: (e['works'], e['days']))
# 正在看：觀看紀錄的最後一筆（Netflix 匯出檔第一行是最新的；排除清單裡的作品跳過）
import csv as _csv
now_title = None
for row in _csv.DictReader(open(ROOT / 'data' / 'raw' / 'NetflixViewingHistory.csv', encoding='utf-8')):
    t0 = row['Title'].split(': ')[0].strip()
    if t0 in works:
        now_title = t0
        break
now_p, now_b = media_of(now_title)
now = {'title': now_title, 'kind': meta[now_title]['category'], 'last': max(works[now_title]['days']).isoformat(), 'days': ndays[now_title], 'poster': now_p, 'backdrop': now_b}
timeline[-1]['now'] = now
moments = {timeline[0]['m']: '從這個月開始有紀錄。', end.strftime('%Y-%m'): f'這個月，也就是現在。我正在看《{now_title}》。'}
moments[busiest['m']] = f"看最多部的一個月：{busiest['works']} 部。"
if dom:
    moments[dom['month']] = f"這個月我有開 Netflix 的 {dom['of']} 天裡，有 {dom['days']} 天在看《{dom['title']}》。"
with ThreadPoolExecutor(6) as ex:
    new += sum(ex.map(get, jobs2))
years = {}
for e in timeline:
    yk = e['m'][:4]
    years.setdefault(yk, {'works': set(), 'days': 0})
for k, w in works.items():
    for d in w['days']:
        years[str(d.year)]['works'].add(k)
for yk, v in years.items():
    v['days'] = len({d for w in works.values() for d in w['days'] if d.year == int(yk)})
    v['works'] = len(v['works'])
story = {
    'owner': owner, 'ownerFull': owner_full, 'total': len(works), 'since': min(min(w['days']) for w in works.values()).isoformat(), 'until': end.isoformat(),
    'signature': sig, 'dominance': dom, 'shelf': shelf, 'counts': counts,
    'favorites': favorites, 'timeline': timeline, 'moments': moments, 'years': years, 'now': now,
}
(HERE / 'story.js').write_text('// 由 build_story.py 從 data/netflix-works.json 算出，不要手改\nwindow.STORY = ' + json.dumps(story, ensure_ascii=False) + ';\n')
by = collections.Counter(s['kind'] for s in shelf)
print('正在看：', now_title, now['last'])
print(f'時間軸 {len(timeline)} 個月，最忙 {busiest["m"]}（{busiest["works"]} 部）；每年：', {k: v['works'] for k, v in years.items()})
print(f'片櫃 {len(shelf)} 片 {dict(by)}；這段時間看過：{counts}；新下載 {new} 張；代表作 {sig}')
