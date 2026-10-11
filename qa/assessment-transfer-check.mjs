import assert from 'node:assert/strict';
import fs from 'node:fs';
import { answer,openEvidence,publicSession } from '../vendor/fsp-assessment/dist/src/adaptive/engine.js';
import { packs } from '../vendor/fsp-assessment/dist/src/generative/packs.js';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5174',context=JSON.parse(fs.readFileSync('/tmp/offerly-assessment-qa.json','utf8'));
const [a,b]=context.users;
let checks=0,answers=0,evidence=0,replays=0,extra=0,plans=0,wrongForecasts=0;
const artifacts=new Set(),controls=new Set(),decisions=new Set(),statuses=new Set(),records=[];
async function call(user,path,body,status=200,role='candidate',ua='Mozilla/5.0 Chrome/132.0 Windows NT 10.0'){
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json','X-Offerly-Role':role,'User-Agent':ua,...(user?.cookie?{Cookie:user.cookie}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));checks++;return data;
}
const api='/api/professional';
const raw=async id=>call(a,'/api/qa-assessment',{id});
const safe=v=>{const serialized=JSON.stringify(v);for(const forbidden of ['"rubric"','"groundTruth"','"responseChecks"','"accepted"','"seed"','"contributions"','"config"','"exposureSnapshot"','"gradeRationale"','"semanticFingerprint"'])assert(!serialized.includes(forbidden),forbidden);};
await call(null,api+'/generative-packs',undefined,401);
await call(a,api+'/generative-packs',undefined,403,'employer');
await call(a,api+'/admin/sessions',undefined,404);
assert.equal((await call(a,api+'/generative-packs')).length,12);
await call(a,api+'/adaptive-sessions',{specialization:'bad',targetGrade:'Junior'},400);
await call(a,api+'/adaptive-sessions',{specialization:'backend',targetGrade:'Intern'},400);
await call(a,'/api/action',{type:'finish',id:'anything',role:'candidate'},400);
const priorHistory=await call(a,api+'/adaptive-sessions');
let firstReplay;
for(const pack of packs.filter(p=>p.enabled))for(const grade of ['Junior','Middle','Senior']){
 const prior=priorHistory.find(s=>s.specialization===pack.id&&s.targetGrade===grade&&s.state==='completed');
 if(prior){records.push({id:prior.id,track:pack.id,grade,scenario:records.length%4,answers:prior.progress.answered,result:prior.result,priorVerifiedRun:true});decisions.add(prior.result.decision);statuses.add(prior.result.assessmentStatus);console.log('PRIOR PASS',pack.id,grade);continue;}
 await call(a,'/api/qa-assessment',{action:'reset-start-throttle'});
 let view=await call(a,api+'/adaptive-sessions',{specialization:pack.id,targetGrade:grade});safe(view);
 const same=await call(a,api+'/adaptive-sessions',{specialization:pack.id,targetGrade:grade});assert.equal(same.id,view.id);
 let snapshot=await raw(view.id);assert.equal(snapshot.generation.generatorVersion,'formal-generator-7.3.3');assert.equal(snapshot.config.scoringVersion,'competency-4');assert.equal(snapshot.config.enhancements?.calibratedForms||false,false);assert.equal(Date.parse(snapshot.deadlineAt)-Date.parse(snapshot.startedAt),1200000);
 await call(b,api+`/adaptive-sessions/${view.id}`,undefined,404);
 await call(b,api+`/adaptive-sessions/${view.id}/answer`,{itemId:'x',stepId:'x',optionId:'x'},404);
 await call(a,api+`/adaptive-sessions/${view.id}/answer`,{itemId:'wrong',stepId:'wrong',optionId:'x'},400);
 const oracle=structuredClone(snapshot);
 const scenario=records.length%4; // correct, incorrect, partial, correct plan with incorrect prediction.
 let n=0;
 while(view.state==='active'){
  assert(n++<35);
  const item=oracle.items[oracle.cursor.item].variant,step=item.steps[oracle.cursor.step];
  for(const artifact of view.current.artifacts)if(artifact.type)artifacts.add(artifact.type);
  for(const control of step.responseTask?.controls||[])controls.add(control.type);
  const path=api+`/adaptive-sessions/${view.id}`;
  if(step.exploration){
   const ordered=[...item.artifacts].sort((a,b)=>b.usefulness-a.usefulness);
   for(const artifact of ordered.slice(0,step.requiredEvidenceSources||2)){
    view=await call(a,path+'/evidence',{itemId:item.id,stepId:step.id,artifactId:artifact.id});
    const after=await raw(view.id),at=Date.parse(after.evidenceSelections.at(-1).at);
    openEvidence(oracle,item.id,step.id,artifact.id,at);assert.deepEqual(after,oracle);safe(view);evidence++;
   }
  }
  const entries=Object.entries(step.rubric.scores).sort((a,b)=>b[1]-a[1]);
  const selected=step.exploration?'continue':entries[scenario===0?0:scenario===1?entries.length-1:scenario===2?Math.min(1,entries.length-1):step.responseTask?entries.length-1:0][0];
  const execution=item.generated?.responseChecks?.[step.id]?.accepted[0];
  if(execution)plans++;
  if(scenario===3&&execution)wrongForecasts++;
  const input={itemId:item.id,stepId:step.id,optionId:selected,...(execution?{execution}:{})};
  view=await call(a,path+'/answer',input);safe(view);
  const after=await raw(view.id),at=Date.parse(after.responses.at(-1).at);
  answer(oracle,item.id,step.id,selected,at,execution);assert.deepEqual(after,oracle);
  assert.deepEqual({...view,serverNow:''},{...publicSession(oracle,at),serverNow:''});answers++;
  if(!firstReplay){firstReplay={id:view.id,input};const replay=await call(a,path+'/answer',input);assert.equal(replay.progress.answered,view.progress.answered);replays++;await call(a,path+'/answer',{...input,optionId:'other'},409);}
  if(view.stage==='boundary')extra++;
  const reloaded=await call(a,path);assert.equal(reloaded.progress.answered,view.progress.answered);safe(reloaded);
 }
 assert.deepEqual(view.result,publicSession(oracle).result);assert.equal(view.result.targetGrade,grade);
 decisions.add(view.result.decision);statuses.add(view.result.assessmentStatus);
 records.push({id:view.id,track:pack.id,grade,scenario,answers:n,result:view.result});
 console.log('PASS',pack.id,grade,'scenario',scenario,'steps',n,view.result.decision,view.result.assessmentStatus);
}
// Insufficient evidence and server timeout cannot certify; no profile downgrade.
const timeout=await call(a,api+'/adaptive-sessions',{specialization:'backend',targetGrade:'Senior'});
await call(a,'/api/qa-assessment',{action:'expire',id:timeout.id});
const expired=await call(a,api+`/adaptive-sessions/${timeout.id}`);assert.equal(expired.state,'completed');assert.equal(expired.result.stopReason,'timeout');assert.equal(expired.result.assessmentStatus,'insufficient-evidence');assert.equal(expired.result.decision,'NOT_CONFIRMED');
const late=await call(a,api+`/adaptive-sessions/${timeout.id}/answer`,{itemId:'late',stepId:'late',optionId:'late'});assert.equal(late.progress.answered,0);
const state=await call(a,'/api/state');assert.equal(state.attempts.filter(a=>a.formal).length,records.length+1);assert(state.profile.grade);assert(state.profile.assessmentCategories);
const history=await call(a,api+'/adaptive-sessions');assert.equal(history.length,records.length+1);history.forEach(safe);
// Unknown legacy labels are filled only by a request from that same authenticated session.
await call(b,'/api/qa-assessment',{action:'old-device'});
const devices=await call(b,'/api/sessions',undefined,200,'candidate','Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1');assert.equal(devices.sessions.find(s=>s.current).name,'Safari · iPhone');
const summary={checks,answers,evidence,replays,extra,plans,wrongForecasts,artifacts:[...artifacts],controls:[...controls],decisions:[...decisions],statuses:[...statuses],sessions:records.length+1};
fs.mkdirSync('docs/assessment/verification',{recursive:true});fs.writeFileSync('docs/assessment/verification/transfer.json',JSON.stringify({summary,records},null,2));fs.writeFileSync('/tmp/offerly-assessment-ui.json',JSON.stringify({history:records,b}),{mode:0o600});console.log('PASS',summary);
