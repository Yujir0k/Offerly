import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createSession,publicSession} from '../vendor/fsp-assessment/dist/src/adaptive/engine.js';import {packs} from '../vendor/fsp-assessment/dist/src/generative/packs.js';
const rows=[];const now=1791646000000;
for(const pack of packs.filter(p=>p.enabled))for(const grade of ['Junior','Middle','Senior']){
const s=createSession('variety','fixture',grade,'identical-seed',now,undefined,undefined,{specialization:pack.id});
assert.equal(s.generation.generatorVersion,'formal-generator-7.3.3');assert.equal(s.config.scoringVersion,'competency-4');assert.equal(Date.parse(s.deadlineAt)-Date.parse(s.startedAt),1200000);
const display=[];for(let i=0;i<s.items.length;i++)for(let step=0;step<s.items[i].variant.steps.length;step++){s.cursor={item:i,step};const p=publicSession(s,now).current;const text=JSON.stringify(p);assert(!text.includes('"rubric"'));assert(!text.includes('expectedPlan'));display.push({prompt:p.step.prompt,context:p.step.context,scenario:p.step.scenario,options:p.step.options.map(o=>o.text),responseTask:p.step.responseTask,artifacts:p.artifacts.map(a=>({type:a.type,label:a.label,content:a.content}))});}
const digest=createHash('sha256').update(JSON.stringify(display,(key,value)=>['id','itemId'].includes(key)?undefined:value)).digest('hex');rows.push({role:pack.id,grade,digest,steps:display.length});
}
assert.equal(new Set(rows.map(r=>r.digest)).size,36);console.log(JSON.stringify({combinations:rows.length,uniquePublicContent:36,formalGenerator:'7.3.3',scoring:'competency-4',deadlineMinutes:20}));
