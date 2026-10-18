/* global window */
// Stacking + gravity checks (merge step 7), demo-room: desk lamp on the desk, coffee table nearby.
const obj = (page, name) => page.evaluate((n) => window.__houseDebug.store.getState().workingScene.objects.find((o) => o.displayName === n), name);
const proj = (page, p) => page.evaluate(([x, y, z]) => window.__houseDebug.project(x, y, z), p);

async function dragLamp(page, to, { midCheck, wheel } = {}) {
  const lamp = await obj(page, 'Desk lamp');
  const [sx, sy] = await proj(page, [lamp.transform.position[0], lamp.transform.position[1] + 0.03, lamp.transform.position[2]]);
  const [tx, ty] = await proj(page, to);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) { await page.mouse.move(sx + ((tx - sx) * i) / 20, sy + ((ty - sy) * i) / 20); await page.waitForTimeout(20); }
  if (wheel) for (let i = 0; i < wheel; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40); }
  await page.waitForTimeout(100);
  const mid = midCheck ? await page.evaluate((id) => window.__houseDebug.groupPosition(id), lamp.id) : null;
  await page.mouse.up();
  await page.waitForTimeout(400);
  return { lamp, mid, after: await obj(page, 'Desk lamp') };
}

export async function checks({ page, source, log, fail }) {
  if (source !== 'demo-room') return;
  const desk = await obj(page, 'Desk');
  const table = await obj(page, 'Coffee table');
  // 1. Off the desk's edge: held at desk height while dragging, falls to the floor on release ('mix').
  const deskTop = (await obj(page, 'Desk lamp')).transform.position[1];
  const away = [desk.transform.position[0] - 1.0, 0, desk.transform.position[2] + 1.2];
  const r1 = await dragLamp(page, away, { midCheck: true });
  if (Math.abs(r1.mid[1] - deskTop) < 0.02) log(`  ✓ off the edge it held its height (${r1.mid[1].toFixed(2)} m) while dragging`); else fail(`held height ${r1.mid[1]} ≠ desk top ${deskTop}`);
  if (r1.after.transform.position[1] < 0.01 && !r1.after.placement?.parentId) log('  ✓ released → fell to the floor'); else fail(`did not fall: y=${r1.after.transform.position[1]} parent=${r1.after.placement?.parentId}`);
  // 2. Hop onto the coffee table while dragging; it attaches to it.
  const r2 = await dragLamp(page, [table.transform.position[0], table.dimensionsM[1], table.transform.position[2]]);
  if (r2.after.placement?.parentId === table.id) log(`  ✓ hopped onto the coffee table (y=${r2.after.transform.position[1].toFixed(2)})`); else fail(`did not land on the table (parent ${r2.after.placement?.parentId}, y ${r2.after.transform.position[1]})`);
  // 2b. Magnetic catch (codex, 12 cm): raised 10 cm over the table it snaps back onto it; 15 cm stays up ('mix').
  const onTable = r2.after.transform.position;
  const r2b = await dragLamp(page, [onTable[0] + 0.05, onTable[1], onTable[2]], { wheel: 2 });
  if (r2b.after.placement?.parentId === table.id && Math.abs(r2b.after.transform.position[1] - onTable[1]) < 0.005) log('  ✓ raised 10 cm over the table, the magnetic catch put it back on the table');
  else fail(`magnetic catch: y ${r2b.after.transform.position[1]} (table top ${onTable[1]}), parent ${r2b.after.placement?.parentId}`);
  const r2c = await dragLamp(page, [onTable[0] + 0.05, onTable[1], onTable[2]], { wheel: 3 });
  if (r2c.after.transform.position[1] > onTable[1] + 0.12) log(`  ✓ raised 15 cm it stays up in 'Mix' (${(r2c.after.transform.position[1] - onTable[1]).toFixed(2)} m above)`);
  else fail(`15 cm raise did not stay (${r2c.after.transform.position[1]})`);
  // 3. 'Never fall': off the table's edge it stays in the air after release.
  await page.evaluate(() => window.__houseDebug.store.setState({ releaseMode: 'stay' }));
  const r3 = await dragLamp(page, [table.transform.position[0] + 1.2, 0, table.transform.position[2] - 0.3]);
  if (r3.after.transform.position[1] > 0.1) log(`  ✓ 'Never fall' kept it in the air (${r3.after.transform.position[1].toFixed(2)} m)`); else fail(`'Never fall' still fell (${r3.after.transform.position[1]})`);
  // 4. 'Always fall': raised with the wheel, it still drops on release.
  await page.evaluate(() => window.__houseDebug.store.setState({ releaseMode: 'fall' }));
  const r4 = await dragLamp(page, [table.transform.position[0] + 1.5, 0, table.transform.position[2] - 0.3], { wheel: 4 });
  if (r4.after.transform.position[1] < 0.01) log('  ✓ \'Always fall\' dropped the raised lamp to the floor'); else fail(`'Always fall' left it at ${r4.after.transform.position[1]}`);
  await page.evaluate(() => window.__houseDebug.store.setState({ releaseMode: 'mix' }));
}
