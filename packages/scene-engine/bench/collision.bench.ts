import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bench, describe } from 'vitest';
import test2 from '@house/contracts/fixtures/test2-room.json';
import { AssetCatalogFileSchema, RoomFixtureSchema } from '@house/contracts';
import { bodyOf, findSupport, normalizeShell, resolveTranslation, validateScene, wallBodies } from '../src';

/**
 * CPU microbenchmarks for the merged engine (replaces codex's collision.bench.ts, which measured its
 * own compound collider). Usage: pnpm --filter @house/scene-engine bench. Not frame-rate numbers.
 */
const catalog = AssetCatalogFileSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../../apps/web/public/catalog/catalog.json'), 'utf8')));
const byId = new Map(catalog.assets.map((a) => [a.id, a]));
const assets = (id: string) => byId.get(id);
const fixture = RoomFixtureSchema.parse(test2);
const shell = normalizeShell(fixture.shell);
const scene = fixture.scene;
const chair = scene.objects.find((o) => o.category === 'armchair')!;
const others = scene.objects.filter((o) => o.id !== chair.id).map((o) => bodyOf(o, assets));
const obstacles = [...others, ...wallBodies(shell)];
const vase = scene.objects.find((o) => o.category === 'vase')!;

describe('merged engine (test2, 45 objects)', () => {
  bench('validateScene (all rules, all pairs)', () => { validateScene({ shell, assets }, scene); });
  bench('one drag tick: block-and-slide 0.5 m into the room', () => { resolveTranslation([bodyOf(chair, assets)], obstacles, [0, 0], [0.5, 0.3]); });
  bench('gravity: findSupport for a vase (real top faces)', () => { findSupport(scene.objects, vase, { assets }); });
});
