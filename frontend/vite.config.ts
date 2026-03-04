import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/views/admin/')) return 'admin-pages';
          if (id.includes('/src/views/visitor/')) return 'visitor-pages';
          if (id.includes('node_modules/echarts')) return 'echarts';
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        }
      }
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  }
});

