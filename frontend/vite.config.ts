import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
  },
  server: {
    proxy: {
      // 本地开发跨域代理
      '/api': {
        target: 'http://127.0.0.1:8787', // 假设你的 Cloudflare Worker 端口
        changeOrigin: true,
      }
    }
  }
})