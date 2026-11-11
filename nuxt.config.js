// https://nuxt.com/docs/api/configuration/nuxt-config
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'
import path from 'path'

export default defineNuxtConfig({
  // 遊戲全在瀏覽器端,以 nuxt generate 靜態輸出後部署到 Cloudflare
  ssr: false,

  app: {
    baseURL: '/',
    head: {
      title: '叁角辦公室',
      htmlAttrs: {
        lang: 'zh-TW',
      },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { hid: 'description', name: 'description', content: '叁角辦公室:同事線上連線的 3D 虛擬辦公室' },
        { name: 'format-detection', content: 'telephone=no' },
        { property: 'og:title', content: '叁角辦公室' },
        { property: 'og:description', content: process.env.APP_DESC },
        { property: 'og:site_name', content: '叁角辦公室' },
        { property: 'og:locale', content: process.env.APP_DEFAULT_LANG },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
      ],
      link: [{ rel: 'icon', type: 'image/png', href: '/favicon.png' }],
      noscript: [{ children: 'JavaScript is required' }],
    },
  },

  modules: [
    [
      '@pinia/nuxt',
      {
        autoImports: ['defineStore', 'acceptHMRUpdate'],
      },
    ],
    '@vueuse/nuxt',
    '@nuxt/image',
    '@nuxtjs/google-fonts',
  ],

  vite: {
    plugins: [
      createSvgIconsPlugin({
        iconDirs: [path.resolve(process.cwd(), 'assets/icons')],
        symbolId: '[dir]/[name]',
        customDomId: '__svg__icons__dom__',
      }),
    ],
  },

  css: ['~/assets/css/tailwind.css'],

  // Google Fonts 配置
  googleFonts: {
    families: {
      'Noto Sans TC': [200, 300, 400, 500, 600, 700, 800, 900],
    },
    display: 'swap',
    preload: false,
    download: false,
    inject: true,
  },

  // Nuxt Image 配置
  image: {
    quality: 80,
    format: ['webp'],
    screens: {
      xs: 320,
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
      xxl: 1536,
      '2xl': 1536,
    },
  },

  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  },

  runtimeConfig: {
    APP_TITLE: process.env.APP_TITLE,
    APP_DESC: process.env.APP_DESC,
    APP_URL: process.env.APP_URL,
    APP_API: process.env.APP_API,
    public: {
      // 遊戲伺服器位址。開發:ws://localhost:8787/ws;正式(Vercel 環境變數):wss://<worker>.workers.dev/ws
      // 此值在建置時就寫進輸出檔,改了要重新建置
      WS_URL: process.env.WS_URL || '',
      APP_TITLE: process.env.APP_TITLE,
      APP_KEYWORDS: process.env.APP_KEYWORDS,
      APP_DESC: process.env.APP_DESC,
      APP_URL: process.env.APP_URL,
      APP_API: process.env.APP_API,
      GA_ID: process.env.GA_ID,
      GTM_ID: process.env.GTM_ID,
    },
  },

  devtools: { enabled: process.env.NODE_ENV === 'development' },
  future: {
    compatibilityVersion: 3,
  },
  // 明確使用 static preset:Vercel 上也輸出到 .output/public,與 vercel.json 一致
  nitro: {
    preset: 'static',
  },
  compatibilityDate: '2025-07-17',
})
