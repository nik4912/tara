import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 3001,
    // Dev-only: proxy /ask → local Express backend so no CORS issues
    proxy: command === 'serve' ? {
      '/ask': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    } : undefined,
  },
}));
