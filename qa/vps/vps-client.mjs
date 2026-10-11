import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
export const base = process.env.VPS_QA_BASE || 'http://127.0.0.1:17874';
assert.equal(new URL(base).hostname, '127.0.0.1');
export const prefix = process.env.VPS_QA_PREFIX;
assert.match(prefix || '', /^vps-qa-\d{8}-\d+-$/);
export const dir = process.env.VPS_QA_DIR;
assert(dir?.includes('/offerly/'));
await mkdir(dir, { recursive: true, mode: 0o700 });
export const checks = [];
export let calls = 0;
export function check(name, value) { assert(value, name); checks.push(name); }
export function fixture(input) {
  if(input.action==='baseline')try{input={...input,excludeUserIds:JSON.parse(readFileSync(dir+'/deleted-qa-ids.json','utf8'))};}catch{}
  let r;
  for(let n=0;n<3;n++){
    r=spawnSync('ssh', ['-F', '/dev/null', '-S', process.env.VPS_QA_SSH_SOCKET || '/tmp/offerly-mail-ssh', '-o', 'BatchMode=yes', '-o','ConnectTimeout=10', 'root@193.233.220.30', `docker exec -i -e VPS_QA_PREFIX=${prefix} ${process.env.VPS_QA_CONTAINER || "offerly-app-1"} node /tmp/vps-fixtures.mjs`], { input: JSON.stringify(input), encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if(r.status!==255)break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);
  }
  assert.equal(r.status, 0, 'Fixture maintenance failed: ' + r.stderr+' bytes='+r.stdout?.length+' error='+r.error?.message);
  const result=JSON.parse(r.stdout);
  return result.gzip?JSON.parse(gunzipSync(Buffer.from(result.gzip,'base64')).toString()):result;
}
export async function save(name, value) { await writeFile(dir + '/' + name, JSON.stringify(value, null, 2), { mode: 0o600 }); }
export async function call(u, path, body, status = 200, options = {}) {
  const request = () => fetch(base + path, {
    method: options.method || (body === undefined ? 'GET' : 'POST'),
    headers: { Host: 'opherly.ru', Origin: options.origin || 'https://opherly.ru', 'X-Offerly-Role': options.role || u?.role || 'candidate', 'User-Agent': 'Offerly-VPS-QA Chrome/132', ...(u?.cookie ? { Cookie: u.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  let response;
  try {response=await request();} catch(error) {
    if(body!==undefined&&!path.startsWith('/api/professional/'))throw error;
    await new Promise(resolve=>setTimeout(resolve,250));
    response=await request();
  }
  const data = await response.json();
  assert([status].flat().includes(response.status), `${path} expected ${status}, got ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  if (u) {
    const jar = new Map((u.cookie || '').split('; ').filter(Boolean).map(v => [v.split('=')[0], v]));
    for (const c of response.headers.getSetCookie()) { const v = c.split(';')[0]; jar.set(v.split('=')[0], v); }
    u.cookie = [...jar.values()].join('; ');
  }
  calls++;
  return data;
}
export async function create(label, role = 'candidate', verify = true) {
  const labelPrefix = process.env.VPS_QA_ACCOUNT_LABEL || '';
  assert.match(labelPrefix, /^[a-z0-9-]{0,40}$/);
  const u = { email: (prefix + labelPrefix + label + '@example.test').toLowerCase(), password: 'Vps-QA-' + prefix + 'Aa!', name: 'Проверка ' + label, role };
  u.state = await call(u, '/api/auth', { type: 'register', ...u, consent: true, company: role === 'employer' ? 'Тестовая компания ' + label : undefined },[200,400]);
  if(!u.state.profile)u.state=await call(u,'/api/auth',{type:'login',email:u.email,password:u.password,role});
  check('registration ' + label, !!u.cookie && u.state.profile.id > 0 && u.state.emailSent !== true);
  if (verify) fixture({ action: 'verify-email', email: u.email });
  return u;
}
export async function state(u) { return u.state = await call(u, '/api/state?role='+u.role); }
export async function act(u, type, body = {}, status = 200) {
  const s = await call(u, '/api/action', { ...body, type, role: u.role }, status);
  if (status === 200) u.state = s;
  return s;
}
export async function catalog(u, kind, filters = {}, page = 1) {
  return call(u, `/api/catalog/${kind}?role=${u.role}&page=${page}&filters=${encodeURIComponent(JSON.stringify(filters))}`);
}
export async function complete(u, track, grade, scenario = 'success') {
  const prior=(await call(u,'/api/professional/adaptive-sessions')).find(s=>s.specialization===track&&s.targetGrade===grade);
  let v = prior?.state==='completed' ? prior : await call(u, '/api/professional/adaptive-sessions', { specialization: track, targetGrade: grade });
  const id = v.id;
  let n = 0;
  let rawCache;
  while (v.state === 'active') {
    assert(++n < 100, 'Assessment did not terminate');
    if(!rawCache?.items.some(item=>item.variant.id===v.current.itemId))rawCache=fixture({ action: 'assessment-raw', email: u.email, id });
    const item = rawCache.items.find(item=>item.variant.id===v.current.itemId).variant;
    const step = item.steps.find(step=>step.id===v.current.step.id);
    if (step.exploration) for (const artifact of [...item.artifacts].sort((a,b)=>scenario === 'failure' ? a.usefulness-b.usefulness : b.usefulness-a.usefulness).slice(0, step.requiredEvidenceSources || 2)) v = await call(u, `/api/professional/adaptive-sessions/${id}/evidence`, { itemId: item.id, stepId: step.id, artifactId: artifact.id, interactionRevision: v.interactionRevision });
    const optionId = step.exploration ? 'continue' : Object.entries(step.rubric.scores).sort((a,b)=>scenario === 'failure' ? a[1]-b[1] : b[1]-a[1])[0][0];
    v = await call(u, `/api/professional/adaptive-sessions/${id}/answer`, { itemId: item.id, stepId: step.id, optionId, execution: item.generated?.responseChecks?.[step.id]?.accepted[0], interactionRevision: v.interactionRevision });
    check('private rubric absent ' + id + ':' + n, !JSON.stringify(v).includes('"rubric"') && !JSON.stringify(v).includes('"responseChecks"'));
    if (scenario === 'timeout' && v.state === 'active') {
      fixture({ action: 'assessment-expire', email: u.email, id });
      v = await call(u, `/api/professional/adaptive-sessions/${id}`);
      check('hard assessment deadline ' + track + grade, v.state === 'completed' && v.current === null && v.result.stopReason === 'timeout' && v.result.timeoutSummary.unanswered > 0);
      await call(u, `/api/professional/adaptive-sessions/${id}/answer`, { itemId: item.id, stepId: step.id, optionId, interactionRevision: v.interactionRevision }, 409);
      const frozen = await call(u, `/api/professional/adaptive-sessions/${id}`);
      assert.deepEqual(frozen.result, v.result);
    }
  }
  check('assessment ' + track + grade + scenario, v.result.decision === (scenario === 'success' ? 'CONFIRMED' : 'NOT_CONFIRMED'));
  const history = await state(u);
  check('assessment history ' + track + grade + scenario, history.attempts.some(a => a.id === id));
  return v;
}
