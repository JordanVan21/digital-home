/**
 * @house/scene-engine — pure, deterministic scene operations, geometry rules, collision,
 * stacking, asset matching and undo logic. No React / Three / DOM / Supabase imports (enforced by
 * ESLint and test/purity.test.ts). Shared by the web editor and the Node backend.
 */
export * from './math';
export * from './polygon';
export * from './obb';
export * from './shell';
export * from './config';
export * from './body';
export * from './collision';
export * from './support';
export * from './rules';
export * from './ops';
export * from './commands';
export * from './editing';
export * from './matching';
export * from './placement';
export * from './history';
export * from './fixtureFormat';
export * from './shapes';
