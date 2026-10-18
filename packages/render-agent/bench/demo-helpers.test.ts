import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeModelKey, validOrigin, sse, parseRequest, descriptionInput } from './demo-helpers';
test('model paths reject traversal and unrelated roots', () => {
  for (const p of ['models/polyhaven/chair.glb', 'models/generated/table-123.glb']) assert.ok(safeModelKey(p));
  for (const p of ['models/generated/../x.glb', 'models/generated/a..glb', '/models/generated/a.glb', 'models/generated/a/b.glb', 'models/polyhaven/a.glb?x', 'models/other/a.glb']) assert.ok(!safeModelKey(p));
});
test('host and origin must match exact loopback origin', () => {
  assert.ok(validOrigin('localhost:5199', 'http://localhost:5199', 5199));
  assert.ok(validOrigin('127.0.0.1:5199', undefined, 5199));
  for (const [h,o] of [['evil:5199',undefined], ['localhost:5199','null'], ['localhost:5199','http://evil'], ['localhost:5199','http://127.0.0.1:5199']]) assert.ok(!validOrigin(h,o,5199));
});
test('SSE escapes newlines in payload and yields exactly one frame', () => {
  const frame = sse({ type:'status', msg:'a\nb' });
  assert.equal(frame.split('\n\n').length,2);
  assert.deepEqual(JSON.parse(frame.slice(6).trim()), {type:'status',msg:'a\nb'});
});
test('request sanitizes category, clamps sizes and preserves user controls', () => {
  const r = parseRequest(JSON.stringify({category:'Dining Table!',description:'invented',targetDimensionsM:[-2,100,.75],allowGeneration:true}), 'my table',false);
  assert.equal(r.category,'dining_table'); assert.deepEqual(r.targetDimensionsM,[.05,6,.75]); assert.equal(r.description,'my table'); assert.equal(r.allowGeneration,false); assert.deepEqual(r.styles,[]);
  for (const value of ['{}','{"category":"123","targetDimensionsM":[1,1,1]}','{"category":"chair","targetDimensionsM":[1,null,1]}']) assert.throws(()=>parseRequest(value,'chair',true));
  assert.throws(()=>descriptionInput('x'.repeat(301))); assert.throws(()=>descriptionInput(' '));
});
