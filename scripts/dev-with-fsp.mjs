import { spawn } from 'node:child_process';
try {
  process.loadEnvFile('.env.local');
} catch {}
const children = [];
let stopping = false;
const run = (args) => {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  return child;
};
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
};
const build = run(['scripts/build-assessment.mjs']);
build.on('exit', (code) => {
  if (code !== 0 || stopping) return stop(code || 1);
  const provider = run(['scripts/fsp-demo-provider.mjs']);
  const app = run([
    'node_modules/next/dist/bin/next',
    'dev',
    '--webpack',
    '-H',
    '127.0.0.1',
    '-p',
    new URL(process.env.APP_URL || 'http://localhost:5174').port || '5174',
  ]);
  for (const child of [provider, app])
    child.on('exit', (exitCode) => stop(exitCode || 0));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
