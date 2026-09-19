import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()], base: './',
  build: { outDir: 'dist', rollupOptions: { input: { preview: resolve('index.html'), popup: resolve('popup.html'), options: resolve('options.html') } } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
