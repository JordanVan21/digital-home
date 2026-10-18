/* global window */
// Walk mode (P): WASD moves at eye height, dragging looks around, walls stop you, Esc exits.
export async function checks({ page, log, fail }) {
  const cam = () => page.evaluate(() => window.__houseDebug.camera());
  await page.mouse.click(700, 450);
  await page.keyboard.press('p');
  await page.waitForTimeout(600);
  const a = await cam();
  await page.keyboard.down('w');
  await page.waitForTimeout(1000);
  await page.keyboard.up('w');
  const b = await cam();
  const moved = Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]);
  if (moved > 0.5 && Math.abs(b.position[1] - 1.6) < 1e-6) log(`  ✓ W walked ${moved.toFixed(2)} m at eye height`); else fail(`walk did not move (${moved})`);
  await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(820, 450, { steps: 8 }); await page.mouse.up();
  const c = await cam();
  if (Math.abs(c.direction[0] - b.direction[0]) + Math.abs(c.direction[2] - b.direction[2]) > 0.1) log('  ✓ dragging looks around'); else fail('look drag did nothing');
  // Hold W for a long time: the walls stop you inside the room.
  await page.keyboard.down('w');
  await page.waitForTimeout(6000);
  await page.keyboard.up('w');
  const d = await cam();
  const inside = await page.evaluate(([x, z]) => {
    const poly = window.__houseDebug.store.getState().shell.floor.polygonXZ;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i]; const [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }, [d.position[0], d.position[2]]);
  if (inside) log('  ✓ the walls stopped the walk inside the room'); else fail(`walked through a wall to ${d.position}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (!(await page.evaluate(() => window.__houseDebug.store.getState().walkMode))) log('  ✓ Esc left walk mode'); else fail('Esc did not leave walk mode');
}
