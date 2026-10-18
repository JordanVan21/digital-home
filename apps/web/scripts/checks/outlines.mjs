/* global window */
// Outline screenshots (merge step 4): selected piece outline, then "Show all outlines".
import { join } from 'node:path';
export async function checks({ page, source, log }) {
  await page.evaluate(() => window.__houseDebug.store.setState({ hideUi: true }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join('test-output', `outline-selected-${source}.png`) });
  await page.evaluate(() => window.__houseDebug.store.setState({ showAllOutlines: true, selectedIds: [], selectedId: null }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join('test-output', `outline-all-${source}.png`) });
  await page.evaluate(() => window.__houseDebug.store.setState({ showAllOutlines: false, hideUi: false }));
  log('  ✓ outline screenshots saved');
}
