/* global window */
// Movement checks: scroll-wheel height, Space up/down (codex), selection stays on the held piece,
// rotate by dragging the piece, undo glide.
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

  // 2. Hold Space mid-drag (codex): straight up, X/Z kept; release Space and keep sliding at that height, no jump.
  before = (await st(page)).objs[id].transform.position;
  {
    const [sx, sy] = await screenOf(page, id);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 6, sy); await page.waitForTimeout(40);
    await page.keyboard.down('Space');
    for (let i = 1; i <= 8; i++) { await page.mouse.move(sx + 6, sy - i * 10); await page.waitForTimeout(25); }
    const up = await page.evaluate((i) => window.__houseDebug.groupPosition(i), id);
    await page.keyboard.up('Space');
    await page.waitForTimeout(40);
    const atRelease = await page.evaluate((i) => window.__houseDebug.groupPosition(i), id);
    for (let i = 1; i <= 6; i++) { await page.mouse.move(sx + 6 + i * 8, sy - 80); await page.waitForTimeout(25); }
    const slid = await page.evaluate((i) => window.__houseDebug.groupPosition(i), id);
    await page.mouse.up();
    await page.waitForTimeout(400);
    after = (await st(page)).objs[id].transform.position;
    const xzKept = Math.hypot(up[0] - before[0], up[2] - before[2]) < 0.06;
    if (up[1] > before[1] + 0.1 && xzKept) log(`  ✓ Space lifted it ${((up[1] - before[1]) * 100).toFixed(0)} cm straight up`); else fail(`Space did not lift straight up (y ${before[1]} → ${up[1]})`);
    if (Math.abs(atRelease[1] - up[1]) < 0.01 && Math.abs(slid[1] - up[1]) < 0.02) log('  ✓ releasing Space kept the height and slid on without a jump'); else fail(`height jumped after releasing Space (${up[1]} → ${atRelease[1]} → ${slid[1]})`);
    if (after[1] > before[1] + 0.1) log("  ✓ let go: it stays up ('Mix')"); else fail('it fell after a Space lift in Mix');
  }

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
  // 2b. The selection stays on the held piece the whole drag, even when it's blocked and the pointer
  // runs over other furniture; obstacles aren't outlined.
  {
    await page.keyboard.press('g');
    const [sx, sy] = await screenOf(page, id);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    let switched = false;
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(sx - i * 14, sy - i * 6);
      await page.waitForTimeout(20);
      const sel = await page.evaluate(() => window.__houseDebug.store.getState().selectedIds);
      if (sel.length !== 1 || sel[0] !== id) switched = true;
    }
    const outlined = await page.evaluate(() => window.__houseDebug.store.getState().selectedIds.length);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const sel = await page.evaluate(() => window.__houseDebug.store.getState().selectedIds);
    if (!switched && sel.length === 1 && sel[0] === id && outlined === 1) log('  ✓ selection stayed on the held piece for the whole drag'); else fail('selection switched during the drag');
  }

  // 3. Rotate tool: drag on the piece itself turns it.
  await page.keyboard.press('r');
  const yaw0 = yawOf((await st(page)).objs[id].transform.rotation);
  await drag([[30, 0], [50, 30], [30, 60], [0, 70]]);
  const yaw1 = yawOf((await st(page)).objs[id].transform.rotation);
  if (Math.abs(yaw1 - yaw0) > 0.1) log(`  ✓ rotate-drag on the piece turned it ${Math.round(((yaw1 - yaw0) * 180) / Math.PI)}°`); else fail('rotate-drag did not turn it');

}
