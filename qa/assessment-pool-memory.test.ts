import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fallbackCacheSize,validatedFallbackPool} from '../vendor/fsp-assessment/src/generative/pool';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('fallback cache evicts old pools without changing regenerated task snapshots',()=>{
 const first=validatedFallbackPool('backend','Junior'),signature=hash(first);
 validatedFallbackPool('frontend','Junior');validatedFallbackPool('security-appsec','Junior');
 assert.equal(fallbackCacheSize(),2);
 const again=validatedFallbackPool('backend','Junior');
 assert.notEqual(again,first);assert.equal(hash(again),signature);assert.equal(fallbackCacheSize(),2);
});
