import { random } from '../random.js';
import { generateVariant } from './bank.js';
import { generateBlueprint, generateItem, type BlueprintOptions } from '../generative/generator.js';
import { packs, getPack, getItemModel } from '../generative/packs.js';
import { gradeConfigs } from './config.js';
import { activeEnhancements } from './enhancements.js';
import { itemCalibration } from './item-calibration.js';
import type { Plan } from '../domain.js';
import { validatePlan } from '../families/core.js';
import { canonical } from '../generative/validators.js';
import {
  type Stage,
  dimensions,
  type AssessmentSession,
  type AssessmentGradeConfig,
  type AssessmentDefinition,
  type DecisionBand,
  type DimensionResult,
  type ScoreContribution,
  type SessionView,
  type TargetGrade,
} from './model.js';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const iso = (now: number) => new Date(now).toISOString();
/** Instantiate a complete frozen bank/config snapshot for replay across later revisions. */
export function createSession(
  id: string,
  candidateId: string,
  targetGrade: TargetGrade,
  seed: number | string,
  now = Date.now(),
  definition?: AssessmentDefinition,
  config: AssessmentGradeConfig = gradeConfigs[targetGrade],
  generationOptions: BlueprintOptions = {},
): AssessmentSession {
  if (config.targetGrade !== targetGrade)
    throw new Error('Конфигурация не соответствует заявленному грейду');
  const blueprint = definition
    ? null
    : generateBlueprint(targetGrade, seed, { ...generationOptions, userId: candidateId });
  if (blueprint) {
    const enhancements = { ...activeEnhancements, ...config.enhancements };
    const items = blueprint.items.map((variant) => ({ variant, stage: variant.stage }));
    let boundaryPool = blueprint.boundaryPool;
    if (targetGrade === 'Senior' && enhancements.seniorCoreProbe) {
      const candidate = boundaryPool
        .filter(
          (item) =>
            item.generated.difficulty?.band === 'senior_core' &&
            item.steps[0]!.rubric.dimension === 'engineering_judgment' &&
            item.generated.worldState.work?.policy &&
            item.generated.worldState.work.consequences.length > 1,
        )
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!candidate) throw new Error('Нет независимого обязательного Senior policy probe');
      const probe = generateItem(
        getPack(blueprint.specialization),
        getItemModel(blueprint.specialization, candidate.generated.itemModelId),
        targetGrade,
        'boundary',
        'engineering_judgment',
        candidate.generated.seed,
        'on-demand',
        undefined,
        'senior_core',
        true,
      );
      items.push({ variant: probe, stage: 'review' });
      boundaryPool = boundaryPool.filter((item) => item.id !== probe.id);
    }
    return {
      id,
      candidateId,
      specialization: blueprint.specialization,
      ...(packs.find((pack) => pack.id === blueprint.specialization)?.presentation
        ? {
            packPresentation: structuredClone(
              packs.find((pack) => pack.id === blueprint.specialization)!.presentation!,
            ),
          }
        : {}),
      targetGrade,
      seed,
      assessmentVersion: blueprint.version,
      config: {
        ...structuredClone(config),
        version: `${config.version}-competency-4`,
        scoringVersion: 'competency-4',
        maxBoundaryItems: targetGrade === 'Senior' && enhancements.seniorCoreProbe ? 5 : 6,
        boundarySelection: 'weighted-information',
        enhancements,
        ...(enhancements.discriminatingBoundary
          ? {
              boundaryCalibration: {
                source: 'synthetic-7.3.0-rotated-masteries; not human calibration',
                byItem: Object.fromEntries(
                  boundaryPool.map((item) => [
                    item.id,
                    Object.fromEntries(
                      dimensions.flatMap((dimension) => {
                        const cell = itemCalibration(item, dimension);
                        return cell
                          ? [
                              [
                                dimension,
                                {
                                  n: cell.n,
                                  ownScore: cell.ownScore,
                                  lowerScore: cell.lowerScore,
                                  discrimination: cell.discrimination,
                                },
                              ],
                            ]
                          : [];
                      }),
                    ),
                  ]),
                ),
              },
            }
          : {}),
      },
      items,
      boundaryPool,
      cursor: { item: 0, step: 0 },
      responses: [],
      evidenceSelections: [],
      contributions: [],
      startedAt: iso(now),
      deadlineAt: iso(now + config.hardCapMs),
      stepStartedAt: iso(now),
      finishedAt: null,
      state: 'active',
      stageTimeMs: { anchors: 0, incident: 0, review: 0, boundary: 0 },
      result: null,
      generation: blueprint.generation,
    };
  }
  if (!definition || typeof seed !== 'number')
    throw new Error('Legacy definition требует числовой seed');
  const rng = random(seed);
  const available = definition.families.filter(
    (f) =>
      f.approved && f.targetGrade === targetGrade && f.specialization === definition.specialization,
  );
  const pick = <T>(choices: T[]): T => {
    if (!choices.length) throw new Error('Банк не покрывает обязательную программу');
    return choices[Math.floor(rng() * choices.length)]!;
  };
  const selected = dimensions.map((d) =>
    pick(available.filter((f) => f.stage === 'anchors' && f.steps[0]?.rubric.dimension === d)),
  );
  const incident = pick(available.filter((f) => f.stage === 'incident'));
  const review = pick(
    available.filter(
      (f) =>
        f.stage === 'review' && !f.contentTags.some((tag) => incident.contentTags.includes(tag)),
    ),
  );
  selected.push(incident, review);
  const variant = (f: (typeof available)[number]) =>
    generateVariant(f, Math.floor(rng() * 0x100000000));
  return {
    id,
    candidateId,
    specialization: definition.specialization,
    targetGrade,
    seed,
    assessmentVersion: definition.version,
    config: structuredClone(config),
    items: selected.map((f) => ({ variant: variant(f), stage: f.stage })),
    boundaryPool: available.filter((f) => f.stage === 'boundary').map(variant),
    cursor: { item: 0, step: 0 },
    responses: [],
    evidenceSelections: [],
    contributions: [],
    startedAt: iso(now),
    deadlineAt: iso(now + config.hardCapMs),
    stepStartedAt: iso(now),
    finishedAt: null,
    state: 'active',
    stageTimeMs: { anchors: 0, incident: 0, review: 0, boundary: 0 },
    result: null,
  };
}
/** Minimum content balance is mandatory even for clearly strong candidates. */
export function coreCompleted(session: AssessmentSession): boolean {
  return session.items
    .filter((item) => item.stage !== 'boundary')
    .every((item) =>
      item.variant.steps.every((s) =>
        session.responses.some((r) => r.itemId === item.variant.id && r.stepId === s.id),
      ),
    );
}

/** Correlated steps are grouped by family before estimating effective independent evidence. */
export function evaluateEvidence(session: AssessmentSession): {
  dimensions: DimensionResult[];
  band: DecisionBand;
} {
  const results = dimensions.map((dimension): DimensionResult => {
    const contributions = session.contributions.filter((c) => c.dimension === dimension);
    const groups = new Map<string, ScoreContribution[]>();
    for (const c of contributions) {
      const key = session.config.enhancements?.boundaryByConstruct
        ? (session.items.find((item) => item.variant.id === c.familyId)?.variant.generated
            ?.siblingGroup ?? c.familyId)
        : c.familyId;
      groups.set(key, [...(groups.get(key) || []), c]);
    }
    const families = [...groups.values()].map((cs) => {
      const weight = cs.reduce((sum, c) => sum + c.weight, 0);
      return {
        weight: ['difficulty-3', 'competency-4'].includes(session.config.scoringVersion)
          ? Math.max(...cs.map((c) => c.resultWeight ?? 1))
          : Math.min(2, weight),
        value: cs.reduce((sum, c) => sum + c.value * c.weight, 0) / weight,
      };
    });
    const weight = families.reduce((sum, f) => sum + f.weight, 0);
    const score = weight ? families.reduce((sum, f) => sum + f.value * f.weight, 0) / weight : 0;
    const effectiveEvidence = ['information-2', 'difficulty-3', 'competency-4'].includes(
      session.config.scoringVersion,
    )
      ? [...groups.values()].reduce(
          (sum, cs) => sum + Math.min(2.5, Math.max(...cs.map((c) => c.weight))),
          0,
        )
      : weight
        ? (weight * weight) / families.reduce((sum, f) => sum + f.weight * f.weight, 0)
        : 0;
    const disagreement = weight
      ? Math.sqrt(families.reduce((sum, f) => sum + f.weight * (f.value - score) ** 2, 0) / weight)
      : 0;
    const margin = Math.min(
      1,
      session.config.uncertainty.floor +
        session.config.uncertainty.base / Math.sqrt(Math.max(1, effectiveEvidence)) +
        (['information-2', 'difficulty-3', 'competency-4'].includes(session.config.scoringVersion)
          ? 0
          : session.config.uncertainty.contradiction * disagreement),
    );
    return {
      dimension,
      score,
      coverage: groups.size,
      effectiveEvidence,
      margin,
      label: !weight
        ? 'Needs evidence'
        : score - margin > session.config.cutScore
          ? 'Strong'
          : score >= session.config.cutScore
            ? 'Sufficient'
            : score + margin >= session.config.cutScore
              ? 'Uncertain'
              : 'Needs evidence',
      evidence: contributions.map((c) => {
        const item = session.items.find((i) => i.variant.id === c.familyId)!;
        const response = session.responses.find(
          (r) => `${r.itemId}/${r.stepId}` === c.observation.split('#')[0],
        )!;
        const step = item.variant.steps.find((s) => s.id === response.stepId)!;
        const selected = step.options.find((o) => o.id === response.optionId);
        const explanation =
          c.source === 'execution'
            ? c.value === 1
              ? 'План выполнения сохраняет все обязательные гарантии текущего сценария.'
              : 'План выполнения нарушает хотя бы одну обязательную гарантию текущего сценария; правильность выбранного рассуждения оценена отдельно.'
            : step.exploration
              ? `Первые источники: ${session.evidenceSelections
                  .filter((e) => e.itemId === c.familyId)
                  .slice(0, 2)
                  .map((e) => item.variant.artifacts.find((a) => a.id === e.artifactId)!.label)
                  .join(' → ')}. Их релевантность оценена относительно причины данного инцидента.`
              : `Ваш выбор: ${selected?.text || ''} Ожидаемое рассуждение: ${step.rubric.rationale}`;
        return { familyId: c.familyId, source: c.observation, value: c.value, explanation };
      }),
    };
  });
  const estimatedScore = results.reduce(
    (sum, d) => sum + d.score * session.config.weights[d.dimension],
    0,
  );
  const spread =
    Math.max(...results.map((d) => d.score)) - Math.min(...results.map((d) => d.score));
  const margin =
    results.reduce((sum, d) => sum + d.margin * session.config.weights[d.dimension], 0) +
    session.config.uncertainty.contradiction * spread;
  return {
    dimensions: results,
    band: {
      estimatedScore,
      margin,
      lowerBound: clamp(estimatedScore - margin),
      upperBound: clamp(estimatedScore + margin),
      cutScore: session.config.cutScore,
      method: 'expert-rule-decision-band',
    },
  };
}
/** Identify repeated below-standard demonstrations using independent family evidence. */
export function verifiedDeficit(
  session: AssessmentSession,
  evaluation = evaluateEvidence(session),
) {
  return evaluation.dimensions.find((dimension) => {
    if (dimension.coverage < 2 || dimension.score + dimension.margin >= session.config.cutScore)
      return false;
    const groups = new Map<string, ScoreContribution[]>();
    for (const row of session.contributions.filter(
      (row) => row.dimension === dimension.dimension,
    )) {
      const key =
        session.items.find((item) => item.variant.id === row.familyId)?.variant.generated
          ?.siblingGroup ?? row.familyId;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return (
      [...groups.values()].filter((rows) => {
        const sum = rows.reduce((n, row) => n + row.weight, 0);
        return (
          rows.reduce((n, row) => n + row.value * row.weight, 0) / sum < session.config.cutScore
        );
      }).length >= 2
    );
  });
}

/** Resolve low scores with a third independent family before a compensating aggregate can confirm. */
export function verificationNeeded(
  session: AssessmentSession,
  evaluation = evaluateEvidence(session),
) {
  return evaluation.dimensions.filter(
    (dimension) => dimension.score < session.config.cutScore && dimension.coverage < 3,
  );
}

/** Select unused evidence, prioritizing a directly observed unresolved competency deficit. */
export function chooseBoundary(session: AssessmentSession) {
  const evaluation = evaluateEvidence(session);
  const used = new Set(session.items.map((i) => i.variant.id));
  const usedSiblings = new Set(
    session.items.flatMap((i) => (i.variant.generated ? [i.variant.generated.siblingGroup] : [])),
  );
  const available = (item: AssessmentSession['boundaryPool'][number]) => {
    if (used.has(item.id)) return false;
    if (!item.generated) return true;
    if (!session.config.enhancements?.boundaryByConstruct)
      return !usedSiblings.has(item.generated.siblingGroup);
    const dimension = item.steps[0]!.rubric.dimension;
    return !session.items.some(
      (entry) =>
        entry.variant.generated?.siblingGroup === item.generated!.siblingGroup &&
        ((entry.stage !== 'boundary' && !entry.variant.generated?.coreProbe) ||
          entry.variant.steps.some(
            (step) =>
              step.rubric.dimension === dimension ||
              (session.config.enhancements?.separateExecution &&
                step.rubric.executionDimension === dimension),
          )),
    );
  };
  if (session.config.boundarySelection === 'weighted-information') {
    const measured = (item: AssessmentSession['boundaryPool'][number]) =>
      [
        ...new Set(
          item.steps.flatMap((step) => [
            step.rubric.dimension,
            ...(session.config.enhancements?.separateExecution && step.responseTask
              ? [step.rubric.executionDimension ?? step.rubric.dimension]
              : []),
          ]),
        ),
      ].filter(
        (dimension) =>
          !session.contributions.some(
            (entry) =>
              entry.dimension === dimension &&
              (session.items.find((i) => i.variant.id === entry.familyId)?.variant.generated
                ?.siblingGroup ?? entry.familyId) === (item.generated?.siblingGroup ?? item.id),
          ),
      );
    const deficits = session.config.enhancements?.targetedVerification
      ? (session.config.enhancements.resolveUncertainDeficits
          ? evaluation.dimensions.filter(
              (entry) =>
                entry.score < session.config.cutScore &&
                (entry.coverage < 3 || entry.score + entry.margin >= session.config.cutScore),
            )
          : verificationNeeded(session, evaluation)
        ).map((entry) => entry.dimension)
      : [];
    const deficitCandidates = session.boundaryPool.filter(
      (item) =>
        available(item) &&
        (session.config.enhancements?.resolveUncertainDeficits
          ? measured(item).some((dimension) => deficits.includes(dimension))
          : deficits.includes(item.steps[0]!.rubric.dimension)),
    );
    const utility = (item: AssessmentSession['boundaryPool'][number]) => {
      const information = Math.min(
        2.5,
        Math.max(...item.steps.map((step) => step.rubric.informationWeight)),
      );
      const itemDimensions = session.config.enhancements?.resolveUncertainDeficits
        ? measured(item)
        : [item.steps[0]!.rubric.dimension];
      return itemDimensions.reduce((total, dimension) => {
        const current = evaluation.dimensions.find((entry) => entry.dimension === dimension)!;
        const nextMargin =
          session.config.uncertainty.floor +
          session.config.uncertainty.base /
            Math.sqrt(Math.max(1, current.effectiveEvidence + information));
        const cell =
          session.config.enhancements?.discriminatingBoundary && session.targetGrade !== 'Junior'
            ? session.config.boundaryCalibration?.byItem[item.id]?.[dimension]
            : undefined;
        const contrast = cell ? 0.5 + cell.discrimination * cell.ownScore : 1;
        return (
          total +
          contrast * session.config.weights[dimension] * Math.max(0, current.margin - nextMargin)
        );
      }, 0);
    };
    return (
      (deficitCandidates.length ? deficitCandidates : session.boundaryPool)
        .filter(available)
        .sort((a, b) => utility(b) - utility(a) || a.id.localeCompare(b.id))[0] ?? null
    );
  }
  const ranked = [...evaluation.dimensions].sort(
    (a, b) =>
      b.margin - a.margin ||
      a.effectiveEvidence - b.effectiveEvidence ||
      dimensions.indexOf(a.dimension) - dimensions.indexOf(b.dimension),
  );
  for (const d of ranked) {
    const candidates = session.boundaryPool.filter(
      (f) => available(f) && f.steps[0]?.rubric.dimension === d.dimension,
    );
    if (candidates.length)
      return [...candidates].sort(
        (a, b) =>
          b.steps[0]!.rubric.informationWeight - a.steps[0]!.rubric.informationWeight ||
          a.id.localeCompare(b.id),
      )[0]!;
  }
  return null;
}
function finalize(
  session: AssessmentSession,
  stopReason: NonNullable<AssessmentSession['result']>['stopReason'],
  now: number,
) {
  const { dimensions: dimensionResults, band } = evaluateEvidence(session);
  const sufficient =
    coreCompleted(session) &&
    dimensionResults.every((d) => d.coverage >= session.config.minimumCoverage);
  const confirmed =
    sufficient &&
    band.lowerBound > band.cutScore &&
    (!session.config.enhancements?.targetedVerification ||
      (!verifiedDeficit(session, { dimensions: dimensionResults, band }) &&
        !verificationNeeded(session, { dimensions: dimensionResults, band }).length));
  const levels: TargetGrade[] = ['Junior', 'Middle', 'Senior'];
  const index = levels.indexOf(session.targetGrade);
  const assessmentStatus = confirmed
    ? 'confirmed'
    : sufficient &&
        (band.upperBound < band.cutScore ||
          (session.config.enhancements?.targetedVerification &&
            verifiedDeficit(session, { dimensions: dimensionResults, band })))
      ? 'below-standard'
      : 'insufficient-evidence';
  const recommendation = confirmed
    ? band.estimatedScore > band.cutScore + 0.2
      ? levels[index + 1]
      : undefined
    : session.config.enhancements?.honestRecommendation &&
        assessmentStatus === 'insufficient-evidence'
      ? undefined
      : levels[index - 1];
  session.state = 'completed';
  session.finishedAt = iso(Math.min(now, Date.parse(session.deadlineAt)));
  const reason = confirmed
    ? `Заявленный уровень ${session.targetGrade} подтверждён обязательными кейсами.`
    : stopReason === 'competency_deficit'
      ? `Заявленный уровень ${session.targetGrade} пока не подтверждён: повторные независимые кейсы показали дефицит обязательной компетенции.`
      : stopReason === 'below_band'
        ? `Заявленный уровень ${session.targetGrade} пока не подтверждён: свидетельства ниже настроенного порога.`
        : `Недостаточно подтверждающих свидетельств для заявленного уровня ${session.targetGrade}.`;
  session.result = {
    ...(session.config.enhancements?.honestRecommendation ? { assessmentStatus } : {}),
    targetGrade: session.targetGrade,
    specialization: session.specialization,
    decision: confirmed ? 'CONFIRMED' : 'NOT_CONFIRMED',
    title: `${session.targetGrade.toUpperCase()} ${confirmed ? 'CONFIRMED' : 'NOT CONFIRMED'}`,
    reason,
    stopReason,
    dimensions: dimensionResults,
    band,
    recommendation: recommendation || null,
    contentTags: [...new Set(session.items.flatMap((i) => i.variant.contentTags))],
    assessmentVersion: session.assessmentVersion,
    gradeConfigVersion: session.config.version,
    scoringConfigVersion: session.config.scoringVersion,
  };
}
/** Server-authoritative hard cap. A late request cannot contribute new evidence. */
export function expireSession(session: AssessmentSession, now = Date.now()): boolean {
  if (session.state !== 'active' || now < Date.parse(session.deadlineAt)) return false;
  const current = session.items[session.cursor.item];
  if (current)
    session.stageTimeMs[current.stage] += Math.max(
      0,
      Date.parse(session.deadlineAt) - Date.parse(session.stepStartedAt),
    );
  finalize(session, 'timeout', now);
  return true;
}
function currentStep(session: AssessmentSession, now: number) {
  expireSession(session, now);
  if (session.state !== 'active') throw new Error('Проверка уже завершена');
  const item = session.items[session.cursor.item]!;
  const step = item.variant.steps[session.cursor.step]!;
  return { item, step };
}
/** Record evidence order once; unlimited later inspection does not repair the first-two signal. */
export function openEvidence(
  session: AssessmentSession,
  itemId: string,
  stepId: string,
  artifactId: string,
  now = Date.now(),
): void {
  const { item, step } = currentStep(session, now);
  if (item.variant.id !== itemId || step.id !== stepId || item.stage !== 'incident')
    throw new Error('Источник недоступен на текущем шаге');
  const artifact = item.variant.artifacts.find((a) => a.id === artifactId);
  if (!artifact) throw new Error('Источник не найден');
  if (session.evidenceSelections.some((e) => e.itemId === itemId && e.artifactId === artifactId))
    return;
  const previous = session.evidenceSelections.filter((e) => e.itemId === itemId);
  session.evidenceSelections.push({
    itemId,
    stepId,
    artifactId,
    order: previous.length + 1,
    at: iso(now),
    elapsedMs: now - Date.parse(session.startedAt),
    usefulness: artifact.usefulness,
    ...(artifact.type ? { artifactType: artifact.type, diagnosticValue: artifact.usefulness } : {}),
  });
}
function advance(session: AssessmentSession, now: number) {
  // Navigation may visit any issued task. Never score early or repeat a saved response.
  const positions = session.items.flatMap((entry, itemIndex) =>
    entry.variant.steps.map((step, stepIndex) => ({ item: itemIndex, step: stepIndex, itemId: entry.variant.id, stepId: step.id })),
  );
  const currentIndex = positions.findIndex((p) => p.item === session.cursor.item && p.step === session.cursor.step);
  const ordered = [...positions.slice(currentIndex + 1), ...positions.slice(0, currentIndex + 1)];
  const pending = ordered.find((p) => !session.responses.some((r) => r.itemId === p.itemId && r.stepId === p.stepId));
  session.stepStartedAt = iso(now);
  if (pending) { session.cursor = { item: pending.item, step: pending.step }; return; }
  session.cursor = { item: session.items.length, step: 0 };
  if (!coreCompleted(session)) throw new Error('Обязательная часть не завершена');
  const evaluation = evaluateEvidence(session);
  const sufficient = evaluation.dimensions.every(
    (d) => d.coverage >= session.config.minimumCoverage,
  );
  if (session.config.enhancements?.targetedVerification && verifiedDeficit(session, evaluation))
    return finalize(session, 'competency_deficit', now);
  if (
    sufficient &&
    evaluation.band.lowerBound > evaluation.band.cutScore &&
    (!session.config.enhancements?.targetedVerification ||
      !verificationNeeded(session, evaluation).length)
  )
    return finalize(session, 'above_band', now);
  if (sufficient && evaluation.band.upperBound < evaluation.band.cutScore)
    return finalize(session, 'below_band', now);
  const boundaryCount = session.items.filter((i) => i.stage === 'boundary').length;
  const next = boundaryCount < session.config.maxBoundaryItems ? chooseBoundary(session) : null;
  if (!next) return finalize(session, 'boundary_exhausted', now);
  session.items.push({ variant: structuredClone(next), stage: 'boundary' });
}
/** Score a committed response independently, using only the session's frozen rubric. */
export function answer(
  session: AssessmentSession,
  itemId: string,
  stepId: string,
  optionId: string,
  now = Date.now(),
  execution?: Plan,
): void {
  const { item, step } = currentStep(session, now);
  if (itemId !== item.variant.id || stepId !== step.id)
    throw new Error('Ответ не относится к текущему шагу');
  let value: number;
  let executionValue: number | undefined;
  if (step.exploration) {
    const required = step.requiredEvidenceSources || 2;
    const selections = session.evidenceSelections
      .filter((e) => e.itemId === itemId)
      .slice(0, required);
    if (selections.length < required || optionId !== 'continue')
      throw new Error('Откройте минимум два источника evidence');
    value = selections.reduce((sum, e, index) => sum + e.usefulness * (index === 0 ? 0.6 : 0.4), 0);
  } else {
    if (!step.options.some((o) => o.id === optionId)) throw new Error('Вариант ответа не найден');
    value = step.rubric.scores[optionId]!;
    if (step.responseTask) {
      if (!execution) throw new Error('Заполните план для текущих условий');
      validatePlan(step.responseTask.controls, execution);
      const accepted = item.variant.generated?.responseChecks?.[step.id]?.accepted;
      if (!accepted?.length) throw new Error('Отсутствует замороженная проверка плана');
      const normalized = (plan: Plan) =>
        Object.fromEntries(
          step.responseTask!.controls.map((control) => [
            control.id,
            control.type === 'multiselect'
              ? [...(plan[control.id] as string[])].sort()
              : plan[control.id],
          ]),
        );
      executionValue = Number(
        accepted.some((plan) => canonical(normalized(plan)) === canonical(normalized(execution))),
      );
      if (!session.config.enhancements?.separateExecution && executionValue === 0) value = 0;
    }
  }
  const contribution: ScoreContribution = {
    dimension: step.rubric.dimension,
    value,
    weight: step.rubric.informationWeight,
    ...(step.rubric.resultWeight !== undefined ? { resultWeight: step.rubric.resultWeight } : {}),
    observation: `${itemId}/${stepId}`,
    familyId: itemId,
    source: step.exploration ? 'evidence' : 'answer',
  };
  const responseTimeMs = Math.max(0, now - Date.parse(session.stepStartedAt));
  const responseContributions = [contribution];
  if (session.config.enhancements?.separateExecution && executionValue !== undefined) {
    responseContributions.push({
      ...contribution,
      dimension: step.rubric.executionDimension ?? step.rubric.dimension,
      value: executionValue,
      observation: `${itemId}/${stepId}#execution`,
      source: 'execution',
    });
  }
  session.responses.push({
    ...(execution ? { execution: structuredClone(execution) } : {}),
    itemId,
    stepId,
    optionId,
    at: iso(now),
    responseTimeMs,
    contributions: responseContributions,
  });
  session.contributions.push(...responseContributions);
  session.stageTimeMs[item.stage] += responseTimeMs;
  advance(session, now);
}
/** Candidate projection excludes seeds, keys, rubrics, future tasks and unopened artifacts. */
export function publicSession(session: AssessmentSession, now = Date.now()): SessionView {
  const item = session.state === 'active' ? session.items[session.cursor.item] : undefined;
  const step = item?.variant.steps[session.cursor.step];
  return {
    id: session.id,
    specialization: session.specialization,
    specializationName:
      packs.find((p) => p.id === session.specialization)?.name || session.specialization,
    ...(session.packPresentation ? { packPresentation: session.packPresentation } : {}),
    targetGrade: session.targetGrade,
    state: session.state,
    startedAt: session.startedAt,
    deadlineAt: session.deadlineAt,
    finishedAt: session.finishedAt,
    serverNow: iso(now),
    stage: item?.stage || null,
    coreCompleted: coreCompleted(session),
    boundaryUsed: session.items.some((i) => i.stage === 'boundary'),
    progress: assessmentProgress(session),
    current:
      item && step
        ? {
            itemId: item.variant.id,
            step: {
              id: step.id,
              type: step.type,
              prompt: step.prompt,
              context: step.context,
              ...(['difficulty-3', 'competency-4'].includes(session.config.scoringVersion)
                ? { difficultyPoints: step.rubric.resultWeight ?? 1 }
                : {}),
              ...(step.scenario ? { scenario: step.scenario } : {}),
              options: step.options,
              ...(step.responseTask ? { responseTask: step.responseTask } : {}),
              ...(step.resetContext ? { resetContext: step.resetContext } : {}),
              ...(step.exploration ? { exploration: true } : {}),
              ...(step.requiredEvidenceSources
                ? { requiredEvidenceSources: step.requiredEvidenceSources }
                : {}),
            },
            architecture:
              item.stage === 'anchors' || item.stage === 'boundary'
                ? []
                : item.variant.generated?.stepWorlds[step.id]?.topology.nodes.map((n) => n.label) ||
                  item.variant.architecture,
            ...(item.variant.topology && item.stage !== 'anchors' && item.stage !== 'boundary'
              ? {
                  topology:
                    item.variant.generated?.stepWorlds[step.id]?.topology || item.variant.topology,
                }
              : {}),
            artifacts: (item.variant.generated?.stepArtifacts[step.id] || item.variant.artifacts)
              .filter((a) =>
                step.responseTask || session.packPresentation?.evidenceVisibility === 'all-stages'
                  ? a.type !== 'topology'
                  : item.stage === 'incident'
                    ? a.type !== 'architecture'
                    : ['code', 'diff', 'deployment'].includes(a.type || '') &&
                      (item.stage === 'review' || a.type === 'code'),
              )
              .map((a) => ({
                id: a.id,
                label: a.label,
                ...(a.type ? { type: a.type } : {}),
                content:
                  item.variant.generated?.stepWorlds[step.id]?.work?.reasoningGrade === 'Junior' ||
                  item.stage !== 'incident' ||
                  session.evidenceSelections.some(
                    (e) => e.itemId === item.variant.id && e.artifactId === a.id,
                  )
                    ? a.content
                    : null,
              })),
          }
        : null,
    result: session.result ? candidateResult(session.result) : null,
  };
}
/** Honest progress counts frozen core steps and bounds the optional remainder separately. */
export function assessmentProgress(session: AssessmentSession): SessionView['progress'] {
  const completed = (stage: Stage) =>
    session.responses.filter((r) =>
      session.items.some((item) => item.stage === stage && item.variant.id === r.itemId),
    ).length;
  const total = (stage: Stage) =>
    session.items
      .filter((item) => item.stage === stage)
      .reduce((sum, item) => sum + item.variant.steps.length, 0);
  const coreTotalSteps = total('anchors') + total('incident') + total('review');
  const coreCompletedSteps = completed('anchors') + completed('incident') + completed('review');
  const pending = session.items.reduce(
    (sum, item) =>
      sum +
      item.variant.steps.filter(
        (step) =>
          !session.responses.some((r) => r.itemId === item.variant.id && r.stepId === step.id),
      ).length,
    0,
  );
  const issuedBoundary = session.items.filter((item) => item.stage === 'boundary').length;
  return {
    answered: session.responses.filter((r) => r.optionId !== 'continue').length,
    coreCompletedSteps,
    coreTotalSteps,
    remainingMin: session.state === 'active' ? pending : 0,
    remainingMax:
      session.state === 'active'
        ? pending + Math.max(0, session.config.maxBoundaryItems - issuedBoundary)
        : 0,
    stages: (['anchors', 'incident', 'review', 'boundary'] as const).map((stage) => ({
      stage,
      completed: completed(stage),
      total: total(stage),
      status:
        total(stage) && completed(stage) === total(stage)
          ? 'complete'
          : session.items[session.cursor.item]?.stage === stage
            ? 'active'
            : stage === 'boundary'
              ? 'optional'
              : 'upcoming',
    })),
  };
}
/** Candidate wording contains no scores, seeds, rubrics, versions or family identities. */
export function candidateResult(result: NonNullable<AssessmentSession['result']>) {
  const labels = {
    Strong: 'Сильная сторона',
    Sufficient: 'Соответствует',
    Uncertain: 'Недостаточно подтверждений',
    'Needs evidence': 'Требуется дополнительная практика',
  };
  const descriptions = {
    diagnosis: 'диагностике',
    correctness: 'корректности системы',
    engineering_judgment: 'инженерным решениям',
    adaptation: 'адаптации',
  };
  const uncertain = result.dimensions
    .filter((d) => d.label === 'Uncertain' || d.label === 'Needs evidence')
    .map((d) => descriptions[d.dimension]);
  return {
    targetGrade: result.targetGrade,
    specialization: result.specialization,
    decision: result.decision,
    title:
      result.decision === 'CONFIRMED'
        ? `${result.targetGrade.toUpperCase()} CONFIRMED`
        : `${result.targetGrade.toUpperCase()} ПОКА НЕ ПОДТВЕРЖДЁН`,
    reason:
      result.decision === 'CONFIRMED'
        ? `Заявленный уровень ${result.targetGrade} подтверждён инженерными сценариями.`
        : `Для устойчивого подтверждения ${result.targetGrade} в этой попытке недостаточно свидетельств${uncertain.length ? ` по ${uncertain.join(' и ')}` : ''}. Это не означает автоматического присвоения более низкого грейда.`,
    stopReason: result.stopReason,
    contentTags: result.contentTags,
    recommendation: result.recommendation,
    ...(result.assessmentStatus ? { assessmentStatus: result.assessmentStatus } : {}),
    dimensions: result.dimensions.map((d) => ({
      dimension: d.dimension,
      label: labels[d.label],
      description:
        d.label === 'Strong'
          ? 'Последовательно выбираете решения, поддержанные наблюдениями и ограничениями.'
          : d.label === 'Sufficient'
            ? 'Решения соответствуют требованиям проверенных сценариев.'
            : d.label === 'Uncertain'
              ? 'Ответы не дали устойчивого подтверждения этой компетенции.'
              : 'Рекомендуем практику на анализе последствий и проверке инженерных предположений.',
    })),
  };
}
/** Privacy-limited technical telemetry, with no webcam, tab or keystroke tracking. */
export function sessionTelemetry(session: AssessmentSession) {
  const domainIds = [
    ...new Set(
      session.items.flatMap((item) =>
        item.variant.generated?.competencyDomain ? [item.variant.generated.competencyDomain] : [],
      ),
    ),
  ];
  const domainProfile = domainIds.map((domain) => {
    const items = session.items.filter(
      (item) => item.variant.generated?.competencyDomain === domain,
    );
    const contributions = session.contributions.filter((contribution) =>
      items.some((item) => item.variant.id === contribution.familyId),
    );
    const weight = contributions.reduce((sum, contribution) => sum + contribution.weight, 0);
    return {
      domain,
      label:
        session.packPresentation?.domains.find((entry) => entry.id === domain)?.label || domain,
      independentModels: new Set(items.map((item) => item.variant.generated!.itemModelId)).size,
      observations: contributions.length,
      evidenceWeight: weight,
      weightedScore: weight
        ? contributions.reduce(
            (sum, contribution) => sum + contribution.value * contribution.weight,
            0,
          ) / weight
        : null,
      status: 'provisional-descriptive-profile',
    };
  });
  return {
    domainProfile,
    packPresentation: session.packPresentation || null,
    sessionId: session.id,
    targetGrade: session.targetGrade,
    specialization: session.specialization,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    totalTimeMs: session.finishedAt
      ? Date.parse(session.finishedAt) - Date.parse(session.startedAt)
      : null,
    timePerStage: session.stageTimeMs,
    timePerItem: session.items.map((i, index) => ({
      familyId: i.variant.id,
      timeMs:
        session.responses
          .filter((r) => r.itemId === i.variant.id)
          .reduce((sum, r) => sum + r.responseTimeMs, 0) +
        (session.result?.stopReason === 'timeout' && index === session.cursor.item
          ? Math.max(0, Date.parse(session.deadlineAt) - Date.parse(session.stepStartedAt))
          : 0),
    })),
    items: session.items.map((i) => ({
      familyId: i.variant.id,
      familyVersion: i.variant.version,
      variantSeed: i.variant.variantSeed,
      parameters: i.variant.parameters,
      ...(i.variant.generated
        ? {
            itemModel: i.variant.generated.itemModelId,
            difficulty: i.variant.generated.difficulty || null,
            generatorVersion: i.variant.generated.generatorVersion,
            packVersion: i.variant.generated.packVersion,
            radicals: i.variant.generated.worldState.radicals,
            semanticFingerprint: i.variant.generated.semanticFingerprint,
            surfaceFingerprint: i.variant.generated.surfaceFingerprint,
            source: i.variant.generated.source,
          }
        : {}),
    })),
    responses: session.responses.map((r) => {
      const generated = session.items.find((i) => i.variant.id === r.itemId)?.variant.generated;
      const intentId = generated?.optionIntents[r.optionId];
      const intent = generated?.intents[r.stepId]?.find((i) => i.id === intentId);
      return {
        ...r,
        ...(intent ? { intentId: intent.id, misconception: intent.misconception } : {}),
      };
    }),
    evidenceSelections: session.evidenceSelections,
    contributions: session.contributions,
    dimensionCoverage: evaluateEvidence(session).dimensions.map((d) => ({
      dimension: d.dimension,
      coverage: d.coverage,
    })),
    boundaryUsed: session.items.some((i) => i.stage === 'boundary'),
    timeout: session.result?.stopReason === 'timeout',
    earlyStopReason: session.result?.stopReason || null,
    decision: session.result?.decision || null,
    assessmentVersion: session.assessmentVersion,
    gradeConfigVersion: session.config.version,
    scoringConfigVersion: session.config.scoringVersion,
    result: session.result,
  };
}
