import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Store, type User } from './store.js';
import { AdaptiveService } from './adaptive/service.js';
import { publicSession as publicAdaptiveSession, sessionTelemetry } from './adaptive/engine.js';
import type { AssessmentSession as AdaptiveSession } from './adaptive/model.js';
import { packs as generativePacks } from './generative/packs.js';
import { generatorVersion } from './generative/generator.js';
import type { ExposureRecord } from './generative/model.js';
import { help } from './assistant.js';
import { tracks, skills, getTrack, llmProfiles, familyCoverage } from './catalog.js';
import { generateVariant, generateUniqueVariant, publicVariant } from './generator.js';
import { runExperiment } from './simulator.js';
import { evaluate, matchNeed } from './scoring.js';
import { sessionResult, latestLevelChange } from './session.js';
import { calibrationReport, type Observation } from './calibration.js';
import { openapi } from './openapi.js';
import { preflight } from './validation-engine.js';
import { familyCatalog, chooseFamily } from './families/registry.js';
import {
  engineeringVariant,
  engineeringProgress,
  engineeringExperiment,
  engineeringDiagnostic,
  recordAudit,
} from './engineering.js';
import { enrichEngineeringArtifact } from './engineering-llm.js';
import { generateExpressVariant, expressExperiment, expressRetryAt } from './express.js';
import { modeledFspStatus } from '../offerly-web/lib/fsp-status.js';
import {
  grades,
  modes,
  type Assessment,
  type AssessmentSession,
  type Need,
  type CustomCase,
  type ExperimentInput,
  type Grade,
  type ToolMode,
  type Plan,
  type DiagnosticKind,
  type FspStatus,
} from './domain.js';

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'Ожидается объект');
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 3000, optional = false): string {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim()))
    throw new HttpError(400, 'Некорректное текстовое поле');
  return value.trim();
}
function list(value: unknown, allowed?: string[]): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 30 ||
    value.some(
      (item) =>
        typeof item !== 'string' || item.length > 100 || (allowed && !allowed.includes(item)),
    )
  )
    throw new HttpError(400, 'Некорректный список');
  return [...new Set(value as string[])];
}
function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    throw new HttpError(400, 'Число вне допустимых границ');
  return Number(value);
}
function grade(value: unknown): Grade {
  if (!grades.includes(value as Grade)) throw new HttpError(400, 'Неизвестный грейд');
  return value as Grade;
}
function mode(value: unknown): ToolMode {
  if (!modes.includes(value as ToolMode))
    throw new HttpError(400, 'Неизвестный режим инструментов');
  return value as ToolMode;
}
function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > 100_000) throw new HttpError(413, 'Запрос слишком большой');
    chunks.push(buffer);
  }
  try {
    return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Некорректный JSON');
  }
}
interface Invitation {
  id: string;
  employerId: string;
  candidateId: string;
  company: string;
  description: string;
  salaryMin: number;
  salaryMax: number;
  employerContact: string;
  status: 'sent' | 'viewed' | 'accepted' | 'declined';
  createdAt: string;
}

/** Creates the API and local web interface. External integrations are disabled by default. */
export function createApplication(
  store: Store,
  options: { development: boolean; dataDir: string; bridgeSecret?: string },
) {
  const loginAttempts = new Map<string, { count: number; expires: number }>();
  const pendingPrograms = new Set<string>();
  function userFor(request: IncomingMessage): User {
    const token =
      request.headers.cookie
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('sid='))
        ?.slice(4) ?? '';
    const user = store.sessionUser(token);
    if (!user) throw new HttpError(401, 'Войдите в кабинет');
    return user;
  }
  function requireRole(user: User, ...roles: string[]): void {
    if (!roles.includes(user.role)) throw new HttpError(403, 'Нет доступа к этому действию');
  }
  function assessmentFor(user: User, id: string): Assessment {
    const assessment = store.get<Assessment>('assessments', id);
    if (!assessment || (assessment.candidateId !== user.id && user.role !== 'admin'))
      throw new HttpError(404, 'Испытание не найдено');
    return assessment;
  }
  function visibleAssessment(assessment: Assessment): unknown {
    const review = store.get<{ decision: string; notes: string; at: string }>(
      'reviews',
      assessment.id,
    );
    const result =
      assessment.result && !assessment.variant.engineering
        ? {
            ...assessment.result,
            evidence: assessment.result.evidence
              .filter((item) => !['communication', 'reasoning'].includes(item.skillId))
              .concat(
                ['communication', 'reasoning'].map((skillId) => ({
                  skillId,
                  score: review?.decision === 'approved' ? 85 : 0,
                  source: review ? `expert:${assessment.id}` : 'recommendation',
                  explanation: review?.notes || 'Обоснование ожидает экспертной проверки',
                })),
              ),
          }
        : assessment.result;
    return {
      ...assessment,
      result,
      variant: publicVariant(assessment.variant, assessment.stage),
      expertReview: review,
    };
  }
  function visibleSession(session: AssessmentSession): unknown {
    const assessments = session.assessmentIds.map((id) =>
      store.get<Assessment>('assessments', id)!,
    );
    const visible = assessments.map(visibleAssessment) as Assessment[];
    return {
      ...session,
      assessments: visible,
      result: sessionResult(session, visible),
    };
  }
  function active(assessment: Assessment): void {
    if (assessment.state !== 'active')
      throw new HttpError(409, 'Испытание завершено или находится в архиве');
  }
  const adaptive = new AdaptiveService(store);
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = request.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        const origin = request.headers.origin;
        if (origin && new URL(origin).host !== request.headers.host)
          throw new HttpError(403, 'Запрещён внешний источник запроса');
        if (request.headers['x-platform-request'] !== '1')
          throw new HttpError(403, 'Отсутствует заголовок приложения');
      }
      if (path === '/api/health') return json(response, { ok: true });
      if (path === '/api/catalog' && method === 'GET')
        return json(response, {
          tracks,
          skills,
          grades,
          families: familyCatalog(),
          profiles: llmProfiles,
          development: options.development,
          liveEnabled: process.env.LLM_LIVE_ENABLED === 'true',
        });
      if (path === '/api/auth/register' && method === 'POST') {
        const input = await body(request);
        const email = string(input.email, 254);
        const password = string(input.password, 128);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10)
          throw new HttpError(400, 'Укажите email и пароль от 10 символов');
        if (!['candidate', 'employer'].includes(String(input.role)) || input.consent !== true)
          throw new HttpError(400, 'Выберите роль и подтвердите согласие');
        if (!options.development)
          throw new HttpError(
            503,
            'Сначала подключите доставку verification-писем. Регистрация в production пока выключена.',
          );
        const user = store.createUser(
          email,
          password,
          string(input.name, 100),
          input.role as 'candidate' | 'employer',
        );
        const token = randomBytes(24).toString('hex');
        const id = createHash('sha256').update(token).digest('hex');
        store.save('verification', id, user.id, {
          userId: user.id,
          expires: Date.now() + 3600_000,
        });
        store.audit(user.id, 'register', user.id);
        return json(
          response,
          {
            message:
              'Локальное письмо подтверждения подготовлено. В production нужна доставка email.',
            developmentVerificationUrl: `/api/auth/verify?token=${token}`,
          },
          201,
        );
      }
      if (path === '/api/auth/verify' && method === 'GET') {
        const token = url.searchParams.get('token') ?? '';
        const id = createHash('sha256').update(token).digest('hex');
        const verification = store.get<{ userId: string; expires: number }>('verification', id);
        if (!verification || verification.expires < Date.now())
          throw new HttpError(400, 'Ссылка недействительна');
        store.updateUser(verification.userId, { verified: true });
        store.remove('verification', id);
        response.writeHead(303, { Location: '/' });
        response.end();
        return;
      }
      if (path === '/api/auth/bridge' && method === 'POST') {
        if (!options.development || !options.bridgeSecret)
          throw new HttpError(404, 'Метод API не найден');
        const input = await body(request);
        const payload = string(input.payload, 3000);
        const signature = string(input.signature, 64);
        const expected = createHmac('sha256', options.bridgeSecret).update(payload).digest('hex');
        if (
          signature.length !== expected.length ||
          !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        )
          throw new HttpError(403, 'Недействительный вход');
        const identity = object(JSON.parse(payload));
        if (
          !Number.isSafeInteger(identity.at) ||
          Math.abs(Date.now() - Number(identity.at)) > 30_000
        )
          throw new HttpError(403, 'Вход истёк');
        const role = string(identity.role);
        if (!['candidate', 'employer', 'admin'].includes(role))
          throw new HttpError(403, 'Неизвестная роль');
        const owner = string(identity.owner, 200);
        const email =
          owner === 'local_seedy'
            ? `${role}@demo.local`
            : `bridge-${createHash('sha256').update(owner).digest('hex').slice(0, 24)}-${role}@demo.local`;
        let user = store.list<User>('users').find((item) => item.email === email);
        if (!user)
          user = store.createUser(
            email,
            randomBytes(32).toString('hex'),
            'Локальный участник',
            role as User['role'],
            true,
          );
        if (role === 'candidate' && typeof identity.fspId === 'string') {
          const fspId = string(identity.fspId, 100, true);
          const verified = store.get<FspStatus>('fsp-verifications', `${user.id}:${fspId}`);
          user = store.updateUser(user.id, {
            fspId,
            fspVerified: Boolean(verified?.verified && verified.id === fspId),
          });
        }
        response.setHeader(
          'Set-Cookie',
          `sid=${store.session(user)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        );
        return json(response, store.publicUser(user));
      }
      if (path === '/api/auth/login' && method === 'POST') {
        const key = request.socket.remoteAddress ?? 'local';
        const prior = loginAttempts.get(key);
        if (prior && prior.expires > Date.now() && prior.count >= 20)
          throw new HttpError(429, 'Слишком много попыток входа');
        const input = await body(request);
        const user = store.authenticate(string(input.email, 254), string(input.password, 128));
        if (!user) {
          loginAttempts.set(key, {
            count: (prior && prior.expires > Date.now() ? prior.count : 0) + 1,
            expires: Date.now() + 300_000,
          });
          throw new HttpError(401, 'Проверьте данные входа и подтверждение email');
        }
        loginAttempts.delete(key);
        response.setHeader(
          'Set-Cookie',
          `sid=${store.session(user)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${options.development ? '' : '; Secure'}`,
        );
        store.audit(user.id, 'login', user.id);
        return json(response, user);
      }
      if (path === '/api/auth/me' && method === 'GET') return json(response, userFor(request));
      if (path === '/api/auth/logout' && method === 'POST') {
        const token = request.headers.cookie
          ?.split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith('sid='))
          ?.slice(4);
        if (token) store.remove('sessions', createHash('sha256').update(token).digest('hex'));
        response.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return json(response, { ok: true });
      }
      if (path === '/api/openapi.json' && method === 'GET') return json(response, openapi());
      if (path.startsWith('/api/')) {
        const user = userFor(request);
        if (path === '/api/generative-packs' && method === 'GET')
          return json(
            response,
            generativePacks
              .filter((p) => p.enabled)
              .map((p) => ({
                id: p.id,
                name: p.name,
                presentation: p.presentation || null,
                modelCount: p.itemModels.length,
                grades: ['Junior', 'Middle', 'Senior'],
              })),
          );
        if (path === '/api/admin/generative-status' && method === 'GET') {
          requireRole(user, 'admin');
          const exposures = store.list<ExposureRecord>('item-exposures');
          const validationFile = join(options.dataDir, 'assessment-validation-summary.json');
          const assessmentValidation = existsSync(validationFile)
            ? JSON.parse(readFileSync(validationFile, 'utf8'))
            : null;
          return json(response, {
            packs: generativePacks.map((p) => ({
              id: p.id,
              name: p.name,
              enabled: p.enabled,
              models: p.itemModels.map((m) => ({
                id: m.id,
                dimensions: m.measuredDimensions,
                issued: exposures.filter((e) => e.specialization === p.id && e.itemModelId === m.id)
                  .length,
              })),
            })),
            exposures,
            poolItems: adaptive.pool.length,
            calibration: 'provisional; no human pilot',
            assessmentValidation,
            validationMatchesCurrentRevision:
              assessmentValidation?.currentRevision === generatorVersion,
          });
        }
        if (path === '/api/admin/adaptive-sessions' && method === 'GET') {
          requireRole(user, 'admin');
          return json(
            response,
            store.list<AdaptiveSession>('adaptive-sessions').map((s) => ({
              id: s.id,
              specialization: s.specialization,
              targetGrade: s.targetGrade,
              state: s.state,
              startedAt: s.startedAt,
            })),
          );
        }
        const evaluatorRoute = path.match(
          /^\/api\/admin\/adaptive-sessions\/([^/]+)(?:\/(export))?$/,
        );
        if (evaluatorRoute && method === 'GET') {
          requireRole(user, 'admin');
          const session = store.get<AdaptiveSession>('adaptive-sessions', evaluatorRoute[1]!);
          if (!session) throw new HttpError(404, 'Проверка не найдена');
          if (evaluatorRoute[2]) {
            response.setHeader(
              'Content-Disposition',
              `attachment; filename="assessment-pilot-${session.id}.json"`,
            );
            return json(response, {
              format: 'assessment-expert-pilot-1',
              candidate: session.candidateId,
              declaredGrade: session.targetGrade,
              specialization: session.specialization,
              seed: session.seed,
              generation: session.generation,
              items: session.items.map((item) => item.variant),
              answers: session.responses,
              telemetry: sessionTelemetry(session),
              dimensionResults: session.result?.dimensions || [],
              finalResult: session.result,
              expertAssessment: null,
            });
          }
          return json(response, {
            telemetry: sessionTelemetry(session),
            seed: session.seed,
            generation: session.generation,
            items: session.items.map((i) => i.variant),
          });
        }
        if (path === '/api/adaptive-sessions') {
          requireRole(user, 'candidate');
          if (method === 'GET') return json(response, adaptive.list(user.id));
          if (method === 'POST') {
            const input = await body(request);
            const targetGrade = string(input.targetGrade);
            if (!grades.includes(targetGrade as Grade))
              throw new HttpError(400, 'Выберите заявленный грейд');
            return json(
              response,
              adaptive.create(user.id, targetGrade as Grade, string(input.specialization)),
              201,
            );
          }
          throw new HttpError(405, 'Действие не поддерживается');
        }
        const adaptiveRoute = path.match(
          /^\/api\/adaptive-sessions\/([^/]+)(?:\/(answer|evidence|telemetry|profile-result))?$/,
        );
        if (adaptiveRoute) {
          requireRole(user, 'candidate');
          const id = adaptiveRoute[1]!;
          const action = adaptiveRoute[2];
          const session = adaptive.get(id, user.id);
          if (!session) throw new HttpError(404, 'Проверка не найдена');
          if (method === 'GET' && !action) return json(response, publicAdaptiveSession(session));
          if (method === 'GET' && action === 'profile-result') {
            const signature = request.headers['x-assessment-bridge'];
            const expected = options.bridgeSecret
              ? createHmac('sha256', options.bridgeSecret).update(id).digest('hex')
              : '';
            if (
              typeof signature !== 'string' ||
              !expected ||
              signature.length !== expected.length ||
              !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
            )
              throw new HttpError(403, 'Внутренний endpoint интеграции');
            return json(response, { ...publicAdaptiveSession(session), result: session.result });
          }
          if (method === 'GET' && action === 'telemetry') {
            if (session.state !== 'completed')
              throw new HttpError(409, 'Telemetry доступна после завершения проверки');
            return json(response, {
              startedAt: session.startedAt,
              finishedAt: session.finishedAt,
              items: session.items.map((i) => ({ itemId: i.variant.id, stage: i.stage })),
              responses: session.responses.map((r) => ({
                itemId: r.itemId,
                stepId: r.stepId,
                optionId: r.optionId,
                responseTimeMs: r.responseTimeMs,
              })),
              evidenceSelections: session.evidenceSelections.map((e) => ({
                artifactId: e.artifactId,
                artifactType: e.artifactType,
                order: e.order,
                selectedAt: e.at,
              })),
            });
          }
          if (method === 'POST' && (action === 'answer' || action === 'evidence')) {
            const input = await body(request);
            const updated = adaptive.mutate(id, user.id, action, {
              itemId: string(input.itemId),
              stepId: string(input.stepId),
              ...(action === 'answer'
                ? {
                    optionId: string(input.optionId),
                    ...(input.execution !== undefined
                      ? { execution: object(input.execution) as Plan }
                      : {}),
                  }
                : { artifactId: string(input.artifactId) }),
            });
            return json(response, updated);
          }
          throw new HttpError(405, 'Действие не поддерживается');
        }
        if (path === '/api/admin/adaptive-telemetry' && method === 'GET') {
          requireRole(user, 'admin');
          adaptive.sweep();
          return json(
            response,
            store.list<AdaptiveSession>('adaptive-sessions').map(sessionTelemetry),
          );
        }
        if (path === '/api/fsp/status' && method === 'GET') {
          const verified = user.fspId
            ? store.get<FspStatus>('fsp-verifications', `${user.id}:${user.fspId}`)
            : null;
          const valid = Boolean(
            verified?.verified && verified.id === user.fspId && verified.verifiedAt,
          );
          const modeled = modeledFspStatus(user.fspId);
          if (!valid && modeled) return json(response, modeled);
          return json(
            response,
            valid ? { ...verified, verified: true } : { id: user.fspId || null, verified: false },
          );
        }
        if (path === '/api/sessions' && method === 'GET') {
          requireRole(user, 'candidate');
          return json(
            response,
            store.list<AssessmentSession>('assessment-sessions', user.id).map(visibleSession),
          );
        }
        const sessionRoute = path.match(
          /^\/api\/sessions\/([^/]+)(?:\/(archive|resume|workspace))?$/,
        );
        if (sessionRoute) {
          requireRole(user, 'candidate');
          const session = store.get<AssessmentSession>('assessment-sessions', sessionRoute[1]!);
          if (!session || session.candidateId !== user.id)
            throw new HttpError(404, 'Сессия не найдена');
          if (method === 'POST' && sessionRoute[2] === 'workspace') {
            await body(request);
            for (const id of session.assessmentIds) {
              const member = store.get<Assessment>('assessments', id)!;
              if (!member.result && !member.variant.engineering) {
                member.variant = engineeringVariant(member.variant, 'legacy');
                engineeringProgress(member);
                store.save('assessments', id, user.id, member);
              }
            }
            session.format = 'engineering-v1';
            store.save('assessment-sessions', session.id, user.id, session);
            return json(response, visibleSession(session));
          }
          if (method === 'POST' && sessionRoute[2]) {
            await body(request);
            if (session.state === 'submitted') throw new HttpError(409, 'Сессия уже завершена');
            const state = sessionRoute[2] === 'archive' ? 'archived' : 'active';
            const retryAt = expressRetryAt(
              store.list<Assessment>('assessments', user.id),
              session.trackId,
              session.grade,
            );
            if (
              state === 'active' &&
              session.state === 'archived' &&
              !session.needId &&
              retryAt &&
              Date.parse(retryAt) > Date.now()
            )
              throw new HttpError(
                409,
                `Повтор ${session.grade} доступен ${retryAt}. Другой уровень можно пройти сейчас.`,
              );
            if (
              state === 'active' &&
              session.state !== 'active' &&
              store
                .list<AssessmentSession>('assessment-sessions', user.id)
                .some((item) => item.state === 'active')
            )
              throw new HttpError(409, 'Сначала завершите или отложите текущую сессию');
            session.state = state;
            for (const id of session.assessmentIds) {
              const assessment = store.get<Assessment>('assessments', id)!;
              if (!assessment.result) {
                assessment.state = state;
                store.save('assessments', id, user.id, assessment);
              }
            }
            store.save('assessment-sessions', session.id, user.id, session);
          } else if (method !== 'GET') throw new HttpError(405, 'Действие не поддерживается');
          return json(response, visibleSession(session));
        }
        if (path === '/api/sessions' && method === 'POST') {
          requireRole(user, 'candidate');
          if (pendingPrograms.has(user.id)) throw new HttpError(409, 'Сессия уже создаётся');
          pendingPrograms.add(user.id);
          try {
            if (!user.consent) throw new HttpError(400, 'Для прохождения требуется согласие');
            const input = await body(request);
            const need =
              typeof input.needId === 'string' ? store.get<Need>('needs', input.needId) : null;
            if (input.needId && !need) throw new HttpError(404, 'Потребность не найдена');
            const trackId = need?.trackId ?? string(input.trackId);
            getTrack(trackId);
            const selectedGrade = need?.grade ?? grade(input.grade);
            const engineering = input.format === 'engineering-v1';
            const express = input.format === 'express-v1';
            const activePrograms = store
              .list<AssessmentSession>('assessment-sessions', user.id)
              .filter((item) => item.state === 'active');
            const replaceOld =
              express &&
              input.replaceCurrent === true &&
              activePrograms.every((item) => item.format !== 'express-v1');
            if (
              !replaceOld &&
              store
                .list<AssessmentSession>('assessment-sessions', user.id)
                .some((item) => item.state === 'active')
            )
              throw new HttpError(409, 'Продолжите текущую сессию или отложите её в архив');
            const previous = latestLevelChange(
              store
                .list<AssessmentSession>('assessment-sessions', user.id)
                .filter(
                  (item) => item.trackId === trackId && !item.needId && item.state === 'submitted',
                )
                .filter(
                  (item) =>
                    sessionResult(
                      item,
                      item.assessmentIds.map((id) => store.get<Assessment>('assessments', id)!),
                    )?.proposedGrade,
                ),
            );
            const retryAt = expressRetryAt(
              store.list<Assessment>('assessments', user.id),
              trackId,
              selectedGrade,
            );
            if (!need && retryAt && Date.parse(retryAt) > Date.now())
              throw new HttpError(
                409,
                `Повтор ${selectedGrade} доступен ${retryAt}. Другой уровень можно пройти сейчас.`,
              );
            if (
              !engineering &&
              !express &&
              !need &&
              previous &&
              previous.grade !== selectedGrade &&
              Date.now() - Date.parse(previous.at) < 90 * 86400_000
            )
              throw new HttpError(
                409,
                'Смена уровня доступна через 90 дней. Текущий уровень можно проверить повторно.',
              );
            const available = familyCatalog().filter(
              (family) =>
                family.trackId === trackId &&
                (!need?.familyIds?.length || need.familyIds.includes(family.id)),
            );
            available.sort(
              (a, b) =>
                b.skills.reduce((sum, skill) => sum + (need?.weights[skill] ?? 0), 0) -
                a.skills.reduce((sum, skill) => sum + (need?.weights[skill] ?? 0), 0),
            );
            if (!available.length || (!need && !express && available.length < 2))
              throw new HttpError(400, 'Программа проверки ещё не подготовлена');
            const session: AssessmentSession = {
              id: randomUUID(),
              candidateId: user.id,
              trackId,
              grade: selectedGrade,
              needId: need?.id ?? null,
              assessmentIds: [],
              createdAt: new Date().toISOString(),
              state: 'active',
              ...(engineering
                ? { format: 'engineering-v1' as const }
                : express
                  ? { format: 'express-v1' as const }
                  : {}),
            };
            const issued = store.list<Assessment>('assessments').map((item) => item.variant);
            const selectedFamilies = express
              ? [
                  available.find(
                    (family) =>
                      trackId === 'backend' && family.id === 'backend-payment-idempotency',
                  ) || available[0]!,
                ]
              : available;
            const members = selectedFamilies.map((family): Assessment => {
              let variant = express
                ? generateExpressVariant(trackId, selectedGrade, issued, family.id)
                : generateUniqueVariant(
                    trackId,
                    engineering ? 'Middle' : selectedGrade,
                    need?.toolMode ?? mode(input.toolMode ?? 'docs'),
                    issued,
                    family.id,
                  );
              if (engineering) variant = engineeringVariant({ ...variant, grade: selectedGrade });
              preflight(variant);
              return {
                id: randomUUID(),
                candidateId: user.id,
                sessionId: session.id,
                needId: need?.id ?? null,
                variant,
                stage: 0,
                state: 'active',
                experiments: [],
                answers: {},
                recommendation: '',
                createdAt: session.createdAt,
                submittedAt: null,
                result: null,
              };
            });
            session.assessmentIds = members.map((item) => item.id);
            if (engineering)
              for (const member of members)
                member.variant = await enrichEngineeringArtifact(member.variant);
            store.db.exec('BEGIN');
            try {
              if (replaceOld)
                for (const prior of activePrograms) {
                  prior.state = 'archived';
                  store.save('assessment-sessions', prior.id, user.id, prior);
                  for (const id of prior.assessmentIds) {
                    const member = store.get<Assessment>('assessments', id)!;
                    if (!member.result) {
                      member.state = 'archived';
                      store.save('assessments', id, user.id, member);
                    }
                  }
                }
              for (const member of members) store.save('assessments', member.id, user.id, member);
              store.save('assessment-sessions', session.id, user.id, session);
              store.db.exec('COMMIT');
            } catch (error) {
              store.db.exec('ROLLBACK');
              throw error;
            }
            return json(response, visibleSession(session), 201);
          } finally {
            pendingPrograms.delete(user.id);
          }
        }
        if (path === '/api/profile' && method === 'PATCH') {
          const input = await body(request);
          const updated = store.updateUser(user.id, {
            name: string(input.name, 100),
            contacts: string(input.contacts, 300),
            consent: input.consent === true,
            fspId: string(input.fspId, 100, true),
            fspVerified: false,
            stack: list(input.stack),
          });
          store.audit(user.id, 'profile_update', user.id);
          return json(response, updated);
        }
        if (path === '/api/needs' && method === 'GET')
          return json(
            response,
            store.list<Need>('needs', user.role === 'employer' ? user.id : undefined),
          );
        if (path === '/api/needs' && method === 'POST') {
          requireRole(user, 'employer');
          const input = await body(request);
          const track = getTrack(string(input.trackId));
          const required = list(input.required, track.skills);
          const rawWeights = object(input.weights);
          const weights: Record<string, number> = {};
          for (const [skill, value] of Object.entries(rawWeights)) {
            if (!track.skills.includes(skill))
              throw new HttpError(400, 'Компетенция не относится к специализации');
            weights[skill] = integer(value, 0, 10);
          }
          if (!required.length || !Object.values(weights).some((weight) => weight > 0))
            throw new HttpError(400, 'Выберите обязательные навыки и положительные веса');
          const salaryMin = integer(input.salaryMin, 1, 10_000_000);
          const salaryMax = integer(input.salaryMax, salaryMin, 10_000_000);
          const need: Need = {
            id: randomUUID(),
            employerId: user.id,
            title: string(input.title, 200),
            trackId: track.id,
            grade: grade(input.grade),
            required,
            weights,
            stack: list(input.stack),
            toolMode: mode(input.toolMode),
            salaryMin,
            salaryMax,
            description: string(input.description, 5000),
          };
          if (input.familyIds !== undefined) {
            need.familyIds = list(
              input.familyIds,
              familyCatalog()
                .filter((family) => family.trackId === track.id)
                .map((family) => family.id),
            );
            if (!need.familyIds.length)
              throw new HttpError(400, 'Выберите хотя бы одно семейство проверки');
          }
          store.save('needs', need.id, user.id, need);
          store.audit(user.id, 'need_create', need.id);
          const selectedFamily = chooseFamily(
            track.id,
            need.required,
            need.weights,
            need.familyIds,
          );
          return json(
            response,
            {
              ...need,
              blueprint: {
                familyId: selectedFamily,
                ...familyCoverage(track, selectedFamily),
                experimental: true,
                explanation:
                  'Семейство выбрано по обязательным компетенциям и весам без ИИ. Другие требования остаются отдельными проверками.',
              },
            },
            201,
          );
        }
        if (path === '/api/assessments' && method === 'GET') {
          requireRole(user, 'candidate', 'admin');
          return json(
            response,
            store
              .list<Assessment>('assessments', user.role === 'admin' ? undefined : user.id)
              .map(visibleAssessment),
          );
        }
        if (path === '/api/assessments' && method === 'POST') {
          requireRole(user, 'candidate');
          if (!user.consent) throw new HttpError(400, 'Для прохождения требуется согласие');
          const input = await body(request);
          const need =
            typeof input.needId === 'string' ? store.get<Need>('needs', input.needId) : null;
          if (input.needId && !need) throw new HttpError(404, 'Потребность не найдена');
          const trackId = need?.trackId ?? string(input.trackId);
          const selectedGrade = need?.grade ?? grade(input.grade);
          const previous = store.list<Assessment>('assessments', user.id);
          if (previous.filter((item) => item.state === 'active').length >= 5)
            throw new HttpError(409, 'Завершите открытые испытания или отправьте ненужные в архив');
          const successful = previous
            .filter(
              (item) =>
                item.variant.trackId === trackId && item.result?.proposedGrade && item.submittedAt,
            )
            .sort((a, b) => b.submittedAt!.localeCompare(a.submittedAt!))[0];
          if (
            !need &&
            successful &&
            successful.variant.grade !== selectedGrade &&
            Date.now() - Date.parse(successful.submittedAt!) < 90 * 86400_000
          )
            throw new HttpError(
              409,
              'Изменение предварительного уровня доступно через 90 дней; текущий результат не понижается',
            );
          const familyId = need
            ? chooseFamily(trackId, need.required, need.weights, need.familyIds)
            : typeof input.familyId === 'string' && input.familyId
              ? input.familyId
              : undefined;
          const assessment: Assessment = {
            id: randomUUID(),
            candidateId: user.id,
            needId: need?.id ?? null,
            variant: generateUniqueVariant(
              trackId,
              selectedGrade,
              need?.toolMode ?? mode(input.toolMode ?? 'local'),
              store.list<Assessment>('assessments').map((item) => item.variant),
              familyId,
            ),
            stage: 0,
            state: 'active',
            experiments: [],
            answers: {},
            recommendation: '',
            createdAt: new Date().toISOString(),
            submittedAt: null,
            result: null,
          };
          preflight(assessment.variant);
          store.save('assessments', assessment.id, user.id, assessment);
          store.audit(user.id, 'assessment_create', assessment.id);
          return json(response, visibleAssessment(assessment), 201);
        }
        const assessmentRoute = path.match(
          /^\/api\/assessments\/([^/]+)(?:\/(answers|advance|experiments|assistant|submit|archive|resume|engineering))?$/,
        );
        if (assessmentRoute) {
          let assessment = assessmentFor(user, assessmentRoute[1]!);
          const action = assessmentRoute[2];
          if (method === 'GET' && !action) return json(response, visibleAssessment(assessment));
          requireRole(user, 'candidate');
          if (method === 'POST' && (action === 'archive' || action === 'resume')) {
            await body(request);
            assessment = assessmentFor(user, assessmentRoute[1]!);
            if (assessment.sessionId)
              throw new HttpError(409, 'Управляйте сессией целиком через историю сессий');
            if (assessment.state === 'submitted' || assessment.result)
              throw new HttpError(409, 'Завершённая работа остаётся в истории результатов');
            if (
              action === 'resume' &&
              assessment.state === 'archived' &&
              store
                .list<Assessment>('assessments', user.id)
                .filter((item) => item.state === 'active').length >= 5
            )
              throw new HttpError(
                409,
                'Отправьте одну из открытых проверок в архив перед восстановлением',
              );
            assessment.state = action === 'archive' ? 'archived' : 'active';
            store.save('assessments', assessment.id, assessment.candidateId, assessment);
            store.audit(user.id, `assessment_${action}`, assessment.id);
            return json(response, visibleAssessment(assessment));
          }
          if (method === 'POST' && action === 'engineering') {
            if (!assessment.variant.engineering)
              throw new HttpError(409, 'Кейс ещё не переведён в инженерный формат');
            active(assessment);
            const input = await body(request);
            const progress = engineeringProgress(assessment);
            try {
              if (input.operation === 'audit') recordAudit(assessment, object(input.audit));
              else if (input.operation === 'theory') {
                const answers = object(input.answers);
                for (const [id, value] of Object.entries(answers)) {
                  const question = assessment.variant.questions.find((item) => item.id === id);
                  if (!question?.options.some((option) => option.id === value))
                    throw new Error('Недопустимый ответ');
                  assessment.answers[id] = String(value);
                }
              } else if (input.operation === 'strategy') {
                const stage = integer(input.stage, 1, 2) as 1 | 2;
                if (assessment.experiments.length >= 60)
                  throw new Error('Лимит виртуальных тестов: 60 запусков на кейс');
                assessment.experiments.push(
                  assessment.variant.engineering.version === 'express-v1'
                    ? expressExperiment(
                        assessment,
                        stage,
                        string(input.strategyId, 100),
                        input.adaptationId === undefined
                          ? undefined
                          : string(input.adaptationId, 100),
                      )
                    : engineeringExperiment(assessment, stage, object(input.plan) as Plan),
                );
              } else if (input.operation === 'diagnostic') {
                const diagnostic = engineeringDiagnostic(
                  assessment,
                  string(input.nodeId, 100),
                  string(input.kind, 20) as DiagnosticKind,
                  string(input.question, 3000, true),
                  input.stage === undefined ? 1 : (integer(input.stage, 1, 2) as 1 | 2),
                );
                let live = false;
                if (
                  assessment.variant.engineering.version !== 'express-v1' &&
                  process.env.LLM_LIVE_ENABLED === 'true' &&
                  llmProfiles[assessment.variant.stageModes[1]!]!.model
                ) {
                  const response = await help(
                    store,
                    { ...assessment, stage: 1 },
                    `${string(input.question, 3000, true) || 'Объясни диагностическую гипотезу'}\nДиагностика симулятора:\n${diagnostic.text}`.slice(
                      0,
                      3000,
                    ),
                  );
                  diagnostic.text += `\n\nИнтерпретация LLM:\n${response.text}`;
                  progress.diagnostics.at(-1)!.text = diagnostic.text;
                  live = response.live;
                }
                store.save('assessments', assessment.id, user.id, assessment);
                return json(response, { ...diagnostic, live, progress });
              } else if (input.operation === 'submit') {
                if (
                  !progress.auditSaved ||
                  assessment.variant.questions.some(
                    (question) => !assessment.answers[question.id],
                  ) ||
                  ![1, 2].every((stage) =>
                    assessment.experiments.some((item) => item.stage === stage && item.engineering),
                  )
                )
                  throw new Error(
                    'Для завершения нужны теория, сохранённый аудит и оба стресс-теста. Порядок выполнения свободный.',
                  );
                assessment.result = evaluate(assessment);
                assessment.state = 'submitted';
                assessment.submittedAt = new Date().toISOString();
              } else throw new Error('Неизвестное действие');
            } catch (failure) {
              throw new HttpError(400, (failure as Error).message);
            }
            store.save('assessments', assessment.id, user.id, assessment);
            if (assessment.sessionId) {
              const program = store.get<AssessmentSession>(
                'assessment-sessions',
                assessment.sessionId,
              )!;
              if (
                program.assessmentIds.every(
                  (id) => store.get<Assessment>('assessments', id)?.result,
                )
              ) {
                program.state = 'submitted';
                program.submittedAt = assessment.submittedAt!;
                store.save('assessment-sessions', program.id, user.id, program);
              }
            }
            return json(response, visibleAssessment(assessment));
          }
          active(assessment);
          const input = await body(request);
          assessment = assessmentFor(user, assessmentRoute[1]!);
          active(assessment);
          if (assessment.variant.engineering)
            throw new HttpError(409, 'Используйте действия инженерного кейса');
          if (method === 'POST' && action === 'answers') {
            if (assessment.stage !== 0) throw new HttpError(409, 'Теоретический этап уже закрыт');
            const answers = object(input.answers);
            for (const question of assessment.variant.questions) {
              const answer = answers[question.id];
              if (!question.options.some((option) => option.id === answer))
                throw new HttpError(400, 'Ответьте на все вопросы');
              assessment.answers[question.id] = String(answer);
            }
          } else if (method === 'POST' && action === 'advance') {
            if (
              assessment.stage === 0 &&
              assessment.variant.questions.some((question) => !assessment.answers[question.id])
            )
              throw new HttpError(409, 'Сначала завершите теоретическую часть');
            if (
              assessment.stage === 1 &&
              !assessment.experiments.some((experiment) => experiment.stage === 1)
            )
              throw new HttpError(409, 'Сначала выполните основной эксперимент');
            if (assessment.stage >= 2) throw new HttpError(409, 'Последний этап уже открыт');
            assessment.stage++;
          } else if (method === 'POST' && action === 'experiments') {
            if (assessment.stage === 0) throw new HttpError(409, 'Практическая часть ещё закрыта');
            if (assessment.experiments.length >= 12)
              throw new HttpError(409, 'Бюджет экспериментов исчерпан');
            const experimentInput: ExperimentInput = {};
            if (input.plan !== undefined)
              experimentInput.plan = object(input.plan) as NonNullable<ExperimentInput['plan']>;
            if (input.features !== undefined) experimentInput.features = list(input.features);
            if (input.split !== undefined) experimentInput.split = string(input.split, 20);
            if (input.strategy !== undefined) experimentInput.strategy = string(input.strategy, 20);
            if (input.policy !== undefined) experimentInput.policy = string(input.policy, 30);
            if (input.topK !== undefined) experimentInput.topK = integer(input.topK, 1, 5);
            assessment.experiments.push(
              runExperiment(assessment.variant, experimentInput, assessment.stage),
            );
          } else if (method === 'POST' && action === 'assistant') {
            return json(response, await help(store, assessment, string(input.question, 3000)));
          } else if (method === 'POST' && action === 'submit') {
            if (
              assessment.stage !== 2 ||
              !assessment.experiments.some((experiment) => experiment.stage === 2)
            )
              throw new HttpError(409, 'Пройдите проверку изменения условий');
            assessment.recommendation = string(input.recommendation, 10000);
            assessment.state = 'submitted';
            assessment.submittedAt = new Date().toISOString();
            assessment.result = evaluate(assessment);
          } else throw new HttpError(405, 'Действие не поддерживается');
          store.save('assessments', assessment.id, assessment.candidateId, assessment);
          if (assessment.sessionId && assessment.result) {
            const session = store.get<AssessmentSession>(
              'assessment-sessions',
              assessment.sessionId,
            )!;
            if (
              session.assessmentIds.every((id) => store.get<Assessment>('assessments', id)?.result)
            ) {
              session.state = 'submitted';
              session.submittedAt = assessment.submittedAt!;
              store.save('assessment-sessions', session.id, session.candidateId, session);
            }
          }
          store.audit(user.id, `assessment_${action}`, assessment.id);
          return json(response, visibleAssessment(assessment));
        }
        if (path === '/api/cases' && method === 'POST') {
          requireRole(user, 'employer');
          const input = await body(request);
          const track = getTrack(string(input.trackId));
          const materials = input.materials;
          if (!Array.isArray(materials) || !materials.length || materials.length > 10)
            throw new HttpError(400, 'Добавьте 1–10 материалов');
          const questions = input.questions;
          if (!Array.isArray(questions) || questions.length > 10)
            throw new HttpError(400, 'Некорректный набор проверок');
          const answers: Record<string, string> = {};
          const checkedQuestions = questions.map((entry, index) => {
            const item = object(entry);
            const options = list(item.options);
            const correct = integer(item.correct, 0, options.length - 1);
            const id = `custom-${index}`;
            answers[id] = String(correct);
            return {
              id,
              prompt: string(item.prompt, 1000),
              options: options.map((text, option) => ({ id: String(option), text })),
              points: 5,
              skill: string(item.skill, 100),
            };
          });
          const record: CustomCase = {
            id: randomUUID(),
            employerId: user.id,
            title: string(input.title, 200),
            trackId: track.id,
            skills: list(input.skills, track.skills),
            context: string(input.context, 5000),
            deliverable: string(input.deliverable, 3000),
            constraints: string(input.constraints, 3000),
            materials: materials.map((entry) => {
              const item = object(entry);
              return { name: string(item.name, 100), content: string(item.content, 10000) };
            }),
            questions: checkedQuestions,
            answers,
            variations: list(input.variations),
            rubric: string(input.rubric, 5000),
            mode: mode(input.mode),
            status: 'draft',
          };
          for (const variation of record.variations)
            if (!/^[a-z][a-z0-9_]*=\d+:\d+$/.test(variation))
              throw new HttpError(400, 'Вариация задаётся как days=3:20');
          store.save('cases', record.id, user.id, record);
          return json(response, record, 201);
        }
        if (path === '/api/cases' && method === 'GET') {
          const cases = store
            .list<CustomCase>('cases')
            .filter(
              (item) =>
                user.role === 'admin' || item.employerId === user.id || item.status !== 'draft',
            );
          return json(
            response,
            cases.map((item) => {
              const { answers: _answers, ...visible } = item;
              return visible;
            }),
          );
        }
        const caseRoute = path.match(/^\/api\/cases\/([^/]+)\/(publish|variant|submit|assistant)$/);
        if (caseRoute) {
          const record = store.get<CustomCase>('cases', caseRoute[1]!);
          if (!record) throw new HttpError(404, 'Кейс не найден');
          const action = caseRoute[2];
          if (action === 'publish' && method === 'POST') {
            requireRole(user, 'employer');
            if (record.employerId !== user.id) throw new HttpError(404, 'Кейс не найден');
            record.status = 'technical';
            store.save('cases', record.id, user.id, record);
            return json(response, {
              status: record.status,
              warning:
                'Проверена структура. Содержание, равенство вариантов и экспертная рубрика требуют пилота.',
            });
          }
          if (record.status === 'draft' && record.employerId !== user.id && user.role !== 'admin')
            throw new HttpError(404, 'Кейс не найден');
          if (action === 'assistant' && method === 'POST') {
            requireRole(user, 'candidate');
            const input = await body(request);
            const id = string(input.variantId);
            const caseVariant = store
              .list<{ id: string; caseId: string }>('case-variants', user.id)
              .find((item) => item.id === id && item.caseId === record.id);
            if (!caseVariant || store.get('case-submissions', id))
              throw new HttpError(409, 'Вариант недоступен для помощи');
            const variant = generateVariant(record.trackId, 'Middle', 1, record.mode);
            variant.artifacts = record.materials;
            const assessment: Assessment = {
              id,
              candidateId: user.id,
              needId: null,
              variant,
              stage: 1,
              state: 'active',
              experiments: [],
              answers: {},
              recommendation: '',
              createdAt: '',
              submittedAt: null,
              result: null,
            };
            return json(response, await help(store, assessment, string(input.question, 3000)));
          }
          if (action === 'variant' && method === 'GET') {
            const params: Record<string, number> = {};
            for (const variation of record.variations) {
              const [name, bounds] = variation.split('=');
              const [min, max] = bounds!.split(':').map(Number);
              if (max! < min! || max! - min! > 1_000_000)
                throw new HttpError(400, 'Неверные границы вариации');
              params[name!] = min! + (randomBytes(4).readUInt32LE() % (max! - min! + 1));
            }
            const render = (text: string) =>
              text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_match, name: string) =>
                String(params[name] ?? `{{${name}}}`),
              );
            const id = randomUUID();
            const visible = {
              id,
              caseId: record.id,
              title: record.title,
              context: render(record.context),
              deliverable: render(record.deliverable),
              constraints: render(record.constraints),
              materials: record.materials.map((item) => ({
                name: item.name,
                content: render(item.content),
              })),
              questions: record.questions.map((item) => ({
                ...item,
                prompt: render(item.prompt),
                options: item.options.map((option) => ({ ...option, text: render(option.text) })),
              })),
              mode: record.mode,
              experimental: true,
            };
            store.save('case-variants', id, user.id, visible);
            return json(response, visible);
          }
          if (action === 'submit' && method === 'POST') {
            requireRole(user, 'candidate');
            const input = await body(request);
            const variantId = string(input.variantId);
            const variant = store
              .list<{ id: string; caseId: string }>('case-variants', user.id)
              .find((item) => item.id === variantId && item.caseId === record.id);
            if (!variant) throw new HttpError(404, 'Вариант не найден');
            if (store.get('case-submissions', variantId))
              throw new HttpError(409, 'Вариант уже сдан');
            const answers = object(input.answers);
            let correct = 0;
            for (const question of record.questions) {
              if (!question.options.some((option) => option.id === answers[question.id]))
                throw new HttpError(400, 'Ответьте на все вопросы');
              if (answers[question.id] === record.answers[question.id]) correct++;
            }
            const submission = {
              id: variantId,
              caseId: record.id,
              candidateId: user.id,
              recommendation: string(input.recommendation, 10000),
              correct,
              questions: record.questions.length,
              status: 'expert_review',
              affectsGrade: false,
              at: new Date().toISOString(),
            };
            store.save('case-submissions', variantId, user.id, submission);
            return json(response, submission, 201);
          }
          throw new HttpError(405, 'Действие не поддерживается');
        }
        if (path === '/api/candidates' && method === 'GET') {
          requireRole(user, 'employer');
          const needId = url.searchParams.get('needId');
          const need = needId ? store.get<Need>('needs', needId) : null;
          if (needId && (!need || need.employerId !== user.id))
            throw new HttpError(404, 'Потребность не найдена');
          const candidates = store
            .list<User>('users')
            .filter((item) => item.role === 'candidate' && item.consent)
            .flatMap((candidate) => {
              const assessments = store.list<Assessment>('assessments', candidate.id).filter(
                (item) =>
                  !item.needId &&
                  item.result?.proposedGrade &&
                  (!item.sessionId ||
                    (() => {
                      const session = store.get<AssessmentSession>(
                        'assessment-sessions',
                        item.sessionId,
                      )!;
                      return Boolean(
                        sessionResult(
                          session,
                          session.assessmentIds.map((id) =>
                            store.get<Assessment>('assessments', id)!,
                          ),
                        )?.proposedGrade,
                      );
                    })()) &&
                  (!need ||
                    (item.variant.trackId === need.trackId &&
                      grades.indexOf(item.result.proposedGrade) >= grades.indexOf(need.grade))),
              );
              const adaptiveResults = store
                .list<AdaptiveSession>('adaptive-sessions', candidate.id)
                .filter(
                  (s) =>
                    s.result?.decision === 'CONFIRMED' &&
                    (!need ||
                      ((s.specialization === 'devops-sre' ? 'sre' : s.specialization) ===
                        need.trackId &&
                        grades.indexOf(s.targetGrade) >= grades.indexOf(need.grade))),
                );
              if (!assessments.length && !adaptiveResults.length) return [];
              const invitations = store
                .list<Invitation>('invitations')
                .filter(
                  (item) =>
                    item.employerId === user.id &&
                    item.candidateId === candidate.id &&
                    item.status === 'accepted',
                );
              return [
                {
                  id: candidate.id,
                  name: candidate.name,
                  stack: candidate.stack,
                  categories: [
                    ...assessments.map((item) => ({
                      trackId: item.variant.trackId,
                      grade: item.result!.proposedGrade,
                      status: item.result!.status,
                      at: item.submittedAt,
                    })),
                    ...adaptiveResults.map((s) => ({
                      trackId: s.specialization === 'devops-sre' ? 'sre' : s.specialization,
                      grade: s.targetGrade,
                      status: 'provisional',
                      at: s.finishedAt,
                    })),
                  ],
                  fsp: candidate.fspId
                    ? 'Самостоятельно указан; не верифицирован'
                    : 'Истории ФСП нет',
                  contacts: invitations.length ? candidate.contacts : null,
                  matching: need
                    ? matchNeed(need, [
                        ...assessments.map((item) => item.result!),
                        ...adaptiveResults.map((s) => ({
                          score: Math.round(s.result!.band.estimatedScore * 100),
                          maxScore: 100,
                          proposedGrade: s.targetGrade,
                          status: 'provisional' as const,
                          rubricVersion: s.result!.scoringConfigVersion,
                          feedback: [s.result!.reason],
                          evidence: s.result!.dimensions.map((d) => ({
                            skillId: d.dimension,
                            score: Math.round(d.score * 100),
                            source: s.id,
                            explanation: `${d.label}; coverage=${d.coverage}`,
                          })),
                        })),
                      ])
                    : null,
                },
              ];
            });
          candidates.sort((a, b) => (b.matching?.score ?? 0) - (a.matching?.score ?? 0));
          return json(response, candidates);
        }
        if (path === '/api/invitations' && method === 'GET')
          return json(
            response,
            store
              .list<Invitation>('invitations')
              .filter((item) => item.candidateId === user.id || item.employerId === user.id),
          );
        if (path === '/api/invitations' && method === 'POST') {
          requireRole(user, 'employer');
          const input = await body(request);
          const candidateId = string(input.candidateId);
          const candidate = store.get<User>('users', candidateId);
          if (!candidate || candidate.role !== 'candidate' || !candidate.consent)
            throw new HttpError(404, 'Кандидат не найден');
          const salaryMin = integer(input.salaryMin, 1, 10_000_000);
          const salaryMax = integer(input.salaryMax, salaryMin, 10_000_000);
          const invitation: Invitation = {
            id: randomUUID(),
            employerId: user.id,
            candidateId,
            company: user.name,
            description: string(input.description, 5000),
            salaryMin,
            salaryMax,
            employerContact: user.contacts,
            status: 'sent',
            createdAt: new Date().toISOString(),
          };
          store.save('invitations', invitation.id, user.id, invitation);
          return json(response, invitation, 201);
        }
        const invitationRoute = path.match(/^\/api\/invitations\/([^/]+)$/);
        if (invitationRoute && method === 'PATCH') {
          requireRole(user, 'candidate');
          const invitation = store.get<Invitation>('invitations', invitationRoute[1]!);
          if (!invitation || invitation.candidateId !== user.id)
            throw new HttpError(404, 'Приглашение не найдено');
          const input = await body(request);
          if (!['viewed', 'accepted', 'declined'].includes(String(input.status)))
            throw new HttpError(400, 'Неизвестный статус');
          if (['accepted', 'declined'].includes(invitation.status))
            throw new HttpError(409, 'Решение уже принято');
          invitation.status = input.status as Invitation['status'];
          store.save('invitations', invitation.id, invitation.employerId, invitation);
          return json(response, invitation);
        }
        if (path === '/api/admin/reviews' && method === 'GET') {
          requireRole(user, 'admin');
          return json(
            response,
            store
              .list<Assessment>('assessments')
              .filter(
                (item) =>
                  item.state === 'submitted' &&
                  !item.variant.engineering &&
                  !store.get('reviews', item.id),
              )
              .map(visibleAssessment),
          );
        }
        if (path === '/api/admin/reviews' && method === 'POST') {
          requireRole(user, 'admin');
          const input = await body(request);
          const assessment = assessmentFor(user, string(input.assessmentId));
          if (!assessment.result) throw new HttpError(409, 'Работа ещё не сдана');
          if (!['approved', 'needs_revision'].includes(String(input.decision)))
            throw new HttpError(400, 'Неизвестное решение');
          const id = assessment.id;
          const review = {
            id,
            assessmentId: id,
            reviewer: user.id,
            decision: input.decision,
            notes: string(input.notes, 5000),
            at: new Date().toISOString(),
          };
          store.save('reviews', id, user.id, review);
          assessment.expertReview = {
            decision: input.decision as 'approved' | 'needs_revision',
            notes: review.notes,
            at: review.at,
          };
          store.save('assessments', assessment.id, assessment.candidateId, assessment);
          store.audit(user.id, 'expert_review', id);
          return json(response, review);
        }
        if (path === '/api/admin/observations' && method === 'GET') {
          requireRole(user, 'admin');
          return json(response, calibrationReport(store.list<Observation>('observations')));
        }
        if (path === '/api/admin/case-submissions' && method === 'GET') {
          requireRole(user, 'admin');
          return json(
            response,
            store
              .list<Record<string, unknown>>('case-submissions')
              .filter((submission) => submission.status === 'expert_review')
              .map((submission) => ({
                ...submission,
                case: store.get<CustomCase>('cases', String(submission.caseId)),
                variant: store.get('case-variants', String(submission.id)),
              })),
          );
        }
        if (path === '/api/admin/case-submissions' && method === 'POST') {
          requireRole(user, 'admin');
          const input = await body(request);
          const id = string(input.submissionId);
          const submission = store.get<Record<string, unknown>>('case-submissions', id);
          if (!submission) throw new HttpError(404, 'Работа не найдена');
          if (!['approved', 'needs_revision'].includes(String(input.decision)))
            throw new HttpError(400, 'Неизвестное решение');
          const updated = {
            ...submission,
            status: input.decision,
            notes: string(input.notes, 5000),
            reviewer: user.id,
          };
          store.save('case-submissions', id, String(submission.candidateId), updated);
          return json(response, updated);
        }
        if (path === '/api/case-submissions' && method === 'GET')
          return json(
            response,
            store
              .list<Record<string, unknown>>('case-submissions')
              .filter(
                (submission) =>
                  user.role === 'admin' ||
                  submission.candidateId === user.id ||
                  store.get<CustomCase>('cases', String(submission.caseId))?.employerId === user.id,
              ),
          );
        if (path === '/api/admin/observations' && method === 'POST') {
          requireRole(user, 'admin');
          const input = await body(request);
          if (!['standard', 'exposed', 'ai-only'].includes(String(input.condition)))
            throw new HttpError(400, 'Неизвестное условие');
          const observation: Observation = {
            id: randomUUID(),
            participant: string(input.participant, 100),
            familyId: string(input.familyId, 100),
            variantId: string(input.variantId, 100),
            expertGrade: integer(input.expertGrade, 0, 3),
            predictedGrade: integer(input.predictedGrade, 0, 3),
            score: integer(input.score, 0, 100),
            seconds: integer(input.seconds, 1, 86400),
            condition: input.condition as Observation['condition'],
          };
          store.save('observations', observation.id, user.id, observation);
          return json(response, observation, 201);
        }
        if (path === '/api/admin/validation' && method === 'GET') {
          requireRole(user, 'admin');
          const file = join(options.dataDir, 'technical-validation.json');
          return json(
            response,
            existsSync(file)
              ? JSON.parse(readFileSync(file, 'utf8'))
              : { status: 'not_run', instruction: 'pnpm validate' },
          );
        }
        throw new HttpError(404, 'Метод API не найден');
      }
      const files: Record<string, { path: string; mime: string }> = {
        '/': { path: 'public/index.html', mime: 'text/html' },
        '/app.js': { path: 'dist/src/client.js', mime: 'text/javascript' },
        '/presentation.js': { path: 'dist/src/presentation.js', mime: 'text/javascript' },
        '/style.css': { path: 'public/style.css', mime: 'text/css' },
        '/offerly.css': { path: 'public/offerly.css', mime: 'text/css' },
        '/favicon.svg': { path: 'public/favicon.svg', mime: 'image/svg+xml' },
      };
      for (const asset of [
        ['brand/original.svg', 'image/svg+xml'],
        ['brand/fsp.svg', 'image/svg+xml'],
        ['fonts/Manrope.ttf', 'font/ttf'],
        ['fonts/JetBrainsMono-Regular.woff2', 'font/woff2'],
        ['fonts/JetBrainsMono-Bold.woff2', 'font/woff2'],
      ])
        files['/' + asset[0]] = { path: 'public/' + asset[0], mime: asset[1]! };
      if (['/login', '/register', '/register/employer'].includes(path)) files[path] = files['/']!;
      const file = files[path];
      if (!file || method !== 'GET') throw new HttpError(404, 'Страница не найдена');
      response.writeHead(200, {
        'Content-Type': `${file.mime}; charset=utf-8`,
        'Cache-Control': 'no-cache',
      });
      response.end(readFileSync(resolve(file.path)));
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      json(response, { error: error instanceof Error ? error.message : 'Ошибка запроса' }, status);
    }
  });
  let adaptiveSweep: ReturnType<typeof setInterval> | undefined;
  server.on('listening', () => {
    adaptiveSweep = setInterval(() => adaptive.sweep(), 1000);
    adaptiveSweep.unref();
  });
  server.on('close', () => clearInterval(adaptiveSweep));
  return { server };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve('dist/src/server.js')) {
  const development = process.env.APP_ENV !== 'production';
  const dataDir = resolve(process.env.DATA_DIR ?? 'data');
  const store = new Store(join(dataDir, 'platform.sqlite'));
  if (development && store.list('users').length === 0) {
    store.createUser(
      'candidate@demo.local',
      'Demo2026!pass',
      'Алексей · кандидат',
      'candidate',
      true,
    );
    store.createUser('employer@demo.local', 'Demo2026!pass', 'Команда продукта', 'employer', true);
    store.createUser('admin@demo.local', 'Demo2026!pass', 'Эксперт платформы', 'admin', true);
  }
  if (!development && store.list<User>('users').some((user) => user.email.endsWith('@demo.local')))
    throw new Error('Production требует отдельную базу без демонстрационных аккаунтов');
  const { server } = createApplication(store, {
    development,
    dataDir,
    ...(process.env.OFFERLY_BRIDGE_SECRET
      ? { bridgeSecret: process.env.OFFERLY_BRIDGE_SECRET }
      : {}),
  });
  const port = Number(process.env.PORT ?? 4310);
  const host = process.env.HOST ?? '127.0.0.1';
  server.listen(port, host, () =>
    process.stdout.write(
      `Платформа: http://${host}:${port}\nLive LLM: ${process.env.LLM_LIVE_ENABLED === 'true' ? 'включён' : 'выключен'}\n`,
    ),
  );
  const shutdown = () =>
    server.close(() => {
      store.close();
      process.exit(0);
    });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
