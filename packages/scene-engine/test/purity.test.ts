import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** scene-engine and contracts must stay framework-free so the Node backend can import them. */
const FORBIDDEN_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](react(?:-dom)?(?:\/[^'"]*)?|three(?:\/[^'"]*)?|@react-three\/[^'"]+|@supabase\/[^'"]+|zustand(?:\/[^'"]*)?)['"]/;
const FORBIDDEN_GLOBAL = /\b(window|document|localStorage|sessionStorage|navigator|requestAnimationFrame)\s*[.(]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('purity', () => {
  const roots = [join(__dirname, '../src'), join(__dirname, '../../contracts/src')];
  for (const file of roots.flatMap(files)) {
    it(`${file.split(/[\\/]packages[\\/]/)[1]} has no React/Three/DOM imports`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src.match(FORBIDDEN_IMPORT)?.[0] ?? null).toBeNull();
      expect(src.match(FORBIDDEN_GLOBAL)?.[0] ?? null).toBeNull();
    });
  }
});
