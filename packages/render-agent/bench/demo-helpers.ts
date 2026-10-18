import { AssetRequest } from '@house/contracts';
export function safeModelKey(key: string) { return /^models\/(polyhaven|generated)\/[\w.-]+\.glb$/.test(key) && !key.includes('..'); }
export function validOrigin(host: string | undefined, origin: string | undefined, port: number) {
  return (host === `127.0.0.1:${port}` || host === `localhost:${port}`) && (origin === undefined || origin === `http://${host}`);
}
export function sse(event: unknown) { return `data: ${JSON.stringify(event)}\n\n`; }
export function descriptionInput(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new Error('Description must contain 1–300 characters.');
  return value.trim();
}
export function parseRequest(text: string, description: string, allowGeneration: boolean) {
  const raw = JSON.parse(text);
  const category = String(raw.category ?? '').toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 41);
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(category)) throw new Error('Model returned an invalid category.');
  if (!Array.isArray(raw.targetDimensionsM) || raw.targetDimensionsM.length !== 3 || !raw.targetDimensionsM.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) throw new Error('Model returned invalid dimensions.');
  return AssetRequest.parse({ ...raw, schemaVersion: 1, category, description: descriptionInput(description), allowGeneration,
    targetDimensionsM: raw.targetDimensionsM.map((n: number) => Math.min(6, Math.max(.05, n))) });
}
