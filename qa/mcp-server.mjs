import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', '5174'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, APP_URL: 'http://localhost:5174', DATABASE_URL: '', PGLITE_PATH: '.data/mcp-qa/postgres',
    ENABLE_DEMO: 'true', MCP_DEMO_ENABLED: 'true', LOCAL_DEMO_ACCOUNT: '', COOKIE_SECURE: 'false', NEXT_DEV_DIST_DIR: '.next-mcp-qa' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
child.on('exit', code => { process.exitCode = code || 0; });
