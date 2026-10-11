import{readFile}from'node:fs/promises';import assert from'node:assert/strict';import{getDb}from'../db';import{accountById,loadPlatform}from'../lib/platform';import{bucket}from'../lib/file-storage';
const legacy=JSON.parse(await readFile(process.argv[2],'utf8'));const{owner,state}=legacy.workspaces[0];const account=await accountById(owner);assert(account);const s=await loadPlatform(account);
for(const field of['name','email','phone','city','resumeKey','avatarKey','skills','roles','bio','education','projects']as const)assert.deepEqual(s.profile[field],state.profile[field],field);
assert.equal(s.company.name,state.company.name);assert.equal(s.jobs.length,state.jobs.length);assert.equal(s.invitations.length,state.invitations.length);
const{rows:[count]}=await(await getDb()).query('SELECT count(*)::int AS n FROM drafts WHERE user_id=$1',[owner]);assert.equal(count.n,legacy.drafts.length);
for(const key of[s.profile.avatarKey,s.profile.resumeKey,...(s.company.media||[]).map(m=>m.key)].filter(Boolean)){const file=await bucket.get(key!);assert(file&&file.size>0,'Imported file missing');}
console.log(JSON.stringify({profileFieldsPreserved:true,companyPreserved:true,jobs:s.jobs.length,invitations:s.invitations.length,drafts:count.n,linkedFilesAvailable:true}));process.exit(0);
