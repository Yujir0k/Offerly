import { randomBytes, randomUUID } from 'node:crypto';
import type { Store } from '../store.js';
import { answer, createSession, expireSession, openEvidence, publicSession } from './engine.js';
import type { AssessmentSession, TargetGrade } from './model.js';
import { getPack } from '../generative/packs.js';
import { fingerprint, questionFingerprint } from '../generative/validators.js';
import { loadGeneratedPool } from '../generative/pool.js';
import type { ExposureRecord, GeneratedItem } from '../generative/model.js';
import { gradeConfigs } from './config.js';
import type { Plan } from '../domain.js';

/** Persist complete snapshots atomically in the existing SQLite record store. */
export class AdaptiveService {
  readonly pool: GeneratedItem[];
  constructor(readonly store: Store) {
    this.pool = process.env.GENERATIVE_POOL_FILE
      ? loadGeneratedPool(process.env.GENERATIVE_POOL_FILE)
      : [];
  }
  recordExposure(session: AssessmentSession, now = Date.now()): void {
    const variant =
      session.state === 'active' ? session.items[session.cursor.item]?.variant : undefined;
    const generated = variant?.generated;
    if (!variant || !generated) return;
    const id = fingerprint([session.id, variant.id]);
    if (this.store.get('item-exposures', id)) return;
    const prior = this.store
      .list<ExposureRecord>('item-exposures')
      .filter(
        (r) => r.specialization === session.specialization && r.targetGrade === session.targetGrade,
      );
    const record: ExposureRecord = {
      questionFingerprints: variant.steps.map((step) =>
        questionFingerprint(variant, step, getPack(session.specialization)),
      ),
      specialization: session.specialization,
      targetGrade: session.targetGrade,
      itemModelId: generated.itemModelId,
      siblingGroup: generated.siblingGroup,
      itemModelExposureCount:
        1 + prior.filter((r) => r.itemModelId === generated.itemModelId).length,
      familyExposureCount:
        1 + prior.filter((r) => r.siblingGroup === generated.siblingGroup).length,
      variantExposureCount:
        1 + prior.filter((r) => r.surfaceFingerprint === generated.surfaceFingerprint).length,
      semanticFingerprint: generated.semanticFingerprint,
      surfaceFingerprint: generated.surfaceFingerprint,
      lastUsedAt: new Date(now).toISOString(),
      userId: session.candidateId,
      sessionId: session.id,
    };
    this.store.save('item-exposures', id, session.candidateId, record);
  }
  save(session: AssessmentSession): void {
    this.store.save('adaptive-sessions', session.id, session.candidateId, session);
    if (session.state === 'completed') this.store.remove('question-reservations', session.id);
  }
  /** Upgrade historical exposure records from their frozen content, without rescoring attempts. */
  exposureHistory(): ExposureRecord[] {
    const sessions = new Map<string, AssessmentSession | null>();
    return this.store
      .list<ExposureRecord>('item-exposures')
      .map((record) => {
        if (record.questionFingerprints) return record;
        if (!sessions.has(record.sessionId))
          sessions.set(
            record.sessionId,
            this.store.get<AssessmentSession>('adaptive-sessions', record.sessionId),
          );
        const session = sessions.get(record.sessionId);
        const variant = session?.items.find(
          (item) => item.variant.generated?.surfaceFingerprint === record.surfaceFingerprint,
        )?.variant;
        return variant
          ? {
              ...record,
              questionFingerprints: variant.steps.map((step) =>
                questionFingerprint(variant, step, getPack(record.specialization)),
              ),
            }
          : record;
      })
      .sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt));
  }
  list(owner: string, now = Date.now()) {
    return this.store
      .list<AssessmentSession>('adaptive-sessions', owner)
      .map((s) => {
        if (expireSession(s, now)) this.save(s);
        return publicSession(s, now);
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  get(id: string, owner: string, now = Date.now()): AssessmentSession | null {
    const session = this.store.get<AssessmentSession>('adaptive-sessions', id);
    if (!session || session.candidateId !== owner) return null;
    if (expireSession(session, now)) this.save(session);
    return session;
  }
  create(owner: string, targetGrade: TargetGrade, specialization: string, now = Date.now()) {
    getPack(specialization);
    const sessions = this.list(owner, now);
    if (sessions.some((s) => s.state === 'active'))
      throw new Error('Сначала завершите текущую проверку; таймер продолжает идти');
    const session = createSession(
      `adaptive-${randomUUID()}`,
      owner,
      targetGrade,
      randomBytes(16).toString('hex'),
      now,
      undefined,
      gradeConfigs[targetGrade],
      {
        specialization,
        exposure: this.exposureHistory(),
        excludedQuestionFingerprints: this.store
          .list<{
            specialization: string;
            targetGrade: TargetGrade;
            questions: string[];
          }>('question-reservations')
          .filter(
            (record) =>
              record.specialization === specialization && record.targetGrade === targetGrade,
          )
          .flatMap((record) => record.questions),
        ...(this.pool.length ? { pool: this.pool } : {}),
      },
    );
    this.save(session);
    // Reserve complete active programs, including potential boundary tasks, so
    // interleaved candidates cannot be assigned the same frozen question.
    this.store.save('question-reservations', session.id, owner, {
      specialization,
      targetGrade,
      questions: [...session.items.map((item) => item.variant), ...session.boundaryPool].flatMap(
        (variant) =>
          variant.steps.map((step) => questionFingerprint(variant, step, getPack(specialization))),
      ),
    });
    this.recordExposure(session, now);
    return publicSession(session, now);
  }
  mutate(
    id: string,
    owner: string,
    operation: 'answer' | 'evidence',
    input: {
      itemId: string;
      stepId: string;
      optionId?: string;
      artifactId?: string;
      execution?: Plan;
    },
    now = Date.now(),
  ) {
    const session = this.get(id, owner, now);
    if (!session) return null;
    if (session.state === 'completed') return publicSession(session, now);
    // Synchronous read/validate/write in one event-loop turn prevents lost updates.
    if (operation === 'answer')
      answer(session, input.itemId, input.stepId, input.optionId || '', now, input.execution);
    else openEvidence(session, input.itemId, input.stepId, input.artifactId || '', now);
    this.save(session);
    this.recordExposure(session, now);
    return publicSession(session, now);
  }
  sweep(now = Date.now()): void {
    for (const session of this.store.list<AssessmentSession>('adaptive-sessions'))
      if (expireSession(session, now)) this.save(session);
  }
}
