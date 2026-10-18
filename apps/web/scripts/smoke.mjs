/* global window, localStorage -- page.evaluate callbacks run in the browser */
// Headless smoke test of the sandbox: loads every scene source in an installed Chromium-family
// browser (playwright-core, no download), fails on page errors / React warnings, drags one object,
// and saves screenshots to test-output/smoke-<source>.png.
//
// Usage: node apps/web/scripts/smoke.mjs [--gpu] [--source demo-room,test2] [--checks path/to/checks.mjs]
// A checks module may export `async function checks({ page, url, source, log })` for extra steps.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const repoRoot = resolve(webRoot, '../..');
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const gpu = args.includes('--gpu');
const sources = (arg('--source') ?? 'demo-room,demo-scan,test2').split(',');
const checksPath = arg('--checks');
const extra = checksPath ? (await import(pathToFileURL(resolve(process.cwd(), checksPath)).href)).checks : null;

const executablePath = [
  process.env.HOUSE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!executablePath) { console.error('No Chromium-family browser found; set HOUSE_BROWSER.'); process.exit(1); }

const server = await createServer({ root: webRoot, configFile: join(webRoot, 'vite.config.ts'), server: { port: 5198, strictPort: false }, logLevel: 'warn' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5198/';
const browser = await chromium.launch({
  executablePath, headless: true,
  args: gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let failures = 0;
const log = (...m) => console.log(...m);
const fail = (m) => { failures++; console.error('  ✗', m); };
try {
  for (const source of sources) {
    log(`\n== ${source}`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      const t = m.text();
      if (m.type() === 'error' || (m.type() === 'warning' && /Warning:|React|THREE\.|deprecated/i.test(t))) problems.push(`${m.type()}: ${t.slice(0, 240)}`);
    });
    await page.goto(`${url}?source=${source}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__houseReady === true && !!window.__houseDebug, null, { timeout: 180_000 });
    await page.waitForTimeout(800);

    // Drag the first unlocked floor-standing object ~120 px right.
    const target = await page.evaluate(() => {
      const st = window.__houseDebug.store.getState();
      const o = st.workingScene.objects.find((x) => !x.locked && !x.placement?.parentId && (x.placement?.support ?? 'floor') === 'floor' && x.category !== 'rug');
      if (!o) return null;
      const [x, y, z] = o.transform.position;
      return { id: o.id, name: o.displayName, before: o.transform.position, screen: window.__houseDebug.project(x, y + o.dimensionsM[1] / 2, z) };
    });
    if (target) {
      const [sx, sy] = target.screen;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(sx + i * 10, sy); await page.waitForTimeout(16); }
      await page.mouse.up();
      await page.waitForTimeout(400);
      const after = await page.evaluate((id) => window.__houseDebug.store.getState().workingScene.objects.find((o) => o.id === id)?.transform.position, target.id);
      const moved = Math.hypot(after[0] - target.before[0], after[2] - target.before[2]);
      if (moved > 0.01) log(`  ✓ dragged ${target.name} ${moved.toFixed(2)} m`);
      else log(`  · ${target.name} did not move (may be blocked); before ${target.before.map((n) => n.toFixed(2))}`);
    }
    if (extra) await extra({ page, url, source, log, fail });

    mkdirSync(join(repoRoot, 'test-output'), { recursive: true });
    await page.screenshot({ path: join(repoRoot, 'test-output', `smoke-${source}.png`) });
    if (problems.length) problems.forEach((p) => fail(p));
    else log('  ✓ no page errors or warnings');
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (failures) { console.error(`\n${failures} problem(s)`); process.exit(1); }
console.log('\nsmoke OK');
