import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {create,call,act,catalog,state,save,dir,base,checks,check,calls} from './vps-client.mjs';
const {e}=JSON.parse(await readFile(dir+'/users.json'));
const u=await create('delete-lifecycle-'+Date.now());
let deleted=[];try{deleted=JSON.parse(await readFile(dir+'/deleted-qa-ids.json','utf8'));}catch{}
await save('deleted-qa-ids.json',[...new Set([...deleted,u.state.auth.userId])]);
await act(u,'delete-account',{email:u.email,confirmation:'WRONG'},400);
await act(u,'delete-account',{email:u.email,confirmation:'УДАЛИТЬ'});
await call(u,'/api/state?role=candidate',undefined,401);
await call(u,'/api/auth',{type:'login',email:u.email,password:u.password,role:'candidate'},400);
check('disposable account deletion revokes access',true);
const v=await create('logout-lifecycle-'+Date.now());const logoutCookie=v.cookie;await call(v,'/api/auth',{type:'logout'});v.cookie=logoutCookie;
await call(v,'/api/state?role=candidate',undefined,401);check('logout invalidates own session',true);
const samples=[],errors=[];let next=0;
async function worker(){for(;;){const i=next++;if(i>=120)return;const started=performance.now();try{if(i%3===0)await call(e,'/api/health');else if(i%3===1)await state(e);else await catalog(e,'candidates',{sort:'По результату теста'});samples.push(performance.now()-started);}catch(err){errors.push(err.message);}}}
await Promise.all(Array.from({length:6},worker));samples.sort((a,b)=>a-b);
check('bounded concurrent read run without errors',samples.length===120&&errors.length===0);
await save('load-lifecycle.json',{at:new Date().toISOString(),calls,passed:checks,load:{requests:120,concurrency:6,medianMs:Math.round(samples[60]),p95Ms:Math.round(samples[Math.floor(samples.length*.95)]),maxMs:Math.round(samples.at(-1)),errors}});
console.log(JSON.stringify({phase:'load-lifecycle',checks:checks.length,requests:120,p95Ms:Math.round(samples[114])}));
