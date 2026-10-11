import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(),'offerly-polish-'));
try {
  for(const name of ['phone','profile-options','vacancy-search','model']) await build({entryPoints:[`lib/${name}.ts`],bundle:true,platform:'node',format:'esm',outfile:join(dir,`${name}.mjs`)});
  const {formatPhone,phoneError}=await import(join(dir,'phone.mjs'));
  assert.equal(formatPhone('89991234567'),'+7 (999) 123-45-67');
  assert.equal(formatPhone('999123456789999999999'),'+7 (999) 123-45-67');
  assert.equal(formatPhone('+77777777777777777777').replace(/\D/g,''),'77777777777');
  assert.equal(formatPhone('+14155552671'),'+14155552671');
  assert.equal(formatPhone('+123456789012345999999').length,16);
  assert(phoneError('+77777777777777777777'));
  assert(phoneError('+7 (999)'));
  assert.equal(phoneError('+7 (999) 123-45-67'),'');
  const {initialState}=await import(join(dir,'model.mjs'));
  const {withWorkPreferences,editWorkPreference,professionalDirection,profileGrades}=await import(join(dir,'profile-options.mjs'));
  let profile=withWorkPreferences(initialState().profile);
  profile=editWorkPreference(profile,'availabilities',['Сразу','Обсудим индивидуально']);
  assert.equal(profile.availability,'Сразу · Обсудим индивидуально');
  assert.deepEqual(withWorkPreferences({...profile,availabilities:undefined}).availabilities,['Сразу','Обсудим индивидуально']);
  assert.equal(professionalDirection({...profile,professionalDirection:''}),'');
  assert.equal(profileGrades.length,5);
  const {searchVacancies,emptyVacancyFilters}=await import(join(dir,'vacancy-search.mjs'));
  const state=initialState(),companies=[state.jobs[0].company,state.jobs.find(job=>job.company!==state.jobs[0].company).company];
  const expected=state.jobs.filter(job=>companies.includes(job.company));
  assert.equal(searchVacancies(state.jobs,{...emptyVacancyFilters,companies},state.profile,[]).length,expected.length);
  assert.equal(searchVacancies(state.jobs,{...emptyVacancyFilters,companies,excludeCompany:true},state.profile,[]).length,state.jobs.length-expected.length);
  const base='http://127.0.0.1:5174';
  const request=(path,options={})=>fetch(base+path,{...options,headers:{Cookie:'__sites_local_auth=1',Origin:base,...options.headers}});
  let saved=await (await request('/api/state?role=candidate')).json();
  const save=async(extra)=>request('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'profile',role:'candidate',version:saved.version,...saved.profile,...extra})});
  for(const extra of [{experience:51},{experience:-1},{phone:'+77777777777777777777'}]) {
    const response=await save(extra); assert.equal(response.status,400,JSON.stringify(extra));
  }
  for(const claimed of ['Intern','Lead']) {
    const response=await save({claimed,phone:'89991234567',experience:50,professionalDirection:'',availabilities:['Сразу','Обсудим индивидуально']});
    const body=await response.json(); assert.equal(response.status,200,JSON.stringify(body.error)); saved=body;
    assert.equal(saved.profile.claimed,claimed); assert.equal(saved.profile.phone,'+7 (999) 123-45-67');
    assert.equal(saved.profile.professionalDirection,''); assert.equal(saved.profile.availabilities.length,2);
  }
  console.log('Phone formatting/limits, empty IT direction, five grades, availability migration, multiple-company OR/exclusion and isolated API validation passed.');
} finally {await rm(dir,{recursive:true,force:true});}
