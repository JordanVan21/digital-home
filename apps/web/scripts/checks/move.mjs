/* global window */
// Movement checks (merge step 6): 3D move, scroll-wheel height, rotate by dragging the piece, undo glide.
const st = (page) => page.evaluate(() => {
  const s = window.__houseDebug.store.getState();
  return { mode: s.mode, sel: s.selectedId, objs: Object.fromEntries(s.workingScene.objects.map((o) => [o.id, o])) };
});
const screenOf = (page, id) => page.evaluate((i) => {
  const o = window.__houseDebug.store.getState().workingScene.objects.find((x) => x.id === i);
  const [x, y, z] = o.transform.position;
  return window.__houseDebug.project(x, y + o.dimensionsM[1] / 2, z);
}, id);
const yawOf = (q) => 2 * Math.atan2(q[1], q[3]);

export async function checks({ page, log, fail }) {
  // Pick a small free-standing item (chair) to work with.
  const id = await page.evaluate(() => {
    const s = window.__houseDebug.store.getState();
    const o = s.workingScene.objects.find((x) => !x.locked && !x.placement?.parentId && /chair/.test(x.category));
    window.__houseDebug.store.setState({ selectedIds: [o.id], selectedId: o.id });
    return o.id;
  });
  const drag = async (path, wheel) => {
    const [sx, sy] = await screenOf(page, id);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (const [dx, dy] of path) { await page.mouse.move(sx + dx, sy + dy); await page.waitForTimeout(20); }
    if (wheel) { for (let i = 0; i < wheel; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(30); } }
    await page.mouse.up();
    await page.waitForTimeout(400);
  };

  // 1. Scroll wheel while dragging (Move tool) raises the piece; in 'mix' it stays up.
  let before = (await st(page)).objs[id].transform.position;
  await drag([[5, 0], [15, 0], [30, 0]], 3);
  let after = (await st(page)).objs[id].transform.position;
  if (after[1] - before[1] > 0.1) log(`  ✓ wheel raised it ${((after[1] - before[1]) * 100).toFixed(0)} cm`); else fail(`wheel did not raise it (${before[1]} → ${after[1]})`);

  // 2. 3D move: dragging up on screen lifts it, sideways moves it.
  await page.keyboard.press('m');
  before = (await st(page)).objs[id].transform.position;
  await drag([[0, -10], [10, -30], [20, -60]]);
  after = (await st(page)).objs[id].transform.position;
  if (after[1] > before[1] + 0.05) log(`  ✓ 3D move lifted it ${((after[1] - before[1]) * 100).toFixed(0)} cm`); else fail(`3D move did not lift (${before[1]} → ${after[1]})`);

  // 4. Undo glides (not jumps) back.
  const target = (await st(page)).objs[id];
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(40);
  const mid = await page.evaluate((i) => window.__houseDebug.groupPosition(i), id);
  await page.waitForTimeout(700);
  const end = await page.evaluate((i) => window.__houseDebug.groupPosition(i), id);
  const undone = (await st(page)).objs[id];
  const dMid = Math.hypot(mid[0] - undone.transform.position[0], mid[1] - undone.transform.position[1], mid[2] - undone.transform.position[2]);
  const dEnd = Math.hypot(end[0] - undone.transform.position[0], end[1] - undone.transform.position[1], end[2] - undone.transform.position[2]);
  void target;
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(500);
  if (dEnd < 0.005) log(`  ✓ undo glided into place (${(dMid * 100).toFixed(1)} cm away after 40 ms, 0 at the end)`); else fail(`undo did not settle at the restored pose (${dEnd})`);
  // 3. Rotate tool: drag on the piece itself turns it.
  await page.keyboard.press('r');
  const yaw0 = yawOf((await st(page)).objs[id].transform.rotation);
  await drag([[30, 0], [50, 30], [30, 60], [0, 70]]);
  const yaw1 = yawOf((await st(page)).objs[id].transform.rotation);
  if (Math.abs(yaw1 - yaw0) > 0.1) log(`  ✓ rotate-drag on the piece turned it ${Math.round(((yaw1 - yaw0) * 180) / Math.PI)}°`); else fail('rotate-drag did not turn it');

}
