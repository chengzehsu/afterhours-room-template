#!/usr/bin/env bash
# 從私人 repo 產生公開快照，同步到公開 repo 的本機 clone。
#
#   scripts/export-public.sh <公開 repo 的本機資料夾> [git ref，預設 HEAD]
#
# 1. git archive <ref>（只拿已 commit 的檔案，工作目錄沒 commit 的改動不會外流）
# 2. 拿掉 scripts/public/exclude.txt 列的路徑，放回 keep.txt 列的路徑
# 3. 部署設定換成佔位值（web/site.config.json 的網址與 Worker 名稱、Cloudflare 帳號 id）
# 4. 產生假資料範例（web/scripts/make-sample-data.ts）
# 5. 外流檢查（scripts/public/check_snapshot.py）：有命中就中止，目的地完全不動
# 6. 同步到目的地（保留目的地的 .git，刪掉快照裡已經沒有的檔案），再由你看過 diff 自己 commit、push
#
# 需要：git、rsync、python3、Node 23.6 以上（私人 repo 的 web/node_modules 要先 npm ci 過）。
set -euo pipefail

DEST=${1:?用法：scripts/export-public.sh <公開 repo 的本機資料夾> [git ref]}
REF=${2:-HEAD}
ROOT=$(git rev-parse --show-toplevel)
HERE="$ROOT/scripts/public"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/export-public.XXXXXX")
SNAP="$WORK/snap"
trap 'rm -rf "$WORK"' EXIT

if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ] && [ ! -d "$DEST/.git" ]; then
  echo "目的地 $DEST 不是空資料夾、也不是 git repo，不覆蓋" >&2; exit 1
fi
real() { python3 -I -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$1"; }
case "$(real "$DEST")/" in "$(real "$ROOT")/"*)
  echo "目的地不能是私人 repo 本身或它底下的資料夾（rsync --delete 會刪掉權杖檔與原始資料）" >&2; exit 1 ;;
esac
if [ "$(git -C "$ROOT" rev-parse "$REF")" != "$(git -C "$ROOT" rev-parse HEAD)" ]; then
  echo "只能匯出 HEAD：外流檢查讀的是工作目錄的私人資料，要跟匯出的版本一致" >&2; exit 1
fi
if [ ! -d "$ROOT/web/node_modules" ]; then
  echo "私人 repo 的 web/node_modules 不存在：先在 web/ 跑 npm ci" >&2; exit 1
fi

echo "① 從 $(git -C "$ROOT" rev-parse --short "$REF") 取出已 commit 的檔案"
mkdir -p "$SNAP"
git -C "$ROOT" archive --format=tar "$REF" | tar -x -C "$SNAP"

echo "② 拿掉個人資料與工具設定"
mkdir -p "$WORK/keep"
while IFS= read -r p; do
  case "$p" in ''|'#'*) continue ;; esac
  [ -e "$SNAP/$p" ] || { echo "keep.txt 的 $p 不在 $REF 裡" >&2; exit 1; }
  mkdir -p "$WORK/keep/$(dirname "$p")" && cp -R "$SNAP/$p" "$WORK/keep/$(dirname "$p")/"
done < "$HERE/keep.txt"
(
  cd "$SNAP"
  shopt -s nullglob dotglob
  while IFS= read -r p; do
    case "$p" in ''|'#'*) continue ;; esac
    for m in $p; do rm -rf -- "$m"; done
  done < "$HERE/exclude.txt"
)
cp -R "$WORK/keep/." "$SNAP/"
cat "$HERE/gitignore-append" >> "$SNAP/.gitignore"

echo "③ 部署設定換成佔位值"
python3 -I - "$SNAP" <<'PY'
import re, sys
from pathlib import Path
snap = Path(sys.argv[1])
import json
cfg = json.loads((snap / 'web/site.config.json').read_text(encoding='utf-8'))
name, url = cfg['worker'], cfg['url'].rstrip('/')
wr = snap / 'web/wrangler.jsonc'
t = wr.read_text(encoding='utf-8')
t = re.sub(r'\n\s*"account_id"\s*:\s*"[^"]*",?', '', t)  # wrangler 改讀環境變數 CLOUDFLARE_ACCOUNT_ID
wr.write_text(t, encoding='utf-8')
wf = snap / '.github/workflows/deploy.yml'
w = wf.read_text(encoding='utf-8')
tok = "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n"
assert w.count(tok) == 1, 'deploy.yml 的 CLOUDFLARE_API_TOKEN 那行變了，請更新 export-public.sh'
wf.write_text(w.replace(tok, tok + "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}\n"), encoding='utf-8')
for p in snap.rglob('*'):
    if not p.is_file() or p.suffix not in {'.ts', '.js', '.mjs', '.json', '.jsonc', '.yml', '.yaml', '.md', '.html', '.py', '.sh'}:
        continue
    s = p.read_text(encoding='utf-8')
    # 只換業主自己的網址與 Worker 名稱（範例、測試裡別的 workers.dev 網址不動；漏換的由外流檢查擋）
    n = s.replace(url, 'https://your-room.your-subdomain.workers.dev').replace(name, 'your-room')
    if n != s:
        p.write_text(n, encoding='utf-8')
        print('   ', p.relative_to(snap))
PY

echo "④ 產生假資料範例"
ln -s "$ROOT/web/node_modules" "$SNAP/web/node_modules"
NODE=$(command -v node)
[ -x "$ROOT/tools/node26/bin/node" ] && NODE="$ROOT/tools/node26/bin/node"
(cd "$SNAP/web" && "$NODE" scripts/make-sample-data.ts --root "$SNAP" >/dev/null)
rm "$SNAP/web/node_modules"
# 歌手照片（data:gigs 下載）不進版本控制；範例圖檔名是假的 artist id，沒辦法用萬用字元放行，逐一列出
{ echo "web/public/gigs/*"; for f in "$SNAP"/web/public/gigs/*.jpg; do echo "!web/public/gigs/$(basename "$f")"; done; } >> "$SNAP/.gitignore"

echo "⑤ 外流檢查"
python3 -I "$HERE/check_snapshot.py" "$ROOT" "$SNAP"
leaked=$(cd "$SNAP" && find . -name '.*' -not -name '.gitignore' -not -name '.assetsignore' -not -name '.github' -not -path './.github/*' -not -name '.' | head -20)
if [ -n "$leaked" ]; then echo "快照裡有不該公開的點檔：" >&2; echo "$leaked" >&2; exit 1; fi

echo "⑥ 同步到 $DEST"
mkdir -p "$DEST"
rsync -a --delete --exclude .git "$SNAP/" "$DEST/"
echo "完成。接著看過差異再 commit、push："
echo "  git -C \"$DEST\" add -A && git -C \"$DEST\" status --short | head && git -C \"$DEST\" diff --cached --stat | tail -3"
