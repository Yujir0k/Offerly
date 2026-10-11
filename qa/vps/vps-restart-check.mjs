import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {call,state,save,dir,base,fixture} from './vps-client.mjs';
const users=JSON.parse(await readFile(dir+'/users.json'));
const registered=JSON.parse(await readFile(dir+'/ui-registration-users.json'));
const flow=JSON.parse(await readFile(dir+'/new-user-flow.json'));
const pdf=registered.find(u=>u.email.includes('ui-pdf-'));
const {token}=JSON.parse(await readFile(dir+'/restart-mcp.json'));
const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const result={states:[],conversations:[],pdf:null,mcp:null,baseline:null};
for(const u of [users.e,users.c,pdf]){
 const s=await state(u);result.states.push(hash({profile:s.profile,company:s.company,needs:s.needs,attempts:s.attempts,settings:s.settings}));
}
for(const [u,id]of [[users.e,users.flow.room],[pdf,flow.roomId]]){const t=await call(u,'/api/conversations/'+id);result.conversations.push(hash(t.messages.map(m=>({id:m.id,body:m.body,task:m.task}))));}
const r=await fetch(base+'/api/resume',{headers:{Cookie:pdf.cookie}});assert.equal(r.status,200);result.pdf=hash(Buffer.from(await r.arrayBuffer()));
result.mcp=hash((await call(users.e,'/api/mcp/settings',{action:'reveal'})).token);assert.equal(result.mcp,hash(token));
result.baseline=fixture({action:'baseline'});
assert.deepEqual(result.baseline,JSON.parse(await readFile(dir+'/baseline-before.json')));
if(process.argv[2]==='before')await save('restart-before.json',result);
else {assert.deepEqual(result,JSON.parse(await readFile(dir+'/restart-before.json')));await save('restart.json',{at:new Date().toISOString(),passed:['existing browser sessions survive app restart','profiles, companies, needs and results identical','messages and tasks identical','original PDF bytes identical','MCP encryption key and token persist','non-QA baseline unchanged']});}
console.log('Restart '+process.argv[2]+' passed');
