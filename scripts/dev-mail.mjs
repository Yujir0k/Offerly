import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
await mkdir('.data/mailpit', { recursive: true, mode: 0o700 });
const child = spawn('mailpit', [
  '--listen', '127.0.0.1:8025', '--smtp', '127.0.0.1:1025',
  '--allowed-hosts', 'localhost,127.0.0.1',
  '--database', '.data/mailpit/mailpit.db', '--disable-version-check',
  '--block-remote-css-and-fonts', '--smtp-disable-rdns', '--quiet',
], { stdio: 'inherit' });
child.on('error', () => { console.error('Установите Mailpit: brew install mailpit'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
