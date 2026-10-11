// Isolated disposable PGlite only; never connect to the running development DB.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db';
import { createAccount, loadPlatform, type Account } from '../lib/platform';
import { hiringOperation, HiringError } from '../lib/hiring';
async function main() {
 if (!process.env.PGLITE_PATH?.startsWith('/tmp/offerly-compare-qa-') || process.env.DATABASE_URL) throw Error('Disposable QA DB required');
 const db=await getDb(), id=randomUUID();
 const a:Account={id,scope:id,email:`${id}@example.test`,name:'Comparison QA',demo:true,verified_at:null,deleted_at:null};
 await createAccount(db,a,null,'Comparison QA');
 await loadPlatform(a);
 const {rows}=await db.query<{id:number}>(`SELECT p.id FROM candidate_profiles p JOIN users u ON u.id=p.user_id WHERE u.scope=$1 AND u.id<>$1 AND p.visible AND p.consent AND p.grade IS NOT NULL ORDER BY p.id DESC LIMIT 25`,[id]);
 const ids=rows.map(r=>r.id);assert.equal(ids.length,25);
 const result=await hiringOperation(a,'employer',{type:'compare',ids:[...ids,ids[0]]});
 assert.deepEqual(result.items.map((p:any)=>p.id),ids,'All 25 candidates beyond preview are returned in selection order, without duplicates');
 assert(result.items.every((p:any)=>!p.email&&!p.phone&&!p.resumeKey),'Unaccepted contacts/files stay redacted');
 const rejects=async(body:any,status:number,role:'employer'|'candidate'='employer')=>assert.rejects(hiringOperation(a,role,{type:'compare',...body}),(e:any)=>e instanceof HiringError&&e.status===status);
 await rejects({ids:[ids[0]]},400);await rejects({ids:[ids[0],-1]},400);await rejects({ids:ids.slice(0,4)},403,'candidate');
 const {rows:[company]}=await db.query('SELECT id FROM companies WHERE owner_id=$1',[id]);
 await db.query('INSERT INTO blocked_companies(candidate_id,company_id) VALUES($1,$2)',[ids[0],company.id]);
 await rejects({ids:ids.slice(0,4)},404);
 await db.query('DELETE FROM blocked_companies WHERE candidate_id=$1 AND company_id=$2',[ids[0],company.id]);
 await db.query("UPDATE candidate_profiles SET visible=false,payload=jsonb_set(payload,'{visible}','false') WHERE id=$1",[ids[1]]);
 await rejects({ids:ids.slice(0,4)},404);
 const foreignId=randomUUID(),foreign={...a,id:foreignId,scope:foreignId,email:`${foreignId}@example.test`};
 await createAccount(db,foreign,null,'Foreign QA');
 const {rows:[foreignProfile]}=await db.query('SELECT id FROM candidate_profiles WHERE user_id=$1',[foreignId]);
 await rejects({ids:[ids[2],foreignProfile.id]},404);
 console.log(JSON.stringify({passed:true,checks:9,candidates:25,features:['unlimited selection','deduplication and order','redacted contacts','minimum two','invalid ID','candidate role denied','blocked candidate denied','hidden candidate denied','foreign scope denied']}));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
