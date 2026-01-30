/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,vue}",
  ],
  theme: {
    extend: {
      colors: {
        // 遵循同花顺红涨绿跌风格
        'ths-red': '#f43f5e',
        'ths-green': '#10b981',
        'ths-bg': '#0f172a',
        'ths-card': '#1e293b',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', "Liberation Mono", "Courier New", 'monospace'],
      }
    },
  },
  plugins: [],
}