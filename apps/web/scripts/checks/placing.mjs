/* global window, document */
// test2: placing a lantern off-centre on a bookshelf board (no wall pull), and pillows staying on the
// sofa cushion against the backrest (no sinking, no falling off the back).
const obj = (page, name) => page.evaluate((n) => window.__houseDebug.store.getState().workingScene.objects.find((o) => o.displayName === n), name);
const proj = (page, p) => page.evaluate(([x, y, z]) => window.__houseDebug.project(x, y, z), p);
async function drag(page, from, to, steps = 24) {
  const [sx, sy] = await proj(page, from);
  const [tx, ty] = await proj(page, to);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(sx + ((tx - sx) * i) / steps, sy + ((ty - sy) * i) / steps); await page.waitForTimeout(20); }
  const guides = await page.evaluate(() => document.querySelectorAll('.readout').length);
  await page.mouse.up();
  await page.waitForTimeout(400);
  return guides;
}
export async function checks({ page, source, log, fail }) {
  if (source !== 'test2') return;
  await page.evaluate(() => window.__houseDebug.store.setState({ selectedIds: [], selectedId: null }));
  // --- Lantern onto the shelf's second board (between a book and a plant), off-centre: lands where aimed.
  const shelf = await obj(page, 'Open bookshelf');
  const lp = (await obj(page, 'Orb lantern')).transform.position;
  for (const target of [2.05, 1.97, 2.08]) {
    await drag(page, [lp[0], lp[1] + 0.12, lp[2]], [target, 0.62, -2.2]);
    const l = await obj(page, 'Orb lantern');
    const on = l.placement?.parentId === shelf.id && Math.abs(l.transform.position[1] - 0.47) < 0.01;
    const dx = l.transform.position[0] - target;
    if (on && Math.abs(dx) < 0.02) log(`  ✓ aimed x=${target.toFixed(2)} → x=${l.transform.position[0].toFixed(2)} on the shelf, no pull to an end or the wall`);
    else fail(`lantern aimed x=${target.toFixed(2)} landed at ${l.transform.position.map((n) => n.toFixed(2))} ${on ? 'on the shelf' : 'NOT on the shelf'}`);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(700);
  }
  // --- Pillow pushed into the backrest / off the back: stays on the cushion.
  const sofa = await obj(page, 'Cream sofa');
  const p0 = (await obj(page, 'Rust pillow')).transform.position;
  await drag(page, [p0[0], p0[1] + 0.2, p0[2]], [p0[0], p0[1] + 0.2, p0[2] + 0.2]);
  const pf = (await obj(page, 'Rust pillow')).transform.position;
  if (pf[2] > p0[2] + 0.1) log(`  ✓ pillow pulled forward on the cushion (z ${pf[2].toFixed(2)})`); else fail(`pillow didn't move forward: ${pf.map((n) => n.toFixed(2))}`);
  await drag(page, [pf[0], pf[1] + 0.2, pf[2]], [pf[0], pf[1] + 0.2, pf[2] - 1.4], 36);
  const p1 = await obj(page, 'Rust pillow');
  const back = sofa.transform.position[2] - 0.04 + 0.075; // backrest front + half the pillow depth
  if (p1.placement?.parentId === sofa.id && Math.abs(p1.transform.position[1] - 0.48) < 0.01 && p1.transform.position[2] >= back - 0.01) log(`  ✓ pushed back, the pillow stopped at the backrest on the cushion (z ${p1.transform.position[2].toFixed(2)}, y ${p1.transform.position[1].toFixed(2)})`);
  else fail(`pillow went wrong: parent ${p1.placement?.parentId === sofa.id ? 'sofa' : p1.placement?.parentId}, pos ${p1.transform.position.map((n) => n.toFixed(2))}`);
  const v = await page.evaluate((id) => (window.__houseDebug.store.getState().violations[id] ?? []).map((x) => x.detail), p1.id);
  if (!v.length) log('  ✓ no warnings on the pillow'); else fail(`pillow warnings: ${v.join(' | ')}`);
  // --- Pushed sideways into the arm: stops at the arm, still on the cushion.
  const q0 = p1.transform.position;
  await drag(page, [q0[0], q0[1] + 0.2, q0[2]], [q0[0] - 1.2, q0[1] + 0.2, q0[2]], 36);
  const q1 = await obj(page, 'Rust pillow');
  const arm = sofa.transform.position[0] - 1.2 + 0.225; // arm inner face + half the pillow width
  if (q1.placement?.parentId === sofa.id && Math.abs(q1.transform.position[1] - 0.48) < 0.01 && q1.transform.position[0] >= arm - 0.01) log(`  ✓ pushed sideways, it stopped at the arm (x ${q1.transform.position[0].toFixed(2)})`);
  else fail(`pillow vs arm: parent ${q1.placement?.parentId === sofa.id ? 'sofa' : q1.placement?.parentId}, pos ${q1.transform.position.map((n) => n.toFixed(2))}`);
}
