import {chromium} from '/Users/igorechekborisov/.cache/offerly/qa-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const dir=process.env.VPS_QA_DIR;
if(!dir?.includes('/offerly/'))throw Error('Private QA directory required');
const users=JSON.parse(await readFile(dir+'/users.json','utf8'));
const origin=process.env.VPS_QA_BROWSER_ORIGIN||'https://127.0.0.1:18443';
const mobile=process.env.VPS_QA_MOBILE==='1';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report={pages:[],checks:[],errors:[]};
const contexts={};
const check=(name,yes)=>{assert(yes,name);report.checks.push(name);};
async function open(u){
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:mobile?{width:390,height:844}:{width:1440,height:1000},reducedMotion:'reduce'});
 contexts[u.role]=context;
 const page=await context.newPage();
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('response',r=>{if(r.status()>=500)report.errors.push(r.status()+' '+new URL(r.url()).pathname);});
 await page.goto(origin+'/login?role='+u.role);
 await page.getByLabel('Электронная почта',{exact:true}).fill(u.email);
 await page.getByLabel('Пароль',{exact:true}).fill(u.password);
 await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.waitForURL('**/demo/'+u.role+'/overview');
 await page.getByRole('heading').first().waitFor({state:'visible'});
 check('browser login '+u.role,(await context.cookies()).some(c=>c.name.includes('session')&&c.secure&&c.httpOnly));
 return page;
}
try{
 for(const u of [users.e,users.c]){
  const page=await open(u);
  const pages=u.role==='employer'?['overview','candidates','needs','invitations','messages','jobs','company','settings']:['overview','assessment','skills','results','jobs','invitations','messages','profile','settings'];
  for(const tab of pages){
   await page.goto(origin+'/demo/'+u.role+'/'+tab);
   await page.getByRole('heading').first().waitFor({state:'visible'});
   await page.locator('.workspace-main').waitFor();
   await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))));
   const info=await page.evaluate(()=>({headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent.trim()),body:document.body.innerText.length,overflow:document.documentElement.scrollWidth>innerWidth+2,broken:[...document.images].filter(i=>i.complete&&i.naturalWidth===0&&i.src).map(i=>new URL(i.src).pathname)}));
   check(u.role+'/'+tab+' renders',info.body>100&&!info.headings.some(t=>t==='404'));
   check(u.role+'/'+tab+' fits desktop',!info.overflow);
   check(u.role+'/'+tab+' images decode',info.broken.length===0);
   report.pages.push({role:u.role,tab,...info});
  }
  if(mobile)await page.getByRole('button',{name:'Открыть навигацию'}).click();
  await page.getByRole('button',{name:'Помощь',exact:true}).click();await page.getByRole('dialog').waitFor();
  check('help dialog '+u.role,(await page.getByRole('dialog').innerText()).length>100);
 }
 check('no browser exceptions or HTTP 5xx',report.errors.length===0);
 console.log(JSON.stringify({pages:report.pages.length,checks:report.checks.length,errors:report.errors}));
}finally{
 await writeFile(dir+(mobile?'/browser-mobile.json':'/browser.json'),JSON.stringify(report,null,2),{mode:0o600});
 await browser.close();
}
