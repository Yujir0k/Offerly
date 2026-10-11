import { chromium } from '/Users/igorechekborisov/.cache/offerly/qa-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
assert.equal(process.env.CAPACITY_ALLOW_PRODUCTION, 'opherly.ru');
const dir=process.env.CAPACITY_PRIVATE_DIR;
const users=JSON.parse(await readFile(path.join(dir,'targets.json'),'utf8'));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const errors=[];
try {
  for(const role of ['employer','candidate']) {
    const u=users.find(u=>u.role===role),ctx=await browser.newContext({viewport:{width:1440,height:1000}});
    await ctx.addCookies(u.cookie.split('; ').map(s=>({name:s.slice(0,s.indexOf('=')),value:s.slice(s.indexOf('=')+1),url:'https://opherly.ru',secure:true,httpOnly:true})));
    const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
    const kind=role==='employer'?'candidates':'jobs',selector=role==='employer'?'.candidate-card':'.vacancy-card';
    const response=p.waitForResponse(r=>r.url().includes('/api/catalog/'+kind+'?')&&r.status()===200);
    await p.goto('https://opherly.ru/demo/'+role+'/'+(role==='employer'?'candidates':'jobs'));
    await response;
    const reset=p.getByRole('button',{name:role==='employer'?'Сбросить':'Сбросить всё',exact:true});
    if(await reset.count()) await reset.click();
    try { await p.locator(selector).first().waitFor(); }
    catch(e) {
      console.log(JSON.stringify({path:new URL(p.url()).pathname, headings:await p.locator('h1').allTextContents(), inputs:await p.locator('input').evaluateAll(a=>a.map(x=>({label:x.getAttribute('aria-label'),value:x.type==='password'?'hidden':x.value}))), alerts:await p.locator('[role=alert]').allTextContents()}));
      throw e;
    }
    const input=p.locator('input[aria-label="'+(role==='employer'?'Поиск кандидатов':'Поиск по названию, компании или навыку')+'"]');
    await p.route('**/api/catalog/'+kind+'?**',async route=>{
      const f=JSON.parse(new URL(route.request().url()).searchParams.get('filters'));
      if(f.query==='Python') await new Promise(r=>setTimeout(r,700));
      try{await route.continue();}catch{ /* Superseded request is cancelled by the hook. */ }
    });
    await input.fill('Python');await new Promise(r=>setTimeout(r,350));
    const last=p.waitForResponse(r=>{
      if(!r.url().includes('/api/catalog/'+kind+'?'))return false;
      return JSON.parse(new URL(r.url()).searchParams.get('filters')).query==='SQL'&&r.status()===200;
    });
    await input.fill('SQL');const finalBody=await (await last).json();
    await p.waitForFunction(()=>!document.querySelector('.catalog-pending'));
    assert.equal(await input.inputValue(),'SQL');
    await new Promise(r=>setTimeout(r,800));
    assert.equal(await input.inputValue(),'SQL');
    if(role==='employer') {
      const shown=await p.locator('.candidate-card').allTextContents();
      assert.deepEqual(shown.map(t=>Number(t.match(/Кандидат #(\d+)/)?.[1])),finalBody.items.map(x=>x.id));
    } else {
      assert.deepEqual(await p.locator('.vacancy-card').evaluateAll(a=>a.map(x=>x.getAttribute('aria-label'))),finalBody.items.map(x=>'Подробнее: '+x.title));
    }
    for(const width of [1440,390]) {
      await p.setViewportSize({width,height:900});
      assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    }
    console.log(JSON.stringify({role,catalogLoaded:true,latestQueryPreserved:true,desktopAndMobile:true}));
    await ctx.close();
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
