// Copies Three's Draco decoder into public/decoders so nothing is fetched from a CDN at runtime.
// (Meshopt's decoder ships inside three-stdlib as JS; KTX2/Basis is not needed by the current catalog.)
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// three's exports map hides package.json; resolve the main entry and walk up to the package root.
const threeRoot = join(dirname(require.resolve('three')), '..');
const src = join(threeRoot, 'examples/jsm/libs/draco/gltf');
const dest = join(dirname(fileURLToPath(import.meta.url)), '../public/decoders/draco');
if (!existsSync(src)) throw new Error(`Draco decoders not found at ${src}`);
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`draco decoders → ${dest}`);
