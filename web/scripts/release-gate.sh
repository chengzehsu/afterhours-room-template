#!/bin/zsh
# 上線前關卡（自動迴圈用，機器可讀）：全部通過印「GATE PASS」並 exit 0，任何一項失敗印「GATE FAIL」並 exit 1。
#   npm run gate          完整：兩頁 × 15 RWD 尺寸（約 30–40 分鐘）
#   GATE_QUICK=1 npm run gate   快速：兩頁 × 5 尺寸（390、375、768 觸控、1280×720、1920×1080），迴圈中途用
#   GATE_NO_BROWSER=1 npm run gate  只跑不開瀏覽器的項目（語法、測試、型別、Python、建置），幾分鐘內
# 只用 headless（沙盒內可跑）；Aside 實機驗收與目測不在這裡（.aside/run-release.sh，業主跑）。
# 亮度稽核（brightness-audit.mjs）規則仍有誤報，不列入關卡；ON AIR 亮度上限由單元測試把關。
cd "${0:A:h}/.." || exit 1
export PATH="$PWD/../tools/node26/bin:$PATH" npm_config_cache="${TMPDIR:-/tmp}/npm-cache" AUDIT_SINGLE_PROCESS=1
OUT="${TMPDIR:-/tmp}/gate"; DIST="$OUT/dist"; rm -rf "$OUT"; mkdir -p "$OUT"
fails=()
step() { # 名稱 指令…
  local name=$1; shift
  local t0=$SECONDS
  echo "GATE … $name 進行中（記錄：$OUT/$name.log）"
  # 版面稽核要 30～40 分鐘：每跑完一個尺寸就把那行結果（✓／✗）同步印出來，不然終端機一片安靜像卡住
  if [[ $name == layout ]]; then
    "$@" 2>&1 | tee "$OUT/$name.log" | grep --line-buffered -E '^[✓✗] ' | sed -u 's/^/    /'
    local rc=${pipestatus[1]}
    if (( rc == 0 )); then echo "GATE ✓ $name ($((SECONDS - t0))s)"; else echo "GATE ✗ $name ($((SECONDS - t0))s) → $OUT/$name.log"; fails+=$name; fi
    return
  fi
  if "$@" > "$OUT/$name.log" 2>&1; then echo "GATE ✓ $name ($((SECONDS - t0))s)"
  else echo "GATE ✗ $name ($((SECONDS - t0))s) → $OUT/$name.log"; tail -15 "$OUT/$name.log" | sed 's/^/    /'; fails+=$name; fi
}
restore_deploy() { printf '{"configPath":"../../dist/wrangler.json","auxiliaryWorkers":[]}' > .wrangler/deploy/config.json; }

step syntax zsh -c 'node --check screening/main.js && for f in scripts/*.mjs; do node --check "$f" || exit 1; done'
step unit npm test
step typecheck npm run typecheck
step python python3 -I -m unittest discover -s ../tools/netflix -p 'test_*.py'
# 建到自己的目錄（不寫 dist/）；Cloudflare 外掛會把 .wrangler/deploy/config.json 指到這裡，建完立刻還原
step build npx vite build --outDir "$DIST" --emptyOutDir
restore_deploy
if [[ -z ${fails[(r)build]} && -z $GATE_NO_BROWSER ]]; then
  if [[ -n $GATE_QUICK ]]; then sizeEnv="AUDIT_SIZES=390x844t,375x667t,768x1024t,1280x720,1920x1080"; else sizeEnv="AUDIT_PRESET=rwd"; fi
  step layout env AUDIT_DIST="$DIST" "$sizeEnv" node scripts/mobile-audit.mjs "$OUT/layout"
  step opening-hover node scripts/opening-hover-check.mjs "$DIST"
fi
restore_deploy
if (( ${#fails} )); then echo "GATE FAIL：${fails[*]}（詳細在 $OUT/）"; exit 1; fi
echo "GATE PASS"
