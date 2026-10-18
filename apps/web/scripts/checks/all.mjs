/* global window, localStorage */
// All merged-sandbox browser checks (pnpm test:browser). Replaces the codex Playwright specs:
// sandbox.spec → ui.mjs + smoke; compound-snapping-stack / surface-snapping → stacking.mjs + snapping.mjs;
// compound-collision → engine tests (merge-collision.test.ts) + contact guides; polyhaven-continuous →
// move.mjs (continuous move / raise); geometry-lab.spec → lab.mjs. Each module starts from a fresh room.
import { checks as ui } from './ui.mjs';
import { checks as move } from './move.mjs';
import { checks as stacking } from './stacking.mjs';
import { checks as snapping } from './snapping.mjs';
import { checks as outlines } from './outlines.mjs';
import { checks as lab } from './lab.mjs';
import { checks as perf } from './perf.mjs';
import { checks as walk } from './walk.mjs';

async function fresh(page, url, source) {
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  await page.goto(`${url}?source=${source}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__houseReady === true && !!window.__houseDebug, null, { timeout: 180_000 });
  await page.waitForTimeout(600);
}

export async function checks(ctx) {
  const { page, url, source, log } = ctx;
  const modules = { ui, move, outlines, walk, ...(source === 'demo-room' ? { stacking, snapping, lab } : {}), ...(source === 'test2' ? { perf } : {}) };
  for (const [name, run] of Object.entries(modules)) {
    log(`  — ${name}`);
    await fresh(page, url, source);
    if (!['outlines', 'lab', 'perf', 'walk'].includes(name)) {
      // Most checks act on a selected piece: select the first draggable one like the base smoke drag does.
      await page.evaluate(() => {
        const s = window.__houseDebug.store.getState();
        const o = s.workingScene.objects.find((x) => !x.locked && !x.placement?.parentId && x.category === 'sofa') ?? s.workingScene.objects[0];
        window.__houseDebug.store.setState({ selectedIds: [o.id], selectedId: o.id });
      });
    }
    await run(ctx);
  }
}
