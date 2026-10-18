// Geometry lab (codex's geometry-lab.spec.ts, ported): loads each lab model, shows probes, runs the benchmark.
export async function checks({ page, url, log, fail }) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}?geometry-lab`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Shape inspection lab' }).waitFor({ timeout: 60_000 });
  const titles = await page.getByLabel('Lab model').locator('option').allTextContents();
  for (const t of titles) {
    await page.getByLabel('Lab model').selectOption({ label: t });
    await page.getByRole('status', { name: 'Geometry build status' }).filter({ hasText: `${t}:` }).waitFor({ timeout: 60_000 });
  }
  log(`  ✓ lab built shapes for ${titles.length} models: ${titles.join(', ')}`);
  await page.getByRole('button', { name: 'Run query benchmark' }).click();
  await page.getByRole('table').waitFor({ timeout: 60_000 });
  log('  ✓ query benchmark ran');
  await page.screenshot({ path: 'test-output/geometry-lab.png' });
  if (errors.length) fail(errors.join(' | '));
  await page.goto(`${url}?source=demo-room`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__houseReady === true, null, { timeout: 120_000 });
}
