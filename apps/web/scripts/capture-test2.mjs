/* global window, localStorage -- page.evaluate callbacks run in the browser */
// Headless capture of the test2 scene at the "Match photo" camera, for side-by-side comparison
// with assets/test2.png. Starts its own Vite dev server (port 5199) and drives an installed
// Chromium-family browser via playwright-core (no browser download).
//
// Usage: pnpm capture:test2 [--gpu] [--out test-output/test2-render.png]
// Browser: set HOUSE_BROWSER to an executable path, otherwise common Edge/Chrome paths are tried.
// --gpu renders on the real GPU (D3D11 on Windows); default is SwiftShader (deterministic, slower).
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const repoRoot = resolve(webRoot, '../..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const out = resolve(repoRoot, outArg >= 0 ? args[outArg + 1] : 'test-output/test2-render.png');
const gpu = args.includes('--gpu');

const candidates = [
  process.env.HOUSE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chromium-family browser found; set HOUSE_BROWSER to its executable path.');
  process.exit(1);
}

const server = await createServer({ root: webRoot, configFile: join(webRoot, 'vite.config.ts'), server: { port: 5199, strictPort: false }, logLevel: 'warn' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  // Same aspect as the reference image (1586 × 992).
  const page = await browser.newPage({ viewport: { width: 1586, height: 992 } });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  if (process.env.DEBUG) page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 200)));
  await page.goto(`${url}?source=test2&hideUi&capture`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => (window).__houseReady === true, null, { timeout: 180_000 });
  } catch (e) {
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out.replace(/.png$/, '-timeout.png') });
    throw e;
  }
  await page.waitForTimeout(1500);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
} finally {
  await browser.close();
  await server.close();
}
