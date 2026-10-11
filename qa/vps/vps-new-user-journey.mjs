import {chromium} from '/Users/igorechekborisov/.cache/offerly/qa-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {call,state,save,dir} from './vps-client.mjs';
const registered=JSON.parse(await readFile(dir+'/ui-registration-users.json','utf8'));
const c=registered.find(u=>u.email.includes('ui-pdf-')),e=registered.find(u=>u.role==='employer');
await state(c);await state(e);
const origin=process.env.VPS_QA_BROWSER_ORIGIN||'https://127.0.0.1:18443',passed=[],errors=[];
const check=(name,value)=>{assert(value,name);passed.push(name);console.log('PASS '+name);};
const until=async fn=>{const end=Date.now()+20000;while(!await fn()){assert(Date.now()<end,'Condition timeout');await new Promise(r=>setTimeout(r,200));}};
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
async function page(u){const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},reducedMotion:'reduce'});await ctx.addCookies(u.cookie.split('; ').map(s=>({name:s.slice(0,s.indexOf('=')),value:s.slice(s.indexOf('=')+1),url:origin,secure:true,httpOnly:true})));const p=await ctx.newPage();p.on('pageerror',err=>errors.push(err.message));return p;}
try{
 const p=await page(e),q=await page(c);
 await p.goto(origin+'/demo/employer/candidates');await p.getByRole('button',{name:'Сбросить',exact:true}).click();
 await p.getByRole('textbox',{name:'Поиск кандидатов',exact:true}).fill(String(c.state.profile.id));
 await until(async()=>await p.locator('.candidate-card').count()===1&&await p.locator('.candidate-card').innerText().then(t=>t.includes('#'+c.state.profile.id)));
 check('new PDF candidate searchable after test',true);
 check('candidate contacts hidden before consent',!(await p.locator('.candidate-card').innerText()).includes(c.email));
 let invite=e.state.invitations.find(i=>i.candidateId===c.state.profile.id&&i.title.startsWith('VPS UI complete journey'));
 if(!invite){
  await p.locator('.candidate-card').getByRole('button',{name:'Пригласить',exact:true}).click();const dialog=p.getByRole('dialog');await dialog.waitFor();const title='VPS UI complete journey '+Date.now();
  await dialog.locator('[name=title]').fill(title);await dialog.locator('[name=description]').fill('Приглашаем в команду после знакомства с PDF-профилем и результатом теста.');await dialog.locator('[name=min]').fill('150000');await dialog.locator('[name=max]').fill('200000');
  await dialog.getByRole('button',{name:/Отправить/}).click();await dialog.waitFor({state:'hidden'});invite=(await state(e)).invitations.find(i=>i.title===title);assert(invite);
 }
 check('new employer sends invitation through UI',!!invite);
 await q.goto(origin+'/demo/candidate/invitations');
 if(invite.status!=='accepted'){await q.getByRole('button',{name:'Хочу познакомиться',exact:true}).click();const confirm=q.getByRole('dialog');await confirm.waitFor();await confirm.getByRole('button',{name:'Познакомиться и открыть контакты',exact:true}).click();await confirm.waitFor({state:'hidden'});await until(async()=>(await state(e)).invitations.find(i=>i.id===invite.id)?.status==='accepted');}
 else await q.getByRole('button',{name:'Открыть чат',exact:true}).click();
 check('candidate accepts invitation through UI',true);
 const rooms=await call(c,'/api/conversations');const room=rooms.items.find(r=>r.companyId===e.state.company.id)||rooms.items[0];assert(room);
 await q.waitForURL('**/messages?conversation=**');
 check('accepted invitation opens candidate chat',true);
 await p.goto(origin+'/demo/employer/invitations');await p.getByRole('button',{name:'Открыть чат',exact:true}).first().click();await p.waitForURL('**/messages?conversation=**');
 check('accepted invitation opens employer chat',new URL(p.url()).searchParams.get('conversation')===new URL(q.url()).searchParams.get('conversation'));
 const roomId=new URL(q.url()).searchParams.get('conversation');
 const candidateText='Спасибо за приглашение, готов обсудить работу. '+Date.now();
 await q.getByLabel('Ваше сообщение',{exact:true}).fill(candidateText);await q.getByRole('button',{name:'Отправить',exact:true}).click();
 await until(async()=>(await call(e,'/api/conversations/'+roomId)).messages.some(m=>m.body===candidateText));
 check('candidate sends actual UI message',true);
 const employerText='Согласуем встречу с командой. '+Date.now();
 const abort=async route=>{const data=route.request().postDataJSON();if(data?.type==='message')await route.abort('failed');else await route.continue();};
 await p.route('**/api/conversations/'+roomId,abort);
 await p.getByLabel('Ваше сообщение',{exact:true}).fill(employerText);await p.getByRole('button',{name:'Отправить',exact:true}).click();
 await p.getByRole('dialog').waitFor();check('failed message keeps typed text',await p.getByLabel('Ваше сообщение',{exact:true}).inputValue()===employerText);
 await p.unroute('**/api/conversations/'+roomId,abort);await p.reload();
 check('message draft survives reload',await p.getByLabel('Ваше сообщение',{exact:true}).inputValue()===employerText);
 await p.getByRole('button',{name:'Отправить',exact:true}).click();
 await until(async()=>(await call(c,'/api/conversations/'+roomId)).messages.filter(m=>m.body===employerText).length===1);
 check('recovered send delivered exactly once',true);
 await q.reload();await q.locator('.chat-message').filter({hasText:employerText}).waitFor();
 await until(async()=>(await call(e,'/api/conversations/'+roomId)).otherReadThrough>0);
 check('recipient sees message and read marker updates',true);
 await save('new-user-flow.json',{roomId,invitationId:invite.id,candidateId:c.state.profile.id});
 check('new user journey no browser exceptions',errors.length===0);
}finally{await save('new-user-journey.json',{at:new Date().toISOString(),passed,errors});await browser.close();}
