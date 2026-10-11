import {chromium} from '/Users/igorechekborisov/.cache/offerly/qa-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {call,state,complete,fixture,save,dir,prefix} from './vps-client.mjs';
const origin=process.env.VPS_QA_BROWSER_ORIGIN||'https://127.0.0.1:18443';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const users=[],passed=[];
const check=(s,v)=>{assert(v,s);passed.push(s);console.log('PASS '+s);};
try{
 for(const variant of ['manual','pdf','employer']){
  const role=variant==='employer'?'employer':'candidate';
  const u={role,email:prefix+'ui-'+variant+'-'+Date.now()+'@example.test',password:'Vps-QA-'+prefix+'Aa!',name:'Тест Регистрация'};
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},reducedMotion:'reduce'}),p=await ctx.newPage();
  await p.goto(origin+'/register?role='+role);
  await p.getByLabel(/^Фамилия/).fill('Регистрация');await p.getByLabel(/^Имя/).fill('Тест');
  if(role==='employer')await p.getByPlaceholder('Название вашей команды').fill('VPS QA UI employer');
  await p.getByPlaceholder('you@company.ru').fill(u.email);await p.getByPlaceholder('Не менее 12 символов').fill(u.password);await p.locator('#consent').click();
  await p.getByRole('button',{name:'Продолжить',exact:true}).click();await p.waitForURL('**/verify-email?role='+role);
  u.cookie=(await ctx.cookies()).map(c=>c.name+'='+c.value).join('; ');users.push(u);check('registration form '+variant,!!u.cookie);
  await p.getByRole('button',{name:role==='employer'?'Заполнить компанию, пока ожидаю письмо':'Заполнить профиль, пока ожидаю письмо'}).click();await p.waitForURL('**/onboarding/'+role+'**');
  fixture({action:'verify-email',email:u.email});await p.reload();
  if(role==='candidate'){
   if(variant==='pdf'){
    await p.getByLabel('Загрузить PDF-резюме').setInputFiles('output/pdf/resume-benchmark/authored-photo-top-right.pdf');
    await p.getByRole('button',{name:'Перенести выбранное'}).click();await p.locator('.setup-parsed').waitFor({state:'hidden'});
    check('PDF visible skills imported',(await p.locator('.setup-form').innerText()).includes('Python'));
   }else{await p.locator('#setup-skills').fill('Python');await p.locator('#setup-skills').press('Enter');}
   await p.getByRole('radio',{name:'Пока нет опыта'}).click();await p.getByRole('button',{name:'Продолжить',exact:true}).click();await p.waitForURL('**step=expectations');
   await p.locator('#setup-roles').fill('Backend-разработчик');await p.locator('#setup-roles').press('Enter');
   await p.locator('#setup-min').fill('120000');await p.locator('#setup-max').fill('200000');
   await p.locator('#setup-city').fill('Москва');await p.locator('#setup-city').press('Tab');
   const consent=p.getByRole('checkbox',{name:/Согласен на участие профиля/});if(!(await consent.isChecked()))await consent.click();
   await p.getByRole('button',{name:'Сохранить и продолжить',exact:true}).click();await p.waitForURL('**/demo/candidate/**');
   const s=await state(u);check('candidate onboarding '+variant,s.profile.skills.includes('Python')&&s.profile.roles.length>0&&s.profile.city==='Москва'&&s.profile.salaryMin===120000&&s.profile.consent);
   if(variant==='pdf')check('PDF resume and photo persisted',!!s.profile.resumeKey&&!!s.profile.avatarKey);
  }else{
   await p.locator('#setup-company-name').fill('VPS QA UI employer');
   await p.locator('#setup-company-industry').click();await p.getByRole('option').first().click();
   await p.locator('#setup-company-size').click();await p.getByRole('option').first().click();
   await p.locator('#setup-company-city').fill('Москва');await p.locator('#setup-company-city').press('Tab');
   await p.locator('#setup-company-description').fill('Синтетическая компания для проверки регистрации после переноса.');
   await p.getByRole('button',{name:'Продолжить',exact:true}).click();await p.waitForURL('**step=team');
   await p.locator('#setup-company-email').fill(u.email);await p.locator('#setup-company-phone').fill('+79991234567');
   await p.getByRole('button',{name:'Сохранить и продолжить',exact:true}).click();await p.waitForURL('**/demo/employer/**');
   const s=await state(u);check('employer onboarding',s.company.name==='VPS QA UI employer'&&s.company.city==='Москва'&&s.company.email===u.email);
  }
  await call(u,'/api/drafts?key=settings:tour_preferences_v1',{value:{disabled:true}},200,{method:'PUT'});
 }
 await save('ui-registration-users.json',users);
 const u=users.find(u=>u.email.includes('ui-pdf-'));
 const v=await complete(u,'backend','Junior');check('registered PDF candidate completes real VPS test',v.result.decision==='CONFIRMED');
 await save('ui-registration-users.json',users);
 console.log(JSON.stringify({phase:'registration-browser',checks:passed.length,result:'passed'}));
}finally{await save('registration-browser.json',{at:new Date().toISOString(),passed});await save('ui-registration-users.json',users);await browser.close();}
