// QA ONLY: copy into an isolated localhost test app, never the main app/api.
import {currentAccount,digest} from '@/lib/auth';
import {query} from '@/db';
export async function POST(request:Request){
 if(process.env.NODE_ENV==='production' || process.env.ENABLE_ASSESSMENT_QA!=='true' || !['localhost','127.0.0.1'].includes(new URL(request.url).hostname))return new Response('',{status:404});
 const a=await currentAccount();if(!a?.email.startsWith('session-qa-'))return new Response('',{status:403});
 const b=await request.json();
 if(b.action==='reset-start-throttle')await query('DELETE FROM auth_throttles WHERE key=$1',[digest('professional-start:'+a.id)]);
 if(b.action==='old-device')await query("UPDATE sessions SET device_name='Неизвестное устройство' WHERE user_id=$1",[a.id]);
 if(b.action==='expire')await query("UPDATE professional_assessment_records SET body=jsonb_set(body,'{deadlineAt}',to_jsonb($3::text)) WHERE user_id=$1 AND id=$2 AND collection='adaptive-sessions'",[a.id,b.id,new Date(Date.now()-1000).toISOString()]);
 if(b.action==='chat-member') {
  if(!['viewer','recruiter','remove'].includes(b.role)) return new Response('',{status:400});
  const {rows:[target]}=await query("SELECT id FROM users WHERE id=$1 AND email LIKE 'session-qa-%' AND scope=$2 AND deleted_at IS NULL",[b.userId,a.scope]);
  const {rows:[company]}=await query("SELECT id FROM companies WHERE id=$1 AND owner_id=$2",[b.companyId,a.id]);
  if(!target||!company) return new Response('',{status:403});
  if(b.role==='remove') await query("DELETE FROM company_memberships WHERE company_id=$1 AND user_id=$2",[company.id,target.id]);
  else await query("INSERT INTO company_memberships(company_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(company_id,user_id) DO UPDATE SET role=excluded.role",[company.id,target.id,b.role]);
 }
 const {rows:[r]}=await query("SELECT body FROM professional_assessment_records WHERE user_id=$1 AND id=$2 AND collection='adaptive-sessions'",[a.id,b.id]);
 return Response.json(r?.body||null);
}
