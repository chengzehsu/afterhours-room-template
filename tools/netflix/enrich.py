"""用 TMDB 為 Netflix 作品補上類型、國家、語言。結果快取在 data/tmdb-cache.json，重跑只查新的。

用法：python3 -I tools/netflix/enrich.py data/raw/NetflixViewingHistory.csv
"""
import http.client, json, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from classify import load_works

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'data' / 'tmdb-cache.json'
OUT = ROOT / 'data' / 'netflix-works.json'
MEDIA = ROOT / 'web' / 'public' / 'media'
# 頁面每類顯示幾部；排序規則要和 web/src/core/screen-stories.ts 一致
WALL = {'電影': 12, '影集': 12, '動畫': 12, '實境秀': 6}
SIZES = {'sm': 'w342', 'lg': 'w780'}
TMDB_CONFIG = ROOT / 'tools' / 'tmdb-config.json'


def _token():
    """TMDB 的 API Read Access Token：環境變數 TMDB_READ_TOKEN 優先，否則讀 tools/tmdb-config.json（權限 600、不進版本控制）。"""
    import os
    t = os.environ.get('TMDB_READ_TOKEN', '').strip()
    if t:
        return t
    if not TMDB_CONFIG.exists():
        raise SystemExit('找不到 TMDB 權杖：設環境變數 TMDB_READ_TOKEN，或建立 tools/tmdb-config.json（{"readAccessToken": "..."}），見 README')
    return json.load(open(TMDB_CONFIG))['readAccessToken'].strip()


TOKEN = _token()

def get(path, **params):
    params.setdefault('language', 'zh-TW')
    url = f'https://api.themoviedb.org/3{path}?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + TOKEN, 'accept': 'application/json'})
    for attempt in range(6):
        try:
            return json.load(urllib.request.urlopen(req, timeout=20))
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(2 ** attempt); continue
            raise
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError):
            time.sleep(2 ** attempt)  # 代理偶爾截斷回應，重試即可
    raise RuntimeError(f'TMDB 請求失敗：{path}')

# TMDB 的 zh-TW 類型表常回簡體或英文，用台灣用語固定下來
GENRE_TW = {28: '動作', 12: '冒險', 16: '動畫', 35: '喜劇', 80: '犯罪', 99: '紀錄片', 18: '劇情', 10751: '家庭',
            14: '奇幻', 36: '歷史', 27: '恐怖', 10402: '音樂', 9648: '懸疑', 10749: '愛情', 878: '科幻',
            10770: '電視電影', 53: '驚悚', 10752: '戰爭', 37: '西部', 10759: '動作冒險', 10762: '兒童',
            10763: '新聞', 10764: '實境秀', 10765: '科幻奇幻', 10766: '肥皂劇', 10767: '脫口秀', 10768: '戰爭政治'}

def genre_maps():
    m = {}
    for kind in ('movie', 'tv'):
        m[kind] = {g['id']: GENRE_TW.get(g['id'], g['name']) for g in get(f'/genre/{kind}/list')['genres']}
    return m

import re, unicodedata
def norm(t):
    t = unicodedata.normalize('NFKC', t or '').lower().replace('黄', '黃')
    return re.sub(r'[\s\W_]+', '', t)

def pack(kind, r):
    return {'kind': kind, 'id': r['id'], 'title': r.get('title') or r.get('name'),
            'original_title': r.get('original_title') or r.get('original_name'),
            'genre_ids': r.get('genre_ids', []), 'original_language': r.get('original_language'),
            'origin_country': r.get('origin_country', []),
            'date': r.get('release_date') or r.get('first_air_date'), 'popularity': r.get('popularity'),
            'poster_path': r.get('poster_path'), 'backdrop_path': r.get('backdrop_path')}

def search(q, is_series, last_watched, is_anime):
    """在電影與影集兩邊的前幾筆結果裡打分挑一筆。"""
    cands = []
    for kind in ('tv', 'movie'):
        for r in get(f'/search/{kind}', query=q, include_adult='false').get('results', [])[:8]:
            cands.append(pack(kind, r))
    if not cands:
        return None
    nq = norm(q)
    def score(c):
        sc = 0
        nt, no = norm(c['title']), norm(c['original_title'])
        if nq in (nt, no): sc += 100
        elif nq and (nq in nt or nt in nq): sc += 40
        if (c['kind'] == 'tv') == is_series: sc += 30
        if c['date'] and c['date'] > last_watched: sc -= 200  # 還沒上映不可能看過
        if not c['date']: sc -= 20
        if (16 in c['genre_ids']) == is_anime: sc += 50  # 同名的動畫版／真人版，依分類挑
        return sc + min(c['popularity'] or 0, 50) / 5
    best = max(cands, key=score)
    return best if score(best) > 0 else None

def wall_order(works):
    """電影依最近觀看排；其他類依觀看天數排，同天數再看最近觀看。每部作品只算一次，不看集數。"""
    if works and works[0]['category'] == '電影':
        return sorted(works, key=lambda o: o['last'], reverse=True)
    return sorted(works, key=lambda o: (o['days'], o['last']), reverse=True)

def download(url, dest):
    if dest.exists():
        return
    for attempt in range(6):
        try:
            data = urllib.request.urlopen(url, timeout=30).read()
            dest.write_bytes(data)
            return
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError):
            time.sleep(2 ** attempt)
    raise RuntimeError(f'海報下載失敗：{url}')

def attach_posters(out):
    """只替頁面會顯示的作品下載海報，寫成 picture: {sm, lg}（相對 web/public 的路徑）。"""
    MEDIA.mkdir(parents=True, exist_ok=True)
    jobs = []
    for cat, n in WALL.items():
        for o in wall_order([o for o in out if o['category'] == cat])[:n]:
            path = o['tmdb'] and o['tmdb'].get('poster_path')
            if not path:
                continue
            o['picture'] = {}
            for key, size in SIZES.items():
                name = f"tmdb-{o['tmdb']['kind']}-{o['tmdb']['id']}-{key}.jpg"
                o['picture'][key] = f'media/{name}'
                jobs.append((f'https://image.tmdb.org/t/p/{size}{path}', MEDIA / name))
    with ThreadPoolExecutor(4) as ex:
        list(ex.map(lambda j: download(*j), jobs))
    return len(jobs)

def main(csv_path):
    works = load_works(csv_path)
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = [(k, w) for k, w in works.items() if k not in cache]
    print(f'共 {len(works)} 部，快取已有 {len(works) - len(todo)}，要查 {len(todo)}')
    def safe(kw):
        try:
            return kw[0], search(kw[1]['query'], kw[1]['is_series'], max(kw[1]['days']).isoformat(), kw[1]['category'] == '動畫'), None
        except Exception as e:  # 失敗的不寫快取，下次重跑會再查
            return kw[0], None, e
    failed = 0
    with ThreadPoolExecutor(4) as ex:
        for i, (k, r, err) in enumerate(ex.map(safe, todo), 1):
            if err: failed += 1; continue
            cache[k] = r
            if i % 50 == 0: CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
    if failed: print(f'有 {failed} 部查詢失敗，重跑一次會補查')
    gm = genre_maps()
    out = []
    for k, w in works.items():
        m = cache.get(k)
        cat = w['category']
        if cat == '影集' and m and 10764 in m['genre_ids']:
            cat = '實境秀'  # TMDB 類型 10764 = Reality
        out.append({'title': k, 'category': cat, 'days': len(w['days']), 'episodes': w['episodes'],
                    'query': w['query'], 'first': min(w['days']).isoformat(), 'last': max(w['days']).isoformat(),
                    'tmdb': m and {**m, 'genres': [gm[m['kind']].get(g, str(g)) for g in m['genre_ids']]}})
    n = attach_posters(out)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f'海報 {n} 張（已存在的不重抓）')
    print(f'寫入 {OUT.relative_to(ROOT)}，找不到的有 {sum(1 for o in out if not o["tmdb"])} 部')

if __name__ == '__main__':
    main(sys.argv[1])
