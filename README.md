# 播放室與放映室

把自己的 Spotify 聽歌紀錄和 Netflix 觀看紀錄，做成一間可以走進去的 3D 房間。

- **播放室**：CD 牆上掛著你最常聽的專輯，挑一張放上唱盤就會播放，歌詞跟著跑。
- **放映室**：在隔壁的客廳，片櫃裡是你這幾年反覆回來看的作品，銀幕上播預告片。

頁面上的每一句話都是從資料算出來的，用主人的第一人稱來寫，換成你的資料，整間房間就變成你的。

技術上是 Vite + Three.js 的靜態網站，沒有後端。資料在你自己的電腦上抓好、算好，建置成靜態檔，再部署到 Cloudflare Workers（也可以放在任何靜態主機上）。

> 這個 repo 附的是**虛構的範例資料**：歌手、歌名、片名、主人都是假的，封面和海報是佔位圖。clone 下來不需要任何金鑰就能跑。

## 最快的路：10 分鐘換成你的播放室

在 GitHub 上按 **Use this template**（或 Fork）複製一份成你自己的 repo，clone 下來：

```bash
cd <你的 repo>/web
npm ci
npm run setup           # 問 4 題：名字、別名、Worker 名稱、網址
npm run spotify:login   # 貼上 Spotify app 的 Client ID／secret，瀏覽器按同意（app 怎麼建見 5.1）
npm run data            # 抓你的聽歌資料、下載封面、算副歌
npm run dev             # 打開 http://localhost:5173 看你的房間
```

不確定做到哪一步，隨時跑：

```bash
npm run doctor          # 列出每一步完成了沒，告訴你下一個指令
```

放映室（Netflix）、演唱會牆、部署都是選用的，doctor 會一起列出來，細節在下面各節。你的權杖只會存在自己電腦的 `web/.spotify-readonly-token.json`（權限 600、不進版本控制），或你自己 repo 的 GitHub secret。

---

## 目錄

0. [最快的路：10 分鐘換成你的播放室](#最快的路10-分鐘換成你的播放室)
1. [先用範例資料跑起來](#1-先用範例資料跑起來)
2. [要安裝哪些東西](#2-要安裝哪些東西)
3. [換成你自己的版本：總覽](#3-換成你自己的版本總覽)
4. [主人資訊](#4-主人資訊)
5. [串接 Spotify](#5-串接-spotify)
6. [讀取 Netflix 觀看紀錄](#6-讀取-netflix-觀看紀錄)
7. [從 TMDB 取得影集與電影資訊](#7-從-tmdb-取得影集與電影資訊)
8. [3D 房間是怎麼做出來的](#8-3d-房間是怎麼做出來的)
9. [部署](#9-部署)
10. [資料流與專案結構](#10-資料流與專案結構)
11. [安全與隱私](#11-安全與隱私)
12. [私人 repo 與公開 repo 同步](#12-私人-repo-與公開-repo-同步)
13. [授權與素材來源](#13-授權與素材來源)

---

## 1. 先用範例資料跑起來

```bash
git clone <這個 repo> && cd <repo>/web
npm ci
npm run dev          # 打開終端機印出的網址（預設 http://localhost:5173）
```

其他常用指令（都在 `web/` 底下執行）：

| 目的 | 指令 |
|---|---|
| 測試 | `npm test` |
| 型別檢查 | `npm run typecheck` |
| 建置成靜態檔（輸出到 `web/dist/`） | `npm run build` |
| 重新產生範例資料 | `npm run data:sample` |
| 看設定做到哪一步 | `npm run doctor` |

範例資料沒有真的 Spotify 曲目 id，所以唱盤**不會出聲**。換成你自己的資料以後，Spotify 嵌入播放器就能播放。

## 2. 要安裝哪些東西

| 工具 | 版本 | 用在哪裡 | 一定要裝嗎 |
|---|---|---|---|
| [Node.js](https://nodejs.org/) | **24 以上**（CI 用 26） | 網站建置、測試、Spotify 資料腳本。測試跟腳本直接執行 `.ts`，所以 Node 要內建型別剝除（23.6 以上） | 要 |
| npm 套件 | `npm ci` 自動安裝 | `three`（3D）、`vite`（建置）、`typescript`、`sharp`（建置時合成分享圖）、`wrangler` 與 `@cloudflare/vite-plugin`（部署到 Cloudflare） | 要 |
| Python | 3.9 以上，只用標準函式庫 | Netflix CSV 分類、TMDB 補資料、產生放映室資料 | 要做放映室才需要 |
| `curl` | 系統內建的就可以 | 下載放映室的海報與劇照 | 要做放映室才需要 |
| 中文字型 | Linux 執行 `sudo apt-get install fonts-noto-cjk` | 建置時 sharp 用它把中文畫進分享圖，沒裝會變成方框。macOS、Windows 內建的就夠了 | Linux 上要 |
| [Blender](https://www.blender.org/) | 5.x（repo 裡的 glb 用 5.2 匯出） | 只有要**改 3D 房間**時才需要，見[第 8 節](#8-3d-房間是怎麼做出來的) | 不用 |
| [Switzer 字型](https://www.fontshare.com/fonts/switzer) | 400、500、600 三種字重的 woff2 | 英數字的字型。repo 不附字型檔，自己下載後放到 `web/public/fonts/switzer-{400,500,600}.woff2`；沒放就用系統字型 | 不用 |

## 3. 換成你自己的版本：總覽

```
Spotify Web API ──fetch-spotify──▶ data/raw/spotify.json ──build-profile──▶ web/src/data/profile.json ＋ 封面圖
                                                                 └─fetch-chorus（lrclib）──▶ web/src/data/chorus.json
Netflix CSV ──classify + enrich（TMDB）──▶ data/netflix-works.json ──build_story──▶ web/public/screening/story.js ＋ 海報
你自己寫的 ──────────────────────────────────────────────────────▶ web/src/data/owner.json、opener.json
                                         ▼
                             npm run build ──▶ web/dist/ ──▶ 部署
```

照這個順序做：

1. 改主人資訊（[第 4 節](#4-主人資訊)）
2. 串接 Spotify，抓自己的聽歌資料（[第 5 節](#5-串接-spotify)）
3. 下載 Netflix 觀看紀錄（[第 6 節](#6-讀取-netflix-觀看紀錄)），用 TMDB 補資料並產生放映室（[第 7 節](#7-從-tmdb-取得影集與電影資訊)）
4. 設定部署（[第 9 節](#9-部署)）

只想要播放室也可以：跳過 3，放映室會沿用範例資料。不要放映室的話，就刪掉 `web/screening/index.html`。

**一定要改的值**

| 位置 | 改成什麼 |
|---|---|
| `web/site.config.json` | `url`：網站完整網址（分享縮圖、`og:url`、部署後檢查都用它）；`worker`：Cloudflare Worker 名稱。`npm run setup` 會幫你寫 |
| `web/src/data/owner.json` | 名字、別名（`npm run setup` 會幫你寫）；最愛清單要自己填（見第 4 節） |
| `tools/netflix/rules.example.json` → 複製成 `data/netflix-rules.json` | 你的 Netflix 分類規則（見第 6 節） |

## 4. 主人資訊

`web/src/data/owner.json`：

```jsonc
{
  "name": "阿明",                 // 名牌和開場自我介紹用的名字
  "alias": "Ming",                // 別名，可省略：「嗨，我是阿明，也可以叫我 Ming。」
  "share": {
    "posterSwap": { "片名A": "片名B" }   // 分享圖上想把某張海報換成另一部片，可省略
  },
  "favorites": {
    "screen": ["作品名", "..."],         // 一定會放進放映室片櫃的作品，名稱要跟 Netflix CSV 的作品名一樣
    "gigs": [{ "name": "歌手名", "spotify": "<Spotify artist id>" }]  // 播放室牆上的演唱會燈箱，可省略
  }
}
```

- `favorites.screen` 也是放映室「最愛燈箱牆」的片單，順序照你寫的。
- `favorites.gigs` 的照片用 `npm run data:gigs` 下載（見 5.3）；名次越前面燈箱越大，不在年度排行裡的歌手框最小。
- `web/src/data/opener.json` 的 `artists`：開場「落針」那首歌從這些歌手的歌裡挑。
- 頁面上主人的全名、國家、Spotify 個人頁，來自 Spotify 帳號資料（`profile.json` 的 `owner`）。

## 5. 串接 Spotify

網站只會**讀取**你的資料，所以權杖只要唯讀權限。權杖只放在你的電腦上，或放在 GitHub secret，瀏覽器端不會拿到任何權杖。

### 5.1 建立 Spotify app

1. 準備一個 **Spotify Premium** 帳號。從 2026 年 2 月起，開發模式（Development Mode）的 app 擁有者必須是 Premium，每個 app 最多 5 位授權使用者（[官方說明](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)）。只抓你自己的資料，所以這樣就夠了。
2. 到 [Spotify for Developers Dashboard](https://developer.spotify.com/dashboard) 建立一個 app：
   - **Redirect URI** 填 `http://127.0.0.1:8888/callback`。Spotify 不接受 `localhost`，要用 `127.0.0.1`。
   - API 勾 **Web API**。
3. 從 app 的 Settings 複製 **Client ID** 和 **Client secret**。

### 5.2 取得唯讀的 refresh token（只要做一次）

```bash
cd web
npm run spotify:login   # 依序貼上 Client ID、Client secret（secret 輸入時不顯示）
```

用瀏覽器打開終端機印出的網址，按同意。Client ID、secret 和拿到的 refresh token 會存在 `web/.spotify-readonly-token.json`，權限 600，已列入 `.gitignore`，不會進版本控制。之後 `npm run data` 直接讀這個檔，不用再設環境變數。

> 已經 `export SPOTIFY_CLIENT_ID`／`SPOTIFY_CLIENT_SECRET` 的話就不會再問。

腳本只申請下面這些 scope，Spotify 實際給的 scope 只要多一個或少一個，腳本就不收：

`user-top-read`、`user-read-recently-played`、`user-follow-read`、`user-library-read`、`user-read-private`

### 5.3 抓資料、建 profile

```bash
npm run data           # = data:fetch → data:build → data:chorus
```

憑證來源依序是：環境變數 `SPOTIFY_CLIENT_ID`／`SPOTIFY_CLIENT_SECRET`／`SPOTIFY_REFRESH_TOKEN` 三個都有（CI 用這個）→ `web/.spotify-readonly-token.json`。

每一步做的事：

| 指令 | 做什麼 | 輸出 |
|---|---|---|
| `data:fetch` | 打 Spotify Web API，抓三段時間（4 週、6 個月、1 年）的前 50 名歌手與曲目、最近播放、追蹤的歌手、收藏 | `data/raw/spotify.json`（含帳號資料，已列入 `.gitignore`） |
| `data:build` | 經過 `web/src/adapters/spotify-api.ts` 轉成 `TasteProfile`，下載封面與歌手照 | `web/src/data/profile.json`、`web/public/media/` |
| `data:chorus` | 到 [LRCLIB](https://lrclib.net/) 查同步歌詞，算出副歌從第幾秒開始（只存秒數，不存歌詞） | `web/src/data/chorus.json` |
| `data:gigs`（另外跑） | 依 `owner.json` 的 `favorites.gigs`，透過 Spotify oEmbed 下載歌手照片（不需要權杖）；已經有的略過 | `web/public/gigs/<artist id>.jpg`（已列入 `.gitignore`） |

Spotify 換發新的 refresh token 時，會自動存回 `web/.spotify-readonly-token.json`。refresh token 失效了（例如在 Spotify 帳號撤銷授權），重跑 `npm run spotify:login` 就好。

> 你的網路如果要走代理，Node 的 `fetch` 需要加 `NODE_USE_ENV_PROXY=1`。

## 6. 讀取 Netflix 觀看紀錄

Netflix 沒有公開 API，要自己下載觀看紀錄的 CSV：

1. 用**電腦的瀏覽器**登入 Netflix，打開帳號頁 → 選你的**個人檔案** → **觀看紀錄（Viewing activity）**。
2. 捲到最下面，點**全部下載（Download all）**，會拿到 `NetflixViewingHistory.csv`，裡面只有 `Title` 和 `Date` 兩欄。
3. 把檔案放到 `data/raw/NetflixViewingHistory.csv`。`data/raw/` 已經列在 `.gitignore` 裡。

接著設定分類規則，把範例複製一份來改：

```bash
cp tools/netflix/rules.example.json data/netflix-rules.json
```

| 欄位 | 用途 |
|---|---|
| `date_format` | CSV 的日期格式，會跟著 Netflix 帳號的語系變。美式是 `%m/%d/%y`（`11/8/26`），歐式像 `%d/%m/%Y`。打開 CSV 看一下 |
| `exclude` | 不是你看的作品，例如同一個個人檔案裡家人看的 |
| `kids` | 兒童節目 |
| `anime_series`／`anime_movies` | 要算成「動畫」的影集和電影。CSV 本身分不出是不是動畫 |
| `movie_with_colon` | 片名裡有「: 」但其實是電影的作品。程式靠「: 」判斷是不是影集 |

片名要跟 CSV `Title` 欄位的第一段（第一個「: 」之前的文字）完全一樣。

權重以**作品**為單位，看了幾天才算數，不管看了幾集。這樣一口氣追完 20 集的劇，不會壓過反覆回來看的電影。

## 7. 從 TMDB 取得影集與電影資訊

CSV 只有片名。類型、國家、語言、海報、劇照、預告片，要靠 [TMDB](https://www.themoviedb.org/) 補上。

### 7.1 申請 TMDB 權杖

1. 註冊 TMDB 帳號，到 [Settings → API](https://www.themoviedb.org/settings/api) 申請 API，用途填個人、非商業。
2. 複製 **API Read Access Token**（很長的 Bearer token），不是 API Key。
3. 用下面任一種方式提供權杖：
   - 環境變數：`export TMDB_READ_TOKEN=<token>`
   - 檔案：建立 `tools/tmdb-config.json`，內容是 `{"readAccessToken": "<token>"}`，再執行 `chmod 600 tools/tmdb-config.json`。這個檔案已經列在 `.gitignore` 裡。

### 7.2 補資料、產生放映室

在 repo 根目錄執行：

```bash
python3 -I tools/netflix/enrich.py data/raw/NetflixViewingHistory.csv
python3 -I prototypes/screening-room/home/build_story.py --out web/public/screening --fetch-trailers --fetch-overviews
```

| 步驟 | 做什麼 | 輸出 |
|---|---|---|
| `enrich.py` | 每部作品同時搜尋 TMDB 的電影和影集，用片名、是不是影集、上映日期、是不是動畫打分數，挑最像的一筆；類型名稱改成台灣用語；結果有快取，重跑只查新的 | `data/netflix-works.json`、`data/tmdb-cache.json` |
| `build_story.py` | 算出片櫃、時間軸、代表作、「包場」月份等故事；下載海報（寬 342）和劇照（寬 780）；加上 `--fetch-trailers` 時，替片櫃作品挑 YouTube 官方預告（快取在 `data/tmdb-videos.json`）；加上 `--fetch-overviews` 時，補抓劇情簡介（zh-TW，沒有再試 zh-HK，簡體或空的就不放；快取在 `data/tmdb-overviews.json`） | `web/public/screening/story.js`、`web/public/screening/media/` |

TMDB 的使用條款要求在網站上標示「本產品使用 TMDB API，但未經 TMDB 認可或授權」，並放 TMDB 的標誌（[TMDB API 使用條款](https://www.themoviedb.org/api-terms-of-use)）。放映室頁面已經有這句文字（`web/screening/index.html`），標誌要不要加、怎麼加，照條款自行處理。

## 8. 3D 房間是怎麼做出來的

兩間房都用同一個做法：**在 Blender 用 Cycles 把光照烘焙成貼圖**，匯出 glb 加上 JPG 光照圖，瀏覽器端用 Three.js 的 `ShaderMaterial` 直接把烘焙好的貼圖畫出來，不算即時光照。所以手機也跑得動，看起來又像真的渲染過。

**Blender 只有要改房間時才需要。** 建好的模型和貼圖已經在 repo 裡（`web/public/room/`、`web/public/screening/room/`），`npm run dev`／`build` 不會呼叫 Blender。

### 8.1 播放室

| 階段 | 做什麼 |
|---|---|
| 素材 | `web/blender/fetch_assets.py` 從 [Poly Haven](https://polyhaven.com/) 的 API 下載 19 個家具模型（glTF 1k）、7 種材質、3 張 HDRI，全部是 CC0 授權，存到 `web/blender/assets/`。這些素材約 90MB，**不放在 repo 裡**，要重做房間時先跑一次這支腳本（已列入 `.gitignore`） |
| 建模 | `web/blender/build_room.py`：房間外殼（地板、牆、鋼構窗）用方塊拼，家具用 Poly Haven 模型擺放，最後合併成「外殼」和「家具」兩個網格，各自展一層 `bake` UV。CD、唱片、唱臂、相框這些會動或會換圖的東西不烘焙，留給 Three.js 處理 |
| 烘焙 | Cycles 的 `DIFFUSE` 烘焙，直接光、間接光、顏色三種都開，有 GPU 就用 GPU；色彩轉換用 AgX。三種光照各烘一次：**afternoon**（午後陽光從窗外斜照）、**tipsy**（夕陽加上全部的燈）、**night**（月光加上檯燈與串燈） |
| 輸出 | `room.glb`，加上每種光照各一組 `{mood}_shell.jpg`、`{mood}_props.jpg`、`{mood}_view.jpg`（窗外景色）；`lights.json` 記錄串燈和蠟燭的位置，給網頁做閃爍效果 |
| 壓縮 | `web/blender/compress_glb.py` 用 Draco 壓縮 glb。瀏覽器端的解碼器在 `web/public/draco/`，從 `three` 套件複製過來 |

```bash
# 在 repo 根目錄；Blender 指的是你的 Blender 執行檔（macOS 是 /Applications/Blender.app/Contents/MacOS/Blender）
python3 web/blender/fetch_assets.py
Blender -b --factory-startup -P web/blender/build_room.py -- --out web/public/room --samples 512 --size 2048 --moods afternoon,tipsy,night
Blender -b --factory-startup -P web/blender/compress_glb.py -- web/public/room/room.glb /tmp/room-draco.glb && mv /tmp/room-draco.glb web/public/room/room.glb
```

`--size` 是烘焙貼圖的邊長，repo 裡用的是 2048。`--samples` 越高雜訊越少，但烘焙越久。

### 8.2 放映室

```bash
python3 web/blender/fetch_assets.py                            # 共用素材（8.1 跑過就會跳過）
python3 prototypes/screening-room/blender/fetch_assets.py      # 沙發、抱枕等 7 個模型與 4 種材質
Blender -b --factory-startup -P prototypes/screening-room/blender/build_screening.py -- --out web/public/screening/room --samples 192 --passes night,lamp,screen
Blender -b --factory-startup -P prototypes/screening-room/blender/build_props.py -- --out web/public/screening/room   # 要在上一步之後跑
```

放映室的光照分成三層，網頁會把三層疊加起來：**night** 是門口漏進來的燈光加月光，一直都在；**lamp** 是立燈和片櫃燈條；**screen** 是銀幕的白光，網頁會再乘上正在放映的那部片的顏色。會動的東西（門、DVD 盒、播放機托盤、銀幕、海報）由 `build_props.py` 另外匯出成 `props.glb`。

### 8.3 瀏覽器端

| 檔案 | 職責 |
|---|---|
| `web/src/room/room.ts` | 用 `GLTFLoader` 和 `DRACOLoader` 載入 `room.glb`，換成烘焙材質，切換光照時兩組貼圖交叉淡入淡出。CD 牆的封面在執行期從 `profile.json` 貼上，所以換了資料不用重新烘焙。glb 載不到時，會退回程式畫的方塊房間 |
| `web/src/main.ts` | 頁面各段標了 `data-cam`，捲動時鏡頭在相鄰兩個機位之間平滑移動 |
| `web/src/core/mood.ts` | 預設光照看訪客當地的時間：6–16 點是午後、16–21 點是微醺，其他時間是深夜 |
| `web/src/room/quality.ts` | 畫質自動降級，分五級。畫格持續太慢就降一級，網址加 `?quality=low` 可以強制指定 |
| `web/screening/main.js` | 放映室：載入兩個 glb 和三層光照貼圖，海報畫在 CanvasTexture 上 |

## 9. 部署

### 9.1 用 GitHub Actions 部署到 Cloudflare Workers

`.github/workflows/deploy.yml` 的行為：

- 每次 push 和 PR 都會跑型別檢查、測試、建置。
- push 到 `main` 時，會先重抓 Spotify 資料，再部署到 Cloudflare Workers。
- 每週一 00:00（台灣時間）自動重抓一次。

需要設定的 GitHub secrets：

| Secret | 內容 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare 權杖，用「Edit Cloudflare Workers」範本建立 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 帳號 id（Dashboard 右側欄就看得到），部署那一步會傳給 wrangler。也可以改成直接寫進 `web/wrangler.jsonc` 的 `account_id` |
| `SPOTIFY_CLIENT_ID`、`SPOTIFY_CLIENT_SECRET`、`SPOTIFY_REFRESH_TOKEN` | 第 5 節拿到的唯讀憑證 |
| `SECRETS_PAT` | fine-grained personal access token，**只開這個 repo 的 Secrets: Read and write**。Spotify 換發新的 refresh token 時，CI 用它寫回 secret |

設定 Spotify 這三個 secret（要先裝 [GitHub CLI](https://cli.github.com/)）：

```bash
cd web
node -p "require('./.spotify-readonly-token.json').clientId" | tr -d '\n' | gh secret set SPOTIFY_CLIENT_ID
node -p "require('./.spotify-readonly-token.json').clientSecret" | tr -d '\n' | gh secret set SPOTIFY_CLIENT_SECRET
node -p "require('./.spotify-readonly-token.json').refreshToken" | tr -d '\n' | gh secret set SPOTIFY_REFRESH_TOKEN
```

本機還要更新資料就留著 `.spotify-readonly-token.json`，只靠 CI 的話可以刪掉。

還沒設 secret 也沒關係：CI 會跳過抓資料和部署，只跑檢查與建置，Actions 頁面會提示你少了哪個 secret。

注意，CI 只會重抓 **Spotify** 資料。放映室的資料要在你的電腦上產生，再把 `web/public/screening/story.js` 與海報 commit 進 repo。`data/` 底下的 JSON（`netflix-works.json` 有每部作品的觀看天數與日期，比網站公開的多很多）**不要 commit**，公開版的 `.gitignore` 已經擋掉了。公開版的 `.gitignore` 預設不收錄 `web/public/screening/media/` 裡的海報，要用 CI 部署放映室，就把那兩行拿掉，或改在本機用 `npm run deploy` 部署。

### 9.2 從自己的電腦部署

```bash
cd web
npx wrangler login      # 第一次：瀏覽器登入 Cloudflare（或改用 export CLOUDFLARE_API_TOKEN=...）
npm run deploy          # 網址與 Worker 名稱讀 web/site.config.json
```

部署完確認 `https://你的網址/.gstack/x` 回的是首頁，不是任何日誌。理由見第 11 節。

### 9.3 其他靜態主機

`npm run build` 之後，把 `web/dist/` 整包放到任何靜態主機上都可以。找不到的路徑要回 `index.html`。

## 10. 資料流與專案結構

| 路徑 | 職責 |
|---|---|
| `web/src/core/profile.ts` | `TasteProfile`：頁面唯一吃的資料格式 |
| `web/src/adapters/` | 外部資料 → `TasteProfile`。要接新的資料來源，只要加一個 adapter |
| `web/src/core/` | 從資料算出故事、人設、開場曲、副歌位置。都是純函式，不碰 DOM，有單元測試 |
| `web/src/page/` | 建置時把 `TasteProfile` 畫成整頁靜態 HTML，沒有 JavaScript 也看得到全部內容 |
| `web/src/room/`、`web/src/live/` | 瀏覽器端：Three.js 房間、播放、歌詞、舞台效果 |
| `web/src/share/` | 建置時用 sharp 合成分享圖（OG 圖、IG／Threads 限動圖） |
| `web/screening/` | 放映室頁面 |
| `web/scripts/` | Spotify 資料管線、範例資料產生器、手機版稽核 |
| `tools/netflix/` | Netflix CSV 分類、TMDB 補資料、預告片 |
| `web/blender/`、`prototypes/screening-room/blender/` | 兩間房的 Blender 建模與烘焙腳本；Poly Haven 素材用各自的 `fetch_assets.py` 下載，不在 repo 裡 |
| `scripts/export-public.sh` | 從私人 repo 產生公開快照（見第 12 節） |

更細的系統設計見 [`DESIGN.md`](DESIGN.md)，視覺設計系統見 [`web/DESIGN.md`](web/DESIGN.md)。

## 11. 安全與隱私

- **權杖不進前端**：瀏覽器只會連到 LRCLIB（歌詞）和 Spotify 嵌入播放器。所有權杖都只留在你的電腦上，或放在 GitHub secret。
- **權杖檔不進版本控制**：`web/.spotify-readonly-token.json`、`tools/tmdb-config.json`、`data/raw/` 都列在 `.gitignore` 裡，權限設 600。
- **CI 用唯讀權杖**：Spotify secret 只在「抓資料」那一步拿得到；錯誤訊息只留 HTTP 狀態和錯誤代碼，不會把權杖印進日誌。來自 fork 的 PR 拿不到 secret，也不會部署。
- **第三方字串一律跳脫**：歌名、片名、歌詞都可能被別人控制。建置時一律經過 `esc()`，執行期只用 `textContent`。
- **點目錄不公開**：開發工具常把日誌寫進 `web/public/.xxx/`。建置後 `dropDotDirs()` 會刪掉 `dist/` 裡所有點目錄，CI 也會再檢查一次。
- **注意你公開了什麼**：觀看紀錄和聽歌紀錄都是個人資料。部署之前想清楚哪些要給別人看，例如用 `exclude` 排除不想公開的作品。

發現安全問題，請私下用 GitHub 的 Security Advisory 回報，不要開公開 issue。

## 12. 私人 repo 與公開 repo 同步

如果你跟作者一樣，私人 repo 放真資料負責部署，公開 repo 只放程式碼，可以用 `scripts/export-public.sh`：

```bash
# 在私人 repo 根目錄；第一次先建一個空的公開 repo 並 clone 到本機
scripts/export-public.sh ../my-room-public
git -C ../my-room-public add -A && git -C ../my-room-public diff --cached --stat
git -C ../my-room-public commit -m "sync" && git -C ../my-room-public push
```

腳本做的事：

1. 只取已經 commit 的檔案（`git archive`），工作目錄裡還沒 commit 的改動不會外流。
2. 刪掉 `scripts/public/exclude.txt` 列的路徑（個人資料、第三方圖片、工具設定），再放回 `keep.txt` 列的檔案。
3. 把 workers.dev 網址、Worker 名稱、Cloudflare 帳號 id 換成佔位值，並產生範例資料。
4. **外流檢查**：`scripts/public/check_snapshot.py` 從私人 repo 算出不能出現在公開版的字串，逐檔掃過整份快照，連二進位檔也掃。這些字串包括：主人姓名、Spotify 使用者 id、Cloudflare 帳號、本機路徑、權杖值、真實的歌手與片名。只要命中一筆就中止，公開 repo 完全不會被動到。權杖只回報命中的檔案路徑，不會印出值。
5. 同步到公開 repo 的本機 clone。新的變動會成為新的 commit，不改寫歷史。

每次私人 repo 有更新，重跑一次就同步過去。要額外禁止的字串，寫在 `scripts/public/forbidden.txt`（一行一個）。這個檔案本身不會被匯出。

## 13. 授權與素材來源

- **程式碼**：[MIT](LICENSE)。
- **3D 模型、材質、HDRI**：[Poly Haven](https://polyhaven.com/)，CC0。
- **歌詞**：執行期從 [LRCLIB](https://lrclib.net/) 抓取，repo 不收錄。
- **專輯封面、歌手照片**：來自 Spotify。**電影海報、劇照**：來自 TMDB。兩者版權都屬於各權利人，repo 不收錄，由資料管線下載。
- **Switzer 字型**：來自 [Fontshare](https://www.fontshare.com/fonts/switzer)，依它的授權條款使用，repo 不收錄。
- 這個專案跟 Spotify、Netflix、TMDB 沒有任何關係，也沒有得到它們的認可。
