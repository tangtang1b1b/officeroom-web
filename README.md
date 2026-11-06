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

## 重機道路安全判斷遊戲

此 Nuxt 3 專案包含桌面瀏覽器用的第一人稱山路風險教育原型。安裝相依套件後執行 `npm run dev` 開啟遊戲。進入後可從教學開始；使用 W／↑ 加速、S／↓ 煞車、A／D 或方向鍵左右移動，M 切換音效、R 換新情境重玩、Esc 暫停。

情境是可重播的遊戲化模型，不代表真實事故率或駕駛訓練建議。外部素材來源及授權記錄於 `CREDITS.md`。
# riding-think
