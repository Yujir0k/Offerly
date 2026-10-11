// Maintenance-only fixture control. Never install as an HTTP route.
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import {gzipSync} from 'node:zlib';
let text = '';
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);
const prefix = process.env.VPS_QA_PREFIX;
if (!/^vps-qa-\d{8}-\d+-$/.test(prefix || '')) throw Error('Explicit disposable QA prefix required');
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  if (input.action === 'baseline') {
    const excluded = input.excludeUserIds || [];
    for (const id of excluded) {
      const {rows:[row]}=await db.query("SELECT 1 FROM users WHERE id=$1 AND email=$2 AND deleted_at IS NOT NULL AND created_at>='2026-10-10 22:11:00+00'",[id,`deleted-${id}@invalid.example`]);
      if(!row)throw Error('Only explicitly recorded deleted QA accounts may be excluded');
    }
    const queries = {
      profiles: 'SELECT p.* FROM candidate_profiles p JOIN users u ON u.id=p.user_id WHERE u.email NOT LIKE $1 ORDER BY p.id',
      companies: 'SELECT c.* FROM companies c JOIN users u ON u.id=c.owner_id WHERE u.email NOT LIKE $1 ORDER BY c.id',
      jobs: 'SELECT j.* FROM jobs j JOIN companies c ON c.id=j.company_id JOIN users u ON u.id=c.owner_id WHERE u.email NOT LIKE $1 ORDER BY j.id',
      needs: 'SELECT n.* FROM needs n JOIN companies c ON c.id=n.company_id JOIN users u ON u.id=c.owner_id WHERE u.email NOT LIKE $1 ORDER BY n.id',
      invitations: 'SELECT i.* FROM invitations i JOIN companies c ON c.id=i.company_id JOIN users u ON u.id=c.owner_id WHERE u.email NOT LIKE $1 ORDER BY i.id',
      messages: 'SELECT m.* FROM conversation_messages m JOIN users u ON u.id=m.sender_id WHERE u.email NOT LIKE $1 ORDER BY m.id',
    };
    const result = {};
    for (const [name, sql] of Object.entries(queries)) {
      const { rows } = await db.query(sql.replace('u.email NOT LIKE $1','u.email NOT LIKE $1 AND u.id <> ALL($2::text[])'), [prefix + '%',excluded]);
      result[name] = { rows: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
    }
    console.log(JSON.stringify(result));
  } else if(input.action==='hide-qa-data') {
    // Retain evidence and accounts; only this run's synthetic listings leave public search.
    const profiles=await db.query("UPDATE candidate_profiles p SET visible=false,payload=jsonb_set(p.payload,'{visible}','false'::jsonb) FROM users u WHERE u.id=p.user_id AND u.email LIKE $1 RETURNING p.id",[prefix+'%']);
    const jobs=await db.query("UPDATE jobs j SET status='archived',payload=jsonb_set(j.payload,'{status}','\"archived\"'::jsonb) FROM companies c JOIN users u ON u.id=c.owner_id WHERE j.company_id=c.id AND u.email LIKE $1 AND j.status='published' RETURNING j.id",[prefix+'%']);
    console.log(JSON.stringify({hiddenProfiles:profiles.rowCount,archivedJobs:jobs.rowCount}));
  } else {
    if (typeof input.email !== 'string' || !input.email.startsWith(prefix) || !input.email.endsWith('@example.test')) throw Error('Only this run’s disposable QA accounts');
    const { rows: [user] } = await db.query('SELECT id FROM users WHERE email=$1 AND deleted_at IS NULL', [input.email]);
    if (!user) throw Error('QA account not found');
    if (input.action === 'verify-email') {
      // A fixture setup, NOT a claim of successful real email delivery.
      await db.query('UPDATE users SET verified_at=now() WHERE id=$1', [user.id]);
      console.log(JSON.stringify({ fixtureVerified: true }));
    } else if (['assessment-raw', 'assessment-expire'].includes(input.action)) {
      if (input.action === 'assessment-expire') await db.query("UPDATE professional_assessment_records SET body=jsonb_set(body,'{deadlineAt}',to_jsonb($3::text)) WHERE user_id=$1 AND id=$2 AND collection='adaptive-sessions'", [user.id, input.id, new Date(Date.now() - 1000).toISOString()]);
      const { rows: [row] } = await db.query("SELECT body FROM professional_assessment_records WHERE user_id=$1 AND id=$2 AND collection='adaptive-sessions'", [user.id, input.id]);
      if (!row) throw Error('Owned QA session not found');
      console.log(JSON.stringify({gzip:gzipSync(JSON.stringify(row.body)).toString('base64')}));
    } else throw Error('Unknown fixture action');
  }
} finally { await db.end(); }
