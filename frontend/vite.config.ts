import { createNetworkPolicy, listenHost, listenPort } from '../server/src/network';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

const apiHost = listenHost(process.env.API_HOST, '127.0.0.1');
const proxyHost = ['0.0.0.0', '::'].includes(apiHost) ? '127.0.0.1' : apiHost;
const proxyAddress = proxyHost.includes(':') ? `[${proxyHost}]` : proxyHost;

const network = createNetworkPolicy(
  process.env.FRONTEND_ORIGIN ? [process.env.FRONTEND_ORIGIN] : [],
);

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'eks-lan-host-validation',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!network.acceptsHost(request.headers.host)) {
            response.statusCode = 403;
            response.end('허용되지 않은 접속 주소입니다.');
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    host: listenHost(process.env.FRONTEND_HOST, '0.0.0.0'),
    port: listenPort(process.env.FRONTEND_PORT, 5186),
    strictPort: true,
    allowedHosts: process.env.FRONTEND_ORIGIN
      ? [new URL(process.env.FRONTEND_ORIGIN).hostname]
      : [],
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../shared', import.meta.url)),
        fileURLToPath(new URL('../node_modules', import.meta.url)),
      ],
      deny: ['**/server/**', '**/data/**', '**/.git/**', '**/.env*'],
    },
    proxy: {
      '/api': {
        target:
          process.env.API_TARGET ||
          `http://${proxyAddress}:${listenPort(process.env.API_PORT, 5187)}`,
        changeOrigin: false,
      },
    },
  },
});
