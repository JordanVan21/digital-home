/* global window */
// Snapping keys (merge step 8), demo-room: Shift = 10 cm grid; Alt = no snapping (no hop onto surfaces).
const obj = (page, name) => page.evaluate((n) => window.__houseDebug.store.getState().workingScene.objects.find((o) => o.displayName === n), name);
const proj = (page, p) => page.evaluate(([x, y, z]) => window.__houseDebug.project(x, y, z), p);
async function drag(page, name, to, key, yOff = 0.03) {
  const o = await obj(page, name);
  const [sx, sy] = await proj(page, [o.transform.position[0], o.transform.position[1] + yOff, o.transform.position[2]]);
  const [tx, ty] = await proj(page, to);
  if (key) await page.keyboard.down(key);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) { await page.mouse.move(sx + ((tx - sx) * i) / 20, sy + ((ty - sy) * i) / 20); await page.waitForTimeout(20); }
  await page.mouse.up();
  if (key) await page.keyboard.up(key);
  await page.waitForTimeout(400);
  return obj(page, name);
}
export async function checks({ page, source, log, fail }) {
  if (source !== 'demo-room') return;
  const p = await drag(page, 'Potted plant', [0.43, 0, 1.17], 'Shift', 0.2);
  const onGrid = (n) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-6;
  if (onGrid(p.transform.position[0]) && onGrid(p.transform.position[2])) log(`  ✓ Shift-drag landed on the 10 cm grid (${p.transform.position[0].toFixed(2)}, ${p.transform.position[2].toFixed(2)})`);
  else fail(`Shift-drag off grid: ${p.transform.position}`);
  const table = await obj(page, 'Coffee table');
  const lamp = await drag(page, 'Desk lamp', [table.transform.position[0], 0, table.transform.position[2] + 0.9]);
  const alt = await drag(page, 'Desk lamp', [table.transform.position[0], 0, table.transform.position[2]], 'Alt');
  if (alt.placement?.parentId !== table.id) log('  ✓ Alt-drag did not hop onto the coffee table (no snapping)');
  else fail('Alt-drag still hopped onto the table');
  void lamp;
}
