# 模板(專案名稱)

## 啟動步驟

1. 切換 node 版本 v22 以上
2. npm install
3. 複製 .env.example 到 .env
4. npm run dev 啟動專案

---

## env設定

```
- nuxt.config結構

APP_TITLE=NUXT模板
APP_DESC=NUXT模板
APP_DEFAULT_LANG=zh-TW
APP_KEYWORDS=

- 網站網址
APP_URL=http://localhost:3000


- api網址
APP_API=http://localhost:3000


- api token
API_TOKEN=


- GA 需要的key
GA_ID=
GOOGLE_SITE_VERIFICATION=
```

## 檔案結構

  - component 組件
  - pages 頁面
  - layouts 統一頁面佈局
  - assets 靜態資源
  - app.vue 入口組件
  - nuxt.config 應用檔案配置
  - plugins 全域註冊插件

## 元件管理
- Atom 原子組件
  - Button 按鈕
  - Form 表單元件
  - Load 刷色圖塊
- Modal 模塊
  - Accordion 導覽類型 (頁碼、麵包屑)
  - Marquee 跑馬燈
  - Popup 彈窗
  - Slider 輪播
  - Video 嵌入youtube影片
- Layout 共用組件
  - Header 頁首
  - Footer 頁尾
  - Loading 載入
- Custom 客製區
- View 頁面區塊
# js-nuxt3-template

## 虛擬辦公室

3D 火柴人辦公室:多人連線、聊天室與漆彈槍互動(10 人以內)。

本機開發需開兩個終端機:

1. `npm run worker:dev`(Cloudflare Worker,預設 `ws://localhost:8787/ws`)
2. `npm run dev`(前端,`.env` 需設定 `WS_URL=ws://localhost:8787/ws`)

操作:WASD 移動、滑鼠視角、左鍵射擊、C 蹲、Z 趴、Enter 聊天、Esc 釋放滑鼠。

測試:`npm test`。格局資料在 `shared/layout.js`。

## 部署

前端與遊戲伺服器分開部署(Vercel 不支援 WebSocket 伺服器):

1. **遊戲伺服器(Cloudflare Worker)**
   - `wrangler.toml` 的 `ALLOWED_ORIGINS` 填入 Vercel 正式網址(完整 origin,逗號分隔,例如 `https://xxx.vercel.app`)。
   - `npx wrangler login`(一次),再 `npm run worker:deploy`,取得 `https://<name>.<account>.workers.dev`(目前:`https://officeroom.streetcare.workers.dev`)。
2. **前端(Vercel)**
   - 在 Vercel 專案環境變數新增 `WS_URL=wss://<name>.<account>.workers.dev/ws`(建置時寫入輸出檔,改了要重新部署)。
   - Vercel 依 `vercel.json` 執行 `npm run generate`,輸出 `.output/public`。push 後自動部署。
3. 換網域或新增預覽網址時,要同步更新 Worker 的 `ALLOWED_ORIGINS` 並重新 `worker:deploy`。

# riding-think
