// Operator command. Dry-run by default. Production PostgreSQL only.
import {Pool} from 'pg';
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required; do not open a live PGlite directory in a second process');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
const apply=process.argv.includes('--apply');
const rules=[['sessions',"expires_at < now()-interval '1 day'"],['email_challenges',"expires_at < now()-interval '1 day'"],['email_change_flows',"expires_at < now()-interval '1 day'"],['password_reset_flows',"expires_at < now()-interval '1 day'"],['oidc_flows',"expires_at < now()-interval '1 day'"],['auth_throttles',"reset_at < now()-interval '1 day'"]];
const db=await pool.connect();
try{await db.query('BEGIN');for(const [table,where] of rules){const {rows:[r]}=await db.query(`SELECT count(*)::integer AS count FROM ${table} WHERE ${where}`);if(apply)await db.query(`DELETE FROM ${table} WHERE ${where}`);console.log(JSON.stringify({table,expired:r.count,mode:apply?'apply':'dry-run'}));}await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();await pool.end();}
