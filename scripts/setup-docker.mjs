import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('../.env.docker',import.meta.url));
const settings={POSTGRES_PASSWORD:randomBytes(32).toString('hex'),POSTGRES_APP_PASSWORD:randomBytes(32).toString('hex'),APP_URL:'http://localhost:3000',COOKIE_SECURE:'false',TRUST_PROXY:'false',ENABLE_DEMO:'true',ENABLE_DEMO_DATA:'true',MCP_ENABLED:'false',FSP_OIDC_ENABLED:'false',SMTP_HOST:'',SMTP_PORT:'587',SMTP_USER:'',SMTP_PASSWORD:'',MAIL_FROM:'Офферли <noreply@example.test>',MAIL_WORKER_ENABLED:'false'};
try{await writeFile(file,'# Local Docker only. Never publish.\n'+Object.entries(settings).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{flag:'wx',mode:0o600});console.log('Created .env.docker with distinct random database passwords. Run docker compose --env-file .env.docker up --build -d');}
catch(error){if(error.code==='EEXIST')console.log('Existing .env.docker preserved.');else throw error;}
