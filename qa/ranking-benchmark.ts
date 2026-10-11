import {readFile,writeFile} from 'node:fs/promises';
import {initialState,rank,type Profile,type Need} from '../lib/model';
const fixture=JSON.parse(await readFile(new URL('./2026-10-10-mvp-expansion/ranking-fixtures.json',import.meta.url),'utf8'));
const base=initialState().profile,reports:any[]=[];
function metrics(rows:any[],ideal:any[]){const dcg=(r:any[])=>r.slice(0,5).reduce((v,p,i)=>v+(2**p.relevance-1)/Math.log2(i+2),0);return {precisionAt5:rows.slice(0,5).filter(p=>p.relevance===3).length/5,nDCGAt5:dcg(rows)/dcg(ideal)};}
for(const [specialty,...skills] of fixture.tracks)for(const grade of fixture.grades){
 const need:Need={id:'benchmark',title:'Синтетическая потребность',specialty,grade,skills,description:'',min:100000,max:200000,format:'Удалённо'};
 const rows=fixture.cases.map((v:any,i:number)=>{const p:Profile={...base,id:i+1,specialty:v.sameCategory?specialty:'Other',grade,skills:v.declared.map((k:number)=>skills[k]),verified:v.verified.map((k:number)=>skills[k]),score:v.testScore,fsp:null,achievements:[]};return {key:v.key,relevance:v.relevance,p};});
 const ideal=[...rows].sort((a,b)=>b.relevance-a.relevance);
 const ranked=[...rows].sort((a,b)=>rank(b.p,need).score-rank(a.p,need).score||a.p.id-b.p.id);
 const baseline=[...rows].sort((a,b)=>b.p.score-a.p.score||a.p.id-b.p.id);
 reports.push({specialty,grade,rank:metrics(ranked,ideal),baseline:metrics(baseline,ideal),top5:ranked.slice(0,5).map(p=>p.key)});
}
const avg=(key:'rank'|'baseline',metric:string)=>reports.reduce((s,r)=>s+r[key][metric],0)/reports.length;
const result={fixtureVersion:fixture.version,provenance:fixture.provenance,queries:reports.length,pairs:reports.length*fixture.cases.length,metrics:{rank:{precisionAt5:avg('rank','precisionAt5'),nDCGAt5:avg('rank','nDCGAt5')},baseline:{precisionAt5:avg('baseline','precisionAt5'),nDCGAt5:avg('baseline','nDCGAt5')}},baselineDefinition:'Сортировка только по результату теста; без категории и стека.',limitations:['Рубрика авторская синтетическая. Не внешняя независимая экспертная валидация.','Формальный тест оценивает категорию, не автоматически все технологии профиля.','Метрики не доказывают качество найма или точность на реальных людях.'],reports};
await writeFile(new URL('./2026-10-10-mvp-expansion/ranking-result.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,reports:undefined},null,2));
