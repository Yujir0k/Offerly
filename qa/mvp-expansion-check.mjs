// Synthetic accounts in a separate localhost DB only. Run hiring-chat-check.mjs first.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base=process.env.TEST_BASE_URL,mailDir=process.env.TEST_MAIL_DIR;
if(!base||!mailDir||!['localhost','127.0.0.1'].includes(new URL(base).hostname)||new URL(base).port==='5173')throw Error('Isolated QA server required');
const users=JSON.parse(await readFile('/tmp/offerly-hiring-users.json','utf8'));
const {employer:e,a,b,c,outsider:o,job,need,invite}=users;
if(process.env.TEST_REUSE_EXPANSION){const current=JSON.parse(await readFile('/tmp/offerly-mvp-users.json','utf8'));for(const key of ['a','b','c'])Object.assign(users[key],current[key]);Object.assign(e,current.e);Object.assign(o,current.o);}
let checks=0;
for(const u of [e,a,b,c,o])u.jar=Object.fromEntries((Object.entries(u.jar||{}).map(([k,v])=>k+'='+v).join('; ')||u.cookie||'').split('; ').map(v=>v.split('=')));
async function request(u,path,body,status=200,role='candidate'){
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json','X-Offerly-Role':role,...(u?{Cookie:Object.entries(u.jar||{}).map(([k,v])=>`${k}=${v}`).join('; ')}:{})},body:body?JSON.stringify(body):undefined});
 const data=await r.json();assert.equal(r.status,status,`${path} ${body?.type||''}: ${JSON.stringify(data)}`);
 if(u)for(const cookie of r.headers.getSetCookie()){const [k,v]=cookie.split(';')[0].split('=');u.jar[k]=v;}
 checks++;return data;
}
const h=(u,type,data={},status=200,role=u===e?'employer':'candidate')=>request(u,'/api/hiring',{type,...data},status,role);
const act=(u,type,data={},status=200,role=u===e?'employer':'candidate')=>request(u,'/api/action',{type,role,...data},status,role);
const catalog=(u,filters={},kind='candidates')=>request(u,`/api/catalog/${kind}?role=${kind==='candidates'?'employer':'candidate'}&filters=${encodeURIComponent(JSON.stringify(filters))}`,undefined,200,kind==='candidates'?'employer':'candidate');
async function mail(email,subject){const ms=await Promise.all((await readdir(mailDir)).map(async f=>({...JSON.parse(await readFile(mailDir+'/'+f,'utf8')),file:f})));return ms.filter(m=>m.to===email&&m.subject.includes(subject)).sort((x,y)=>y.file.localeCompare(x.file));}
await h(null,'processes',{},401);
await h(a,'compare',{ids:[b.state.profile.id,c.state.profile.id]},403);
let cmp=await h(e,'compare',{ids:[b.state.profile.id,c.state.profile.id]});assert(cmp.items.find(p=>p.id===b.state.profile.id).email);assert.equal(cmp.items.find(p=>p.id===c.state.profile.id).email,'');checks+=2;
await h(e,'compare',{ids:[c.state.profile.id]},400);
let list=await h(e,'processes'),pa=list.items.find(p=>p.candidateId===a.state.profile.id&&p.title===need.title);assert(pa);checks++;
const ca=(await h(a,'processes')).items.find(p=>p.id===pa.id);assert(ca&&!('note'in ca)&&!('stage'in ca)&&!('reminderAt'in ca));checks++;
await h(o,'meeting-ics',{id:randomUUID()},404);
const created=await h(e,'process-create',{candidateId:c.state.profile.id,needId:need.id});
assert(!(await h(c,'processes')).items.some(p=>p.id===created.id));checks++;
await h(e,'process-update',{id:pa.id,revision:pa.revision,stage:'interview',note:'Приватная заметка о следующем разговоре',reminderAt:new Date(Date.now()+3600000).toISOString()});
await h(e,'process-update',{id:pa.id,revision:pa.revision,stage:'offer'},409);
await h(a,'process-update',{id:pa.id,revision:0,stage:'offer'},403);
const company=e.state.company.id;
await h(c,'block',{companyId:company,blocked:true});
assert(!(await catalog(e)).items.some(p=>p.id===c.state.profile.id));checks++;
await h(e,'compare',{ids:[b.state.profile.id,c.state.profile.id]},404);
await h(e,'process-create',{candidateId:c.state.profile.id},404);
await act(e,'invite',{candidateId:c.state.profile.id,title:'Backend',description:'Попытка приглашения скрытому профилю',min:160000,max:220000,contact:e.email},400);
await h(c,'block',{companyId:company,blocked:false});
assert((await catalog(e,{skills:['Go']})).items.some(p=>p.id===c.state.profile.id));checks++;
const declared=await catalog(e,{skills:['Python'],skillSource:'declared'}),verified=await catalog(e,{skills:['Python'],skillSource:'verified'});assert(declared.items.some(p=>p.id===a.state.profile.id));assert(!verified.items.some(p=>p.id===a.state.profile.id));checks+=2;
// Invitations, preferences and optional decline feedback across actual accounts.
const existing=(await request(e,'/api/state?role=employer')).invitations.find(i=>i.candidateId===c.state.profile.id&&['sent','viewed'].includes(i.status));
const ci=existing?{invitations:[existing]}:await act(e,'invite',{candidateId:c.state.profile.id,title:'Backend для новой команды',description:'Обсудим разработку API',min:160000,max:220000,contact:e.email});const iv=ci.invitations.find(i=>i.candidateId===c.state.profile.id);
await act(c,'respond',{id:iv.id,status:'declined',declineReason:'Пока не подходит формат'});
assert.equal((await request(e,'/api/state?role=employer')).invitations.find(i=>i.id===iv.id).declineReason,'Пока не подходит формат');checks++;
// Saved searches and exact unread counts, not a download of the complete catalog.
const se=await h(e,'search-save',{name:'Серверные разработчики',filters:{spec:'Backend',skills:['Python']}});
await h(a,'search-delete',{id:se.id},404);
assert((await h(e,'search-notifications')).items.find(s=>s.id===se.id).count>=2);checks++;
const mp=await h(e,'search-matches',{id:se.id});assert(mp.items.length<=20&&mp.newIds.length>0);checks++;
await h(e,'search-seen',{id:se.id,page:1});assert.equal((await h(e,'search-notifications')).items.find(s=>s.id===se.id).count,Math.max(0,mp.total-20));checks++;
await h(e,'search-update',{id:se.id,enabled:false});assert(!(await h(e,'search-notifications')).items.some(s=>s.id===se.id));checks++;
const unique='уникальное предложение MVP '+Date.now();
const sa=await h(a,'search-save',{name:'Backend новые предложения',filters:{query:unique}});assert.equal((await h(a,'search-notifications')).items.find(s=>s.id===sa.id).count,0);checks++;
await act(e,'job',{status:'published',title:'Backend '+unique,description:'Разработка API и сервисов. Продуктовая команда.',specialty:'Backend',grade:'Middle',skills:'Python,SQL',format:'Удалённо',city:'Москва',min:160000,max:220000,employment:'Полная занятость'});
assert.equal((await h(a,'search-notifications')).items.find(s=>s.id===sa.id).count,1);checks++;
// A process is scoped to each need/job, while chat remains one consent-bound relationship.
const other=await h(e,'process-create',{candidateId:a.state.profile.id,jobId:job.id});assert.notEqual(other.id,pa.id);checks++;
await h(e,'meeting-propose',{processId:pa.id,slots:['garbage'],timeZone:'Europe/Moscow',duration:30},400);
await h(e,'meeting-propose',{processId:created.id,slots:[new Date(Date.now()+86400000).toISOString()],timeZone:'Europe/Moscow',duration:30},403);
const slots=[2,3,4].map(n=>new Date(Date.now()+n*86400000).toISOString());
let mm=await h(e,'meeting-propose',{processId:pa.id,slots,timeZone:'Europe/Moscow',duration:30});
let m=(await h(a,'processes')).items.find(p=>p.id===pa.id).meetings.find(m=>m.id===mm.id);
await h(o,'meeting-confirm',{id:m.id,revision:m.revision,slot:slots[0]},404);
const responses=await Promise.all([0,1].map(i=>fetch(base+'/api/hiring',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Offerly-Role':'candidate',Cookie:Object.entries(a.jar).map(([k,v])=>`${k}=${v}`).join('; ')},body:JSON.stringify({type:'meeting-confirm',id:m.id,revision:m.revision,slot:slots[i]})})));
assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);checks+=2;
m=(await h(a,'processes')).items.find(p=>p.id===pa.id).meetings.find(m=>m.id===mm.id);
const ics=await h(a,'meeting-ics',{id:m.id});assert(ics.ics.includes(`UID:${m.id}@offerly.local`)&&ics.ics.includes('DTSTART:')&&!ics.ics.includes('TZOFFSET'));checks++;
const collision=await h(e,'meeting-propose',{processId:other.id,slots:[m.selectedAt],timeZone:'Europe/Moscow',duration:30});const cm=(await h(a,'processes')).items.find(p=>p.id===other.id).meetings[0];await h(a,'meeting-confirm',{id:collision.id,revision:cm.revision,slot:m.selectedAt},409);
await h(e,'meeting-cancel',{id:m.id,revision:m.revision});await h(a,'meeting-confirm',{id:m.id,revision:m.revision,slot:slots[2]},409);
// The company owns its quiz; its result can never mutate the formal category.
const before=(await request(a,'/api/state')).profile.grade;
const task=await h(e,'task-create',{processId:pa.id,title:'Практика API',periodDays:7,questions:[{prompt:'Статус успешного GET?',options:['200','500'],correct:0},{prompt:'Пароль хранится?',options:['Открытым текстом','В виде защищённого хеша'],correct:1}]});
const ap=(await h(a,'processes')).items.find(p=>p.id===pa.id),t=ap.tasks.find(t=>t.id===task.id);assert(!JSON.stringify(t).includes('correct'));checks++;
await h(o,'task-answer',{id:t.id,occurrence:t.occurrence,answers:{}},404);
await h(a,'task-answer',{id:t.id,occurrence:t.occurrence,answers:{}},400);
const answers={[t.questions[0].id]:0,[t.questions[1].id]:0};assert.equal((await h(a,'task-answer',{id:t.id,occurrence:t.occurrence,answers})).score,50);checks++;
assert.equal((await h(a,'task-answer',{id:t.id,occurrence:t.occurrence,answers:Object.fromEntries(Object.entries(answers).reverse())})).score,50);checks++;
await h(a,'task-answer',{id:t.id,occurrence:t.occurrence,answers:{...answers,[t.questions[1].id]:1}},409);
assert.equal((await request(a,'/api/state')).profile.grade,before);checks++;
const hist=(await h(e,'processes')).items.find(p=>p.id===pa.id).tasks.find(t=>t.id===task.id);assert(hist.answered&&hist.history[0].score===50);checks++;
await h(e,'task-stop',{id:t.id});await h(a,'task-answer',{id:t.id,occurrence:t.occurrence,answers},403);
// Recovery is bound to the browser, codes are single use, all previous sessions are revoked.
const recover=(u,type,data={},status=200)=>request(u,'/api/auth/recovery',{type,...data},status);
let flow=await recover(a,'request',{email:a.email});let rm=(await mail(a.email,'восстановление'))[0];assert(rm);checks++;
const code=rm.text.match(/\b\d{6}\b/)[0];
await recover(o,'verify',{id:flow.id,code},400);
await recover(a,'verify',{id:flow.id,code:code==='000000'?'111111':'000000'},400);
const grant=(await recover(a,'verify',{id:flow.id,code})).grant;
await recover(a,'verify',{id:flow.id,code},400);
await recover(a,'complete',{id:flow.id,grant,password:'short'},400);
const newPassword='New-'+randomUUID();await recover(a,'complete',{id:flow.id,grant,password:newPassword});
await request(a,'/api/state',undefined,401);
await request(a,'/api/auth',{type:'login',email:a.email,password:a.password},400);
a.state=await request(a,'/api/auth',{type:'login',email:a.email,password:newPassword});a.password=newPassword;
await recover(a,'complete',{id:flow.id,grant,password:newPassword},400);
const unknown={jar:{}};const missing=await recover(unknown,'request',{email:`no-account-${Date.now()}@example.test`});assert.equal(missing.message,flow.message);checks++;
await writeFile('/tmp/offerly-mvp-users.json',JSON.stringify({e,a,b,c,o,pa,other,task,sa,se}),{mode:0o600});
console.log(JSON.stringify({checks,result:'passed',features:['blocked company / direct compare / invitation','private stages and notes / cross-account ACL','saved search unseen counts / both roles','concurrent slot confirmation / collision / ICS','company quiz partial score / idempotency / unchanged grade','recovery code browser binding / single use / session revocation']}));
