// Run inside the app container against the live DB and an independent restored DB.
import {Client} from 'pg';
import {createHash} from 'node:crypto';
const target=new URL(process.env.DATABASE_URL);target.pathname='/offerly_restore_final_20261011';
const a=new Client({connectionString:process.env.DATABASE_URL}),b=new Client({connectionString:target.toString()});
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const digest=rows=>createHash('sha256').update(rows.map(r=>JSON.stringify(canon(r.row))).sort().join('\n')).digest('hex');
await a.connect();await b.connect();
try{
 await a.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await b.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const tables=(await a.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
 const rows=[];
 for(const {tablename}of tables){
  if(!/^[a-z_]+$/.test(tablename))throw Error('Invalid table');
  const [x,y]=await Promise.all([a.query(`SELECT to_jsonb(t) AS row FROM "${tablename}" t`),b.query(`SELECT to_jsonb(t) AS row FROM "${tablename}" t`)]);
  const matches=digest(x.rows)===digest(y.rows),volatile=['auth_throttles','sessions'].includes(tablename);
  if(!matches&&!volatile)throw Error('Restored data differs: '+tablename);
  rows.push({table:tablename,liveRows:x.rows.length,restoredRows:y.rows.length,exactMatch:matches,volatile});
 }
 console.log(JSON.stringify({at:new Date().toISOString(),restoredDatabase:'offerly_restore_final_20261011',tables:rows,passed:true}));
}finally{await a.end();await b.end();}
