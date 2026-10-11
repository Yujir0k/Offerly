import assert from 'node:assert/strict';
import {readFile,readdir,stat,writeFile} from 'node:fs/promises';
// Run email-automatic-check.mjs first. Only its disposable synthetic accounts are changed.
const base=process.env.TEST_BASE_URL,dir=process.env.TEST_MAIL_DIR;
if(!base||!dir||!['localhost','127.0.0.1'].includes(new URL(base).hostname)||new URL(base).port==='5173')throw Error('Isolated QA server and TEST_MAIL_DIR required');
const users=JSON.parse(await readFile(process.env.TEST_FIXTURE_FILE||'/tmp/offerly-otp-fixtures.json','utf8')).filter(u=>!u.ui);
let checks=0;
async function call(u,path,data,status=200){
 const r=await fetch(base+path,{method:data?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',Cookie:Object.entries(u.jar||{}).map(([k,v])=>k+'='+v).join('; ')},body:data?JSON.stringify(data):undefined});const d=await r.json();assert.equal(r.status,status,path+' '+(data?.type||''));checks++;
 for(const c of r.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');u.jar[k]=v;}return d;
}
async function code(email,subject=''){
 const entries=await Promise.all((await readdir(dir)).map(async f=>({value:JSON.parse(await readFile(dir+'/'+f,'utf8')),time:(await stat(dir+'/'+f)).mtimeMs})));
 const m=entries.filter(m=>m.value.to===email&&m.value.subject.includes(subject)).sort((a,b)=>b.time-a.time)[0];assert(m);return m.value.text.match(/\b\d{6}\b/)[0];
}
for(const u of users){
 assert(/^otp-\d+-(candidate|employer)@example\.test$/.test(u.email));u.jar=Object.fromEntries(u.cookie.split('; ').map(v=>v.split('=')));
 const role=u.role,oldPassword='test-password-1234',password='Audit-'+crypto.randomUUID();
 const flow=await call(u,'/api/auth/recovery',{type:'request',email:u.email});const resetCode=await code(u.email,'восстановление');
 await call({jar:{}},'/api/auth/recovery',{type:'verify',id:flow.id,code:resetCode},400);
 await call(u,'/api/auth/recovery',{type:'verify',id:flow.id,code:'000000'},400);
 const grant=(await call(u,'/api/auth/recovery',{type:'verify',id:flow.id,code:resetCode})).grant;
 await call(u,'/api/auth/recovery',{type:'verify',id:flow.id,code:resetCode},400);
 await call(u,'/api/auth/recovery',{type:'complete',id:flow.id,grant,password:'short'},400);
 await call(u,'/api/auth/recovery',{type:'complete',id:flow.id,grant,password});
 await call(u,'/api/state',undefined,401);
 await call(u,'/api/auth',{type:'login',role,email:u.email,password:oldPassword},400);
 const logged=await call(u,'/api/auth',{type:'login',role,email:u.email,password});assert.equal(logged.emailVerification.status,'verified');checks++;
 await call(u,'/api/auth/recovery',{type:'complete',id:flow.id,grant,password},400);
 const probe={jar:{}};await call(probe,'/api/auth',{type:'login',role,email:u.email,password});
 const newEmail='changed-'+u.email,method=role==='candidate'?'old-email':'password';
 await call(u,'/api/action',{type:'account-email',role,email:newEmail},400);
 await call(u,'/api/action',{type:'email-change-begin',role,email:newEmail,method:'password',password:'wrong'},400);
 const change=(await call(u,'/api/action',{type:'email-change-begin',role,email:newEmail,method,password})).emailChange;
 assert.equal(change.stage,method==='old-email'?'old-code':'new-code');checks++;
 await call(probe,'/api/action',{type:'email-change-resend',role,flowId:change.id},400);
 if(method==='old-email'){
  await call(u,'/api/action',{type:'email-change-confirm',role,flowId:change.id,code:'000000'},400);
  await call(u,'/api/action',{type:'email-change-authorize',role,flowId:change.id,code:'000000'},400);
  await call(u,'/api/action',{type:'email-change-authorize',role,flowId:change.id,code:await code(u.email)});
 }
 await call(u,'/api/action',{type:'email-change-confirm',role,flowId:change.id,code:'000000'},400);
 const newCode=await code(newEmail);
 await call(u,'/api/action',{type:'email-confirm',role,code:newCode},400);
 const changed=await call(u,'/api/action',{type:'email-change-confirm',role,flowId:change.id,code:newCode});assert.equal(changed.emailVerification.email,newEmail);assert.equal(changed.emailVerification.status,'verified');checks+=2;
 await call(probe,'/api/state',undefined,401);
 await call(u,'/api/action',{type:'email-change-confirm',role,flowId:change.id,code:newCode},400);
 await call({jar:{}},'/api/auth',{type:'login',role,email:u.email,password},400);
 await call({jar:{}},'/api/auth',{type:'login',role,email:newEmail,password});
}
const report={checks,roles:['candidate','employer'],recoverySingleUse:true,previousSessionsRevoked:true,emailChangeOldEmailAndPasswordFallback:true,otherSessionDenied:true};
await writeFile('/tmp/offerly-tz-auth-security.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
