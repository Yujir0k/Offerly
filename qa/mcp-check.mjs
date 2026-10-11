import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { request as httpRequest } from 'node:http';

const base = process.env.TEST_BASE_URL || 'http://localhost:5191';
assert.equal(new URL(base).hostname, 'localhost');
assert.equal(new URL(base).port, '5191', 'Never mutate the main workspace');
const { a, b, realEmployer, otherEmployer, pureCandidate } = JSON.parse(await readFile('.data/mcp-qa/fixtures.json', 'utf8'));
let checks = 0;
let rpcId = 0;
async function call(user, path, body, status = 200, extra = {}) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: user?.cookie || '', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, status, `${path} returned unexpected status: ${JSON.stringify(data).slice(0, 250)}`); checks++;
  return data;
}
async function rpc(token, name, args, status = 200) {
  return call(null, '/api/mcp', { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }, status, { Authorization: `Bearer ${token}` });
}
function data(response) { assert.equal(response.result.isError, false, JSON.stringify(response.result)); checks++; return response.result.structuredContent; }
function denied(response) { assert.equal(response.result.isError, true); checks++; }
function privateKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!['name', 'firstName', 'lastName', 'email', 'phone', 'resumeKey', 'avatarKey', 'links', 'bio', 'education', 'projects', 'workHistory', 'contact', 'notes', 'fspConnection'].includes(key), `Private field ${key}`);
    privateKeys(child);
  }
}

await call(null, '/api/mcp/settings', undefined, 401);
assert.equal((await call(realEmployer, '/api/mcp/settings')).data,'employer-catalog'); checks++;
await call(pureCandidate, '/api/mcp/settings', undefined, 403);
const normalToken = (await call(realEmployer, '/api/mcp/settings', {action:'create'})).token;
const normalSearch = data(await rpc(normalToken,'search_candidates',{skills:['McpQaUnique']}));
assert.equal(normalSearch.total,3); privateKeys(normalSearch); checks++;
assert(normalSearch.items.every(item=>realEmployer.ids.slice(0,3).includes(item.candidateId))); checks++;
privateKeys(data(await rpc(normalToken,'get_candidate_profile',{candidateId:realEmployer.ids[0]})));
denied(await rpc(normalToken,'get_candidate_profile',{candidateId:realEmployer.ids[3]}));
denied(await rpc(normalToken,'get_candidate_profile',{candidateId:a.ids[0]}));
const normalDraft = data(await rpc(normalToken,'draft_invitation',{candidateId:realEmployer.ids[0],title:'Синтетическая проверка',description:'Локальная проверка обычного работодателя в изолированной QA-базе.',salaryMin:150000,salaryMax:200000,requestId:'normal-mcp-qa-01'}));
assert.equal(normalDraft.sent,false); checks++;
assert.equal((await call(realEmployer,'/api/mcp/drafts')).drafts.length,1); checks++;
assert.equal((await call(otherEmployer,'/api/mcp/drafts')).drafts.length,0); checks++;
await call(otherEmployer,'/api/mcp/drafts',{id:normalDraft.draftId,action:'approve'},404);
const normalApproved = await call(realEmployer,'/api/mcp/drafts',{id:normalDraft.draftId,action:'approve'});
assert.equal(normalApproved.state.invitations.filter(item=>item.candidateId===realEmployer.ids[0]).length,1); checks++;
await call(realEmployer,'/api/mcp/settings',{action:'revoke'});
await rpc(normalToken,'search_candidates',{},401);
await call(a, '/api/mcp/settings', { action: 'create' }, 403, { Origin: 'https://foreign.test' });
const first = await call(a, '/api/mcp/settings', { action: 'create' });
const other = await call(b, '/api/mcp/settings', { action: 'create' });
const token = first.token;
assert.equal((await call(a, '/api/mcp/settings')).token, undefined); checks++;
assert.equal((await call(a, '/api/mcp/settings', { action: 'reveal' })).token, token); checks++;
await rpc('', 'search_candidates', {}, 401);
await call(a, '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 401);
await call(null, '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 403, { Authorization: `Bearer ${token}`, Origin: 'https://foreign.test' });
const foreignHostStatus = await new Promise((resolve, reject) => {
  const request = httpRequest(base + '/api/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: base, Host: 'foreign.test:5174', 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode); });
  request.on('error', reject);
  request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
});
assert.equal(foreignHostStatus, 403); checks++;
const initialized = await call(null, '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, 200, { Authorization: `Bearer ${token}` });
assert.equal(initialized.result.serverInfo.name, 'offerly-employer-demo'); checks++;
const tools = await call(null, '/api/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, 200, { Authorization: `Bearer ${token}` });
assert.deepEqual(tools.result.tools.map(tool => tool.name), ['search_candidates', 'get_candidate_profile', 'draft_invitation']); checks++;
const found = data(await rpc(token, 'search_candidates', { specialty: 'Backend', grade: 'Middle' }));
assert.equal(found.total, 30); assert.equal(found.items.length, 20); privateKeys(found); checks++;
const second = data(await rpc(token, 'search_candidates', { specialty: 'Backend', grade: 'Middle', page: 2 }));
assert.equal(second.items.length, 10); assert(second.items.every(item => !found.items.some(first => first.candidateId === item.candidateId))); checks++;
assert.deepEqual(data(await rpc(token, 'search_candidates', { skills: ['Python'], verifiedOnly: true })).total, 15); checks++;
for (const priority of ['balanced', 'test', 'fsp']) privateKeys(data(await rpc(token, 'search_candidates', { priority, skills: ['Python'] })));
const candidateId = a.ids[0];
privateKeys(data(await rpc(token, 'get_candidate_profile', { candidateId })));
for (const id of Object.values(a.unavailable)) denied(await rpc(token, 'get_candidate_profile', { candidateId: id }));
denied(await rpc(other.token, 'get_candidate_profile', { candidateId }));
denied(await rpc(token, 'search_candidates', { sql: 'select * from users', scope: b.owner }));
denied(await rpc(token, 'send_invitation', { candidateId }));
denied(await rpc(token, 'send_message', { candidateId, text: 'test' }));
const content = { candidateId, title: 'Backend в тестовую команду', description: 'Приглашаем обсудить разработку тестового сервиса. Это синтетическая проверка.', salaryMin: 180000, salaryMax: 230000, requestId: 'mcp-check-draft-01' };
denied(await rpc(token, 'draft_invitation', { ...content, salaryMin: undefined }));
denied(await rpc(token, 'draft_invitation', { ...content, salaryMin: 250000 }));
denied(await rpc(token, 'draft_invitation', { ...content, candidateId: b.ids[0] }));
const drafted = data(await rpc(token, 'draft_invitation', content));
assert.equal(drafted.sent, false); checks++;
assert.equal(data(await rpc(token, 'draft_invitation', content)).draftId, drafted.draftId); checks++;
denied(await rpc(token, 'draft_invitation', { ...content, title: 'Другой текст' }));
const ownDrafts = await call(a, '/api/mcp/drafts');
assert.equal(ownDrafts.drafts.length, 1); assert.equal((await call(b, '/api/mcp/drafts')).drafts.length, 0); checks++;
await call(null, '/api/mcp/drafts', { id: drafted.draftId, action: 'approve' }, 401, { Authorization: `Bearer ${token}` });
await call(b, '/api/mcp/drafts', { id: drafted.draftId, action: 'approve' }, 404);
const approved = await call(a, '/api/mcp/drafts', { id: drafted.draftId, action: 'approve' });
const invitations = approved.state.invitations.filter(item => item.candidateId === candidateId);
assert.equal(invitations.length, 1); assert.equal(invitations[0].min, 180000); assert.equal(invitations[0].status, 'sent'); checks++;
const repeated = await call(a, '/api/mcp/drafts', { id: drafted.draftId, action: 'approve' });
assert.equal(repeated.state.invitations.filter(item => item.candidateId === candidateId).length, 1); checks++;
const removable = data(await rpc(token, 'draft_invitation', { ...content, candidateId: a.ids[1], requestId: 'mcp-delete-draft-01' }));
await call(a, '/api/mcp/drafts', { id: removable.draftId, action: 'delete' });
await call(a, '/api/mcp/drafts', { id: removable.draftId, action: 'approve' }, 409);
const revokedProfile = data(await rpc(token, 'draft_invitation', { ...content, requestId: 'mcp-hidden-draft-01' }));
await call({ cookie: a.candidateCookie }, '/api/action', { type: 'privacy', role: 'candidate', visible: false, notifications: true });
await call(a, '/api/mcp/drafts', { id: revokedProfile.draftId, action: 'approve' }, 409);
denied(await rpc(token, 'get_candidate_profile', { candidateId }));

// Exercise the actual Desktop stdio → SSE bridge, not only direct HTTP.
const bridge = spawn(process.execPath, ['scripts/mcp-stdio.mjs'], { env: { ...process.env, OFFERLY_MCP_SSE_URL: `${base}/api/mcp/sse`, OFFERLY_MCP_TOKEN: token }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const output = createInterface({ input: bridge.stdout });
const responses = [];
let resolveResponse;
const responseReady = new Promise(resolve => { resolveResponse = resolve; });
output.on('line', line => { responses.push(JSON.parse(line)); if (responses.length === 2) resolveResponse(); });
bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 91, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n');
bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 92, method: 'tools/list' }) + '\n');
let timeout;
try { await Promise.race([responseReady, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('SSE bridge timeout')), 30000); })]); }
finally { clearTimeout(timeout); bridge.stdin.end(); bridge.kill(); output.close(); }
assert.equal(responses[0].result.protocolVersion, '2024-11-05'); assert.equal(responses[1].result.tools.length, 3); checks++;

const replaced = await call(a, '/api/mcp/settings', { action: 'rotate' });
await rpc(token, 'search_candidates', {}, 401);
data(await rpc(replaced.token, 'search_candidates', {}));
await call(a, '/api/mcp/settings', { action: 'revoke' });
await rpc(replaced.token, 'search_candidates', {}, 401);
assert.equal((await call(a, '/api/mcp/settings')).hasToken, false); checks++;
let limited = false;
for (let i = 0; i < 61; i++) {
  const response = await fetch(base + '/api/mcp', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Authorization: `Bearer ${other.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: i, method: 'ping' }) });
  if (response.status === 429) { limited = true; break; }
  assert.equal(response.status, 200);
}
assert.equal(limited, true, 'Rate limits return 429 rather than an internal error'); checks++;
await writeFile('qa/results/latest/mcp-results.json', JSON.stringify({ passed: true, checks, tools: 3, demoScopeIsolated: true, ordinaryEmployersSupported: true, blockedCandidatesExcluded: true, fieldsMinimized: true, scopeIsolation: true, salaryRequired: true, humanApprovalOnly: true, idempotency: true, sseBridge: true, tokenRotationAndRevocation: true, rateLimited: true }, null, 2) + '\n');
console.log(`${checks} MCP checks passed`);
