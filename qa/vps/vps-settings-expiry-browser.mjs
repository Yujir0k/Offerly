import {chromium} from '/Users/igorechekborisov/.cache/offerly/qa-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {state,save,dir,act,call} from './vps-client.mjs';
const {e,c,flow}=JSON.parse(await readFile(dir+'/users.json'));
const matrix=JSON.parse(await readFile(dir+'/matrix-users.json'));
const rows=JSON.parse(await readFile(dir+'/matrix.json')).rows;
const origin=process.env.VPS_QA_BROWSER_ORIGIN||'https://127.0.0.1:18443',passed=[],errors=[];
const check=(name,value)=>{assert(value,name);passed.push(name);console.log('PASS '+name);};
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
async function page(u){const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},reducedMotion:'reduce'});await ctx.addCookies(u.cookie.split('; ').map(s=>({name:s.slice(0,s.indexOf('=')),value:s.slice(s.indexOf('=')+1),url:origin,secure:true,httpOnly:true})));const p=await ctx.newPage();p.on('pageerror',err=>errors.push(err.message));return p;}
try{
 for(const u of [e,c]){
  const p=await page(u);await p.goto(origin+'/demo/'+u.role+'/settings');await p.getByRole('button',{name:'Изменить почту',exact:true}).waitFor();
  const sizes=await p.locator('.account-panel:not([hidden]) .account-row button:not([role=switch]), .account-save button').evaluateAll(es=>es.filter(e=>e.offsetWidth).map(e=>({text:e.textContent.trim(),w:e.offsetWidth,h:e.offsetHeight,font:getComputedStyle(e).fontSize})));
  check(u.role+' account controls consistent',sizes.length>=4&&new Set(sizes.map(x=>x.h)).size===1&&new Set(sizes.map(x=>x.font)).size===1);
  await p.getByRole('combobox',{name:'Часовой пояс'}).click();await p.getByRole('option',{name:'Самара · UTC+4',exact:true}).click();await p.getByRole('button',{name:'Сохранить настройки',exact:true}).click();await p.locator('.account-panel:not([hidden])').getByText('Настройки сохранены',{exact:true}).waitFor();
  check(u.role+' timezone persists',(await state(u)).settings.timeZone==='Europe/Samara');
  await p.getByRole('button',{name:'Уведомления',exact:true}).click();await p.getByRole('heading',{name:'Уведомления',exact:true}).waitFor();
  await p.getByRole('button',{name:'Сохранить настройки',exact:true}).click();await p.locator('.account-panel:not([hidden])').getByText('Настройки сохранены',{exact:true}).waitFor();check(u.role+' notification settings UI saves',true);
  if(u.role==='candidate')check('candidate has no MCP tab',await p.getByRole('button',{name:'MCP · агент',exact:true}).count()===0);
  else {await p.getByRole('button',{name:'MCP · агент',exact:true}).click();await p.getByText('Сервер работает',{exact:true}).waitFor();check('normal employer MCP UI available',true);}
 }
 const q=await page(c);await q.goto(origin+'/demo/candidate/messages?conversation='+flow.room);
 const expired=q.locator('.conversation-task').filter({hasText:'Время выполнения истекло'}).first();await expired.waitFor();
 check('expired task shows closed access message',await expired.getByLabel('Решение задачи').count()===0&&await expired.getByRole('button',{name:'Отправить решение',exact:true}).count()===0);
 const u=matrix.find(j=>j.grade==='Junior'&&j.scenario==='timeout').user;const r=rows.find(r=>r.track==='backend'&&r.grade==='Junior'&&r.scenario==='timeout');
 await state(u);await act(u,'profile',{...u.state.profile,name:'Тест тайм-аута',phone:'+79991234567',city:'Москва',skills:['Python','SQL'],experience:1,roles:['Backend-разработчик'],specialty:'Backend',claimed:'Junior',formats:['Удалённо'],salaryMin:120000,salaryMax:200000,consent:true,visible:true});await call(u,'/api/drafts?key=settings:tour_preferences_v1',{value:{disabled:true}},200,{method:'PUT'});const a=await page(u);await a.goto(origin+'/demo/candidate/assessment?session='+r.id);await a.getByRole('heading',{name:'Время истекло',exact:true}).waitFor();
 check('assessment timeout visibly reports unanswered zero',(await a.locator('body').innerText()).includes('— 0 баллов'));
 check('expired assessment cannot answer',await a.getByRole('button',{name:'Ответить',exact:true}).count()===0);
 await q.goto(origin+'/demo/candidate/profile');const downloadPromise=q.waitForEvent('download');await q.getByRole('button',{name:'Скачать PDF',exact:true}).click();const download=await downloadPromise;await download.saveAs(dir+'/generated-profile.pdf');const bytes=await readFile(dir+'/generated-profile.pdf');check('generated candidate PDF downloads',bytes.subarray(0,4).toString()==='%PDF'&&bytes.length>10000);
 check('settings and expiry no browser exceptions',errors.length===0);
}finally{await save('settings-expiry-browser.json',{at:new Date().toISOString(),passed,errors});await browser.close();}
