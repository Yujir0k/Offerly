import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {getDocumentProxy,extractTextItems} from 'unpdf';
import assert from 'node:assert/strict';
await build({entryPoints:['lib/profile-pdf.ts'],bundle:true,platform:'node',format:'esm',outfile:'tmp/pdfs/modules/profile-pdf.js',external:['jspdf']});
const {createProfilePdf}=await import('../tmp/pdfs/modules/profile-pdf.js');
const p=JSON.parse(await readFile('tmp/pdfs/profile-fixture.json','utf8'));
const assets={regular:(await readFile('public/fonts/Manrope-Regular.ttf')).toString('base64'),bold:(await readFile('public/fonts/Manrope-Bold.ttf')).toString('base64'),photo:(await readFile('tmp/pdfs/portrait.png')).toString('base64'),logo:(await readFile('tmp/pdfs/logo.png')).toString('base64')};
for(const template of ['accent','minimal']) {
 const pdf=await createProfilePdf(p,template,assets); const bytes=new Uint8Array(pdf.output('arraybuffer'));
 await writeFile(`output/pdf/offerly-resume-readable-${template}.pdf`,bytes);
 const doc=await getDocumentProxy(bytes);const {items}=await extractTextItems(doc);
 const text=items.flat().map(x=>x.str).join(' ');
 for(const skill of p.skills)assert(text.includes(skill),skill);
 assert(text.includes('OmniSub'));assert(text.includes('Финансовый'));
 const skill=items[0].find(x=>x.str==='Python'); assert(Math.abs(skill.height-8.5)<.1,JSON.stringify(skill));
 console.log(template,pdf.getNumberOfPages(),'pages;',p.skills.length,'skills preserved; chip font 8.5 pt.');await doc.cleanup();
}
