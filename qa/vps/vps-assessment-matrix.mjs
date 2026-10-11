import {create,complete,call,save,checks,calls,dir} from './vps-client.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
const label=process.env.VPS_QA_MATRIX_LABEL||'matrix';
if(!/^[a-z0-9-]{1,40}$/.test(label))throw Error('Invalid matrix label');
const tracks=['backend','frontend','devops-sre','qa-automation','data-engineering','ml-engineer','data-scientist','mlops','genai','android','ios','security-appsec'];
let jobs=[],rows=[];
try {jobs=JSON.parse(await readFile(dir+'/matrix-users.json','utf8'));rows=JSON.parse(await readFile(dir+'/matrix-progress.json','utf8')).rows;}catch{}
if(!jobs.length)for(const grade of ['Junior','Middle','Senior'])for(const scenario of ['success','failure','timeout'])jobs.push({grade,scenario,user:await create(label+'-'+grade+'-'+scenario)});
await save('matrix-users.json',jobs);
async function worker(){
 for(;;){const job=jobs.shift();if(!job)return;const {user,grade,scenario}=job;
  for(const track of tracks){
   if(rows.some(r=>r.track===track&&r.grade===grade&&r.scenario===scenario))continue;
   const v=await complete(user,track,grade,scenario);
   await call(user,'/api/professional/adaptive-sessions',{specialization:track,targetGrade:scenario==='success'?(grade==='Junior'?'Middle':'Junior'):grade},429);
   rows.push({track,grade,scenario,id:v.id,decision:v.result.decision,status:v.result.assessmentStatus,timeoutSummary:v.result.timeoutSummary});
   writeFileSync(dir+'/matrix-progress.json',JSON.stringify({cases:rows.length,calls,rows}),{mode:0o600});
   console.log(JSON.stringify({case:rows.length,track,grade,scenario}));
  }
 }
}
await Promise.all([worker(),worker(),worker()]);
await save('matrix.json',{cases:rows.length,calls,checks:checks.length,rows});
console.log(JSON.stringify({phase:'matrix',cases:rows.length,calls,checks:checks.length,result:'passed'}));
