/* global window */
// Performance (merge step 10): drag the barrel chair into / along the sofa in test2 for ~4 s and read
// window.__housePerf (rolling 240-frame mean FPS, p95 frame time). Run with --gpu for real numbers.
const obj = (page, name) => page.evaluate((n) => window.__houseDebug.store.getState().workingScene.objects.find((o) => o.displayName === n), name);
const proj = (page, p) => page.evaluate(([x, y, z]) => window.__houseDebug.project(x, y, z), p);
export async function checks({ page, source, log, fail }) {
  if (source !== 'test2') return;
  const results = [];
  for (const [label, setup] of [['Move tool', 'g'], ['Move, Space held (up/down)', 'g'], ['Move + all outlines', 'g']]) {
    await page.keyboard.press(setup);
    await page.evaluate((all) => window.__houseDebug.store.setState({ showAllOutlines: all }), label.includes('outlines'));
    const chair = await obj(page, 'Bouclé barrel chair');
    const sofa = await obj(page, 'Cream sofa');
    const [sx, sy] = await proj(page, [chair.transform.position[0], 0.3, chair.transform.position[2]]);
    const [tx, ty] = await proj(page, [sofa.transform.position[0], 0.3, sofa.transform.position[2]]);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    if (label.includes('Space')) await page.keyboard.down('Space');
    await page.evaluate(() => window.__housePerf?.reset());
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < 4000) {
      const k = (Math.sin(i / 25) + 1) / 2; // sweep back and forth: into the sofa and away
      await page.mouse.move(sx + (tx - sx) * k, sy + (ty - sy) * k);
      await page.waitForTimeout(16);
      i++;
    }
    const s = await page.evaluate(() => ({ fps: window.__housePerf.fps, p95: window.__housePerf.p95Ms, calls: window.__housePerf.calls, tris: window.__housePerf.triangles }));
    if (label.includes('Space')) await page.keyboard.up('Space');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(300);
    results.push({ label, ...s });
    log(`  ${s.fps >= 55 ? '✓' : '·'} ${label}: ${s.fps.toFixed(1)} FPS, p95 ${s.p95.toFixed(1)} ms, ${s.calls} draw calls, ${(s.tris / 1000).toFixed(0)}k tris`);
  }
  await page.evaluate(() => window.__houseDebug.store.setState({ showAllOutlines: false }));
  if (results.some((r) => r.fps < 45)) fail('dragging fell below 45 FPS');
}
