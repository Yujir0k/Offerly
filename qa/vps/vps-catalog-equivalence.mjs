import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
assert.equal(process.env.CAPACITY_ALLOW_PRODUCTION, 'opherly.ru');
const dir = process.env.CAPACITY_PRIVATE_DIR;
assert(dir && path.isAbsolute(dir));
const users = JSON.parse(await readFile(path.join(dir, 'targets.json'), 'utf8'));
const checks = [
  ...[{}, {query:'Python'}, {skills:['Python']}, {spec:'Backend',grade:'Junior'},
    {sort:'По результату теста'}, {sort:'По зарплате'}, {sort:'По дате подтверждения'},
    {sort:'По достижениям ФСП'}, {fsp:true}, {task:'product',mode:'test'},
    {salaryMin:'120000',salaryMax:'200000',formats:['Удалённо']}, {savedOnly:true}]
    .flatMap(filters=>[1,2].map(page=>({kind:'candidates',role:'employer',filters,page}))),
  ...[{}, {query:'Python'}, {sort:'date'}, {sort:'salary-desc'}, {sort:'salary-asc'},
    {specialty:'Backend',grade:'Junior'}, {salaryMin:'150000'}, {favoritesOnly:true}]
    .flatMap(filters=>[1,2].map(page=>({kind:'jobs',role:'candidate',filters,page}))),
];
const results = [];
for(const check of checks) {
  const u=users.find(u=>u.role===check.role);
  const q=new URLSearchParams({role:check.role,filters:JSON.stringify(check.filters),page:String(check.page)});
  const r=await fetch('https://opherly.ru/api/catalog/'+check.kind+'?'+q,{headers:{Cookie:u.cookie},signal:AbortSignal.timeout(10000)});
  assert.equal(r.status,200);
  const b=await r.json();
  if(!Object.keys(check.filters).length) assert(b.total>0);
  results.push({...check,total:b.total,hash:createHash('sha256').update(JSON.stringify(b)).digest('hex')});
}
const file=path.join(dir,'catalog-baseline.json');
if(process.env.CATALOG_COMPARE==='true') assert.deepEqual(results,JSON.parse(await readFile(file,'utf8')));
else await writeFile(file,JSON.stringify(results,null,2),{mode:0o600});
console.log(JSON.stringify({checks:results.length,mode:process.env.CATALOG_COMPARE==='true'?'compare':'capture',passed:true}));
