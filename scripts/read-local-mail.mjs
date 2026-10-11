import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
if(process.env.NODE_ENV==='production'){console.error('Этот инструмент предназначен только для локальной проверки.');process.exit(1);}
const offerlyRoot=fileURLToPath(new URL('../',import.meta.url));
let env={};try{const content=await readFile(path.join(offerlyRoot,'.env.local'),'utf8');env=Object.fromEntries(content.split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));}catch{}
const dir=path.resolve(offerlyRoot,process.env.MAIL_OUTBOX_DIR||env.MAIL_OUTBOX_DIR||'.data/mail-outbox');
const recipient=process.argv[2]?.trim().toLowerCase();
let names;try{names=await readdir(dir);}catch{console.log('Писем ещё нет. Зарегистрируйте обычный аккаунт и нажмите «Отправить код». Для Mailpit откройте http://localhost:8025.');process.exit(0);}
const messages=[];for(const name of names.filter(n=>n.endsWith('.json'))){try{const p=path.join(dir,name),message=JSON.parse(await readFile(p,'utf8'));if(!recipient||String(message.to).toLowerCase()===recipient)messages.push({message,time:(await stat(p)).mtimeMs});}catch{}}
messages.sort((a,b)=>b.time-a.time);const latest=messages[0];
if(!latest){console.log('Письма для этого адреса не найдены. Проверьте адрес и настройку MAIL_TRANSPORT=file.');process.exit(0);}
console.log('Локальное письмо — не отправлено в интернет.');
console.log('Кому: '+latest.message.to+'\nТема: '+latest.message.subject+'\n\n'+latest.message.text);
