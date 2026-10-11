import {withAssessmentCapacity} from "./assessment-capacity";
import { settleAssessmentTimeout } from "./assessment-timeout";
import { specialtyName } from "./assessment-tracks";
import {
  retakeEligibility,
  retakePolicy,
  type AttemptSummary,
  type RetakeEligibility,
} from "./assessment-retakes";
// Server-only bridge. Never import this module from a client component.
import "server-only";
import {
  assessmentNavigation,
  navigateIndependent,
  restorePendingAnchor,
  reopenAnswer,
  revisionResetCount,
  type EditableAssessmentSession,
} from "./professional-navigation";
import { getDb, type Database } from "@/db";
import type { Account } from "./platform";
import { AdaptiveService } from "../vendor/fsp-assessment/dist/src/adaptive/service.js";
import { generatorVersion } from "../vendor/fsp-assessment/dist/src/generative/generator.js";
import { publicSession } from "../vendor/fsp-assessment/dist/src/adaptive/engine.js";
import {
  getPack,
  packs,
} from "../vendor/fsp-assessment/dist/src/generative/packs.js";
import type { Store } from "../vendor/fsp-assessment/src/store";
import type {
  AssessmentSession,
  TargetGrade,
} from "../vendor/fsp-assessment/src/adaptive/model";
import type { Plan } from "../vendor/fsp-assessment/src/domain";

type RecordRow = {
  collection: string;
  id: string;
  user_id: string;
  body: unknown;
};
/** Service remains synchronous, but all reads and writes belong to one PG transaction. */
export class TransactionAssessmentStore {
  readonly records = new Map<string, RecordRow>();
  readonly dirty = new Set<string>();
  readonly removed = new Set<string>();
  constructor(rows: RecordRow[]) {
    for (const row of rows)
      this.records.set(this.key(row.collection, row.id), row);
  }
  private key(collection: string, id: string) {
    return `${collection}\0${id}`;
  }
  get<T>(collection: string, id: string): T | null {
    return (this.records.get(this.key(collection, id))?.body as T) ?? null;
  }
  list<T>(collection: string, owner?: string): T[] {
    return [...this.records.values()]
      .filter(
        (r) => r.collection === collection && (!owner || r.user_id === owner),
      )
      .map((r) => r.body as T);
  }
  save(collection: string, id: string, owner: string, body: unknown) {
    const key = this.key(collection, id);
    this.records.set(key, { collection, id, user_id: owner, body });
    this.dirty.add(key);
    this.removed.delete(key);
  }
  remove(collection: string, id: string) {
    const key = this.key(collection, id);
    this.records.delete(key);
    this.dirty.delete(key);
    this.removed.add(key);
  }
  async flush(db: Database, scope: string) {
    for (const key of this.removed) {
      const [collection, id] = key.split("\0");
      await db.query(
        "DELETE FROM professional_assessment_records WHERE scope=$1 AND collection=$2 AND id=$3",
        [scope, collection, id],
      );
    }
    for (const key of this.dirty) {
      const r = this.records.get(key)!;
      await db.query(
        "INSERT INTO professional_assessment_records(scope,collection,id,user_id,body) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(scope,collection,id) DO UPDATE SET body=excluded.body,updated_at=now()",
        [scope, r.collection, r.id, r.user_id, JSON.stringify(r.body)],
      );
    }
  }
}
export class AssessmentHttpError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly details?: RetakeEligibility,
  ) {
    super(message);
  }
}
async function attemptSummaries(
  db: Database,
  account: Account,
): Promise<AttemptSummary[]> {
  const { rows } = await db.query<AttemptSummary>(
    `SELECT id,body->>'specialization' AS specialization,body->>'targetGrade' AS "targetGrade",
      body->>'state' AS state,body->>'finishedAt' AS "finishedAt",body->>'deadlineAt' AS "deadlineAt",
      body->'result'->>'decision' AS decision FROM professional_assessment_records
      WHERE scope=$1 AND user_id=$2 AND collection='adaptive-sessions'`,
    [account.scope, account.id],
  );
  return rows;
}
export async function professionalEligibility(
  account: Account,
  specialization: string,
  grade: string,
) {
  getPack(specialization);
  if (!["Junior", "Middle", "Senior"].includes(grade))
    throw new AssessmentHttpError("Выберите заявленный уровень");
  return retakeEligibility(
    await attemptSummaries(await getDb(), account),
    specialization,
    grade,
    Date.now(),
  );
}
export function professionalPacks() {
  return Object.values(packs)
    .filter((p) => p.enabled)
    .map((p) => ({
      id: p.id,
      name: p.name,
      presentation: p.presentation ?? null,
      grades: ["Junior", "Middle", "Senior"],
    }));
}
const profileSpecialties: Record<string, string> = {
  backend: "Backend",
  frontend: "Frontend",
  "devops-sre": "DevOps / SRE",
  "qa-automation": "QA",
  "data-engineering": "Data Engineering",
  "ml-engineer": "ML Engineer",
  "data-scientist": "Data Scientist",
  mlops: "MLOps",
  genai: "GenAI",
  android: "Android",
  ios: "iOS",
  "security-appsec": "Security Engineering / AppSec",
};

/** Projection preserves frozen engine results, including the explicit timeout-zero policy. */
async function projectCompleted(
  db: Database,
  store: TransactionAssessmentStore,
  owner: string,
) {
  for (const row of store.records.values()) {
    if (row.user_id !== owner) continue;
    if (row.collection !== "adaptive-sessions") continue;
    const s = row.body as AssessmentSession;
    if (s.state !== "completed" || !s.result) continue;
    const {
      rows: [existing],
    } = await db.query("SELECT id FROM assessments WHERE id=$1", [s.id]);
    if (existing) continue; // Never re-score or re-project a frozen historical attempt.
    const {
      rows: [owned],
    } = await db.query(
      "SELECT payload FROM candidate_profiles WHERE user_id=$1 FOR UPDATE",
      [s.candidateId],
    );
    if (!owned) continue;
    const profile = owned.payload;
    const passed = s.result.decision === "CONFIRMED";
    const specialty = specialtyName(
      profileSpecialties[s.specialization] || getPack(s.specialization).name,
    );
    const prior = profile.grade;
    profile.claimed = s.targetGrade;
    const estimate = Math.round(s.result.band.estimatedScore * 100); // weighted evidence estimate, NOT percent of correct questions.
    if (passed) {
      profile.assessmentCategories = {
        ...(profile.assessmentCategories || {}),
        [s.specialization]: {
          grade: s.targetGrade,
          sessionId: s.id,
          confirmedAt: s.finishedAt,
        },
      };
      profile.grade = s.targetGrade;
      profile.specialty = specialty;
      profile.score = estimate;
      profile.assessmentEvidence = {
        confirmedAt: s.finishedAt,
        assessmentVersion: s.assessmentVersion,
        scoringConfigVersion: s.result.scoringConfigVersion,
        dimensions: publicSession(s).result?.dimensions || [],
      };
      if (prior !== s.targetGrade) profile.lastGradeChange = s.finishedAt;
      // Visibility starts enabled at registration; a later explicit opt-out survives testing.
      // Do not turn self-declared technologies into verified skills without skill-level proof.
    }
    await db.query(
      "UPDATE candidate_profiles SET payload=$2,specialty=$3,grade=$4,visible=$5 WHERE user_id=$1",
      [
        s.candidateId,
        JSON.stringify(profile),
        profile.specialty,
        profile.grade,
        profile.visible,
      ],
    );
    await db.query(
      "INSERT INTO assessments(id,user_id,payload) VALUES ($1,$2,$3)",
      [
        s.id,
        s.candidateId,
        JSON.stringify({
          id: s.id,
          specialty,
          grade: s.targetGrade,
          questions: [],
          answers: {},
          score: estimate,
          passed,
          createdAt: s.startedAt,
          completedAt: s.finishedAt,
          previousGrade: prior,
          categoryAfter: profile.grade
            ? `${profile.specialty} ${profile.grade}`
            : null,
          formal: true,
          result: {...publicSession(s).result,...((s.result as typeof s.result & {timeoutSummary?: unknown}).timeoutSummary ? {timeoutSummary:(s.result as typeof s.result & {timeoutSummary?: unknown}).timeoutSummary} : {})},
          assessmentVersion: s.assessmentVersion,
          scoringConfigVersion: s.result.scoringConfigVersion,
        }),
      ],
    );
    await db.query(
      "UPDATE account_state SET version=version+1,payload=jsonb_set(payload,'{journey}',to_jsonb($2::text)) WHERE user_id=$1",
      [s.candidateId, passed ? "complete" : "assessment"],
    );
  }
}

export async function professionalOperation(
  account: Account,
  operation:
    "list" | "get" | "start" | "answer" | "evidence" | "navigate" | "revise",
  input: Record<string, unknown> = {},
  now?: number,
): Promise<ReturnType<typeof publicSession> | ReturnType<typeof publicSession>[] | null> {
  // History returns the same public views, but fetches one immutable snapshot at a time.
  // A candidate can accumulate many large generated programs; materializing all private
  // snapshots in a single pg response caused excessive transient heap under concurrency.
  if (operation === "list") {
    const { rows: history } = await (await getDb()).query<{id: string; view: ReturnType<typeof publicSession> | null}>(
      `SELECT source.id,CASE WHEN source.body->>'state'='completed' THEN cached.body ELSE NULL END AS view
       FROM professional_assessment_records source LEFT JOIN professional_assessment_records cached
       ON cached.scope=source.scope AND cached.user_id=source.user_id AND cached.id=source.id
         AND cached.collection='public-session-views'
       WHERE source.scope=$1 AND source.user_id=$2 AND source.collection='adaptive-sessions'
       ORDER BY source.body->>'startedAt' DESC`,
      [account.scope, account.id],
    );
    const views = [];
    for (const row of history) {
      if (row.view) { views.push({...row.view, serverNow: new Date(now ?? Date.now()).toISOString()}); continue; }
      try { const view = await professionalOperation(account, "get", {id: row.id}, now); if (view && !Array.isArray(view)) views.push(view); }
      catch (error) {
        // Account deletion between independent reads must not expose somebody else's data.
        if (!(error instanceof AssessmentHttpError && error.status === 404)) throw error;
      }
    }
    return views;
  }
  const output = await withAssessmentCapacity(async () => (
    await getDb()
  ).transaction(async (db) => {
    // Lock account first: two tabs cannot create parallel active attempts. Each track has an independent reservation lock.
    await db.query(
      "SELECT user_id FROM account_state WHERE user_id=$1 FOR UPDATE",
      [account.id],
    );
    const { rows: liveAccount } = await db.query(
      "SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL",
      [account.id],
    );
    if (!liveAccount.length) throw new Error("AUTH"); // A queued request cannot recreate data after account deletion.
    const id = String(input.id || "");
    let specialization = String(input.specialization || "backend"),
      grade = String(
        input.targetGrade ?? (operation === "start" ? "" : "Junior"),
      );
    if (
      operation === "get" ||
      operation === "answer" ||
      operation === "evidence" ||
      operation === "navigate" ||
      operation === "revise"
    ) {
      const {
        rows: [r],
      } = await db.query(
        "SELECT body FROM professional_assessment_records WHERE scope=$1 AND collection='adaptive-sessions' AND id=$2 AND user_id=$3",
        [account.scope, id, account.id],
      );
      if (!r) throw new AssessmentHttpError("Проверка не найдена", 404);
      specialization = r.body.specialization;
      grade = r.body.targetGrade;
    }
    if (
      operation === "start" &&
      (typeof input.targetGrade !== "string" ||
        !["Junior", "Middle", "Senior"].includes(grade))
    )
      throw new AssessmentHttpError("Выберите заявленный уровень");
    if (operation === "start") getPack(specialization);
    const { rows: activeTracks } = await db.query<{
      specialization: string;
      grade: string;
    }>(
      "SELECT body->>'specialization' AS specialization,body->>'targetGrade' AS grade FROM professional_assessment_records WHERE user_id=$1 AND collection='adaptive-sessions' AND body->>'state'='active'",
      [account.id],
    );
    // Sweep may finish the owner's previous track. Hold that track too, in stable order,
    // so another worker cannot write a different timeout snapshot over the frozen result.
    const locks = [
      ...new Set([
        `${account.scope}:${specialization}:${grade}`,
        ...activeTracks.map(
          (t) => `${account.scope}:${t.specialization}:${t.grade}`,
        ),
      ]),
    ].sort();
    for (const lock of locks) {
      await db.query(
        "INSERT INTO professional_assessment_locks(id) VALUES ($1) ON CONFLICT DO NOTHING",
        [lock],
      );
      await db.query(
        "SELECT id FROM professional_assessment_locks WHERE id=$1 FOR UPDATE",
        [lock],
      );
    }
    const { rows } = await db.query<RecordRow>(
      `SELECT collection,id,user_id,body FROM professional_assessment_records WHERE scope=$1 AND (
       (collection='adaptive-sessions' AND user_id=$2 AND (body->>'state'='active' OR id=$5 OR $6))
       OR (body->>'specialization'=$3 AND body->>'targetGrade'=$4 AND (collection NOT IN ('adaptive-sessions','public-session-views') OR (collection='adaptive-sessions' AND body->>'state'='active')))
    )`,
      [
        account.scope,
        account.id,
        specialization,
        grade,
        id,
        false,
      ],
    );
    now ??= Date.now(); // Check the deadline after transaction locks, never at request arrival.
    const store = new TransactionAssessmentStore(rows),
      service = new AdaptiveService(store as unknown as Store);
    for (const session of store.list<AssessmentSession>("adaptive-sessions")) {
      if (
        session.state === "active" &&
        session.generation?.generatorVersion !== generatorVersion
      )
        throw new AssessmentHttpError(
          "Для этой попытки требуется сохранённая версия методики",
          409,
        );
    }
    for(const session of store.list<AssessmentSession>("adaptive-sessions")) {
      if(settleAssessmentTimeout(session,now))service.save(session);
    }
    service.sweep(now);
    let result;
    if (operation === "get")
      result = publicSession(service.get(id, account.id, now)!, now);
    else if (operation === "start") {
      const active = service
        .list(account.id, now)
        .find((s) => s.state === "active");
      if (
        active &&
        active.specialization === specialization &&
        active.targetGrade === grade
      )
        result = active;
      else {
        const eligibility = retakeEligibility(
          await attemptSummaries(db, account),
          specialization,
          grade,
          now,
        );
        if (!eligibility.allowed) {
          // Commit timeout sweep/reservation release even when the new start is denied.
          await store.flush(db, account.scope);
          await projectCompleted(db, store, account.id);
          return new AssessmentHttpError(
            `Следующая проверка доступна ${new Date(eligibility.nextEligibleAt!).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} (МСК).`,
            429,
            eligibility,
          );
        }
        result = service.create(
          account.id,
          grade as TargetGrade,
          specialization,
          now,
        );
        const snapshot = service.get(
          result.id,
          account.id,
          now,
        )! as EditableAssessmentSession;
        snapshot.retakePolicy = { ...retakePolicy };
        service.save(snapshot);
      }
    } else {
      const session = service.get(
        id,
        account.id,
        now,
      )! as EditableAssessmentSession;
      if(session.state==='completed'&&session.result?.stopReason==='timeout') {
        await store.flush(db,account.scope);
        await projectCompleted(db,store,account.id);
        return new AssessmentHttpError('Время проверки истекло. Выполнение закрыто, результат сохранён.',409);
      }
      if (operation === "revise" && session.state !== "active")
        throw new AssessmentHttpError(
          "Завершённую проверку нельзя изменить",
          409,
        );
      const itemId = String(input.itemId || ""),
        stepId = String(input.stepId || "");
      const existing = session.responses.find(
        (r) => r.itemId === itemId && r.stepId === stepId,
      );
      if (
        session.state === "active" &&
        (operation === "revise" ||
          input.interactionRevision !== undefined ||
          session.answerRevisions?.length)
      ) {
        if (
          input.interactionRevision !== (session.interactionRevision || 0) &&
          !(
            operation === "answer" &&
            existing &&
            existing.optionId === String(input.optionId || "") &&
            canonical(existing.execution || {}) ===
              canonical(input.execution || {})
          )
        )
          throw new AssessmentHttpError(
            "Ответы изменились в другой вкладке. Обновите страницу и повторите",
            409,
          );
      }
      const replayEvidence = session.evidenceSelections.some(
        (r) => r.itemId === itemId && r.artifactId === input.artifactId,
      );
      if (operation === "revise") {
        reopenAnswer(session, itemId, stepId, now);
        service.save(session);
        result = publicSession(session, now);
      } else if (operation === "navigate") {
        if (session.state === "active") {
          navigateIndependent(session, itemId, stepId, now);
          service.save(session);
          service.recordExposure(session, now);
        }
        result = publicSession(session, now);
      } else if (operation === "answer" && existing) {
        if (
          existing.optionId !== String(input.optionId || "") ||
          canonical(existing.execution || {}) !==
            canonical(input.execution || {})
        )
          throw new AssessmentHttpError(
            "Этот шаг уже сохранён с другим ответом",
            409,
          );
        result = publicSession(session, now);
      } else if (operation === "evidence" && replayEvidence)
        result = publicSession(session, now);
      else {
        if (session.reviewCursor && session.state === "active")
          throw new AssessmentHttpError(
            "Сначала нажмите «Изменить ответ»",
            409,
          );
        const wasAnchor =
          operation === "answer" &&
          session.items[session.cursor.item]?.stage === "anchors";
        result = service.mutate(
          id,
          account.id,
          operation,
          {
            itemId,
            stepId,
            ...(typeof input.optionId === "string"
              ? { optionId: input.optionId }
              : {}),
            ...(typeof input.artifactId === "string"
              ? { artifactId: input.artifactId }
              : {}),
            ...(input.execution &&
            typeof input.execution === "object" &&
            !Array.isArray(input.execution)
              ? { execution: input.execution as Plan }
              : {}),
          },
          now,
        );
        if (wasAnchor && session.state === "active") {
          restorePendingAnchor(session, true, now);
          service.save(session);
          service.recordExposure(session, now);
          result = publicSession(session, now);
        }
      }
    }
    if (!Array.isArray(result) && result) {
      const saved = store.get<EditableAssessmentSession>(
        "adaptive-sessions",
        result.id,
      );
      if (
        saved &&
        !["list", "get", "start"].includes(operation) &&
        saved.state === "active"
      ) {
        saved.interactionRevision = (saved.interactionRevision || 0) + 1;
        service.save(saved);
      }
    }
    const navigable = Array.isArray(result) ? result : [result];
    for (const view of navigable) {
      if (!view) continue;
      const snapshot = store.get<EditableAssessmentSession>(
        "adaptive-sessions",
        view.id,
      );
      if (snapshot) {
        Object.assign(view, {
          navigation: assessmentNavigation(snapshot),
          interactionRevision: snapshot.interactionRevision || 0,
          methodVersion:
            snapshot.generation?.generatorVersion || snapshot.assessmentVersion,
          scoringVersion: snapshot.config.scoringVersion,
          ...(snapshot.retakePolicy
            ? { retakePolicy: snapshot.retakePolicy }
            : {}),
        });
        if (snapshot.state === "active" && snapshot.reviewCursor) {
          const { item, step } = snapshot.reviewCursor;
          const reviewing = structuredClone(snapshot);
          reviewing.cursor = { item, step };
          const publicReview = publicSession(reviewing, now);
          const response = snapshot.responses.find(
            (r) =>
              r.itemId === snapshot.items[item]?.variant.id &&
              r.stepId === snapshot.items[item]?.variant.steps[step]?.id,
          );
          if (response)
            Object.assign(view, {
              current: publicReview.current,
              stage: publicReview.stage,
              savedAnswer: {
                optionId: response.optionId,
                ...(response.execution
                  ? { execution: response.execution }
                  : {}),
              },
              revisionResetCount: revisionResetCount(
                snapshot,
                response.itemId,
                response.stepId,
              ),
            });
        }
      }
    }
    await store.flush(db, account.scope);
    await projectCompleted(db, store, account.id);
    // Freeze the public report too: later presentation code must not reinterpret old scores.
    const views = Array.isArray(result) ? result : [result];
    const completed = views
      .filter((v) => v?.state === "completed")
      .map((v) => v!.id);
    if (completed.length) {
      const { rows: reports } = await db.query<{ id: string; result: unknown }>(
        "SELECT id,payload->'result' AS result FROM assessments WHERE user_id=$1 AND id=ANY($2::text[])",
        [account.id, completed],
      );
      const frozen = new Map(reports.map((r) => [r.id, r.result]));
      for (const view of views)
        if (view && frozen.has(view.id))
          view.result = frozen.get(view.id) as NonNullable<typeof view.result>;
    }
    // Cache only already frozen public reports, never rubrics, generated worlds or answers.
    // Historical snapshots remain immutable; older attempts populate this projection lazily.
    for (const view of views) if (view?.state === "completed") {
      await db.query(
        "INSERT INTO professional_assessment_records(scope,collection,id,user_id,body) VALUES ($1,'public-session-views',$2,$3,$4) ON CONFLICT(scope,collection,id) DO UPDATE SET body=excluded.body,updated_at=now()",
        [account.scope, view.id, account.id, JSON.stringify(view)],
      );
    }
    return result;
  }));
  if (output instanceof AssessmentHttpError) throw output;
  return output;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value); // Operation ordering must remain meaningful.
  if (value && typeof value === "object")
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, JSON.parse(canonical(v))]),
      ),
    );
  return JSON.stringify(value);
}
