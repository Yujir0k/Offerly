import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const base=process.env.MAIL_QA_BASE||'http://127.0.0.1:17875';
assert.equal(new URL(base).hostname,'127.0.0.1');
const dir=process.env.MAIL_QA_PRIVATE_DIR||path.join(homedir(),'.cache','offerly','private-mail','scenarios');
await mkdir(dir,{recursive:true,mode:0o700});
const run=process.env.MAIL_QA_RUN||Date.now(), password='Mail-QA-password-2026!',checks=[],mails=[];
const suffix=process.env.MAIL_QA_RECIPIENT;
assert(process.env.MAIL_QA_ALLOW_SEND==='yes' && suffix && /^\S+@\S+\.\S+$/.test(suffix),'Explicit per-run permission and recipient required');
const address=label=>suffix?suffix.replace('@','+offerly-'+run+'-'+label+'@'):`mail-${run}-${label}@example.test`;
function check(name,v){assert(v,name);checks.push(name);}
async function call(u,path,body,status=200){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Host:'opherly.ru',Origin:'https://opherly.ru','Content-Type':'application/json',...(u.cookie?{Cookie:u.cookie}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const b=await r.json();assert.equal(r.status,status,`${path}: ${b.error||r.status}`);const jar=new Map((u.cookie||'').split('; ').filter(Boolean).map(v=>[v.split('=')[0],v]));for(const c of r.headers.getSetCookie()){const v=c.split(';')[0];jar.set(v.split('=')[0],v);}u.cookie=[...jar.values()].join('; ');if(b.profile)u.state=b;return b;}
const act=(u,type,data={},status=200)=>call(u,'/api/action',{type,role:u.role,...data},status);
function captured() {
 const r=spawnSync('ssh',['-F','/dev/null','-S','/tmp/offerly-mail-ssh','root@193.233.220.30',`docker exec ${process.env.MAIL_QA_CONTAINER||'offerly-security-mail-app'} node -e 'const fs=require("fs"); console.log(JSON.stringify(fs.readdirSync("/qa/mail").filter(f=>f.endsWith(".json")).map(f=>JSON.parse(fs.readFileSync("/qa/mail/"+f,"utf8")))))'`],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 assert.equal(r.status,0,'Private SMTP evidence unavailable');
 return JSON.parse(r.stdout);
}
async function messages(email){return captured().filter(m=>m.message.to===email);}
async function mail(email,kind,expectedCode=true){
 let record;
 for(let n=0;n<30;n++){
  record=(await messages(email)).find(m=>m.message.headers?.['X-Offerly-Template']==='signature-v1/'+kind);
  if(record)break; await new Promise(r=>setTimeout(r,500));
 }
 assert(record,'Missing actual SMTP mail '+kind);
 check(kind+' accepted by configured SMTP',record.accepted.includes(email)&&record.rejected.length===0&&!!record.messageId);
 const v=record.message,m={Text:v.text,HTML:v.html};
 check(kind+' text/HTML',!!m.Text&&!!m.HTML);
 check(kind+' signature template',m.HTML.includes('#F3F1F8')&&m.HTML.includes('Дело найдёт.'));
 check(kind+' HTML logo without images or attachments',m.HTML.includes('aria-hidden="true" width="40" height="40"')&&!m.HTML.includes('<img')&&!v.attachments?.length);
 check(kind+' sender',v.from.includes('noreply@opherly.ru')&&v.from.includes('Офферли'));
 check(kind+' no local address',!m.HTML.includes('127.0.0.1')&&!m.Text.includes('127.0.0.1'));
 const code=m.Text.match(/(?:код[^\n]*:|подтверждения:)\s*(\d{6})/i)?.[1];
 if(expectedCode){assert(code);check(kind+' actual copyable OTP',m.HTML.includes('>'+code+'</div>')&&code!=='000000'&&code!=='123456');}
 mails.push({kind}); return {m,code};
}
async function register(role,label){const u={role,email:address(label),password};await call(u,'/api/auth',{type:'register',role,name:'Почтовая Проверка',email:u.email,password,consent:true,company:'Команда проверки писем'});check(role+' registration sends mail',u.state.emailSent===true);const {code}=await mail(u.email,'verify');await act(u,'email-confirm',{code});check(role+' code works',u.state.emailVerification.status==='verified');const before=(await messages(u.email)).length;await call(u,'/api/auth',{type:'login',role,email:u.email,password});check(role+' verified login sends no extra code',(await messages(u.email)).length===before);return u;}
const c=await register('candidate','candidate'),e=await register('employer','employer');
const flow=(await act(c,'email-change-begin',{email:address('new-candidate'),method:'old-email'})).emailChange;const old=await mail(c.email,'change-old');await act(c,'email-change-authorize',{flowId:flow.id,code:'000000'},400);await act(c,'email-change-authorize',{flowId:flow.id,code:old.code});const next=await mail(address('new-candidate'),'change-new');await act(c,'email-change-confirm',{flowId:flow.id,code:old.code},400);await act(c,'email-change-confirm',{flowId:flow.id,code:next.code});c.email=address('new-candidate');check('both email change stages completed',c.state.emailVerification.email===c.email);
const ef=(await act(e,'email-change-begin',{email:address('new-employer'),method:'password',password})).emailChange;const em=await mail(address('new-employer'),'change-new');await act(e,'email-change-confirm',{flowId:ef.id,code:em.code});e.email=address('new-employer');check('password authorizes new-address-only flow',e.state.emailVerification.email===e.email);
const reset={};const begin=await call(reset,'/api/auth/recovery',{type:'request',email:c.email});const recovery=await mail(c.email,'recovery');await call(reset,'/api/auth/recovery',{type:'verify',id:begin.id,code:'000000'},400);const grant=await call(reset,'/api/auth/recovery',{type:'verify',id:begin.id,code:recovery.code});const newPassword='New-Mail-QA-password-2026!';await call(reset,'/api/auth/recovery',{type:'complete',id:begin.id,grant:grant.grant,password:newPassword});await mail(c.email,'password-changed',false);await call(c,'/api/auth',{type:'login',role:c.role,email:c.email,password},400);await call(c,'/api/auth',{type:'login',role:c.role,email:c.email,password:newPassword});c.password=newPassword;check('password changed through actual mail code',true);
await call(reset,'/api/auth/recovery',{type:'request',email:address('missing')});check('unknown recovery recipient gets no mail',(await messages(address('missing'))).length===0);
await act(c,'profile',{...c.state.profile,name:'Почтовая Проверка',email:c.email,firstName:'Почтовая',lastName:'Проверка',phone:'',specialty:'Backend',claimed:'Junior',skills:['Python','SQL'],roles:['Backend-разработчик'],city:'Москва',country:'Россия',region:'Москва',salaryMin:120000,salaryMax:170000,experience:0,format:'Удалённо',formats:['Удалённо'],employment:'Полная занятость',employmentTypes:['Полная занятость'],availability:'В течение месяца',availabilities:['В течение месяца'],workHistory:[],visible:true,consent:true,jobStatus:'open'});
await act(e,'company',{...e.state.company,name:'Орбита — проверка писем',description:'Команда разработки API. Это проверочное приглашение, а не настоящее предложение работы.',email:e.email,contactName:'Почтовая Проверка'});
await act(e,'invite',{candidateId:c.state.profile.id,title:'Backend-разработчик · проверка письма',description:'Тестируем отправку фирменного письма Офферли. Реальной вакансией это не является.',min:150000,max:200000,contact:e.email,format:'Удалённо',city:'Москва',grade:'Junior',skills:['Python','SQL']});const inv=e.state.invitations.find(i=>i.candidateId===c.state.profile.id);assert(inv);
const invitation=await mail(c.email,'invitation',false);check('invitation correct salary/company',invitation.m.HTML.includes('150 000 — 200 000 ₽')&&invitation.m.HTML.includes('Орбита'));check('invitation exact deep link',invitation.m.HTML.includes('/demo/candidate/invitations?invitation='+inv.id));check('invitation no employer contact',!invitation.m.Text.includes(e.email));const before=(await messages(c.email)).length;
await act(e,'invitation-update',{...inv,id:inv.id,expectedUpdatedAt:inv.updatedAt||inv.createdAt,description:'Уточнённые проверочные условия'});await new Promise(r=>setTimeout(r,300));check('edit sends no duplicate mail',(await messages(c.email)).length===before);
await writeFile(dir+'/accounts.json',JSON.stringify({c,e,invitationId:inv.id}),{mode:0o600});
const summary={mode:process.env.MAIL_QA_MODE||'actual-provider',checks:checks.length,passed:checks,mails:mails.map(m=>({kind:m.kind})),note:'SMTP acceptance/capture is not proof of inbox placement. Gmail display is confirmed by recipient.'};await writeFile(dir+'/summary.json',JSON.stringify(summary,null,2),{mode:0o600});
console.log(JSON.stringify({checks:checks.length,mails:mails.length,dir}));
