import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSession,answer,openEvidence} from '../vendor/fsp-assessment/dist/src/adaptive/engine.js';
import {assessmentNavigation,navigateIndependent,reopenAnswer,restoreLegacyRevisions,type EditableAssessmentSession} from '../lib/professional-navigation';
import {packs} from '../vendor/fsp-assessment/dist/src/generative/packs.js';
const now=Date.now();
function submit(s:EditableAssessmentSession, wrong=false){
 const item=s.items[s.cursor.item].variant,step=item.steps[s.cursor.step];
 if(step.exploration){for(const a of [...item.artifacts].sort((a,b)=>b.usefulness-a.usefulness).slice(0,step.requiredEvidenceSources||2))openEvidence(s,item.id,step.id,a.id,now+1000);}
 const option=step.exploration?'continue':Object.entries(step.rubric.scores).sort((a,b)=>b[1]-a[1])[wrong?Object.keys(step.rubric.scores).length-1:0][0];
 answer(s,item.id,step.id,option,now+1000,item.generated?.responseChecks?.[step.id]?.accepted[0]);
}
for(const specialization of packs.filter(p=>p.enabled && (process.env.ALL_NAV_MATRIX || ['backend','qa-automation'].includes(p.id))).map(p=>p.id))for(const grade of ['Junior','Middle','Senior'] as const)test(`${specialization}/${grade}: freely visit sections, retain future answers, same native result`,()=>{
 const seed=createSession('free-nav','owner',grade,`free-${specialization}-${grade}`,now,undefined,undefined,{specialization});
 const sequential=structuredClone(seed) as EditableAssessmentSession;
 const free=structuredClone(seed) as EditableAssessmentSession;
 const positions=assessmentNavigation(free);
 assert(positions.every(n=>n.available));
 // Start with the final core step: it must not finish while earlier sections are pending.
 for(const target of positions.slice(1).toReversed()){
  navigateIndependent(free,target.itemId,target.stepId,now+1000);submit(free);
  assert.equal(free.state,'active');
 }
 const target=positions.at(-1)!;
 const before=structuredClone(free.responses),evidence=structuredClone(free.evidenceSelections),deadline=free.deadlineAt;
 navigateIndependent(free,target.itemId,target.stepId,now+1100);
 assert.deepEqual(free.responses,before,'view never withdraws answers');
 reopenAnswer(free,target.itemId,target.stepId,now+1200);
 assert.deepEqual(free.responses,before.filter(r=>r.itemId!==target.itemId||r.stepId!==target.stepId));
 assert.deepEqual(free.evidenceSelections,evidence);assert.equal(free.deadlineAt,deadline);
 submit(free);assert.equal(free.responses.length,before.length);
 // Editing the earliest saved step must preserve every later response byte for byte.
 const early=positions[1],later=structuredClone(free.responses.filter(r=>r.itemId!==early.itemId||r.stepId!==early.stepId));
 navigateIndependent(free,early.itemId,early.stepId,now+1300);reopenAnswer(free,early.itemId,early.stepId,now+1400);
 assert.deepEqual(free.responses,later);submit(free);
 for(const session of [sequential,free]){let guard=0;while(session.state==='active'){assert(++guard<50);submit(session);}}
 assert.equal(free.result!.decision,sequential.result!.decision);
 assert.equal(free.result!.stopReason,sequential.result!.stopReason);
 for(const key of ['estimatedScore','lowerBound','upperBound','cutScore'] as const)assert(Math.abs(free.result!.band[key]-sequential.result!.band[key])<1e-12);
 assert.equal(new Set(free.responses.map(r=>r.itemId+'/'+r.stepId)).size,free.responses.length);
 assert.throws(()=>reopenAnswer(free,early.itemId,early.stepId,now+1500));
});

test('legacy cascading revisions recover later answers once, never overwrite replacements or the edited answer',()=>{
 const s=createSession('legacy-nav','owner','Junior','legacy-nav',now,undefined,undefined,{specialization:'backend'}) as EditableAssessmentSession;
 submit(s);submit(s);submit(s);
 const original=structuredClone(s.responses),first=original[0];
 s.answerRevisions=[{at:new Date(now).toISOString(),itemId:first.itemId,stepId:first.stepId,removed:original}];
 s.responses=[];s.contributions=[];s.cursor={item:0,step:0};
 assert(restoreLegacyRevisions(s));assert.deepEqual(s.responses,original.slice(1));
 assert(!restoreLegacyRevisions(s));assert.equal(s.responses.length,2);
 assert.equal(s.contributions.length,original.slice(1).flatMap(r=>r.contributions).length);
});
