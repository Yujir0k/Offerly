import {chromium} from '/Users/igorechekborisov/.cache/offerly/qa-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {save} from './vps-client.mjs';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const pages=[],errors=[];
try{
 for(const width of [1440,390]){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:1000},reducedMotion:'reduce'});const p=await ctx.newPage();p.on('pageerror',err=>errors.push(err.message));
  for(const path of ['/','/privacy','/terms','/login?role=candidate','/login?role=employer','/register?role=candidate','/register?role=employer']){
   const r=await p.goto('https://127.0.0.1:18443'+path);assert.equal(r.status(),200);await p.getByRole('heading').first().waitFor();await p.evaluate(()=>Promise.race([Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode().catch(()=>{});})),new Promise(r=>setTimeout(r,8000))]));
   const info=await p.evaluate(()=>({headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent),overflow:document.documentElement.scrollWidth>innerWidth+2,broken:[...document.images].filter(i=>i.src&&i.complete&&!i.naturalWidth).length}));
   assert(!info.overflow,path+' horizontal overflow '+width);assert.equal(info.broken,0,path+' images');pages.push({path,width,...info});console.log('PASS public '+path+' '+width);
  }
 }
 assert.equal(errors.length,0);console.log(JSON.stringify({phase:'public-browser',pages:pages.length,result:'passed'}));
}finally{await save('public-browser.json',{at:new Date().toISOString(),pages,errors});await browser.close();}
