import assert from 'node:assert/strict';
import {readdir,readFile,writeFile} from 'node:fs/promises';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5188';
const dir=process.env.TEST_MAIL_DIR||'.data/mail-outbox';
let checks=0;
const records=[];
async function messages(email){return (await Promise.all((await readdir(dir)).map(async f=>JSON.parse(await readFile(`${dir}/${f}`,'utf8'))))).filter(m=>m.to===email)}
async function call(u,path,data,status=200){const r=await fetch(base+path,{method:data?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',...(u.cookie?{Cookie:u.cookie}:{})},body:data?JSON.stringify(data):undefined});const b=await r.json();if(r.headers.get('set-cookie'))u.cookie=r.headers.get('set-cookie').split(';')[0];assert.equal(r.status,status,JSON.stringify(b));checks++;return b;}
for(const role of ['candidate','employer']){
 const u={email:`otp-${Date.now()}-${role}@example.test`,role};
 const s=await call(u,'/api/auth',{type:'register',role,email:u.email,name:'Тестовый Пользователь',password:'test-password-1234',consent:true,company:'Компания проверки'});
 assert.equal(s.emailSent,true);assert(s.emailResendAt);checks+=2;
 const m=await messages(u.email);assert.equal(m.length,1);assert(!JSON.stringify(s).includes(m[0].text.match(/\d{6}/)[0]));checks+=2;
 const code=m[0].text.match(/\d{6}/)[0];
 await call(u,'/api/action',{type:'email-request',automatic:true,role});
 assert.equal((await messages(u.email)).length,1);checks++;
 await call(u,'/api/auth',{type:'login',email:u.email,password:'test-password-1234',role});
 assert.equal((await messages(u.email)).length,1);checks++;
 await call(u,'/api/action',{type:'email-request',role},400);
 records.push({...u,code});
 const wrong=code==='000000'?'111111':'000000';
 await call(u,'/api/action',{type:'email-confirm',role,code:wrong},400);
 const verified=await call(u,'/api/action',{type:'email-confirm',role,code});
 assert.equal(verified.emailVerification.status,'verified');checks++;
 const login=await call(u,'/api/auth',{type:'login',email:u.email,password:'test-password-1234',role});
 assert.equal(login.emailSent,undefined);assert.equal(login.emailVerification.status,'verified');assert.equal((await messages(u.email)).length,1);checks+=3;
 // Independent unverified account for browser flow.
 const v={email:`otp-ui-${Date.now()}-${role}@example.test`,role};
 await call(v,'/api/auth',{type:'register',role,email:v.email,name:'Проверка Интерфейса',password:'test-password-1234',consent:true,company:'Компания интерфейса'});
 const vm=await messages(v.email);records.push({...v,code:vm[0].text.match(/\d{6}/)[0],ui:true});
}
await writeFile('/tmp/offerly-otp-fixtures.json',JSON.stringify(records));
console.log(JSON.stringify({passed:checks,roles:['candidate','employer'],autoSend:true,reloadReuse:true,verifiedLoginWithoutCode:true}));
