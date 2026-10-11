import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import type {Database} from '../db';
import {createAccount,type Account} from '../lib/platform';
import {professionalDemoOperation as demo, professionalOperation as real} from '../lib/professional-assessment';
import type {NavigableSessionView as View} from '../lib/professional-navigation';
import {packs} from '../vendor/fsp-assessment/dist/src/generative/packs.js';
const pg=new PGlite();
for(const f of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')).sort())await pg.exec(await readFile('db/migrations/'+f,'utf8'));
const wrap=(c:Pick<PGlite,'query'>):Database=>({query:(sql,p=[])=>c.query(sql,p),transaction:fn=>pg.transaction(tx=>fn(wrap(tx)))});
const db=wrap(pg);const globalDb=globalThis as typeof globalThis & {offerlyDb?:Promise<Database>};globalDb.offerlyDb=Promise.resolve(db);
after(async()=>{delete globalDb.offerlyDb;await pg.close()});
const owner:Account={id:'expert-demo-owner',email:'expert@example.test',name:'Демонстрация',scope:'expert-test',demo:true,verified_at:null,deleted_at:null};
const other={...owner,id:'expert-demo-other',email:'expert-other@example.test',scope:'other-expert'};
const ordinary={...owner,id:'real-owner',email:'real@example.test',demo:false,verified_at:new Date().toISOString()};
for(const account of [owner,other,ordinary])await createAccount(db,account,null);
const view=(value:unknown)=>value as View;
const input=(s:View)=>({id:s.id,itemId:s.current!.itemId,stepId:s.current!.step.id,interactionRevision:s.interactionRevision||0});
test('expert mode retains reports for the authenticated owner and stays isolated from real qualification',async()=>{
 const profileBefore=(await db.query('SELECT payload FROM candidate_profiles WHERE user_id=$1',[owner.id])).rows[0].payload;
 const normal=view(await real(owner,'start',{specialization:'backend',targetGrade:'Junior'}));
 const ordinaryProfileBefore=structuredClone((await db.query('SELECT payload FROM candidate_profiles WHERE user_id=$1',[ordinary.id])).rows[0].payload);
 let ordinaryDemo=view(await demo(ordinary,'start',{specialization:'backend',targetGrade:'Junior'}));
 assert.equal(ordinaryDemo.demonstration,true);
 const ordinaryReal=view(await real(ordinary,'start',{specialization:'backend',targetGrade:'Junior'}));
 let ordinaryGuard=0;while(ordinaryDemo.state==='active'){assert(++ordinaryGuard<70);const filled=view(await demo(ordinary,'fill',input(ordinaryDemo)));ordinaryDemo=view(await demo(ordinary,'answer',{...input(filled),optionId:filled.demoAnswer!.optionId,execution:filled.demoAnswer!.execution}));}
 assert.equal(ordinaryDemo.result!.decision,'CONFIRMED');
 assert((await demo(ordinary,'list') as View[]).some(s=>s.id===ordinaryDemo.id && s.result?.decision==='CONFIRMED'));
 assert.equal(view(await real(ordinary,'get',{id:ordinaryReal.id})).state,'active');
 assert.equal((await db.query('SELECT id FROM assessments WHERE user_id=$1',[ordinary.id])).rows.length,0);
 await assert.rejects(real(ordinary,'get',{id:ordinaryDemo.id}),{status:404});
 await assert.rejects(demo({...ordinary,verified_at:null},'get',{id:ordinaryDemo.id}),{status:403});
 await assert.rejects(real(owner,'fill',input(normal)),{status:404});
 let cases=0,steps=0;
 for(const pack of packs.filter(p=>p.enabled && (!process.env.DEMO_QA_QUICK || p.id==='backend')))for(const grade of ['Junior','Middle','Senior']){
  let s=view(await demo(owner,'start',{specialization:pack.id,targetGrade:grade}));
  assert.equal(s.demonstration,true);
  await assert.rejects(real(owner,'get',{id:s.id}),{status:404});
  await assert.rejects(demo(owner,'get',{id:normal.id}),{status:404});
  await assert.rejects(demo(other,'get',{id:s.id}),{status:404});
  if(cases===0){
   // A recording can resume days later; normal sessions keep their real deadline.
   const started=new Date(Date.now()-3*86400000).toISOString();
   const deadline=new Date(Date.parse(started)+20*60000).toISOString();
   await db.query(`UPDATE professional_assessment_records SET body=jsonb_set(jsonb_set(body,'{startedAt}',to_jsonb($2::text)),'{deadlineAt}',to_jsonb($3::text)) WHERE id=$1 AND collection='expert-sessions'`,[s.id,started,deadline]);
   s=view(await demo(owner,'get',{id:s.id}));assert.equal(s.state,'active');
   await assert.rejects(demo(owner,'fill',{...input(s),stepId:'wrong'}),{status:409});
  }
  if(cases===0){const last=s.navigation!.at(-1)!;assert(s.navigation!.every(n=>n.available));s=view(await demo(owner,'navigate',{...input(s),itemId:last.itemId,stepId:last.stepId}));}
  let n=0;
  while(s.state==='active'){
   assert(++n<80);
   const before=JSON.stringify(s.progress);
   const filled=view(await demo(owner,'fill',input(s)));
   assert.equal(JSON.stringify(filled.progress),before,'fill must not submit or advance');
   assert.equal(filled.current!.step.id,s.current!.step.id);
   assert.ok(filled.demoAnswer);
   if(cases===0&&n===1)await assert.rejects(demo(owner,'fill',input(s)),{status:409});
   s=view(await demo(owner,'answer',{...input(filled),optionId:filled.demoAnswer!.optionId,execution:filled.demoAnswer!.execution}));steps++;
   const safe=view(await demo(owner,'get',{id:s.id}));
   assert.equal(safe.demoAnswer,undefined);
   assert.doesNotMatch(JSON.stringify(safe),/"rubric"|"responseChecks"|"accepted"/);
  }
  assert.equal(s.result!.decision,'CONFIRMED',`${pack.id} ${grade}`);
  await assert.rejects(demo(owner,'fill',{id:s.id}),{status:409});
  cases++;
 }
 assert.equal(cases,process.env.DEMO_QA_QUICK?3:36);assert(steps>20);
 const history=await demo(owner,'list') as View[];assert.equal(history.filter(s=>s.result).length,cases);assert(history.every(s=>s.demonstration));
 const normalAfter=view(await real(owner,'get',{id:normal.id}));assert.equal(normalAfter.state,'active');assert.equal(normalAfter.demonstration,undefined);assert.equal(normalAfter.demoAnswer,undefined);
 assert.deepEqual((await db.query('SELECT payload FROM candidate_profiles WHERE user_id=$1',[owner.id])).rows[0].payload,profileBefore);
 assert.equal((await db.query('SELECT id FROM assessments WHERE user_id=$1',[owner.id])).rows.length,0);
 assert.deepEqual((await db.query('SELECT payload FROM candidate_profiles WHERE user_id=$1',[ordinary.id])).rows[0].payload,ordinaryProfileBefore);
 const repeat=view(await demo(owner,'start',{specialization:'backend',targetGrade:'Junior'}));assert.equal(repeat.state,'active','demo has no qualification cooldown');
 console.log(JSON.stringify({expertDemoCases:cases,steps,profileUnchanged:true,isolated:true}));
});
