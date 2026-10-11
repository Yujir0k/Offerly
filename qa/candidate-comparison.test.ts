import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialState } from '../lib/model';
import { comparisonFields, visibleComparisonFields } from '../lib/candidate-comparison';
const profile = initialState().profile;
test('only differences compares skill sets without depending on order, case, or duplicates',()=>{
 const a={...profile,skills:['Python','SQL']},b={...profile,skills:['sql','Python','SQL']};
 assert.deepEqual(visibleComparisonFields([a,b],['skills'],true),[]);
 assert.equal(visibleComparisonFields([a,b],['skills'],false).length,1);
 assert.equal(visibleComparisonFields([a,{...b,skills:['Python']}],['skills'],true).length,1);
});
test('selected parameters and three-way differences compose without hiding a distinct third candidate',()=>{
 const a={...profile,salaryMin:100000,salaryMax:150000},b={...a},c={...a,salaryMin:120000};
 assert.deepEqual(visibleComparisonFields([a,b,c],['salary','city'],true).map(f=>f.id),['salary']);
 assert.deepEqual(visibleComparisonFields([a,b,c],['city'],true),[]);
 assert.deepEqual(visibleComparisonFields([a,b,c],['city'],false).map(f=>f.id),['city']);
});
test('empty preference arrays use the same fallback as candidate cards',()=>{
 const a={...profile,formats:[],format:'Удалённо'},b={...profile,formats:['Удалённо'],format:'Офис'};
 assert.deepEqual(visibleComparisonFields([a,b],['formats'],true),[]);
});
test('unconfirmed test scores and redacted contact fields stay explicit',()=>{
 const fields=Object.fromEntries(comparisonFields.map(f=>[f.id,f]));
 assert.equal(fields.score.value({...profile,grade:null,score:100}),'Нет подтверждённого результата');
 assert.equal(fields.contacts.value({...profile,email:'',phone:''}),'Закрыты до согласия');
 assert.equal(new Set(comparisonFields.map(f=>f.id)).size,comparisonFields.length);
});
