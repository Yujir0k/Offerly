import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base='http://127.0.0.1:5174',ctx=JSON.parse(await readFile('/tmp/offerly-session-catalog-qa.json','utf8')),[a,b]=ctx.users;
let checks=0;
async function call(user,path,body,status=200){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:user.cookie,Origin:base,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));checks++;return data;}
const jobId=`${ctx.marker}-job-01999`;
await call(b,'/api/action',{...b.state.profile,type:'profile',role:'candidate',phone:'+79991234567',city:'Москва',skills:['Python'],roles:['Разработчик'],salaryMin:100000,salaryMax:200000,consent:true,visible:true,availability:'В течение месяца'});
await call(b,'/api/action',{type:'privacy',role:'candidate',visible:true,notifications:true});
const path=`/api/catalog/candidates?role=employer&filters=${encodeURIComponent(JSON.stringify({query:String(b.state.profile.id)}))}`;
const before=(await call(a,path)).items.find(p=>p.id===b.state.profile.id);assert(before);assert.equal(before.email,'');assert.equal(before.phone,'');
await call(b,'/api/action',{type:'apply',role:'candidate',id:jobId,shareContacts:true,message:'Проверка карточки дальней страницы'});
const after=(await call(a,path)).items.find(p=>p.id===b.state.profile.id);assert.equal(after.email,b.email);assert(after.phone.includes('123'));assert(!after.resumeKey);
await call(a,'/api/action',{type:'job-status',role:'employer',id:jobId,status:'archived'});
const applied=await call(b,`/api/catalog/jobs?filters=${encodeURIComponent(JSON.stringify({applicationsOnly:true}))}`);assert(applied.items.some(j=>j.id===jobId));assert.equal(applied.total,applied.items.length);
await call(a,'/api/action',{type:'job-status',role:'employer',id:jobId,status:'published'});
// A tiny synthetic PNG is enough to verify media authorization beyond the preview.
const form=new FormData();form.set('role','employer');form.set('kind','gallery');form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'qa-pixel.png');
const upload=await fetch(base+'/api/company-media',{method:'POST',headers:{Cookie:a.cookie,Origin:base},body:form});assert.equal(upload.status,200);const uploaded=await upload.json();checks++;
assert(uploaded.jobs.length<80);
await call(a,'/api/action',{type:'company',role:'employer',name:'Проверочная компания',email:a.email,description:'Синтетическая команда для проверки каталога'});
const detail=(await call(a,`/api/catalog/jobs?job=${jobId}&role=employer`)).job;
await call(a,'/api/action',{...detail,type:'job',role:'employer',mediaKeys:[uploaded.uploadedKey]});
const media=await fetch(base+`/api/company-media?key=${encodeURIComponent(uploaded.uploadedKey)}`,{headers:{Cookie:b.cookie}});assert.equal(media.status,200);checks++;
const foreignMedia=await fetch(base+`/api/company-media?key=company-media/foreign/not-found`,{headers:{Cookie:b.cookie}});assert.equal(foreignMedia.status,404);checks++;
const deleted=await fetch(base+'/api/company-media',{method:'DELETE',headers:{Cookie:a.cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({role:'employer',key:uploaded.uploadedKey})});assert.equal(deleted.status,200);checks++;
assert(!(await call(a,`/api/catalog/jobs?job=${jobId}&role=employer`)).job.mediaKeys.includes(uploaded.uploadedKey));
console.log(`PASS ${checks} linked scenarios: contact consent, archived application, deep-page media and cleanup`);
