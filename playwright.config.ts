import { defineConfig } from "@playwright/test";
// Several worktrees run dev servers side by side; HOUSE_E2E_PORT picks this checkout's.
const port = process.env.HOUSE_E2E_PORT ?? "5173";
export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: {
      executablePath: process.env.HOUSE_BROWSER_EXECUTABLE,
      args:
        process.env.HOUSE_BROWSER_GPU === "1"
          ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
          : [
              "--enable-webgl",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
            ],
    },
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
