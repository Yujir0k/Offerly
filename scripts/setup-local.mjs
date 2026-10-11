import { writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const offerlyRoot=fileURLToPath(new URL('../',import.meta.url));
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<17)){console.error('Нужен Node.js >=22.17.0. Рекомендуется Node.js24 LTS.');process.exit(1);}
const args=process.argv.slice(2),mailpit=args.includes('--mailpit');
const portArg=args.find(arg=>arg.startsWith('--port='));const port=portArg?Number(portArg.slice(7)):5174;
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Укажите порт от1024 до65535');
const envPath=path.join(offerlyRoot,'.env.local');
try{await access(envPath);console.log('Существующий .env.local сохранён. База и файлы не изменены. Для изменения почты/порта отредактируйте настройки вручную.');process.exit(0);}catch{}
const settings=[
 '# Только локальная разработка. Не публиковать этот файл.',
 `APP_URL=http://localhost:${port}`,'ENABLE_DEMO=true','COOKIE_SECURE=false','TRUST_PROXY=false',
 'FSP_OIDC_ENABLED=false',`MAIL_TRANSPORT=${mailpit?'mailpit':'file'}`,'MAIL_PREVIEW=false',
 'MAIL_FROM=Офферли <noreply@offerly.test>',...(mailpit?['SMTP_HOST=127.0.0.1','SMTP_PORT=1025']:[]),
 '# Без DATABASE_URL используется отдельная локальная база .data/postgres.',
 '# Не задавайте DATABASE_URL от другой среды при локальном запуске.',
];
await writeFile(envPath,settings.join('\n')+'\n',{flag:'wx',mode:0o600});
console.log(`Создан .env.local для http://localhost:${port}. Почта: ${mailpit?'Mailpit localhost:8025, запустите npm run dev:mail':'приватные файлы .data/mail-outbox; код: npm run mail:latest -- ваш@email'}.`);
console.log('Далее: npm run dev. При другом порте используйте npm run dev -- --port '+port+'.');
