// Synthetic real accounts in an isolated localhost database; never run on the user server.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {answer,openEvidence,publicSession} from '../vendor/fsp-assessment/dist/src/adaptive/engine.js';
const base=process.env.TEST_BASE_URL,mailDir=process.env.TEST_MAIL_DIR;
if(!base || !mailDir || !['localhost','127.0.0.1'].includes(new URL(base).hostname) || new URL(base).port==='5173')throw Error('Use a separate localhost QA database and mail folder');
let checks=0,steps=0;const run=Date.now(),records=[];
const cached=process.env.TEST_REUSE ? JSON.parse(await readFile('/tmp/offerly-hiring-inprogress.json','utf8')) : [];

async function call(user,path,body,status=200,role='candidate'){
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json','X-Offerly-Role':role,...(user?.cookie?{Cookie:user.cookie}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));if(r.headers.get('set-cookie'))user.cookie=r.headers.get('set-cookie').split(';')[0];checks++;return data;
}
async function create(name,role='candidate'){
 const previous=cached.find(u=>u.name===name);if(previous){records.push(previous);return previous;}
 const u={email:`session-qa-hiring-${run}-${records.length}@example.test`,password:randomBytes(24).toString('hex'),name};records.push(u);
 u.state=await call(u,'/api/auth',{type:'register',role,email:u.email,password:u.password,name,consent:true,company:role==='employer'?'Команда Сфера':''});
 const mails=await Promise.all((await readdir(mailDir)).map(async f=>JSON.parse(await readFile(mailDir+'/'+f,'utf8'))));const mail=mails.find(m=>m.to===u.email);assert(mail);
 u.state=await call(u,'/api/action',{type:'email-confirm',code:mail.text.match(/\b\d{6}\b/)[0],role});return u;
}
async function complete(u,grade,scenario='best',track='backend'){
 let v=await call(u,'/api/professional/adaptive-sessions',{specialization:track,targetGrade:grade});
 const id=v.id,initial=await call(u,'/api/qa-assessment',{id});assert.equal(initial.generation?.calibratedForms?.enabled===true,false);const seed=JSON.stringify(initial.items[0].variant);let count=0;
 while(v.state==='active'){
  assert(count++<60);let raw=await call(u,'/api/qa-assessment',{id});let item=raw.items[raw.cursor.item].variant,step=item.steps[raw.cursor.step];
  if(step.exploration)for(const artifact of [...item.artifacts].sort((a,b)=>b.usefulness-a.usefulness).slice(0,step.requiredEvidenceSources||2))v=await call(u,`/api/professional/adaptive-sessions/${id}/evidence`,{itemId:item.id,stepId:step.id,artifactId:artifact.id,interactionRevision:v.interactionRevision});
  raw=await call(u,'/api/qa-assessment',{id});item=raw.items[raw.cursor.item].variant;step=item.steps[raw.cursor.step];
  const sorted=[...step.options].sort((a,b)=>step.rubric.scores[b.id]-step.rubric.scores[a.id]);
  const optionId=step.exploration?'continue':scenario==='best'?sorted[0].id:scenario==='wrong'?sorted.at(-1).id:scenario==='forecast'&&step.responseTask?sorted.at(-1).id:sorted[Math.min(1,sorted.length-1)].id;
  const execution=item.generated?.responseChecks?.[step.id]?.accepted[0];
  v=await call(u,`/api/professional/adaptive-sessions/${id}/answer`,{itemId:item.id,stepId:step.id,optionId,...(execution?{execution}:{}),interactionRevision:v.interactionRevision});
  const after=await call(u,'/api/qa-assessment',{id});const oracle=structuredClone(raw);const at=Date.parse(after.responses.at(-1).at);
  answer(oracle,item.id,step.id,optionId,at,execution);assert.deepEqual(after.contributions,oracle.contributions);assert.deepEqual(v.result,publicSession(oracle,at).result);checks+=2;steps++;
 }
 assert.equal(v.result.targetGrade,grade);if(scenario==='best')assert.equal(v.result.decision,'CONFIRMED');if(scenario==='wrong')assert.equal(v.result.decision,'NOT_CONFIRMED');
 const state=await call(u,'/api/state');assert(state.attempts.some(a=>a.id===id&&a.result.decision===v.result.decision));checks+=2;
 console.log('ASSESSMENT',track,grade,scenario,v.result.decision,v.result.assessmentStatus,'steps',count);
 return {id,result:v.result,seed};
}
const employer=await create('Анна Сферова','employer'),a=await create('Алексей Серверов'),b=await create('Мария Разработчикова'),c=await create('Иван Инженеров'),outsider=await create('Павел Наблюдателев'),unverified=await create('Нина Начинаева');
await writeFile('/tmp/offerly-hiring-inprogress.json',JSON.stringify(records),{mode:0o600});
for(const [u,skills] of [[a,['Python','SQL']],[b,['Python']],[c,['Go']],[outsider,['JavaScript']],[unverified,['Python','SQL']]])u.state=await call(u,'/api/action',{...u.state.profile,type:'profile',role:'candidate',experience:2,jobStatus:'open',name:u.name,email:u.email,phone:'+79991234567',city:'Москва',skills,roles:['Backend-разработчик'],specialty:'Backend',claimed:'Junior',formats:['Удалённо'],salaryMin:120000,salaryMax:200000,consent:true,visible:true,availability:'В течение месяца'});
employer.state=await call(employer,'/api/action',{type:'company',role:'employer',name:'Сфера · QA',email:employer.email,phone:'+79997654321',description:'Продуктовая команда для изолированной проверки найма'});
// Profile claim cannot forge a certification.
await call(employer,'/api/action',{type:'invite',role:'employer',candidateId:unverified.state.profile.id,title:'Backend',description:'Проверка запрета',min:150000,max:200000,contact:employer.email},400);
const best=await complete(a,'Junior');await complete(a,'Middle','wrong');await complete(a,'Senior','forecast');assert.equal((await call(a,'/api/state')).profile.grade,'Junior');checks++;
await complete(a,'Middle');await complete(b,'Middle');await complete(c,'Middle');await complete(outsider,'Senior','best','frontend');
const timeout=await call(unverified,'/api/professional/adaptive-sessions',{specialization:'backend',targetGrade:'Senior'});await call(unverified,'/api/qa-assessment',{action:'expire',id:timeout.id});const expired=await call(unverified,`/api/professional/adaptive-sessions/${timeout.id}`);assert.equal(expired.result.decision,'NOT_CONFIRMED');assert.equal(expired.result.assessmentStatus,'insufficient-evidence');checks+=2;
employer.state=await call(employer,'/api/action',{type:'need',role:'employer',title:'Backend Middle для продукта',specialty:'Backend',grade:'Middle',description:'API и данные',skills:'Python,SQL',format:'Удалённо',min:150000,max:220000});const need=employer.state.needs[0];
const catalog=await call(employer,'/api/catalog/candidates?role=employer&filters='+encodeURIComponent(JSON.stringify({needId:need.id})));
const ids=catalog.items.map(p=>p.id);assert(ids.includes(a.state.profile.id));assert(ids.includes(b.state.profile.id));assert(ids.includes(c.state.profile.id));assert(ids.indexOf(a.state.profile.id)<ids.indexOf(b.state.profile.id));assert(ids.indexOf(b.state.profile.id)<ids.indexOf(c.state.profile.id));assert(!ids.includes(unverified.state.profile.id));assert(!ids.includes(outsider.state.profile.id));assert(catalog.items.every(p=>!p.email&&!p.phone));checks+=8;
const filters=await call(employer,'/api/catalog/candidates?role=employer&filters='+encodeURIComponent(JSON.stringify({needId:need.id,skills:['Python'],skillSource:'verified'})));assert(!filters.items.some(p=>[a,b,c].some(u=>u.state.profile.id===p.id)));checks++; // Declared technologies are not forged verified skills.
await call(outsider,'/api/catalog/candidates?role=employer&filters='+encodeURIComponent(JSON.stringify({needId:need.id})),undefined,400,'employer');
employer.state=await call(employer,'/api/action',{type:'job',role:'employer',status:'published',title:'Backend Middle · проверка найма',description:'Разработка серверной части продукта. Удалённая работа с API.',specialty:'Backend',grade:'Middle',skills:'Python,SQL',format:'Удалённо',city:'Москва',min:150000,max:220000,employment:'Полная занятость'});const job=employer.state.jobs.find(j=>j.companyId===employer.state.company.id&&j.title.includes('проверка найма'));assert(job);
const jobs=await call(a,'/api/catalog/jobs?role=candidate&filters='+encodeURIComponent(JSON.stringify({query:'проверка найма'})));assert(jobs.items.some(j=>j.id===job.id));const recommendations=await call(a,'/api/state');assert(recommendations.jobs.some(j=>j.id===job.id));assert(recommendations.catalogStats.opportunities>0);checks+=3;
employer.state=await call(employer,'/api/action',{type:'invite',role:'employer',candidateId:a.state.profile.id,needId:need.id,title:need.title,description:'Алексей, приглашаем обсудить серверную часть продукта.',min:160000,max:220000,format:'Удалённо',grade:'Middle',skills:['Python','SQL'],contact:employer.email});const invite=employer.state.invitations.find(i=>i.candidateId===a.state.profile.id);assert(invite.needId===need.id&&invite.match);checks++;
await call(employer,'/api/action',{type:'invite',role:'employer',candidateId:a.state.profile.id,title:'Повтор',description:'Не должно дублироваться',min:150000,max:220000,contact:employer.email},400);
assert((await call(a,'/api/state')).invitations.some(i=>i.id===invite.id));assert(!(await call(b,'/api/state')).invitations.some(i=>i.id===invite.id));checks+=2;
await call(employer,'/api/conversations',{invitationId:invite.id},404,'employer');await call(b,'/api/action',{type:'respond',role:'candidate',id:invite.id,status:'accepted'},400);
await call(a,'/api/action',{type:'respond',role:'candidate',id:invite.id,status:'accepted'});
const contacts=await call(employer,'/api/catalog/candidates?role=employer&filters='+encodeURIComponent(JSON.stringify({query:String(a.state.profile.id)})));assert.equal(contacts.items[0].email,a.email);assert(contacts.items[0].phone);checks+=2;
const room=await call(employer,'/api/conversations',{invitationId:invite.id},200,'employer');assert.equal((await call(a,'/api/conversations',{invitationId:invite.id})).id,room.id);checks++;
await call(b,`/api/conversations/${room.id}`,undefined,404);await call(b,`/api/conversations/${room.id}`,{type:'message',body:'Чужой',clientId:randomUUID()},404);await call(a,`/api/conversations/${room.id}`,undefined,404,'employer');await call(null,`/api/conversations/${room.id}`,undefined,401);
const clientId=randomUUID(),text='Здравствуйте! Обсудим задачи и удобное время?';const message=await call(employer,`/api/conversations/${room.id}`,{type:'message',body:text,clientId},200,'employer');assert.equal((await call(employer,`/api/conversations/${room.id}`,{type:'message',body:text,clientId},200,'employer')).message.id,message.message.id);checks++;
await call(employer,`/api/conversations/${room.id}`,{type:'message',body:'Другой текст',clientId},409,'employer');await call(a,`/api/conversations/${room.id}`,{type:'message',body:' ',clientId:randomUUID()},400);
let thread=await call(a,`/api/conversations/${room.id}`);assert.equal(thread.messages.length,1);assert.equal(thread.messages[0].body,text);assert.equal(thread.messages[0].mine,false);assert.equal((await call(a,'/api/conversations?summary=1')).unread,1);checks+=4;
await call(a,`/api/conversations/${room.id}`,{type:'read',through:message.message.id});assert.equal((await call(a,'/api/conversations?summary=1')).unread,0);assert.equal((await call(employer,`/api/conversations/${room.id}`,undefined,200,'employer')).otherReadThrough,message.message.id);checks+=2;
await call(a,`/api/conversations/${room.id}`,{type:'message',body:'Здравствуйте! Да, готов обсудить.\nУдобно завтра после 12:00.',clientId:randomUUID()});assert.equal((await call(employer,'/api/conversations?summary=1',undefined,200,'employer')).unread,1);checks++;
await call(b,'/api/action',{type:'apply',role:'candidate',id:job.id,shareContacts:true,message:'Интересны задачи команды'});const application=(await call(b,'/api/state')).applications.find(a=>a.jobId===job.id);const second=await call(b,'/api/conversations',{applicationId:application.id});assert.notEqual(second.id,room.id);assert.equal((await call(employer,'/api/conversations',{applicationId:application.id},200,'employer')).id,second.id);checks+=2;
await call(a,`/api/conversations/${room.id}`,{type:'read',through:'999999999999'},404);
const firstPage=await call(employer,'/api/conversations',undefined,200,'employer');assert(firstPage.items.some(r=>r.id===room.id));assert(firstPage.items.some(r=>r.id===second.id));checks+=2;
// Private fixture credentials are outside the repository. These are synthetic accounts only.
await writeFile('/tmp/offerly-hiring-users.json',JSON.stringify({employer,a,b,c,outsider,unverified,room,second,invite,job,need,report:best.id}),{mode:0o600});
console.log(JSON.stringify({checks,steps,ranking:'two declared skills > one > none; grade/salary/format filters',chat:'accepted invitation + application; isolated accounts; idempotent send; unread and receipts',result:'passed'}));
