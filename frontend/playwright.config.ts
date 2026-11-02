import { defineConfig } from '@playwright/test';
const frontendPort = Number(process.env.EKS_E2E_FRONTEND_PORT || 5286);
const apiPort = Number(process.env.EKS_E2E_API_PORT || 5287);
export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    viewport: { width: 1920, height: 900 },
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${frontendPort}`,
    url: `http://127.0.0.1:${frontendPort}`,
    reuseExistingServer: false,
    env: { API_TARGET: `http://127.0.0.1:${apiPort}` },
  },
  reporter: 'list',
});
