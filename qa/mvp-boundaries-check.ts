// Separate disposable database only; never point this at the running site's data.
import assert from 'node:assert/strict';
import {getDb} from '../db';
import {createAccount,loadPlatform,savePlatform} from '../lib/platform';
import {hiringOperation} from '../lib/hiring';
import {digest,hashPassword} from '../lib/auth';
import {completePasswordReset} from '../lib/password-recovery';
if(!process.env.PGLITE_PATH?.startsWith('/tmp/offerly-mvp-boundaries-')||process.env.DATABASE_URL)throw Error('Isolated database required');
const db=await getDb();let checks=0;
const account=()=>({id:crypto.randomUUID(),email:crypto.randomUUID()+'@example.test',name:'QA',scope:'public',demo:false,verified_at:new Date().toISOString(),deleted_at:null});
const e=account(),a=account(),v=account();
for(const u of [e,a,v])await db.transaction(tx=>createAccount(tx,u,null));
const es=await loadPlatform(e),as=await loadPlatform(a);
Object.assign(as.profile,{consent:true,available:true});await savePlatform(a.id,as);
await db.query("DELETE FROM company_memberships WHERE user_id=$1",[v.id]);
await db.query("INSERT INTO company_memberships(company_id,user_id,role) VALUES($1,$2,'viewer')",[es.company.id,v.id]);
const pid=crypto.randomUUID();await db.query("INSERT INTO hiring_processes(id,company_id,candidate_id,context_key,title) VALUES($1,$2,$3,'general','QA')",[pid,es.company.id,as.profile.id]);
const h=(u:any,type:string,data:any={})=>hiringOperation(u,'employer',{type,...data});
assert((await h(v,'processes')).items.some((p:any)=>p.id===pid));checks++;
await assert.rejects(h(v,'process-update',{id:pid,revision:0,stage:'offer'}),/прав/);checks++;
await db.query("UPDATE company_memberships SET role='recruiter' WHERE user_id=$1",[v.id]);
await h(v,'process-update',{id:pid,revision:0,stage:'talking',note:'Recruiter note'});checks++;
// An application grants communication without a fabricated professional result.
const job=crypto.randomUUID();await db.query("INSERT INTO jobs(id,company_id,status,specialty,grade,payload) VALUES($1,$2,'draft','Backend','Middle',$3)",[job,es.company.id,JSON.stringify({title:'QA'})]);
await db.query("INSERT INTO applications(id,job_id,candidate_id,status,payload) VALUES($1,$2,$3,'sent','{}')",[crypto.randomUUID(),job,as.profile.id]);
await assert.rejects(h(e,'task-create',{processId:pid,title:'Bad',periodDays:1,questions:[null]}),/Добавьте/);checks++;
await assert.rejects(h(e,'meeting-propose',{processId:pid,slots:[null],duration:30,timeZone:'Europe/Moscow'}),/врем/);checks++;
const hash=await hashPassword('Boundary-'+crypto.randomUUID());await db.query("UPDATE users SET password_hash=$2 WHERE id=$1",[a.id,hash]);
async function flow(email=a.email,expires="now()+interval '10 minutes'",authorized="now()") {const id=crypto.randomUUID(),binding=crypto.randomUUID(),grant=crypto.randomUUID();await db.query(`INSERT INTO password_reset_flows(id,user_id,binding_hash,code_hash,email,credential_hash,expires_at,grant_hash,authorized_at) VALUES($1,$2,$3,$4,$5,$6,${expires},$7,${authorized})`,[id,a.id,digest(binding),digest('code'),email,digest(hash),digest(grant)]);return{id,binding,grant};}
const password='Replacement-'+crypto.randomUUID();
for(const f of [await flow('old@example.test'),await flow(a.email,"now()-interval '1 minute'"),await flow(a.email,undefined,"now()-interval '6 minutes'")]){await assert.rejects(completePasswordReset(f.id,f.grant,password,f.binding));checks++;}
assert.equal((await db.query('SELECT password_hash FROM users WHERE id=$1',[a.id])).rows[0].password_hash,hash);checks++;
console.log(JSON.stringify({checks,result:'passed',coverage:['viewer read/recruiter write','malformed task and meeting bodies','reset changed-email/expired-code/expired-grant']}));process.exit(0);
