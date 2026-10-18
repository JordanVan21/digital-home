const STOP = new Set(["a", "an", "the", "with", "and", "of", "for", "in", "on", "to", "style", "modern", "furniture", "fixture", "cc0", "poly", "haven"]);

function singular(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ves")) return `${w.slice(0, -3)}f`; // shelves -> shelf
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  return w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

/** Lowercased, de-pluralized content words. Deliberately simple and deterministic. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.add(singular(raw));
  }
  return out;
}

/** Asset-side tokens plus adjacent-pair compounds, so "arm chair" also matches "armchair". */
export function tokensWithCompounds(text: string): Set<string> {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  const out = tokens(text);
  for (let i = 0; i + 1 < words.length; i++) out.add(singular(words[i] + words[i + 1]));
  return out;
}

/** Content words of a request, minus the category words (category is scored separately). */
export function requestTokens(description: string, category: string): Set<string> {
  const skip = new Set([...tokens(category.replace(/_/g, " ")), singular(category.replace(/[_\s-]/g, "").toLowerCase())]);
  return new Set([...tokens(description)].filter((t) => !skip.has(t)));
}

/** Fraction of `want` found in the asset text, in [0,1]. */
export function tokenCoverage(want: Set<string>, assetText: string): number {
  if (want.size === 0) return 0;
  const have = tokensWithCompounds(assetText);
  let hit = 0;
  for (const t of want) if (have.has(t)) hit++;
  return hit / want.size;
}
