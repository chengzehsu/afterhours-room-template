"""公開快照的外流檢查：在私人 repo 算出「不能出現在公開版」的字串，逐檔比對快照。

用法：python3 -I scripts/public/check_snapshot.py <私人 repo 根目錄> <快照目錄>
有命中就以 1 結束。權杖值只回報命中的檔案路徑，絕不印出值本身。

禁用字串來源（都從私人 repo 讀，換人用也成立）：
- 主人：profile.json 的 owner.name（整串與每個字）、owner.url 的使用者 id、owner.json 的 name／alias
- 部署：wrangler.jsonc 的 account_id 與 name、任何 *.workers.dev 子網域
- 本機：家目錄路徑
- 權杖：tools/spotify-mcp-server/spotify-config.json、tools/tmdb-config.json、web/.spotify-readonly-token.json 裡 16 字元以上的字串值
  （worktree 也會回主工作目錄找；一個都沒讀到就失敗）
- 品味：profile.json 的歌手、曲目、專輯名稱，owner.json 的最愛，data/netflix-works.json 的片名
- ID：profile.json 的 Spotify id、ISRC、封面網址檔名，chorus.json 的 key，owner.json 的 spotify 欄位，
  story.js 的片櫃 id（tv-123、movie-123）與海報檔名，data/netflix-works.json 的 id（文字檔內容與檔名都比對）
- 額外：scripts/public/forbidden.txt（一行一個，選用）
"""
import json, os, re, subprocess, sys
from pathlib import Path

PRIV, SNAP = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
CJK = re.compile(r'[㐀-鿿]')


def load(p):
    try:
        return json.loads((PRIV / p).read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from strings(v)


def taste_worthy(s):
    """太短的名字（例如兩個字的中文、四個字母的英文）容易誤判，不列入。"""
    s = s.strip()
    return len(s) >= 3 if CJK.search(s) else len(s) >= 6


identity, taste, secrets, ids, tmdb_ids = set(), set(), set(), set(), set()

profile = load('web/src/data/profile.json') or {}
owner = profile.get('owner') or {}
if owner.get('name'):
    identity.add(owner['name'])
    identity.update(w for w in owner['name'].split() if len(w) >= 3)
m = re.search(r'open\.spotify\.com/user/([^/?#]+)', owner.get('url') or '')
if m:
    identity.add(m.group(1))
ownerj = load('web/src/data/owner.json') or {}
for k in ('name', 'alias'):
    if isinstance(ownerj.get(k), str) and len(ownerj[k]) >= 2:
        identity.add(ownerj[k])

wr = (PRIV / 'web/wrangler.jsonc')
if wr.exists():
    t = wr.read_text(encoding='utf-8')
    for key in ('account_id', 'name'):
        mm = re.search(rf'"{key}"\s*:\s*"([^"]+)"', t)
        if mm and len(mm.group(1)) >= 6:
            identity.add(mm.group(1))
sc = load('web/site.config.json') or {}
if isinstance(sc.get('worker'), str) and len(sc['worker']) >= 6:
    identity.add(sc['worker'])
for f in ('.github/workflows/deploy.yml', 'web/src/share/scene.ts', 'web/site.config.json'):
    p = PRIV / f
    if p.exists():
        identity.update(re.findall(r'([a-z0-9-]+)\.workers\.dev', p.read_text(encoding='utf-8')))
identity.add(str(Path.home()))
extra = PRIV / 'scripts/public/forbidden.txt'
if extra.exists():
    identity.update(l.strip() for l in extra.read_text(encoding='utf-8').splitlines() if l.strip() and not l.startswith('#'))

# 權杖檔不進版本控制：在 git worktree 裡執行時，worktree 沒有權杖檔，要回主工作目錄找
try:
    common = subprocess.run(['git', '-C', str(PRIV), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                            capture_output=True, text=True, check=True).stdout.strip()
    roots = {PRIV, Path(common).parent.resolve()}
except (OSError, subprocess.CalledProcessError):
    roots = {PRIV}
for root in roots:
    for f in ('tools/spotify-mcp-server/spotify-config.json', 'tools/tmdb-config.json', 'web/.spotify-readonly-token.json'):
        try:
            o = json.loads((root / f).read_text(encoding='utf-8'))
        except (FileNotFoundError, json.JSONDecodeError):
            continue
        # redirect URI 這類網址是公開設定，不是權杖
        secrets.update(s for s in strings(o) if len(s) >= 16 and not re.match(r'https?://', s))
if not secrets and os.environ.get('ALLOW_NO_SECRETS') != '1':
    print('一個權杖值都沒讀到，權杖比對等於沒做：請在有權杖檔的私人 repo 執行（確定沒有權杖檔才設 ALLOW_NO_SECRETS=1）', file=sys.stderr)
    sys.exit(1)

music = profile.get('music') or {}
for r in (music.get('ranges') or {}).values():
    for a in r.get('artists', []):
        taste.add(a.get('name', ''))
    for t in r.get('tracks', []):
        taste.add(t.get('name', ''))
        taste.add((t.get('album') or {}).get('name', ''))
fav = ownerj.get('favorites') or {}
taste.update(fav.get('screen') or [])
taste.update(g.get('name', '') for g in fav.get('gigs') or [])
taste.update(o.get('title', '') for o in load('data/netflix-works.json') or [])
taste = {s for s in taste if s and taste_worthy(s)}


def collect_ids(o):
    """真實資料裡的識別碼：換了名字，id 一樣能對回業主的帳號與片單"""
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, str):
                if k in ('id', 'isrc', 'spotify') and len(v) >= 10:
                    ids.add(v)
                elif re.match(r'https?://', v) or v.endswith(('.jpg', '.png', '.webp')):
                    base = re.sub(r'\.(jpg|png|webp)$', '', v.rstrip('/').rsplit('/', 1)[-1])
                    if len(base) >= 16:
                        ids.add(base)
            collect_ids(v)
    elif isinstance(o, list):
        for v in o:
            collect_ids(v)


collect_ids(profile)
collect_ids(ownerj)
collect_ids(load('data/netflix-works.json'))
ids.update(k for k in (load('web/src/data/chorus.json') or {}) if len(k) >= 10)
story_js = PRIV / 'web/public/screening/story.js'
if story_js.exists():
    st = story_js.read_text(encoding='utf-8')
    try:
        story = json.loads(st[st.index('=') + 1:].strip().rstrip(';'))
    except ValueError:
        story = {}
    for it in story.get('shelf') or []:
        if re.fullmatch(r'(tv|movie)-\d+', str(it.get('id', ''))):
            tmdb_ids.add(it['id'])
        collect_ids({k: v for k, v in it.items() if k != 'id'})
ids = {s for s in ids if not s.startswith('sample-')}
tmdb_rx = re.compile(r'(?<![\w-])(?:' + '|'.join(map(re.escape, sorted(tmdb_ids))) + r')(?!\w)') if tmdb_ids else None
identity = {s for s in identity if s}

hits = []
for p in sorted(SNAP.rglob('*')):
    if not p.is_file() or '.git' in p.relative_to(SNAP).parts:
        continue
    rel = p.relative_to(SNAP).as_posix()
    for s in ids:
        if s in rel:
            hits.append(f'ID    {rel}: 檔名含真實 id {s}')
    data = p.read_bytes()
    binary = b'\0' in data[:4096]
    for s in identity:
        if binary and len(s.encode()) < 6:
            continue  # 短字串在圖片、模型的位元組裡會碰巧出現
        if s.encode() in data:
            hits.append(f'身分  {rel}: {s}')
    for s in secrets:
        if s.encode() in data:
            hits.append(f'權杖  {rel}: （值不顯示）')
    if binary:
        continue  # 二進位檔只查身分與權杖
    text = data.decode('utf-8', 'replace')
    for s in taste:
        if s in text:
            hits.append(f'品味  {rel}: {s}')
    for s in ids:
        if s in text:
            hits.append(f'ID    {rel}: {s}')
    if tmdb_rx:
        for m in set(tmdb_rx.findall(text)):
            hits.append(f'ID    {rel}: {m}')

print(f'禁用字串：身分 {len(identity)}、權杖 {len(secrets)}、品味 {len(taste)}、ID {len(ids) + len(tmdb_ids)}；掃描 {SNAP}')
if hits:
    print(f'命中 {len(hits)} 筆，不能公開：')
    for h in hits[:200]:
        print('  ' + h)
    sys.exit(1)
print('沒有命中')
