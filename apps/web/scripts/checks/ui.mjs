/* global window */
// Smoke checks for the merged toolbar / panel (merge step 2). Run via: node apps/web/scripts/smoke.mjs --checks apps/web/scripts/checks/ui.mjs
export async function checks({ page, log, fail }) {
  const count = (sel) => page.locator(sel).count();
  for (const [sel, name] of [['[aria-label^="3D move"]', '3D move button'], ['[aria-label^="Collisions are"]', 'collisions button'], ['[aria-label="X position (m)"]', 'X field'], ['[aria-label^="Y position"]', 'Y field'], ['[aria-label="Z position (m)"]', 'Z field']]) {
    if (await count(sel)) log(`  ✓ ${name}`); else fail(`missing ${name}`);
  }
  if (await page.getByText('Float (don’t settle').count()) fail('Float checkbox still present');
  // Typing X moves the selected object.
  const id = await page.evaluate(() => window.__houseDebug.store.getState().selectedId);
  const x0 = await page.evaluate((i) => window.__houseDebug.store.getState().workingScene.objects.find((o) => o.id === i).transform.position[0], id);
  await page.locator('[aria-label="X position (m)"]').fill(String((x0 - 0.2).toFixed(2)));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const x1 = await page.evaluate((i) => window.__houseDebug.store.getState().workingScene.objects.find((o) => o.id === i).transform.position[0], id);
  if (Math.abs(x1 - (x0 - 0.2)) < 0.03 || Math.abs(x1 - x0) > 0.01) log(`  ✓ typed X moved it (${x0.toFixed(2)} → ${x1.toFixed(2)})`); else fail(`typed X had no effect (${x0} → ${x1})`);
  // C toggles collisions.
  await page.mouse.click(5, 450);
  await page.keyboard.press('c');
  const off = await page.evaluate(() => window.__houseDebug.store.getState().collisionsOff);
  await page.keyboard.press('c');
  if (off) log('  ✓ C toggles collisions'); else fail('C did not toggle collisions');
}
