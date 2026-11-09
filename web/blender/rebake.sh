#!/bin/zsh
# 播放室重新烘焙：建模＋三時段烘焙 → Draco 壓縮 → 換進 web/public/room/（舊檔先備份）
# 用法：在 repo 根目錄執行 web/blender/rebake.sh（Blender 在 Claude Code 沙盒裡會因 Metal 崩潰，要在 Mac 終端機 App 跑）
set -euo pipefail
cd "$(dirname "$0")/../.."
B=/Applications/Blender.app/Contents/MacOS/Blender
OUT="$(mktemp -d)/room"; PREV="$(dirname "$OUT")/preview"; mkdir -p "$OUT" "$PREV"
BK="web/blender/.backup-$(date +%Y%m%d-%H%M)"; mkdir -p "$BK"; cp web/public/room/* "$BK/"
echo "舊檔備份在 $BK；烘焙輸出到 $OUT"
time "$B" -b --factory-startup -P web/blender/build_room.py -- --out "$OUT" --samples 512 --size 2048 --preview "$PREV"
"$B" -b --factory-startup -P web/blender/compress_glb.py -- "$OUT/room.glb" web/public/room/room.glb
cp "$OUT"/*.jpg "$OUT"/lights.json web/public/room/
ls -la web/public/room/ "$BK"/room.glb
echo "預覽圖：$PREV"
