/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './components/**/*.{js,vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './plugins/**/*.{js,ts}',
    './nuxt.config.{js,ts}',
    './app.{js,ts,vue}',
    './error.{js,ts,vue}',
    './utils/transition.js',
  ],
  theme: {
    screens: {
      sm: '480px',
      md: '744px',
      lg: '1025px',
      xl: '1280px',
      '2xl': '1440px',
      '3xl': '1920px',
    },
    fontFamily: {
      Noto: ['Noto Sans TC', 'sans-serif'],
    },
    fontWeight: {
      thin: 100,
      extralight: 200,
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
      black: 900,
    },
    extend: {
      colors: {
        transparent: 'transparent',
        black: '#000',
        white: '#fff',
        gray: {
          50: '#F6F7F9',
          100: '#ECEEF2',
          200: '#D4D9E3',
          300: '#AEB9CB',
          400: '#8294AE',
          500: '#64728B',
          600: '#4A5770',
          700: '#333E55',
          800: '#1F2737',
          900: '#191D27',
          950: '#0C0E12',
        },
        blue: {
          50: '#EEF7FF',
          100: '#D9EBFF',
          200: '#BBDDFF',
          300: '#8DC9FF',
          400: '#57AAFF',
          500: '#3086FF',
          600: '#1A67F6',
          700: '#1250E3',
          800: '#1642B7',
          900: '#183B90',
          950: '#193070',
          default: '#1642B7',
        },
        content: {
          brand: {
            blue: '#1642B7',
            secondary: '#57AAFF',
          },
          black: {
            default: '#000',
            secondary: '#333E55',
            tertiary: '#64728B',
          },
          white: {
            default: '#fff',
            secondary: '#AEB9CB',
          },
        },
        border: {
          brand: {
            blue: '#1642B7',
            secondary: '#57AAFF',
          },
          black: {
            default: '#4A5770',
            secondary: '#D4D9E3',
            tertiary: '#8294AE',
          },
          white: {
            default: '#FFFFFF4D',
            secondary: '#FFFFFF',
          },
        },
      },
      fontSize: {
        'dt/01': ['14px'],
        'dt/02': ['16px'],
        'mb/01': ['14px'],
        'mb/02': ['16px'],
      },
      backdropBlur: {
        DEFAULT: '10px',
      },
      boxShadow: {
        nav: '0 2px 8px 0 rgba(0, 0, 0, 0.1)',
      },
    },
  },
  plugins: [],
}
