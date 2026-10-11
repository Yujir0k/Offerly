import {test,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import type {Database} from '../db';
import {codeMail,invitationMail,passwordChangedMail} from '../lib/mail-templates';
import {enqueueInvitationMail,drainInvitationMail} from '../lib/invitation-mail';
import {workspaceReturnTo} from '../lib/login-return';
import {createAccount,loadPlatform,savePlatform,type Account} from '../lib/platform';
import type {Invitation} from '../lib/model';
process.env.APP_URL='https://opherly.ru';
process.env.MAIL_WORKER_ENABLED='false';
const pg=new PGlite();
for(const f of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')).sort())await pg.exec(await readFile('db/migrations/'+f,'utf8'));
const wrap=(c:any):Database=>({query:(sql,p=[])=>c.query(sql,p),transaction:fn=>pg.transaction(tx=>fn(wrap(tx)))});
const db=wrap(pg);(globalThis as any).offerlyDb=Promise.resolve(db);
after(async()=>{delete (globalThis as any).offerlyDb;await pg.close()});
const account=(id:string):Account=>({id,email:id+'@example.test',name:'Почтовая проверка',scope:'mail-tests',demo:false,verified_at:new Date().toISOString(),deleted_at:null});
const employer=account('mail-employer'),recipient=account('mail-candidate');
for(const u of [employer,recipient])await createAccount(db,u,null);
const ep=(await loadPlatform(employer)).company.id,cp=(await loadPlatform(recipient)).profile.id;
await db.query('UPDATE users SET verified_at=now() WHERE id=ANY($1::text[])',[[employer.id,recipient.id]]);
const sample:Invitation={id:'sample',candidateId:cp,companyId:ep,title:'Backend <script>alert(1)</script>',company:'Орбита & <img src=x>',description:'Private description',contact:'private@example.test',min:150000,max:200000,status:'sent',createdAt:new Date().toISOString(),format:'Удалённо',city:'Москва',skills:['Python','SQL'],grade:'Junior'};
beforeEach(async()=>{await db.query('DELETE FROM invitations');});
async function queue(id:string){await db.query("UPDATE invitations SET status='cancelled'");const i={...sample,id};await db.query('INSERT INTO invitations(id,company_id,candidate_id,status,min_salary,max_salary,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,ep,cp,i.status,i.min,i.max,JSON.stringify(i)]);await enqueueInvitationMail(db,i);return i;}
async function count(id:string){return (await db.query('SELECT * FROM invitation_mail_outbox WHERE invitation_id=$1',[id])).rows[0]}
test('all security mails share the chosen signature template, literal OTP, HTML logo without images or attachments and text alternative',()=>{
 for(const kind of ['verify','change-old','change-new','recovery'] as const){const m=codeMail(kind,'own@example.test','654321');assert.match(m.html as string,/#F3F1F8/);assert.match(m.html as string,/aria-hidden="true" width="40" height="40"/);assert(!m.html?.toString().includes("<img"));assert.match(m.html as string,/>654321<\/div>/);assert.match(m.text,/654321/);assert.equal((m.headers as any)['X-Offerly-Template'],'signature-v1/'+kind);assert.equal(m.attachments,undefined);assert(!m.html?.toString().includes('<script'));assert(!m.html?.toString().includes('483921'));}
 assert.throws(()=>codeMail('verify','x@example.test','<x>'));
 assert.match(passwordChangedMail('x@example.test').html as string,/Пароль обновлён/);
});
test('invitation uses actual escaped data, no private contact, correct salary and authenticated deep link',()=>{
 const m=invitationMail('own@example.test',sample);assert.match(m.html as string,/&lt;script&gt;/);assert.match(m.html as string,/Орбита &amp; &lt;img/);assert.match(m.html as string,/150 000 — 200 000 ₽/);assert.match(m.html as string,/https:\/\/opherly.ru\/demo\/candidate\/invitations\?invitation=sample/);assert(!m.html?.toString().includes('<script>'));assert(!m.text.includes(sample.contact));assert(!m.text.includes(sample.description));
 assert.equal(workspaceReturnTo('/demo/candidate/invitations?invitation=sample','candidate'),'/demo/candidate/invitations?invitation=sample');
 for(const bad of ['https://evil.test/demo/candidate/invitations','//evil.test','/demo/employer/messages','/demo/candidate/../../login','\\evil.test'])assert.equal(workspaceReturnTo(bad,'candidate'),'/demo/candidate/overview');
});
test('invitation and mail event are atomic on rollback',async()=>{
 const s=await loadPlatform(employer);s.invitations.push({...sample,id:'rollback-mail'});s.favoriteJobs.push('nonexistent');await assert.rejects(savePlatform(employer.id,s));assert.equal((await db.query("SELECT id FROM invitations WHERE id='rollback-mail'")).rows.length,0);assert.equal(await count('rollback-mail'),undefined);
});
test('concurrent workers claim an event once; persisted state prevents another delivery',async()=>{
 const i=await queue('single');await enqueueInvitationMail(db,i);let sent=0;const send=async(m:any)=>{sent++;assert.equal(m.to,recipient.email);assert.match(m.messageId,/invitation-single/)};
 await Promise.all([drainInvitationMail(db,send),drainInvitationMail(db,send)]);assert.equal(sent,1);assert.equal((await count(i.id)).status,'sent');await drainInvitationMail(db,send);assert.equal(sent,1);
});
test('failed SMTP leaves invitation intact and retries successfully',async()=>{
 await queue('retry');await drainInvitationMail(db,async()=>{throw Object.assign(new Error('address/secret must not be logged'),{code:'ECONNECTION'})});const r=await count('retry');assert.equal(r.status,'pending');assert.equal(r.last_error,'ECONNECTION');assert.equal(r.attempts,1);assert((await db.query("SELECT id FROM invitations WHERE id='retry'")).rows.length);
 await db.query("UPDATE invitation_mail_outbox SET next_attempt_at=now() WHERE invitation_id='retry'");let sent=0;await drainInvitationMail(db,async()=>{sent++});assert.equal(sent,1);assert.equal((await count('retry')).status,'sent');
});
test('cancelled, blocked, unverified, deleted, opted out and foreign scope recipients receive no mail',async()=>{
 const changes=[
  ["UPDATE invitations SET status='cancelled' WHERE id=$1",[],"UPDATE invitations SET status='sent' WHERE id=$1"],
  ['INSERT INTO blocked_companies(candidate_id,company_id) VALUES($1,$2)',[cp,ep],'DELETE FROM blocked_companies WHERE candidate_id=$1 AND company_id=$2'],
  ["UPDATE users SET verified_at=NULL WHERE id=$1",[recipient.id],"UPDATE users SET verified_at=now() WHERE id=$1"],
  ["UPDATE users SET deleted_at=now() WHERE id=$1",[recipient.id],"UPDATE users SET deleted_at=NULL WHERE id=$1"],
  [`UPDATE account_state SET payload='{"settings":{"emailInvitations":false}}' WHERE user_id=$1`,[recipient.id],"UPDATE account_state SET payload='{}' WHERE user_id=$1"],
  ["UPDATE users SET scope='foreign-mail' WHERE id=$1",[recipient.id],"UPDATE users SET scope='mail-tests' WHERE id=$1"],
 ] as const;
 let sent=0;
 for(let n=0;n<changes.length;n++){const id='suppressed-'+n;await queue(id);const [change,args,restore]=changes[n];const params=args.length?[...args]:[id];await db.query(change,params);await drainInvitationMail(db,async()=>{sent++});assert.equal((await count(id)).status,'skipped');await db.query(restore,params);}
 assert.equal(sent,0);
});
test('email snooze delays without consuming attempts; lease survives restart and is reclaimed',async()=>{
 await queue('snoozed');await db.query('UPDATE account_state SET payload=$2 WHERE user_id=$1',[recipient.id,JSON.stringify({settings:{snoozedUntil:new Date(Date.now()+60000).toISOString()}})]);let sent=0;await drainInvitationMail(db,async()=>{sent++});assert.equal(sent,0);assert.equal((await count('snoozed')).status,'pending');assert.equal((await count('snoozed')).attempts,0);await db.query("UPDATE account_state SET payload='{}' WHERE user_id=$1",[recipient.id]);await db.query("UPDATE invitation_mail_outbox SET status='processing',lease_until=now()-interval '1 second',next_attempt_at=now() WHERE invitation_id='snoozed'");await drainInvitationMail(db,async()=>{sent++});assert.equal(sent,1);
});
test('creation through platform queues one event; editing or candidate read does not enqueue another',async()=>{
 const s=await loadPlatform(employer);s.invitations.push({...sample,id:'platform-mail'});await savePlatform(employer.id,s);assert.equal((await count('platform-mail')).status,'pending');
 const fresh=await loadPlatform(employer);const x=fresh.invitations.find(i=>i.id==='platform-mail')!;x.title='Updated conditions';x.updatedAt=new Date().toISOString();await savePlatform(employer.id,fresh);assert.equal((await db.query("SELECT * FROM invitation_mail_outbox WHERE invitation_id='platform-mail'")).rows.length,1);let sent=0;await drainInvitationMail(db,async m=>{sent++;assert.match(m.text,/Updated conditions/)});assert.equal(sent,1);
});
