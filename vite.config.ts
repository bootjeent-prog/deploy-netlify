import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://127.0.0.1:4000',
        changeOrigin: true
      }
    }
  },
  build: { outDir: 'dist' }
});
