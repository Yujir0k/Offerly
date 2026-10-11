// Creates only synthetic verified accounts against an isolated file-mail QA server.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5174';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('QA must use localhost');
const dir=process.env.TEST_MAIL_DIR;if(!dir)throw Error('Set TEST_MAIL_DIR to the isolated mail-outbox directory');
const run=Date.now(),users=[];
for(let index=0;index<2;index++){
 const u={email:`session-qa-assessment-${run}-${index}@example.test`,password:randomBytes(24).toString('hex')};
 async function call(path,body){const r=await fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:u.cookie||''},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));if(r.headers.get('set-cookie'))u.cookie=r.headers.get('set-cookie').split(';')[0];return data;}
 await call('/api/auth',{type:'register',role:'candidate',email:u.email,password:u.password,name:'Проверка Испытания',consent:true});
 await call('/api/action',{type:'email-request',automatic:true});
 const messages=await Promise.all((await readdir(dir)).map(async name=>JSON.parse(await readFile(dir+'/'+name,'utf8'))));
 const mail=messages.find(m=>m.to===u.email);assert(mail);await call('/api/action',{type:'email-confirm',code:mail.text.match(/\b\d{6}\b/)[0]});users.push(u);
}
await writeFile('/tmp/offerly-assessment-qa.json',JSON.stringify({users}),{mode:0o600});console.log('Prepared 2 synthetic verified QA accounts; credentials are kept in a private temporary file');
