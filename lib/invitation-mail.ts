import "server-only";
import { getDb, type Database } from "@/db";
import { invitationMail, mailOrigin } from "./mail-templates";
import { mailConfigured, sendAccountMail, type AccountMail } from "./mail-transport";
import type { Invitation } from "./model";

// Enqueued in the same transaction as a newly created invitation. No backfill of old events.
export async function enqueueInvitationMail(db:Database, invitation:Invitation) {
  await db.query(`INSERT INTO invitation_mail_outbox(invitation_id,recipient_id)
    SELECT i.id,u.id FROM invitations i JOIN candidate_profiles p ON p.id=i.candidate_id
    JOIN users u ON u.id=p.user_id JOIN companies c ON c.id=i.company_id
    JOIN users employer ON employer.id=c.owner_id
    WHERE i.id=$1 AND i.status='sent' AND NOT u.demo AND NOT employer.demo
      AND u.deleted_at IS NULL AND employer.deleted_at IS NULL AND u.scope=c.scope
    ON CONFLICT(invitation_id) DO NOTHING`,[invitation.id]);
}
type Row = {invitation_id:string;recipient_id:string;attempts:number;lease_id:string};
export function invitationMailPolicy(row:{email:string;demo:boolean;verified_at:unknown;deleted_at:unknown;
  employer_demo:boolean;employer_deleted:unknown;scope:string;company_scope:string;status:string;
  blocked:boolean;preferences:any;created_at:Date|string}) {
  if(row.demo||row.employer_demo||row.deleted_at||row.employer_deleted||!row.verified_at||
      row.scope!==row.company_scope||row.blocked||!['sent','viewed'].includes(row.status)) return 'skip';
  if(!/^\S+@\S+\.\S+$/.test(row.email))return 'skip';
  // Showcase profiles are deliberately not real mail recipients.
  if(/@demo\.offerly\.test$/i.test(row.email) || (process.env.NODE_ENV==='production'&&
      /\.(test|invalid|example|localhost)$/i.test(row.email)))return 'skip';
  if(row.preferences?.settings?.emailInvitations===false)return 'skip';
  if(Date.now()-Date.parse(String(row.created_at))>7*86400000)return 'skip';
  const snooze=Date.parse(row.preferences?.settings?.snoozedUntil||'');
  return snooze>Date.now()?new Date(snooze):'send';
}
export async function drainInvitationMail(db:Database,send:(m:AccountMail,id:string)=>Promise<void>=sendAccountMail,limit=10) {
  let processed=0;
  for(let n=0;n<limit;n++){
    const lease=crypto.randomUUID();
    const {rows:[event]}=await db.query<Row>(`UPDATE invitation_mail_outbox SET status='processing',
      lease_id=$1,lease_until=now()+interval '3 minutes',attempts=attempts+1
      WHERE invitation_id=(SELECT invitation_id FROM invitation_mail_outbox
        WHERE (status='pending' OR (status='processing' AND lease_until<now()))
          AND next_attempt_at<=now() ORDER BY next_attempt_at,created_at
        FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[lease]);
    if(!event)break;
    processed++;
    try{
      const {rows:[target]}=await db.query(`SELECT u.email,u.demo,u.verified_at,u.deleted_at,u.scope,
        employer.demo AS employer_demo,employer.deleted_at AS employer_deleted,c.scope AS company_scope,
        i.status,i.payload AS invitation,a.payload AS preferences,o.created_at,
        EXISTS(SELECT 1 FROM blocked_companies bc WHERE bc.company_id=i.company_id AND bc.candidate_id=i.candidate_id) AS blocked
        FROM invitation_mail_outbox o JOIN invitations i ON i.id=o.invitation_id
        JOIN candidate_profiles p ON p.id=i.candidate_id JOIN users u ON u.id=p.user_id
        JOIN companies c ON c.id=i.company_id JOIN users employer ON employer.id=c.owner_id
        LEFT JOIN account_state a ON a.user_id=u.id WHERE o.invitation_id=$1 AND u.id=o.recipient_id`,[event.invitation_id]);
      const policy=target?invitationMailPolicy(target):'skip';
      if(policy instanceof Date){
        await db.query(`UPDATE invitation_mail_outbox SET status='pending',attempts=attempts-1,
          next_attempt_at=$3,lease_id=NULL,lease_until=NULL WHERE invitation_id=$1 AND lease_id=$2`,[event.invitation_id,lease,policy.toISOString()]);
        continue;
      }
      if(policy==='skip'){
        await db.query(`UPDATE invitation_mail_outbox SET status='skipped',lease_id=NULL,lease_until=NULL,
          last_error=NULL WHERE invitation_id=$1 AND lease_id=$2`,[event.invitation_id,lease]);
        continue;
      }
      const mail=invitationMail(target.email,target.invitation);
      mail.messageId=`<invitation-${event.invitation_id}@${new URL(mailOrigin()).hostname}>`;
      await send(mail,event.invitation_id);
      await db.query(`UPDATE invitation_mail_outbox SET status='sent',sent_at=now(),last_error=NULL,
        lease_id=NULL,lease_until=NULL WHERE invitation_id=$1 AND lease_id=$2`,[event.invitation_id,lease]);
    }catch(error){
      // Persist only a diagnostic class, never SMTP response contents, tokens, addresses or message body.
      const label=String((error as any)?.code||'DELIVERY_FAILED').replace(/[^A-Z0-9_]/g,'').slice(0,40)||'DELIVERY_FAILED';
      const delay=Math.min(3600,60*2**Math.min(event.attempts-1,6));
      await db.query(`UPDATE invitation_mail_outbox SET status=$3,last_error=$4,
        next_attempt_at=now()+($5*interval '1 second'),lease_id=NULL,lease_until=NULL
        WHERE invitation_id=$1 AND lease_id=$2`,[event.invitation_id,lease,event.attempts>=8?'failed':'pending',label,delay]);
      console.error('Invitation mail attempt failed:',label);
    }
  }
  return processed;
}
const globalMail=globalThis as typeof globalThis & {offerlyMailTimer?:ReturnType<typeof setInterval>;offerlyMailRunning?:boolean};
export function startInvitationMailWorker() {
  if(process.env.MAIL_WORKER_ENABLED==='false'||!mailConfigured()||globalMail.offerlyMailTimer)return;
  globalMail.offerlyMailTimer=setInterval(kickInvitationMail,30000);
  globalMail.offerlyMailTimer.unref();
  kickInvitationMail();
}
export function kickInvitationMail() {
  if(process.env.MAIL_WORKER_ENABLED==='false'||!mailConfigured()||globalMail.offerlyMailRunning)return;
  globalMail.offerlyMailRunning=true;
  void getDb().then(db=>drainInvitationMail(db)).catch(()=>{
    console.error('Invitation mail queue unavailable');
  }).finally(()=>{globalMail.offerlyMailRunning=false;});
}
