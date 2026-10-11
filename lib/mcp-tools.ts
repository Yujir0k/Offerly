import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { searchCatalog } from './catalog';
import { loadPlatform } from './platform';
import { grades, specialties, type Profile } from './model';
import { salaryRangeError } from './salary-range';
import type { McpContext } from './mcp-auth';
import { McpError } from './mcp-policy';

const candidateId = z.number().int().min(1).max(2147483647);
const searchSchema = z.object({
  specialty: z.enum(specialties as [string, ...string[]]).optional(),
  grade: z.enum(grades as [string, ...string[]]).optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  verifiedOnly: z.boolean().optional(),
  salaryMin: z.number().int().min(1).max(10000000).optional(),
  salaryMax: z.number().int().min(1).max(10000000).optional(),
  format: z.enum(['Удалённо', 'Гибрид', 'Офис']).optional(),
  priority: z.enum(['balanced', 'test', 'fsp']).optional(),
  page: z.number().int().min(1).max(100).optional(),
}).strict();
const profileSchema = z.object({ candidateId }).strict();
const draftSchema = z.object({
  candidateId, title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(3000),
  salaryMin: z.number().int().min(1).max(10000000),
  salaryMax: z.number().int().min(1).max(10000000),
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
}).strict();

const definitions = [
  { name: 'search_candidates', title: 'Поиск кандидатов', description: 'Поиск доступных работодателю кандидатов с серверной сортировкой по тесту и ФСП. 20 профилей на странице. Не меняйте обязательные условия без поручения HR.', schema: searchSchema, readOnly: true },
  { name: 'get_candidate_profile', title: 'Обезличенный профиль', description: 'Только ID, направление, грейд, проверенные технологии, результат теста и статус ФСП. Имена, контакты, резюме и переписка недоступны.', schema: profileSchema, readOnly: true },
  { name: 'draft_invitation', title: 'Черновик приглашения', description: 'Создать черновик для ручного одобрения HR. Обе границы месячной зарплаты в рублях обязательны. requestId уникален для операции и повторяется при сетевом повторе. Не отправляет приглашение и не открывает чат.', schema: draftSchema, readOnly: false },
] as const;

/** Explicit allowlist of tools; arbitrary actions/SQL, contacts and messaging are never exposed. */
export function mcpToolDefinitions() {
  const idSchema = { type: 'integer', minimum: 1, maximum: 2147483647 };
  const salarySchema = { type: 'integer', minimum: 1, maximum: 10000000 };
  const inputs: Record<string, object> = {
    search_candidates: { type: 'object', additionalProperties: false, properties: {
      specialty: { type: 'string', enum: specialties }, grade: { type: 'string', enum: grades },
      skills: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 80 } },
      verifiedOnly: { type: 'boolean' }, salaryMin: salarySchema, salaryMax: salarySchema,
      format: { type: 'string', enum: ['Удалённо', 'Гибрид', 'Офис'] }, priority: { type: 'string', enum: ['balanced', 'test', 'fsp'] },
      page: { type: 'integer', minimum: 1, maximum: 100 },
    } },
    get_candidate_profile: { type: 'object', additionalProperties: false, required: ['candidateId'], properties: { candidateId: idSchema } },
    draft_invitation: { type: 'object', additionalProperties: false, required: ['candidateId', 'title', 'description', 'salaryMin', 'salaryMax', 'requestId'],
      properties: { candidateId: idSchema, title: { type: 'string', minLength: 3, maxLength: 200 }, description: { type: 'string', minLength: 10, maxLength: 3000 },
        salaryMin: salarySchema, salaryMax: salarySchema, requestId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{8,80}$' } } },
  };
  return definitions.map(tool => ({ name: tool.name, title: tool.title, description: tool.description,
    inputSchema: inputs[tool.name],
    annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
}

/** Projection has no free-form profile text, names, locations, contact/file keys or event titles. */
export function mcpCandidate(profile: Profile) {
  const events = profile.ranking?.events || [];
  const trusted = events.filter(event => ['demo', 'verified'].includes(event.source));
  return {
    candidateId: profile.id,
    specialty: profile.specialty,
    grade: profile.grade,
    gradeConfirmed: !!profile.grade,
    claimedGrade: profile.grade ? null : profile.claimed,
    verifiedTechnologies: profile.verified,
    test: { score: profile.grade ? profile.score : null, scale: 100, source: profile.synthetic ? 'simulation' : profile.demonstration ? 'demo' : 'assessment',
      assessmentVersion: profile.assessmentEvidence?.assessmentVersion || null,
      scoringConfigVersion: profile.assessmentEvidence?.scoringConfigVersion || null },
    fsp: { status: trusted.length ? (trusted.every(event => event.source === 'demo') ? 'demo' : 'verified') : 'none',
      events: trusted.length, relevantEvents: trusted.filter(event => event.relevance > 0).length,
      winners: trusted.filter(event => event.result === 'winner').length, prizes: trusted.filter(event => event.result === 'prize').length },
    ranking: profile.ranking ? { policy: profile.ranking.policyVersion, mode: profile.ranking.mode,
      testComponent: profile.ranking.test, fspComponent: profile.ranking.sport, technologyComponent: profile.ranking.skills,
      explanation: 'Серверные компоненты ранжирования; не вероятность найма. Категории и версии теста сравниваются отдельно.' } : null,
  };
}

async function stateFor(context: McpContext) {
  const state = await loadPlatform(context.account);
  if (state.company.id !== context.companyId) throw new McpError('Доступ к компании изменился.', 403);
  return state;
}

/** Every direct ID access goes through the same visibility, consent, completion and scope checks. */
export async function mcpProfile(context: McpContext, id: number) {
  const result = await searchCatalog(context.account, await stateFor(context), 'candidates', { ids: [id] }, 'employer', 1, 'market', context.account.demo ? { mode: 'demo' } : {});
  const profile = result.items.find((item): item is Profile => !!item && 'claimed' in item && item.id === id);
  if (!profile) throw new McpError('Кандидат недоступен.', 404);
  return profile;
}

/** Execute bounded, validated operations with no privilege derived from an LLM's text. */
export async function callMcpTool(context: McpContext, name: string, input: unknown) {
  const tool = definitions.find(item => item.name === name);
  if (!tool) throw new McpError('Этот инструмент недоступен.', 404);
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    if (name === 'draft_invitation') throw new McpError('Черновик требует ID кандидата, текст, requestId и обе границы зарплатной вилки в рублях.');
    throw new McpError('Проверьте параметры инструмента.');
  }
  if (name === 'search_candidates') {
    const args = searchSchema.parse(parsed.data);
    if (args.salaryMin && args.salaryMax && args.salaryMin > args.salaryMax) throw new McpError('Верхняя граница зарплаты меньше нижней.');
    const result = await searchCatalog(context.account, await stateFor(context), 'candidates', {
      spec: args.specialty || '', grade: args.grade || '', skills: args.skills || [], skillSource: args.verifiedOnly ? 'verified' : 'any',
      salaryMin: args.salaryMin ? String(args.salaryMin) : '', salaryMax: args.salaryMax ? String(args.salaryMax) : '',
      formats: args.format ? [args.format] : [], includeUnconfirmed: true,
      sort: args.priority === 'test' ? 'По результату теста' : args.priority === 'fsp' ? 'По достижениям ФСП' : 'Тест + ФСП',
    }, 'employer', args.page || 1, 'market', context.account.demo ? { mode: 'demo' } : {});
    return { items: result.items.filter((item): item is Profile => !!item && 'claimed' in item).map(mcpCandidate),
      total: result.total, page: result.page, pageSize: result.pageSize, source: context.account.demo ? 'synthetic-demo' : 'employer-catalog',
      notice: 'Технологии фильтруются по профилю или проверенным навыкам; verifiedOnly=true оставляет только проверенные. Источники результатов указаны отдельно; данные демонстрации не являются реальной верификацией.' };
  }
  if (name === 'get_candidate_profile') return { profile: mcpCandidate(await mcpProfile(context, profileSchema.parse(parsed.data).candidateId)), source: context.account.demo ? 'synthetic-demo' : 'employer-catalog' };
  const args = draftSchema.parse(parsed.data);
  const error = salaryRangeError(args.salaryMin, args.salaryMax);
  if (error) throw new McpError(error);
  await mcpProfile(context, args.candidateId);
  const payload = { candidateId: args.candidateId, title: args.title, description: args.description, min: args.salaryMin, max: args.salaryMax };
  // The same requestId with different content is a conflict, not a silent overwrite.
  const requestKey = createHash('sha256').update(args.requestId).digest('hex');
  const result = await context.db.query<{ id: string; payload: typeof payload; status: string }>(
    `INSERT INTO mcp_invitation_drafts(id,user_id,company_id,candidate_id,request_key,payload) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(user_id,request_key) DO UPDATE SET request_key=excluded.request_key WHERE mcp_invitation_drafts.company_id=excluded.company_id AND mcp_invitation_drafts.payload=excluded.payload
     RETURNING id,payload,status`, [randomUUID(), context.account.id, context.companyId, args.candidateId, requestKey, JSON.stringify(payload)]);
  if (!result.rows.length) throw new McpError('requestId уже использован для другого черновика.', 409);
  return { draftId: result.rows[0].id, status: result.rows[0].status, requiresHrApproval: true, sent: result.rows[0].status === 'sent',
    notice: 'Черновик доступен работодателю в разделе «Приглашения». Только HR может одобрить отправку.' };
}
