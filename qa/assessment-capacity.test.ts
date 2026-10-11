import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withAssessmentCapacity} from '../lib/assessment-capacity';
test('only two heavy snapshots run at once, excess work is bounded and failure releases a slot',async()=>{
 let active=0,peak=0;const release:Array<()=>void>=[];
 const work=()=>withAssessmentCapacity(async()=>{active++;peak=Math.max(peak,active);await new Promise<void>(resolve=>release.push(resolve));active--;return true;});
 const jobs=Array.from({length:18},()=>work());await new Promise(r=>setImmediate(r));
 assert.equal(active,2);await assert.rejects(work(),e=>(e as any).status===429);
 for(let i=0;i<18;i++){release.shift()!();await new Promise(r=>setImmediate(r));}
 await Promise.all(jobs);assert.equal(peak,2);assert.equal(active,0);
 await assert.rejects(withAssessmentCapacity(async()=>{throw Error('failure')}));
 assert.equal(await withAssessmentCapacity(async()=>42),42);
});
