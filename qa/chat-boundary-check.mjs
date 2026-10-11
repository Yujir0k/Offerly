// Use synthetic fixtures produced by hiring-chat-check.mjs in a separate localhost app.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base=process.env.TEST_BASE_URL,fixture=process.env.TEST_FIXTURE_FILE;
if(!base||!fixture||!['localhost','127.0.0.1'].includes(new URL(base).hostname)||new URL(base).port==='5173') throw Error('Isolated QA app and TEST_FIXTURE_FILE required');
const f=JSON.parse(await readFile(fixture,'utf8'));let checks=0;
async function call(u,path,data,status=200,role='candidate',raw=false,origin=base){
 const r=await fetch(base+path,{method:data!==undefined?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','X-Offerly-Role':role,Cookie:u.cookie},body:data===undefined?undefined:raw?data:JSON.stringify(data)});const body=await r.json();assert.equal(r.status,status,JSON.stringify(body));checks++;return body;
}
const path='/api/conversations/'+f.second.id;
if(process.env.TEST_AFTER_RESTART){
 const page=await call(f.b,path);assert(page.messages.some(m=>m.body===f.persistenceMarker));assert(page.hasOlder);const old=await call(f.b,path+'?before='+page.messages[0].id);assert(old.messages.length>0);checks+=3;
 const result=await call(f.a,'/api/professional/adaptive-sessions/'+f.report);assert.equal(result.result.decision,'CONFIRMED');checks++;
 console.log(JSON.stringify({checks,persistenceAfterRestart:true}));process.exit(0);
}
await call(f.b,path,{type:'message',body:'Foreign origin',clientId:randomUUID()},400,'candidate',false,'https://foreign.example');
await call(f.b,path,'{broken',400,'candidate',true);
await call(f.b,path,' '.repeat(24001),413,'candidate',true);
await call(f.b,path,{type:'message',body:'x'.repeat(4001),clientId:randomUUID()},400);
await call(f.b,path+'?before=invalid',undefined,400);
await call(f.employer,'/api/conversations?before=invalid',undefined,400,'employer');
const member={action:'chat-member',companyId:f.employer.state.company.id,userId:f.outsider.state.auth.userId};
await call(f.employer,'/api/qa-assessment',{...member,role:'viewer'});
assert.equal((await call(f.outsider,path,undefined,200,'employer')).conversation.canWrite,false);checks++;
await call(f.outsider,path,{type:'message',body:'Viewer blocked',clientId:randomUUID()},403,'employer');
await call(f.employer,'/api/qa-assessment',{...member,role:'recruiter'});
assert.equal((await call(f.outsider,path,undefined,200,'employer')).conversation.canWrite,true);checks++;
await call(f.outsider,path,{type:'message',body:'Сообщение участника команды',clientId:randomUUID()},200,'employer');
await call(f.employer,'/api/qa-assessment',{...member,role:'remove'});
await call(f.outsider,path,undefined,404,'employer');
// Concurrent retries of one request create one message.
const repeated={type:'message',body:'Одно сообщение при повторном запросе',clientId:randomUUID()};
const results=await Promise.all([call(f.b,path,repeated),call(f.b,path,repeated)]);assert.equal(results[0].message.id,results[1].message.id);checks++;
for(let i=0;i<44;i++)await call(i%2?f.b:f.employer,path,{type:'message',body:'Проверка страницы '+i,clientId:randomUUID()},200,i%2?'candidate':'employer');
f.persistenceMarker='Сохранено после перезапуска '+randomUUID();await call(f.b,path,{type:'message',body:f.persistenceMarker,clientId:randomUUID()});
const page=await call(f.b,path);assert.equal(page.messages.length,40);assert(page.hasOlder);checks+=2;
const older=await call(f.b,path+'?before='+page.messages[0].id);assert(older.messages.length>0);assert(!older.hasOlder);assert(!older.messages.some(m=>page.messages.some(n=>n.id===m.id)));checks+=3;
const xss='<img src=x onerror=alert(1)> & <script>alert(2)</script>';
const sent=await call(f.b,path,{type:'message',body:xss,clientId:randomUUID()});assert.equal(sent.message.body,xss);checks++;
await call(f.a,'/api/conversations/'+f.room.id,{type:'read',through:sent.message.id},404);
assert(!JSON.stringify(page).includes('rubric'));assert(!page.messages.some(m=>!m.mine&&m.clientId));checks+=2;
await writeFile(fixture,JSON.stringify(f),{mode:0o600});
console.log(JSON.stringify({checks,pagination:true,teamPermissions:true,concurrentRetries:true,requestLimits:true}));
