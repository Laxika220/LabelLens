import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const VISION_PORT = Number(process.env.E2E_VISION_PORT ?? 8101);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Pixel 7"],
    viewport: { width: 360, height: 780 },
    permissions: ["camera"],
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  },
  webServer: [
    {
      command: `vision-service/.venv/bin/uvicorn app.main:app --app-dir vision-service --port ${VISION_PORT}`,
      url: `http://127.0.0.1:${VISION_PORT}/health`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: { VISION_SERVICE_TOKEN: "e2e-token" },
    },
    {
      command: `npm run build && npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: true,
      timeout: 300_000,
      env: { VISION_SERVICE_URL: `http://127.0.0.1:${VISION_PORT}`, VISION_SERVICE_TOKEN: "e2e-token" },
    },
  ],
});
