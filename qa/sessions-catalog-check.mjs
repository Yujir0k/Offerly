import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5174';
let checks=0;
const file='/tmp/offerly-session-catalog-qa.json';
async function call(user,path,body,status=200,ua='Mozilla/5.0 Chrome/132.0 Windows NT 10.0') {
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json','User-Agent':ua,...(user.cookie?{Cookie:user.cookie}:{})},body:body?JSON.stringify(body):undefined});
 const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));checks++;
 if(r.headers.get('set-cookie'))user.cookie=r.headers.get('set-cookie').split(';')[0];return data;
}
async function login(account,ua){const device={};await call(device,'/api/auth',{type:'login',email:account.email,password:account.password},200,ua);return device;}
if(process.argv.includes('--prepare')){
 const run=Date.now(),users=[];
 for(let i=0;i<2;i++){
  const u={email:`session-qa-${run}-${i}@example.test`,password:'local-qa-only-password-1234'};
  u.state=await call(u,'/api/auth',{type:'register',email:u.email,password:u.password,name:`Проверка Сеансов ${i}`,consent:true,role:'candidate'});
  await call(u,'/api/action',{type:'email-request'});
  const dir=process.env.TEST_MAIL_DIR;
  const messages=await Promise.all((await readdir(dir)).map(async f=>JSON.parse(await readFile(`${dir}/${f}`,'utf8'))));
  const mail=messages.filter(m=>m.to===u.email).at(-1);assert(mail);
  const code=mail.text.match(/\b\d{6}\b/)[0];u.state=await call(u,'/api/action',{type:'email-confirm',code});users.push(u);
 }
 await writeFile(file,JSON.stringify({users,marker:`catalog-qa-${run}`}),{mode:0o600});
 console.log('Prepared 2 verified isolated QA accounts');process.exit();
}
const context=JSON.parse(await readFile(file,'utf8')), [a,b]=context.users;
await call(a,'/api/sessions',{action:'others'});
for(const id of (await call(a,'/api/state?role=employer')).saved)await call(a,'/api/action',{type:'saved',role:'employer',id});
for(const id of (await call(a,'/api/state')).favoriteJobs)await call(a,'/api/action',{type:'favorite-job',id,saved:false});
const iphone=await login(a,'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1');
const firefox=await login(a,'Mozilla/5.0 (X11; Linux x86_64) Firefox/132.0');
let list=await call(a,'/api/sessions');assert.equal(list.sessions.length,3);assert.equal(list.sessions.filter(s=>s.current).length,1);
assert(list.sessions.some(s=>s.name==='Safari · iPhone'));assert(list.sessions.some(s=>s.name==='Firefox · Linux'));
assert(!JSON.stringify(list).includes('token_hash'));assert(!JSON.stringify(list).includes(a.cookie.split('=')[1]));
await call({},'/api/sessions',undefined,401);
const foreign=(await call(b,'/api/sessions')).sessions[0];await call(a,'/api/sessions',{action:'revoke',id:foreign.id});await call(b,'/api/sessions');
await call(a,'/api/sessions',{action:'revoke',id:list.sessions.find(s=>s.name==='Safari · iPhone').id});
await call(iphone,'/api/state',undefined,401);await call(a,'/api/sessions',{action:'others'});await call(firefox,'/api/state',undefined,401);await call(a,'/api/state');
assert.equal((await call(a,'/api/sessions')).sessions.length,1);
const temp=await login(a,'Mozilla/5.0 Edg/132.0 Windows NT 10.0');await call(temp,'/api/sessions',{action:'logout'});await call(temp,'/api/sessions',undefined,401);await call(a,'/api/sessions');
async function catalog(kind,filters={},page=1,scope='market',user=a,role=kind==='jobs'?'candidate':'employer'){
 return call(user,`/api/catalog/${kind}?${new URLSearchParams({filters:JSON.stringify(filters),page:String(page),scope,role})}`);
}
const marker=context.marker;
const first=await catalog('jobs',{query:marker,sort:'date'}),second=await catalog('jobs',{query:marker,sort:'date'},2);
assert.equal(first.total,2000);assert.equal(first.items.length,20);assert.equal(second.items.length,20);assert(!first.items.some(x=>second.items.some(y=>x.id===y.id)));
const last=await catalog('jobs',{query:marker,sort:'date'},99999);assert.equal(last.page,100);assert.equal(last.items.length,20);
for(const entry of context.expected.jobs){const result=await catalog('jobs',{...entry.filters,query:marker});assert.equal(result.total,entry.total,JSON.stringify(entry.filters));assert.deepEqual(result.items.map(j=>j.id),entry.ids);}
for(const entry of context.expected.candidates){const result=await catalog('candidates',{...entry.filters,query:marker});assert.equal(result.total,entry.total,JSON.stringify(entry.filters));assert.deepEqual(result.items.map(j=>j.id),entry.ids);for(const p of result.items){assert.equal(p.email,'');assert.equal(p.phone,'');assert(!p.resumeKey);assert(!p.avatarKey);}}
const deep=second.items[3];const detail=await call(a,`/api/catalog/jobs?job=${deep.id}`);assert.equal(detail.job.id,deep.id);
await call(b,`/api/catalog/jobs?job=${context.privateJob}`,undefined,404);
assert.equal((await catalog('jobs',{query:marker},1,'draft',b,'employer')).items.length,0);
assert.equal((await catalog('jobs',{query:marker},1,'draft',a,'employer')).items.length,1);
await call(a,'/api/action',{type:'favorite-job',id:deep.id,saved:true});assert((await catalog('jobs',{favoritesOnly:true})).items.some(j=>j.id===deep.id));
await call(a,'/api/action',{type:'favorite-job',id:first.items[0].id,saved:true});assert.equal((await catalog('jobs',{favoritesOnly:true})).total,2);
await call(a,'/api/action',{type:'favorite-job',id:deep.id,saved:false});assert.equal((await catalog('jobs',{favoritesOnly:true})).total,1);
const people=await catalog('candidates',{query:marker},2);const candidate=people.items[0];await call(a,'/api/action',{type:'saved',role:'employer',id:candidate.id});assert((await catalog('candidates',{savedOnly:true})).items.some(p=>p.id===candidate.id));
const state=await call(a,'/api/state?role=employer');assert(state.jobs.length<60);assert(state.candidates.length<=21);assert(state.companies.length<60);assert(state.catalogStats.market>=2000);
await call(a,`/api/catalog/jobs?job=${context.otherScopeJob}`,undefined,404);
await call(a,'/api/catalog/candidates?role=candidate',undefined,400);
await call(a,`/api/catalog/jobs?filters=${encodeURIComponent(JSON.stringify({query:"' OR true --"}))}`);
await call(a,`/api/catalog/jobs?filters=${encodeURIComponent(JSON.stringify({salaryMin:'bad'}))}`,undefined,400);
assert.equal((await call(b,'/api/sessions')).sessions.length,1);
await writeFile(file,JSON.stringify(context),{mode:0o600});
console.log(`PASS ${checks} HTTP checks: sessions, isolation, pagination, filters/ranking, private contacts, deep-page actions`);
