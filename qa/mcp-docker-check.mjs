import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

assert.equal(process.env.MCP_DOCKER_QA, '1', 'Run only against the dedicated offerly-mcp-qa compose project');
const base = 'http://localhost:3000';
let checks = 0;
async function request(path, body, headers = {}, status = 200) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  assert.equal(response.status, status, `${path}: unexpected HTTP status`); checks++;
  return { response, data: await response.json() };
}
await request('/api/health');
const login = await request('/api/auth', { type: 'demo-login', role: 'employer' });
const cookie = login.response.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie); checks++;
const hr = { Cookie: cookie };
const credential = await request('/api/mcp/settings', { action: 'create' }, hr);
assert.equal(credential.data.sseUrl, base + '/api/mcp/sse'); checks++;
const agent = { Authorization: `Bearer ${credential.data.token}` };
let rpcId = 0;
async function rpc(method, params) {
  const result = await request('/api/mcp', { jsonrpc: '2.0', id: ++rpcId, method, params }, agent);
  return result.data.result;
}
const tools = await rpc('tools/list');
assert.equal(tools.tools.length, 3); checks++;
const found = await rpc('tools/call', { name: 'search_candidates', arguments: { specialty: 'Backend', priority: 'test' } });
assert.equal(found.isError, false); assert.ok(found.structuredContent.items.length); checks++;
const candidateId = found.structuredContent.items[0].candidateId;
const profile = await rpc('tools/call', { name: 'get_candidate_profile', arguments: { candidateId } });
assert.equal(profile.isError, false); assert.equal(profile.structuredContent.profile.email, undefined); assert.equal(profile.structuredContent.profile.name, undefined); checks++;
const payload = { candidateId, title: 'Проверка MCP в PostgreSQL', description: 'Синтетический тест черновика и одобрения в production-контейнере.', salaryMin: 180000, salaryMax: 230000, requestId: randomUUID() };
assert.equal((await rpc('tools/call', { name: 'draft_invitation', arguments: { ...payload, salaryMax: undefined } })).isError, true); checks++;
const draft = await rpc('tools/call', { name: 'draft_invitation', arguments: payload });
assert.equal(draft.isError, false); assert.equal(draft.structuredContent.sent, false); checks++;
const before = await request('/api/mcp/drafts', undefined, hr);
assert.equal(before.data.drafts.length, 1); checks++;
await request('/api/mcp/drafts', { id: draft.structuredContent.draftId, action: 'approve' }, agent, 401);
const approved = await request('/api/mcp/drafts', { id: draft.structuredContent.draftId, action: 'approve' }, hr);
assert.equal(approved.data.drafts.length, 0); assert.ok(approved.data.state.invitations.some(item => item.candidateId === candidateId && item.title === payload.title && item.status === 'sent')); checks++;
const bridge = spawn(process.execPath, ['scripts/mcp-stdio.mjs'], { env: { ...process.env, OFFERLY_MCP_SSE_URL: base + '/api/mcp/sse', OFFERLY_MCP_TOKEN: credential.data.token }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const output = createInterface({ input: bridge.stdout });
let timeout;
try {
  const reply = new Promise((resolve, reject) => {
    output.once('line', line => { try { resolve(JSON.parse(line)); } catch (error) { reject(error); } });
    bridge.once('error', reject);
    timeout = setTimeout(() => reject(new Error('Docker SSE bridge timeout')), 10000);
  });
  bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 101, method: 'tools/list' }) + '\n');
  assert.equal((await reply).result.tools.length, 3); checks++;
} finally { clearTimeout(timeout); bridge.kill(); output.close(); }
await request('/api/mcp/settings', { action: 'revoke' }, hr);
await request('/api/mcp', { jsonrpc: '2.0', id: 102, method: 'ping' }, agent, 401);
console.log(`${checks} Docker/PostgreSQL MCP checks passed`);
