# 變更紀錄

## 2026-11-06：建立 Nuxt 空白 starter

- 需求：依 `C:\work\nuxt-starter-prompt.md` 建立 Nuxt 3 JavaScript starter，含指定共用效果、Tailwind token 與空白首頁。
- 修改摘要：依規格建立 24 個檔案段落與全部指定目錄；由 `.env.example` 建立空值 `.env`；npm install 產生 lockfile。
- 影響檔案：規格指定的根目錄檔案及 `assets/`、`components/`、`composables/`、`data/`、`layouts/`、`middleware/`、`pages/`、`plugins/`、`public/`、`server/`、`store/`、`utils/`；另有 `package-lock.json`、`.env`、本紀錄。
- 驗證結果：Node v24.21.0 / npm 11.19.0；Nuxt 3.21.11，787 個 lockfile Node engine 範圍全數相容；npm install 與 `nuxt prepare` 成功；`npm run build` 輸出 Build complete。
- 驗證限制：npm install 有 OneDrive 路徑 TAR_ENTRY_ERROR 警告；build 有 Nitro symlink EPERM 與 Nuxt Image sharp binary 警告，但 build 完成。in-app browser 對 localhost 連線逾時，DOM、computed style、console 與 screenshot 未驗證。
- 未解決事項：browser 驗證 Not Verified；starter 的版本範圍安裝後版本由 npm registry 解析，並非來源 lockfile 重現（來源沒有 lockfile）。

## 2026-11-06：加入重機道路安全遊戲 MVP

- 需求：依核准的黑客松實作計劃，建立單人、無後端的第一人稱山路風險教育遊戲。
- 修改摘要：新增 Three.js client-side 山路場景、固定步長遊戲狀態與種子情境、鍵盤控制、教學／HUD／暫停／結果／回顧與重玩；使用程序生成幾何，加入 Poly Haven Asphalt 01 1K 道路材質。
- 影響檔案：`package.json`、`package-lock.json`、`composables/useRoadSafetyGame.js`、`components/game/RoadScene.client.vue`、`pages/index.vue`、`public/textures/asphalt-01-1k.jpg`、`README.md`、`CREDITS.md`、`docs/specs/road-safety-game.md`、`docs/decisions.md`。
- 驗證結果：待執行 Browser 驗證及 build。
- 未解決事項：Sketchfab 車輛頁回覆 403、Quaternius 下載頁連線中斷；模型素材尚未取得，車輛維持程序生成幾何。

## 2026-11-06：改善騎乘、車流、碰撞與局後回顧（已核准；驗證中）

- 需求：依 YouTube 視覺參考提升騎乘感、陰天與山路質感、彎道來車壓迫感、碰撞演出與外部視角重播。
- 修改摘要：鏡頭與車道使用一致側向座標；加入輕微彎道側傾、路面起伏與碰撞失衡/滑行演出；對向箱型車沿道路持續移動並按幾何視線遮蔽決定可見事件；記錄定頻軌跡並於回顧頁提供外部視角重播。調整陰天環境光及霧化，關閉高成本陰影。加入 Poly Haven Asphalt 01 1K normal GL 貼圖及 Tahseen 的 Motorcycle GLB，在外部重播顯示實際機車模型。
- 影響檔案：`components/game/RoadScene.client.vue`、`composables/useRoadSafetyGame.js`、`pages/index.vue`、`public/textures/road/asphalt_01_nor_gl_1k.jpg`、`public/models/motorcycle/`、`docs/specs/road-safety-game.md`、`docs/decisions.md`、`docs/changes.md`、`CREDITS.md`。
- 驗證結果：Node 語法檢查與 Vue SFC 編譯前次通過；localhost:3000 確認碰撞結果、事件回顧、場景 canvas 與重播操作 render。viewport 1125×1039；canvas 1125×1039；回顧卡片 620×578，操作列未重疊且在卡片內；console error/warn 為 0。法線貼圖以 1024×1024 JPEG 成功提供。Motorcycle 套件授權檔、glTF 2.0、11 張貼圖與 58,135 triangles 已核對；模型載入與方向已在 replay 畫面確認：實際機車可見並沿道路放置。
- 未解決事項：卡車模型方向、尺寸與載入待瀏覽器確認；植物、岩石與環境素材尚未匯入。


## 2026-11-06：Brave 下載並整合前車與對向卡車（驗證中）

- 需求：直接以 Brave 下載已討論的 Sketchfab 車輛模型並在場景中使用。
- 修改摘要：取得 F707 Mitsubishi Fuso Ecanter 4K GLB 與 ElectroNick Dump Truck glTF；按包圍盒正規化並接至前車及對向車 render path，成功載入後替換程序占位幾何。更新來源、授權、規格及決策紀錄。
- 影響檔案：components/game/RoadScene.client.vue、public/models/box-truck/model.glb、public/models/oncoming-truck/、CREDITS.md、docs/specs/road-safety-game.md、docs/decisions.md、docs/changes.md。
- 驗證結果：Node 語法與 RoadScene/index Vue SFC 編譯通過。localhost:3000 遊戲中見到對向 Dump Truck；外部回放見到機車及 Fuso 車尾，已調整 Fuso 車頭方向。viewport 1125×1039；場景 canvas DOM selector 存在且實際尺寸約 1125.1×1039.4、display:block；browser console error/warn 為 0。
- 未解決事項：Sketchfab Fuso 的 1K GLB 下載未能完成，使用同頁已下載的 4K 檔；其他植被、岩石與 HDRI 未匯入。本次下載與車輛場景差異已完成視覺核對。

## 2026-11-06：修正騎乘車輛、彎道側傾與盲彎決策

- 需求：處理玩家車輛未更換、轉彎側傾方向錯誤、無操作追撞、缺少選擇、通過車流後遊戲持續及車輛不消失等六項問題。
- 修改摘要：第一人稱顯示實際機車模型並保留載入失敗的程序座艙；側傾依道路曲率與方向計算；前車減速保留低速；盲彎前顯示跟車距離、前車速度、來車視線和車道位置，提供等待或依可用空間啟用超車；車流通過後結束情境並隱藏已通過車輛。
- 影響檔案：`composables/useRoadSafetyGame.js`、`components/game/RoadScene.client.vue`、`pages/index.vue`、`docs/specs/road-safety-game.md`、`docs/decisions.md`、`docs/changes.md`。
- 驗證結果：瀏覽器同種子超車測試：先切出、再返回，結果「安全通過」，12.0 秒，最小前車距離 23.7m、最小會車距離 26.9m；留在對向車道會碰撞，驗證返回時機影響結果。先前同種子等待測試結果「安全通過」，15.2 秒、最小前車距離 24.8m。決策卡可見四項路況因素與兩個選項。viewport 1304×1039.4；場景 canvas selector 存在、CSS 尺寸 1304×1039.4、display:block；結算卡 selector 存在、尺寸 620×385.3，位置 x=342、y=327，browser screenshot 已檢視，卡片完整位於畫面內且無裁切。截圖中可見第一人稱機車模型。彎道側傾依曲率正負方向程式核對；通過後車輛以相對距離 −8m 隱藏。
- 未解決事項：console 錯誤/警告及模型資源載入狀態未重新讀取；對向車模型與場景重疊狀況未在每個時點完整核對。

## 2026-11-06：校正第一人稱機車方向、比例與傾斜

- 需求：修正機車模型方向與比例，讓相機位於騎士第一人稱位置，轉向傾斜逐步累積並平順回正。
- 修改摘要：移除第一人稱 0.42 倍縮放及相機前置整車；機車按約 2.15m 車長顯示並校正前進朝向；相機掛至機車視點 rig，前整流罩、把手及油箱出現在視野下方；轉向傾斜改為隨持續輸入累積並在放開時阻尼回正，並同步呈現於車身；外部回放鏡頭移至不被彎道山壁遮住的一側。
- 影響檔案：`components/game/RoadScene.client.vue`、`docs/specs/road-safety-game.md`、`docs/decisions.md`、`docs/changes.md`。
- 驗證結果：localhost 瀏覽器確認第一人稱道路與前車可見，機車風鏡、儀表、把手、油箱在下方前景；截圖確認機車與卡車沿道路朝前。外部回放視角在相機改掛 rig 後仍可見道路、機車及前車，並調整到不受山壁遮擋的位置。持續左轉時畫面與車身傾角隨輸入改變；方向累積與放開回正公式已核對。場景 canvas selector 存在、CSS 尺寸 1467.4×1039.4、display:block。Node 語法檢查及 RoadScene、index Vue SFC 編譯通過。
- 未解決事項：本次未重新取得 console 錯誤/警告計數或模型資源傳輸資訊；沒有執行測試或 build。

## 2026-11-06：依騎乘參考圖調整座艙構圖與傾斜

- 需求：直行視角呈現風鏡、後照鏡、儀表與油箱；轉彎時左轉左傾、右轉右傾；車款不必相同，需保留道路、車道與前車的比例線索。
- 修改摘要：在機車騎士視點 rig 加入左右後照鏡，使其隨車身傾斜；保持既有風鏡、儀表與油箱在下方前景，保留中央道路與前車視線。外部回放鏡頭保持在能看清道路的位置。後續使用者要求移除自製後照鏡，修正記錄見下一筆。
- 影響檔案：`components/game/RoadScene.client.vue`、`docs/specs/road-safety-game.md`、`docs/decisions.md`、`docs/changes.md`。
- 驗證結果：localhost 瀏覽器截圖確認直行畫面可見左右後照鏡、座艙、油箱、前車與車道線；實際輸入 A 與 D 後，車身、鏡體及視野分別朝左、右傾斜。場景 canvas selector 命中 1 個，尺寸 1467.4×1039.4、`display:block`；模型已在瀏覽器畫面載入。
- 未解決事項：場景尚無實際環境反射貼圖，後照鏡以簡化灰色鏡面呈現；未重新讀取 browser console。未執行 build 或測試。

## 2026-11-06：移除自製後照鏡並限制左右橫移

- 需求：右轉不可把視角推入路肩山壁；現有機車模型沒有後照鏡時，不要人工補造。
- 修改摘要：移除正式模型及座艙 fallback 的程序後照鏡；左右移動速度由 3.4m/s 降為 2.4m/s，橫移範圍限制為 ±3.2m，以保留切換車道並避免快速偏到路肩。原有機車本體與相機左右傾斜保留。
- 影響檔案：`components/game/RoadScene.client.vue`、`composables/useRoadSafetyGame.js`、`docs/specs/road-safety-game.md`、`docs/decisions.md`、`docs/changes.md`。
- 驗證結果：localhost 瀏覽器截圖確認已無自製鏡體，座艙與油箱仍可見；右轉測試中保留道路、前車與車道線，沒有將畫面推到路肩山壁；A/D 輸入分別使車身與畫面左右傾斜。Canvas selector 命中 1 個，CSS 尺寸 1467.4×1039.4、`display:block`。Node 語法檢查及 RoadScene、index Vue SFC 編譯通過。
- 未解決事項：未重新讀取 browser console；未執行 build 或測試。

## 2026-11-06：修正左右傾斜軸與相機轉向

- 需求：左轉時模型左傾、視角微轉左；右轉時模型右傾、視角微轉右。使用者指出原有左右傾斜方向與呈現仍錯誤。
- 修改摘要：把車身模型的前進朝向放入獨立傾斜 pivot，避免 yaw 與 roll 共用一組旋轉；相機以小幅平滑 yaw 朝轉向方向移動，取消跟著車身角度翻滾。
- 影響檔案：`components/game/RoadScene.client.vue`、`docs/specs/road-safety-game.md`、`docs/decisions.md`、`docs/changes.md`。
- 驗證結果：localhost 瀏覽器實際按 A 與 D，確認視角分別微轉左、右，車身前景分別朝相反方向傾斜，地平線保持穩定；Node 語法與 RoadScene Vue SFC 編譯通過。
- 未解決事項：未重新讀取 browser console；未執行 build 或測試。

## 2026-11-06：校正對向卡車車頭朝向

- 需求：對向來車不可車尾朝前、呈現倒車接近。
- 修改摘要：對向卡車模型載入時校正 180 度朝向，保持既有資產與尺度。
- 影響檔案：`components/game/RoadScene.client.vue`、`docs/specs/road-safety-game.md`、`docs/decisions.md`、`docs/changes.md`。
- 驗證結果：localhost 外部視角重播至會車時截圖確認對向車車頭朝向機車迎面接近；`.road-scene canvas` selector 命中 1 個，computed `display:block`，尺寸 1467.4×1039.4；截圖中模型已載入且車頭可辨識。重新讀取修改程式與差異確認只增加對向模型 180 度 heading；未執行 build 或測試。
- 未解決事項：場景大型岩壁等既有環境模型外觀不在本次朝向修正範圍。


## 2026-11-11：改為多人 3D 火柴人辦公室(階段 1 與協定/Worker)

- 需求：放棄機車遊戲，改做 10 人以內同事連線的 3D 虛擬辦公室，含火柴人、蹲趴、聊天室與漆彈槍。
- 修改摘要：移除機車遊戲程式、素材與規格；新增 `shared/layout.js`(格局與碰撞資料)、`utils/office/stickman.js`、`composables/usePlayerControls.js`、`components/office/OfficeScene.vue`、暱稱入口 `pages/index.vue`；新增 `shared/protocol.js`、`shared/raycast.js`、`worker/index.js`、`worker/Room.js`、`wrangler.toml` 與 Vitest 測試。
- 驗證結果：dev server 於 Browser pane 確認場景渲染、站/蹲/趴火柴人、窗戶與桌椅，console 無錯誤；api-dev 回報 Vitest 25 通過。
- 未解決事項：前端尚未連線 Worker、聊天室與漆彈槍 UI 未做；尚未部署；格局為暫時版，待使用者補照片與尺寸；伺服器端未做桌椅碰撞檢查。

## 2026-11-11：階段 2 到 4 前端連線、聊天與漆彈槍，並修正審查問題

- 需求：修正 reviewer 找出的問題，並把前端接上 Worker，完成多人同步、聊天室與漆彈槍。
- 修改摘要：伺服器改為 token bucket 限速、狀態與訊息限頻、連線數與逾時上限、Origin 檢查、趴姿平躺命中形狀、射擊起點驗證、`correct` 位置校正；碰撞資料補上隔板、螢幕、椅背與紙箱；前端新增 `composables/useNetwork.js`、`utils/office/remotePlayers.js`、`utils/office/paint.js`、`components/office/ChatBox.vue`，`store/all.js` 增加連線狀態、名單與聊天；`nuxt.config.js` 改為 `ssr: false`，`OfficeScene` 移除 `.client` 後綴(否則 `ssr:false` 下 `onMounted` 取不到 DOM)。
- 驗證結果：Vitest 52 個通過；以 `wrangler dev` 加 `nuxt dev` 開兩個分頁實測：名單同步、伺服器出生點、移動不被誤判、射擊命中對方並顯示命中閃光、牆面斑點、聊天互通均正常，console 無錯誤。
- 驗證限制：瀏覽器分頁僅約 2 FPS，未實測流暢度；未實測 3 人以上、趴姿命中與斷線重連在真實網路下的表現；尚未部署。
- 未解決事項：格局仍是暫時版；尚未執行 `wrangler login` 與 `wrangler deploy`；`npm run generate` 靜態輸出路徑與 `wrangler.toml` 的 assets 尚未實際串接驗證。

## 2026-11-11：第二輪審查修正

- 修改摘要：`WS_URL` 只在開發時生效(避免把 localhost 打包進正式站)；重連或伺服器重啟後清除舊的遠端玩家並移除快照中缺席者；自己被打中不再留懸空斑點；火柴人只釋放自己的 geometry；聊天框失焦自動關閉；「房間已滿」改為每 5 秒自動重試；伺服器新增每 IP 與未 join 連線上限(超過回 429)、5 秒 join 逾時、60 秒閒置斷線、較寬鬆的射擊起點驗證、正式環境不放行 localhost Origin、聊天超頻提示；`npm run worker:deploy` 先執行 `generate`。
- 驗證結果：Vitest 57 通過；`npm run generate` 成功，輸出不含 `localhost:8787`；以腳本對本機 Worker 連兩個連線，確認 welcome、player_join、聊天、射擊廣播與快照正常。
- 未解決事項：趴姿時視點在腳底、模型卻往前平躺約 1.75 公尺(視角與命中箱不一致)；尚未部署，需使用者先 `wrangler login`；尚未 commit。

## 2026-11-11：改為 Vercel 前端 + Cloudflare Worker，並部署 Worker

- 修改摘要：前端部署到 Vercel(`vercel.json`、`nitro.preset: 'static'`)，遊戲伺服器獨立部署到 Cloudflare Worker；`WS_URL` 正式環境生效；Worker 新增 `ALLOWED_ORIGINS`(完整 origin 清單)，移除靜態資源，`/` 回健康檢查文字。
- 部署結果：Worker 網址 `https://office-paintball.streetcare.workers.dev`(帳號 workers.dev 子網域改為 `streetcare`)，`ALLOWED_ORIGINS=https://dangeride.vercel.app`(先前誤填成另一個專案的網址,已更正)。
- 驗證結果：Vitest 59 通過；線上 `GET /` 回 200；以 `ws` 客戶端實測：該 Vercel Origin 可連線並收到 welcome，其他 Origin 與無 Origin 皆回 403。
- 未解決事項：Vercel 專案環境變數 `WS_URL=wss://office-paintball.streetcare.workers.dev/ws` 尚待設定，設定後需重新部署前端；前端在 Vercel 的實際建置與跨網域連線尚未驗證；預覽網址不在允許清單內。

## 2026-11-11：前端部署到 Vercel

- 部署方式：以 Vercel CLI 建立專案 `dangeride`(帳號 `tangtang1b1b`，團隊 `eric's projects`)並 `vercel deploy --prod`；專案自動連結 GitHub `tangtang1b1b/riding-think`，之後 push 會自動部署。Production 環境變數 `WS_URL=wss://office-paintball.streetcare.workers.dev/ws`。
- 網址：`https://dangeride.vercel.app`；Worker `ALLOWED_ORIGINS` 已改為此網址並重新部署。
- 驗證結果：正式網站回 200 且輸出含 Worker 位址；`ws` 實測此 Origin 連線成功，舊網址、其他來源與無 Origin 皆 403；在瀏覽器開正式網站輸入暱稱後成功進入辦公室並連上伺服器(線上 1 / 10)。
- 未解決事項：頁面標題仍是「NUXT模板」(Vercel 未設定 `APP_TITLE` 等環境變數)；預覽網址不在 Worker 允許清單內；未實測多人同時在正式站互動。

## 2026-11-11：專案改名為 officeroom

- 修改摘要：Vercel 專案 `dangeride` 改名為 `officeroom`；Cloudflare Worker 由 `office-paintball` 改名為 `officeroom`(新網址 `https://officeroom.streetcare.workers.dev`，舊 Worker 已刪除)；`package.json` 與 lockfile 的名稱改為 `officeroom`；Production 的 `WS_URL` 改指向 `wss://officeroom.streetcare.workers.dev/ws` 並重新部署前端。
- 驗證結果：Vitest 59 通過；新 Worker `/` 回 `officeroom ok`；`ws` 實測 `https://dangeride.vercel.app` 可連、其他來源與無 Origin 皆 403；在瀏覽器開正式網站進入辦公室並連上新 Worker(線上 1 / 10)；舊 Worker 回 404。
- 限制：Vercel 改專案名稱不會改 `*.vercel.app` 網址，正式網址仍是 `https://dangeride.vercel.app`(`officeroom.vercel.app` 已被他人占用)。GitHub 倉庫仍叫 `riding-think`，本機資料夾仍叫 `dangeride`，尚未更名。

## 2026-11-11：正式網址換成 officeroom-web.vercel.app

- 修改摘要：以 `vercel domains add` 將 `officeroom-web.vercel.app` 加入專案 `officeroom`；Worker `ALLOWED_ORIGINS` 改為 `https://officeroom-web.vercel.app` 並重新部署。
- 驗證結果：新網址回 200 且含新 Worker 位址；`ws` 實測新 Origin 可連，舊網址 `dangeride.vercel.app`、其他來源與無 Origin 皆 403；在瀏覽器開新網址輸入暱稱後成功進入辦公室並連線(線上 1 / 10)。
- 舊網域 `dangeride.vercel.app` 已以 `vercel alias rm` 移除(現回 404)。

## 2026-11-11：視線上下同步與簡化版物理

- 需求：其他玩家要能看到你上下看的視線；椅子與紙箱可以被推動，被漆彈打到會滑動、椅子重擊會倒下並在 15 秒後扶正。
- 修改摘要：
  - 視線：火柴人頭部改為可轉動並加上眼睛，`setLook(pitch)` 讓頭與雙臂(連槍)跟著上下轉；`remotePlayers.js` 接上原本被丟掉的 `pitch`。
  - 物理：新增 `shared/physics.js`(俯視 2D 圓形剛體：摩擦、牆與固定物碰撞、物件互推、睡眠、衝量、倒下與扶正、玩家推動)；`shared/layout.js` 新增 `DYNAMIC_DEFS`，椅子與紙箱移出固定 `COLLIDERS`；`raycastWorld` 可命中物件；`worker/Room.js` 在 50ms 計時器內模擬並於 `welcome`/`snapshot` 廣播 `objects`，`paint` 帶 `objectId`。
  - 前端：新增 `utils/office/dynamicObjects.js`(平滑移動、倒下傾倒動畫)，斑點可附著在物件上跟著移動；重連時清除舊斑點。
- 審查修正：物件速度上限 8 m/s(避免多人協力射擊穿桌)、被物件卡住的玩家可往外走且新玩家不生在物件內、推不動物件而被拒時退還移動額度、衝量依水平分量縮放且單發只滑動(連續命中才倒)、倒下椅子的射線判定框變大、玩家推動時保留物件原速度。
- 驗證結果：以 `ws` 腳本與雙分頁實測：`welcome` 帶 14 個物件，玩家走過去能把椅子推走且不被拉回，射擊椅子廣播含 `objectId` 的 `paint`、椅子滑動轉向後倒下，約 15 秒後扶正；瀏覽器畫面確認側倒椅子、紅綠斑點附著並跟著移動，另一玩家抬頭時手臂與頭上舉。
- 限制：物件判定以圓形腳印與外接方塊近似，不處理椅子旋轉後的真實輪廓；物件位置由伺服器 50ms 快照平滑，網路抖動時有延遲感；免費方案的 Durable Object 運算與訊息量需上線後觀察。

## 2026-11-11：方塊小人、漆彈貼在被打中的身體部位、辦公室配色

- 需求:依參考影片把火柴人改成方塊小人,漆彈要真的貼在被打中的身體部位上;場景配色依辦公室照片(白色加淺木色,黃色只用在桌子)。
- 修改摘要:
  - `shared/layout.js` 新增 `BODY`(各部位尺寸,模型與命中判定共用)與 `HIT_PARTS`(站、蹲、趴各部位的命中盒)。
  - `shared/raycast.js` 的 `raycastPlayer` 改為各身體部位盒取最近命中並回傳 `part`(head/torso/armL/armR/legL/legR);`paint` 訊息多帶 `part`。
  - `utils/office/stickman.js` 重寫為方塊小人(髮型、眼鏡、膚色、上衣色依玩家顏色決定);對外介面不變,新增 `meshes`。
  - `utils/office/paint.js`:命中玩家時先對實際模型做射線找到被打中的方塊與表面,打空則吸附到同部位最近方塊(方塊局部座標),斑點附著在該方塊上跟著肢體移動;宿主離開場景後斑點自動清除。
  - `OfficeScene.vue`:地板、天花板、牆面改色,加天花板方管、窗外綠樹與紅磚立面與地面。
- 驗證結果:Vitest 103 通過;以本機 Worker 加兩個腳本玩家實測,漆彈貼在頭、軀幹、手臂方塊上並跟著移動,畫面無 console 錯誤。
- 限制:伺服器命中盒不跟隨視線上下(pitch)轉動手臂與頭;姿勢與 yaw 為客戶端自報且姿勢切換沒有冷卻;每個斑點仍是獨立 mesh(最多 150 個);趴姿視點在腳底的舊問題未處理。
