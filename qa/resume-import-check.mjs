import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {getDocumentProxy,extractTextItems} from 'unpdf';
const root=await mkdtemp(join(tmpdir(),'offerly-import-check-'));
try {
 await build({entryPoints:['lib/resume-parser.ts'],bundle:true,platform:'node',format:'esm',outfile:join(root,'parser.mjs')});
 const {parseResume,resumeLayoutText}=await import(join(root,'parser.mjs'));
 const run=text=>parseResume(text);
 let p=run('Имя и фамилия: Тестовый Кандидат\nНавыки: JavaScript, PostgreSQL, Custom ML toolkit\nОбразование\nУчебный университет\nЗаметки:\nПервая строка\nВторая строка');
 assert.deepEqual(p.skills,['JavaScript','PostgreSQL','Custom ML toolkit']);
 assert(!p.skills.includes('Java')&&!p.skills.includes('Go')&&!p.skills.includes('SQL'));
 assert(p.notes.includes('Вторая строка'));assert.equal(p.education,'Учебный университет');
 p=run('Full name: Jane Example\nML engineer\nCity: Обнинск\nSkills\nPython SQL FastAPI\nUnlisted ML Toolkit\nEducation:\n2027 — Demo University\nApplied mathematics\nLanguages:\nEnglish — C1\nNotes:\nAvailable for research\nOpen source contributions');
 assert(p.skills.includes('Python')&&p.skills.includes('SQL')&&p.skills.includes('FastAPI')&&p.skills.includes('Unlisted ML Toolkit'));
 assert.equal(p.city,'Обнинск');assert.equal(p.roles[0],'ML engineer');assert(p.education.includes('Applied mathematics'));assert(p.notes.includes('Open source contributions'));
 p=run('Обо мне:\nПишу на Python.\nБез коммерческого опыта.\nНавыки: Python');assert(p.bio.includes('Без коммерческого опыта'));assert.equal(p.experience,undefined);
 if(process.argv[2]) {
  const doc=await getDocumentProxy(new Uint8Array(await readFile(process.argv[2])));const {items}=await extractTextItems(doc);p=parseResume(resumeLayoutText(items));
  assert.equal(p.city,'Москва');assert.equal(p.skills.length,30);assert(!p.skills.includes('Go'));assert(p.skills.includes('CatBoost')&&p.skills.includes('OpenCV')&&p.skills.includes('Apache Airflow'));
  assert.equal(p.roles[0],'ML-инженер');assert(p.education.includes('2027')&&p.education.includes('Финансовый университет'));assert.equal(p.languages.length,2);assert(p.projects.includes('OmniSub'));assert(p.bio.length>450);assert.equal(p.workHistory,undefined);assert.equal(p.salaryMin,undefined);await doc.cleanup();
 }
 console.log('PASS: skill boundaries, unknown skills, space lists, multi-line notes/education, role/city, original HH résumé when supplied.');
} finally {await rm(root,{recursive:true,force:true});}
