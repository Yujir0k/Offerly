import fs from 'node:fs';import assert from 'node:assert/strict';
import {answer,openEvidence,publicSession} from '../vendor/fsp-assessment/dist/src/adaptive/engine.js';
const ctx=JSON.parse(fs.readFileSync('/tmp/offerly-assessment-qa.json','utf8')),a=ctx.users[0],base=process.env.TEST_BASE_URL||'http://127.0.0.1:5174';
async function call(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:a.cookie,Origin:base,'Content-Type':'application/json','X-Offerly-Role':'candidate'},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
await call('/api/qa-assessment',{action:'reset-start-throttle'});
let view=await call('/api/professional/adaptive-sessions',{specialization:'backend',targetGrade:'Middle'}),oracle=await call('/api/qa-assessment',{id:view.id}),extra=0,n=0;const quality=Number(process.env.TEST_QUALITY||.7);
while(view.state==='active'){
 const item=oracle.items[oracle.cursor.item].variant,step=item.steps[oracle.cursor.step],path='/api/professional/adaptive-sessions/'+view.id;
 if(oracle.items[oracle.cursor.item].stage==='boundary')extra++;
 if(step.exploration)for(const artifact of [...item.artifacts].sort((a,b)=>b.usefulness-a.usefulness).slice(0,step.requiredEvidenceSources||2)){view=await call(path+'/evidence',{itemId:item.id,stepId:step.id,artifactId:artifact.id});const after=await call('/api/qa-assessment',{id:view.id});openEvidence(oracle,item.id,step.id,artifact.id,Date.parse(after.evidenceSelections.at(-1).at));assert.deepEqual(after,oracle);}
 const prior=oracle.contributions.filter(c=>c.dimension===step.rubric.dimension),weight=prior.reduce((a,c)=>a+c.weight,0),earned=prior.reduce((a,c)=>a+c.weight*c.value,0);
 const option=step.exploration?'continue':[...step.options].sort((a,b)=>Math.abs((earned+step.rubric.scores[a.id]*step.rubric.informationWeight)/(weight+step.rubric.informationWeight)-quality)-Math.abs((earned+step.rubric.scores[b.id]*step.rubric.informationWeight)/(weight+step.rubric.informationWeight)-quality))[0].id;
 const execution=item.generated?.responseChecks?.[step.id]?.accepted[0];view=await call(path+'/answer',{itemId:item.id,stepId:step.id,optionId:option,...(execution?{execution}:{})});const after=await call('/api/qa-assessment',{id:view.id});answer(oracle,item.id,step.id,option,Date.parse(after.responses.at(-1).at),execution);assert.deepEqual(after,oracle);n++;
}
assert.deepEqual(view.result,publicSession(oracle).result);console.log({steps:n,extra,result:view.result.assessmentStatus,id:view.id});
fs.writeFileSync(process.env.TEST_RESULT||'/tmp/offerly-extra-result.json',JSON.stringify({steps:n,extra,id:view.id,result:view.result}));
