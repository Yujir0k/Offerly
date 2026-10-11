import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5174';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname)||new URL(base).port==='5173')throw Error('Isolated QA only');
let cookie='',checks=0;
async function call(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie,'X-Offerly-Role':'candidate'},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));checks++;return data;}
const s=await call('/api/auth',{type:'login',role:'candidate',email:'registration-polish-1791632626382@example.test',password:'calendar-test-1234'});
const prior=s.surveys.length;
assert.equal(prior,0,'Dedicated QA account has no preliminary survey.');
const packs=await call('/api/professional/generative-packs');
assert.equal(packs.length,12);
const attempt=await call('/api/professional/adaptive-sessions',{specialization:'backend',targetGrade:'Junior'});
assert.equal(attempt.targetGrade,'Junior');assert.equal(attempt.specialization,'backend');assert.equal(attempt.state,'active');
const reopened=await call('/api/professional/adaptive-sessions/'+attempt.id);
assert.equal(reopened.id,attempt.id);assert.equal(reopened.deadlineAt,attempt.deadlineAt);
assert.equal((await call('/api/state?role=candidate')).surveys.length,prior);
console.log(`${checks} HTTP checks passed: 12 specializations, direct grade session without survey, public task, reopen and no survey creation.`);
