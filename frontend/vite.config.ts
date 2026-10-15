import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: Number(process.env.FRONTEND_PORT || 5186),
    strictPort: true,
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../shared', import.meta.url)),
        fileURLToPath(new URL('../node_modules', import.meta.url)),
      ],
      deny: ['**/server/**', '**/data/runtime/**', '**/data/backups/**', '**/.git/**', '**/.env*'],
    },
    proxy: { '/api': process.env.API_TARGET || 'http://127.0.0.1:5187' },
  },
});
