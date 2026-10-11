import { randomUUID } from 'node:crypto';
import { eligibleCandidate } from './catalog';
import { salaryRangeError } from './salary-range';
import { loadPlatform } from './platform';
import { clientState } from './store';
import type { Invitation, Profile } from './model';
import type { McpContext } from './mcp-auth';
import { McpError } from './mcp-policy';
import { showcaseEnabled } from './showcase-policy';

export type McpInvitationDraft = {
  id: string; candidate_id: number; status: 'draft' | 'sent' | 'deleted'; invitation_id: string | null;
  payload: { candidateId: number; title: string; description: string; min: number; max: number };
  created_at: string;
};

/** HR sees only their company's own unsent drafts; paused/deleted candidates cannot be approved. */
export async function listMcpDrafts(context: McpContext) {
  const { rows } = await context.db.query<McpInvitationDraft & { available: boolean }>(
    `SELECT d.id,d.candidate_id,d.status,d.invitation_id,d.payload,d.created_at,
     EXISTS(SELECT 1 FROM candidate_profiles p JOIN users u ON u.id=p.user_id WHERE p.id=d.candidate_id AND u.scope=$3 AND (NOT $4::boolean OR u.demo) AND u.deleted_at IS NULL AND p.user_id<>$1 AND ${eligibleCandidate}
       AND NOT EXISTS(SELECT 1 FROM blocked_companies bc WHERE bc.candidate_id=p.id AND bc.company_id=$2)
       ${showcaseEnabled() ? '' : "AND coalesce((p.payload->>'demonstration')::boolean,false)=false"}) AS available
     FROM mcp_invitation_drafts d WHERE d.user_id=$1 AND d.company_id=$2 AND d.status='draft' ORDER BY d.created_at DESC LIMIT 100`,
    [context.account.id, context.companyId, context.account.scope, context.account.demo]);
  return rows;
}

/** Approval is atomic and browser-only; an agent credential never reaches this function. */
export async function decideMcpDraft(context: McpContext, id: string, decision: 'approve' | 'delete') {
  await context.db.transaction(async db => {
    const { rows: [draft] } = await db.query<McpInvitationDraft>('SELECT * FROM mcp_invitation_drafts WHERE id=$1 AND user_id=$2 AND company_id=$3 FOR UPDATE', [id, context.account.id, context.companyId]);
    if (!draft) throw new McpError('Черновик недоступен.', 404);
    if (draft.status === 'sent' && decision === 'approve') return;
    if (draft.status === 'deleted' && decision === 'delete') return;
    if (draft.status !== 'draft') throw new McpError('Черновик уже обработан.', 409);
    if (decision === 'delete') { await db.query("UPDATE mcp_invitation_drafts SET status='deleted' WHERE id=$1", [id]); return; }
    const { rows: [candidate] } = await db.query<{ payload: Profile }>(
      `SELECT p.payload FROM candidate_profiles p JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND u.scope=$2 AND (NOT $4::boolean OR u.demo) AND u.deleted_at IS NULL AND p.user_id<>$3 AND ${eligibleCandidate}
       AND NOT EXISTS(SELECT 1 FROM blocked_companies bc WHERE bc.candidate_id=p.id AND bc.company_id=$5)
       ${showcaseEnabled() ? '' : "AND coalesce((p.payload->>'demonstration')::boolean,false)=false"} FOR UPDATE OF p`,
      [draft.candidate_id, context.account.scope, context.account.id, context.account.demo, context.companyId]);
    if (!candidate) throw new McpError('Кандидат больше недоступен.', 409);
    const { rows: [company] } = await db.query<{ payload: { name: string; description: string; email: string } }>('SELECT payload FROM companies WHERE id=$1 FOR UPDATE', [context.companyId]);
    if (!company?.payload.name || !company.payload.description || !company.payload.email) throw new McpError('Заполните название, описание и контакт компании.');
    const error = salaryRangeError(draft.payload.min, draft.payload.max);
    if (error) throw new McpError(error);
    const pending = await db.query("SELECT id FROM invitations WHERE company_id=$1 AND candidate_id=$2 AND status IN ('sent','viewed')", [context.companyId, draft.candidate_id]);
    if (pending.rows.length) throw new McpError('Кандидату уже отправлено приглашение.', 409);
    const invitation: Invitation = { ...draft.payload, id: randomUUID(), candidateId: draft.candidate_id,
      company: company.payload.name, companyId: context.companyId, contact: company.payload.email, status: 'sent', createdAt: new Date().toISOString() };
    await db.query('INSERT INTO invitations(id,company_id,candidate_id,status,min_salary,max_salary,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [invitation.id, context.companyId, draft.candidate_id, 'sent', invitation.min, invitation.max, JSON.stringify(invitation)]);
    await db.query("UPDATE mcp_invitation_drafts SET status='sent',invitation_id=$2 WHERE id=$1", [id, invitation.id]);
  });
  return clientState(await loadPlatform(context.account), 'employer');
}
