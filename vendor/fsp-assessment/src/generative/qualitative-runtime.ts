import { random } from '../random.js';
import { select } from '../families/core.js';
import {
  executeTransition,
  publicTransitionContract,
  transitionPrediction,
  type TransitionContract,
  type TransitionOperation,
} from './transition.js';
import type { Artifact, TargetGrade } from '../adaptive/model.js';
import {
  defaultBand,
  gradeProfile,
  reasoningGrade,
  type DifficultyBand,
  type DifficultyMetadata,
  type GradeProfile,
} from './difficulty.js';
import { getGradeDesign, trackGradeConfigurations, assessmentRecipe } from './grade-designs.js';
import { auditGradeSupport } from './grade-support.js';
import {
  actionToken,
  decisionCatalogs,
  modelDecisionCatalog,
  nativeDecisionContexts,
  type DecisionArchetype,
} from './decision-archetypes.js';
import type {
  AnswerIntent,
  ItemModel,
  ItemRuntime,
  SpecializationPack,
  WorldState,
} from './model.js';

export interface StrategyOutcome {
  index: number;
  archetypeId: string;
  functionalContract: boolean;
  compatibleConsumers: boolean;
  rollbackSafe: boolean;
  interruption: number;
  cost: number;
  delay: number;
  residualRisk: number;
}
export interface GradeWorkWorld {
  professionalResponsibility: string;
  profile: GradeProfile;
  decisionArchetypes: DecisionArchetype[];
  diagnosticMode: 'identified' | 'linked' | 'competing';
  strategyPrograms: [number, number, number][];
  band: DifficultyBand;
  reasoningGrade: TargetGrade;
  actors: string[];
  activeRevision: number;
  historicalWorld: WorldState | null;
  handoff: string;
  unknowns: string[];
  operationalConstraint: string;
  policy: {
    kind: 'evolution' | 'research';
    oldConsumers: number;
    newConsumers: number;
    costFactor: number;
    delayFactor: number;
    maxCost: number;
    maxDelay: number;
    maxInterruption: number;
    maxResidualRisk: number;
    rollbackRequired: boolean;
    priority: 'cost' | 'delay' | 'residualRisk';
  } | null;
  consequences: string[];
  changed: boolean;
  transition?: TransitionContract;
}
const strategicKinds: AnswerIntent['kind'][] = [
  'remediation',
  'adaptation',
  'negative_guarantee',
  'critical_assumption',
];

/** Execute authored native action effects against this instance's constraints. */
export function runWorkStrategy(work: GradeWorkWorld, index: number): StrategyOutcome {
  const policy = work.policy;
  if (!policy || index < 0 || index > 3) throw new Error('Нет стратегического контракта');
  const action = work.decisionArchetypes[index]!;
  const [cost, delay, risk] = work.strategyPrograms[index]!;
  const characteristics = {
    retained: action.reversible,
    adapter: action.preservesScope,
    cost,
    delay,
    risk,
  };
  const transition = work.transition
    ? executeTransition(work.transition.programs[index]!, policy.oldConsumers)
    : null;
  return {
    index,
    archetypeId: action.id,
    functionalContract: transition?.functionalContract ?? true,
    compatibleConsumers:
      transition?.compatibleConsumers ?? (policy.oldConsumers === 0 || characteristics.adapter),
    rollbackSafe: transition?.rollbackSafe ?? characteristics.retained,
    interruption:
      transition?.interruption ??
      (characteristics.retained ? 0 : Math.ceil(policy.newConsumers / 10)),
    cost: characteristics.cost * policy.costFactor,
    delay: characteristics.delay * policy.delayFactor,
    residualRisk: characteristics.risk,
  };
}
/** Keep all technically correct options, then apply coexistence constraints and declared priority. */
export function strategyDecision(work: GradeWorkWorld): {
  outcomes: StrategyOutcome[];
  feasible: StrategyOutcome[];
  best: StrategyOutcome;
} {
  const policy = work.policy;
  if (!policy) throw new Error('Нет policy для решения');
  const outcomes = [0, 1, 2, 3].map((index) => runWorkStrategy(work, index));
  const feasible = outcomes.filter(
    (outcome) =>
      outcome.functionalContract &&
      outcome.compatibleConsumers &&
      (!policy.rollbackRequired || outcome.rollbackSafe) &&
      outcome.interruption <= policy.maxInterruption &&
      outcome.residualRisk <= policy.maxResidualRisk &&
      outcome.cost <= policy.maxCost &&
      outcome.delay <= policy.maxDelay,
  );
  const ordered = [...feasible].sort(
    (left, right) =>
      left[policy.priority] - right[policy.priority] ||
      left.cost - right.cost ||
      left.delay - right.delay ||
      left.residualRisk - right.residualRisk,
  );
  if (!ordered[0]) throw new Error('Нет допустимой стратегии');
  if (
    ordered[1] &&
    ['cost', 'delay', 'residualRisk'].every(
      (key) =>
        ordered[0]![key as 'cost' | 'delay' | 'residualRisk'] ===
        ordered[1]![key as 'cost' | 'delay' | 'residualRisk'],
    )
  )
    throw new Error('Нет единственного лучшего решения по заданным constraints');
  return { outcomes, feasible, best: ordered[0] };
}
function physicalWorld(world: WorldState): WorldState {
  const copy = structuredClone(world);
  if (world.work) copy.grade = world.work.reasoningGrade;
  delete copy.work;
  return copy;
}
function makeWork(
  model: ItemModel,
  world: WorldState,
  runtime: ItemRuntime,
  seed: number,
  band: DifficultyBand,
): GradeWorkWorld {
  const design = getGradeDesign(model.specialization);
  const level = reasoningGrade(band);
  const rng = random(seed ^ 0x52ac);
  const costFactor = 1 + Math.floor(rng() * 3);
  const delayFactor = 1 + Math.floor(rng() * 2);
  const form = Math.floor(rng() * 3);
  const profile = gradeProfile(band, form);
  const diagnosticMode =
    profile.ambiguity === 1 ? 'identified' : profile.ambiguity === 2 ? 'linked' : 'competing';
  const catalog = modelDecisionCatalog(model);
  // Rotate both the omitted plausible alternative and action order; no universal four-option set.
  const offset = Math.floor(rng() * catalog.length);
  const actions = Array.from(
    { length: 4 },
    (_, index) => catalog[(offset + index) % catalog.length]!,
  );
  const programs = actions.map((action) => action.workUnits);
  const work: GradeWorkWorld = {
    professionalResponsibility:
      model.gradeConfigurations?.[level]?.professionalResponsibility || '',
    profile,
    diagnosticMode,
    decisionArchetypes: level === 'Senior' || band === 'middle_upper' ? actions : [],
    strategyPrograms: level === 'Senior' || band === 'middle_upper' ? programs : [],
    band,
    reasoningGrade: level,
    actors:
      level === 'Junior'
        ? [design.actors[0]]
        : profile.scope === 'portfolio'
          ? [...design.actors]
          : design.actors.slice(0, 2),
    activeRevision: Math.floor(rng() * 2),
    historicalWorld:
      level === 'Junior' ? null : runtime.mutateWorld(model, physicalWorld(world), seed ^ 0x318f),
    handoff: design.handoff,
    unknowns:
      diagnosticMode === 'identified'
        ? []
        : diagnosticMode === 'linked'
          ? ['Какое наблюдение применимо к подтверждённому состоянию?']
          : [
              'Какая из конкурирующих причин относится к подтверждённому состоянию?',
              'Какой независимый источник отличает объяснения?',
            ],
    operationalConstraint:
      level === 'Junior'
        ? 'Локальное изменение сохраняет уже корректное поведение этой сущности.'
        : 'Исправление относится к подтверждённой версии workflow; поздний report не может авторизовать изменение другой версии.',
    policy:
      level !== 'Senior' && band !== 'middle_upper'
        ? null
        : {
            kind: model.specialization === 'data-scientist' ? 'research' : 'evolution',
            oldConsumers: (level === 'Senior' ? 20 : 5) + Math.floor(rng() * 20),
            newConsumers: (level === 'Senior' ? 30 : 10) + Math.floor(rng() * 20),
            costFactor,
            delayFactor,
            maxCost: Math.max(...programs.map((entry) => entry[0])) * costFactor,
            maxDelay: Math.max(...programs.map((entry) => entry[1])) * delayFactor,
            maxInterruption: 0,
            maxResidualRisk: Math.max(...programs.map((entry) => entry[2])),
            rollbackRequired: true,
            priority: (['cost', 'delay', 'residualRisk'] as const)[Math.floor(rng() * 3)]!,
          },
    consequences:
      level === 'Senior' ? [...design.consequences] : level === 'Middle' ? [design.handoff] : [],
    changed: false,
  };
  if (work.policy) {
    const policy = work.policy;
    // Some instances rule out expensive or slow actions. Retain a real choice,
    // with competing priorities, rather than a single feasible "smart" option.
    const costs = [...new Set(programs.map(([cost]) => cost * costFactor))];
    const delays = [...new Set(programs.map(([, delay]) => delay * delayFactor))];
    const exposures = [...new Set(programs.map(([, , risk]) => risk))];
    const limits = costs
      .flatMap((maxCost) =>
        delays.flatMap((maxDelay) =>
          exposures.map((maxResidualRisk) => ({ maxCost, maxDelay, maxResidualRisk })),
        ),
      )
      .filter((limit) => {
        const candidate = { ...work, policy: { ...policy, ...limit } };
        try {
          return (
            strategyDecision(candidate).feasible.length >= 2 &&
            new Set(
              (['cost', 'delay', 'residualRisk'] as const).map(
                (priority) =>
                  strategyDecision({ ...candidate, policy: { ...candidate.policy, priority } }).best
                    .archetypeId,
              ),
            ).size >= 2
          );
        } catch {
          return false;
        }
      });
    if (!limits.length) throw new Error(`${model.id}: предметный набор не содержит trade-off`);
    Object.assign(policy, limits[Math.floor(rng() * limits.length)]!);
    // Retain two competing valid strategies; shortened proposals must be
    // rejected for their executed consequences, even when numerically cheap.
    const winners = [
      ...new Set(
        (['cost', 'delay', 'residualRisk'] as const).map(
          (priority) => strategyDecision({ ...work, policy: { ...policy, priority } }).best.index,
        ),
      ),
    ];
    const safe = winners.slice(0, 2);
    const safeProgram: TransitionOperation[] = [
      'prepare-scope',
      'capture-origin',
      'apply-local-fix',
      'activate-target',
      'verify-target',
    ];
    work.transition = { programs: [], probe: Math.floor(rng() * 4) };
    work.strategyPrograms = work.strategyPrograms.map((program) => [...program]);
    for (let index = 0; index < 4; index++) {
      if (safe.includes(index)) {
        work.transition.programs.push([...safeProgram]);
        continue;
      }
      const defect = 1 + Math.floor(rng() * 3);
      const program: TransitionOperation[] =
        defect === 1
          ? [
              'capture-origin',
              'apply-local-fix',
              'activate-target',
              'prepare-scope',
              'verify-target',
            ]
          : defect === 2
            ? [
                'prepare-scope',
                'apply-local-fix',
                'activate-target',
                'capture-origin',
                'verify-target',
              ]
            : [
                'apply-local-fix',
                'activate-target',
                'prepare-scope',
                'capture-origin',
                'verify-target',
              ];
      work.transition.programs.push(program);
      work.strategyPrograms[index]![0] = Math.max(
        0,
        Math.min(...safe.map((i) => work.strategyPrograms[i]![0])) - 1,
      );
      work.strategyPrograms[index]![1] = Math.max(
        0,
        Math.min(...safe.map((i) => work.strategyPrograms[i]![1])) - 1,
      );
    }
    strategyDecision(work);
  }
  return work;
}

/** Infer profile evidence from work structure and executed strategies, without counting defects. */
export function difficultyMetadata(world: WorldState): DifficultyMetadata | undefined {
  const work = world.work;
  if (!work) return undefined;
  const decision = work.policy ? strategyDecision(work) : null;
  const changedDecision = work.policy
    ? (['cost', 'delay', 'residualRisk'] as const).some(
        (priority) =>
          strategyDecision({ ...work, policy: { ...work.policy!, priority } }).best.index !==
          decision!.best.index,
      )
    : false;
  return {
    gradeTarget: world.grade,
    band: work.band,
    profile: structuredClone(work.profile),
    rationale:
      `${work.professionalResponsibility} ${work.diagnosticMode === 'identified' ? 'Причина установлена независимо; неоднозначность не увеличивается из-за грейда.' : 'Причинную гипотезу требуется связать с доступным evidence.'} ${work.reasoningGrade === 'Junior' ? 'Основные facts доступны локально.' : `Необходимо применить правило связи источников: ${work.handoff}`} ${decision ? 'Несколько предметных действий выполняют текущий функциональный контракт; лучший выбор определяется hard constraints и заявленным приоритетом.' : ''}`.trim(),
    structuralEvidence: {
      localContext: work.actors.length === 1 && !work.historicalWorld && !work.policy,
      interactingWorkflow: work.actors.length >= 2 && !!work.handoff && !!work.historicalWorld,
      correlatedSources: !!work.historicalWorld && !!work.handoff,
      technicallyValidStrategies:
        decision?.outcomes.filter((outcome) => outcome.functionalContract).length || 0,
      feasibleStrategies: decision?.feasible.length || 0,
      strategyChangesUnderConstraints: changedDecision,
      secondOrderConsequences: work.consequences,
    },
  };
}

function combinedEvidence(
  current: Artifact,
  historical: Artifact | undefined,
  work: GradeWorkWorld,
): Artifact {
  if (current.type === 'architecture' || current.type === 'topology') return current;
  if (current.type === 'code' || current.type === 'diff') {
    return {
      ...current,
      content: `// Предложенная версия; подтверждённое состояние установите по источнику связи workflow.\n${historical?.content || current.content}`,
    };
  }
  const report = (content: string, revision: number) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }
    const data =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(data?.records)
        ? data.records
        : data
          ? Object.entries(data)
              .filter(([key]) => key !== 'format')
              .map(([name, value]) => ({
                name,
                value: typeof value === 'object' ? JSON.stringify(value) : value,
              }))
          : [{ observation: content }];
    const sourceRevision = revision === 0 ? 'revision-A' : 'revision-B';
    return {
      sourceRevision,
      // Preserve only metadata already public in the original artifact. A/B
      // contracts and parameters can differ and must never be merged globally.
      ...(Array.isArray(data?.records)
        ? Object.fromEntries(Object.entries(data!).filter(([key]) => key !== 'records'))
        : {}),
      records: rows.map((row) => ({
        ...(row && typeof row === 'object' ? row : { observation: row }),
        sourceRevision,
      })),
    };
  };
  const reports = [
    report(current.content, work.activeRevision),
    report(historical?.content || current.content, 1 - work.activeRevision),
  ];
  return {
    ...current,
    content: JSON.stringify({
      records: reports.flatMap((entry) => entry.records),
      reports,
      sourceContract:
        'Reports принадлежат разным состояниям. Подтверждённую версию устанавливает workflow checkpoint, а не порядок поступления report.',
    }),
    usefulness: Math.max(current.usefulness, 0.65),
  };
}

/** Adapt existing domain runtimes through local, correlated-workflow and strategic work contracts. */
export function withQualitativeGrades(model: ItemModel): ItemModel {
  const base = model.runtime;
  if (!base) throw new Error(`Нет runtime для grade adaptation: ${model.id}`);
  if (!model.supportedGrades?.length || !model.gradeConfigurations)
    throw new Error(`ItemModel не имеет explicit grade-support audit: ${model.id}`);
  const configurations = model.gradeConfigurations;
  const gradeRange = model.supportedGrades;
  const sourceModel = (current: ItemModel): ItemModel => ({
    ...current,
    ...(model.availableArtifacts ? { availableArtifacts: model.availableArtifacts } : {}),
  });
  const runtime: ItemRuntime = {
    ...base,
    createWorld(pack, current, target, seed, requestedBand) {
      const band = requestedBand || defaultBand(target);
      const level = reasoningGrade(band);
      if (!gradeRange.includes(target)) throw new Error('ItemModel не поддерживает target grade');
      if (!gradeRange.includes(level)) throw new Error('ItemModel не поддерживает reasoning band');
      const world = base.createWorld(pack, current, level, seed);
      world.work = makeWork(current, world, base, seed, band);
      world.grade = target;
      return world;
    },
    mutateWorld(current, world, seed) {
      const work = world.work!;
      const next =
        work.reasoningGrade === 'Senior'
          ? structuredClone(world)
          : base.mutateWorld(current, physicalWorld(world), seed);
      next.grade = world.grade;
      next.work =
        work.reasoningGrade === 'Senior'
          ? structuredClone(work)
          : makeWork(current, next, base, seed, work.band);
      next.work.changed = true;
      if (next.work.policy) {
        const before = strategyDecision(work).best.index;
        next.work.policy.priority = (['cost', 'delay', 'residualRisk'] as const).find(
          (priority) =>
            strategyDecision({ ...next.work!, policy: { ...next.work!.policy!, priority } }).best
              .index !== before,
        )!;
        if (work.reasoningGrade === 'Senior' && next.work.transition)
          next.work.transition.probe = (next.work.transition.probe + 1) % 4;
      }
      next.mutation =
        work.reasoningGrade === 'Senior'
          ? 'Функциональные данные сохранены; изменён приоритет выбора стратегии и предложение для прогноза последствий. Повторно примените текущие ограничения, новый приоритет и последовательность из источника стратегий.'
          : 'Обновлены исходные данные и результаты проверок. Сопоставьте текущее состояние с контрактом; для нескольких версий сначала установите актуальную по workflow checkpoint.';
      return next;
    },
    deriveTruth(current, world) {
      const truth = base.deriveTruth(current, physicalWorld(world));
      if (world.work?.policy)
        return {
          ...truth,
          requirements: [
            ...truth.requirements,
            `strategy:${strategyDecision(world.work).best.archetypeId}`,
          ],
        };
      return truth;
    },
    createIntents(current, world, kind, seed) {
      const work = world.work!;
      if (!work.policy || !strategicKinds.includes(kind)) {
        const alternatives = base.createIntents(current, physicalWorld(world), kind, seed);
        if (work.reasoningGrade === 'Senior' && kind === 'falsification')
          return alternatives.map((intent) => ({
            ...intent,
            text: `${intent.text} Это проверяет причинную гипотезу; само по себе наблюдение не определяет стратегию при ограничении: ${getGradeDesign(current.specialization).consequences[0]}.`,
          }));
        return alternatives;
      }
      const truth = runtime.deriveTruth(current, world);
      const physicalTruth = base.deriveTruth(current, physicalWorld(world));
      const decision = strategyDecision(work);
      const repair =
        base
          .createIntents(current, physicalWorld(world), 'remediation', seed)
          .find(
            (intent) =>
              intent.predictsHazard === physicalTruth.hazard &&
              intent.availableUnder.includes(physicalTruth.hazard) &&
              physicalTruth.requirements.every((requirement) =>
                intent.guarantees.includes(requirement),
              ) &&
              (!intent.applicability ||
                Object.entries(intent.applicability).every(
                  ([key, value]) => world.radicals.failure[key] === value,
                )),
          )?.text ||
        current.cases.find((entry) => entry.hazard === physicalTruth.hazard)?.repair ||
        'Выполнить функциональный контракт по приведённым данным.';
      return work.decisionArchetypes.map((strategy, index) => ({
        id: `${kind}:${strategy.id}`,
        kind,
        text: `${repair} ${strategy.action} Стоимость=${decision.outcomes[index]!.cost}; срок=${decision.outcomes[index]!.delay}; остаточный риск=${decision.outcomes[index]!.residualRisk}.`,
        predictsHazard: truth.hazard,
        guarantees: [
          ...physicalTruth.requirements,
          ...(index === decision.best.index ? [`strategy:${strategy.id}`] : []),
        ],
        availableUnder: [truth.hazard],
        applicability: { ...world.radicals.failure },
        misconception:
          index === decision.best.index
            ? null
            : `${model.specialization}:strategy-ignores-constraints`,
        partialCredit: 0,
      }));
    },
    responseTask(current, world, kind) {
      const physical = base.responseTask?.(current, physicalWorld(world), kind);
      if (!physical) throw new Error('Нет локальной схемы плана');
      const work = world.work!;
      const controls = [...physical.task.controls];
      let accepted = physical.accepted;
      if (work.reasoningGrade !== 'Junior') {
        controls.push(
          select('sourceRevision', 'Подтверждённое состояние workflow', [
            ['revision-A', 'revision-A'],
            ['revision-B', 'revision-B'],
          ]),
        );
        accepted = accepted.map((plan) => ({
          ...plan,
          sourceRevision: work.activeRevision === 0 ? 'revision-A' : 'revision-B',
        }));
      }
      if (work.policy && strategicKinds.includes(kind)) {
        controls.push(
          select(
            'strategy',
            'Стратегия перехода',
            work.decisionArchetypes.map((action) => [actionToken(action), action.action]),
          ),
        );
        accepted = accepted.map((plan) => ({
          ...plan,
          strategy: actionToken(work.decisionArchetypes[strategyDecision(work).best.index]!),
        }));
        if (work.transition) {
          controls.push(
            select('transitionPrediction', 'Последствия предложенного перехода', [
              ['safe', 'Область соблюдена; исходное основание возврата/пересмотра сохранено'],
              ['scope', 'Нарушена область; исходное основание возврата/пересмотра сохранено'],
              ['rollback', 'Область соблюдена; исходное основание возврата/пересмотра потеряно'],
              [
                'scope-rollback',
                'Нарушена область и потеряно исходное основание возврата/пересмотра',
              ],
            ]),
            select(
              'transitionExposure',
              'Число затронутых нарушением области контекстов',
              [
                ['0', '0'],
                [String(work.policy.oldConsumers), String(work.policy.oldConsumers)],
                [String(work.policy.newConsumers), String(work.policy.newConsumers)],
                [
                  String(work.policy.oldConsumers + work.policy.newConsumers),
                  String(work.policy.oldConsumers + work.policy.newConsumers),
                ],
              ].filter(
                ([value], index, entries) => entries.findIndex(([v]) => v === value) === index,
              ) as [string, string][],
            ),
          );
          const prediction = transitionPrediction(work);
          accepted = accepted.map((plan) => ({
            ...plan,
            transitionPrediction: prediction.prediction,
            transitionExposure: String(prediction.interruption),
          }));
        }
      }
      return {
        task: {
          ...physical.task,
          controls,
          instructions: `${physical.task.instructions} ${work.operationalConstraint}${work.policy && strategicKinds.includes(kind) ? ' Стратегия должна выполнить hard constraints; среди допустимых выберите наилучшую по указанному приоритету. Локальный fix сам по себе не определяет переход. Прогноз последствий относится к отдельно помеченному предложению в источнике стратегий, а не к вашей выбранной стратегии.' : ''}`,
        },
        accepted,
      };
    },
    createArtifacts(current, world, truth) {
      const physical = physicalWorld(world);
      const actualTruth = base.deriveTruth(current, physical);
      const artifacts = base.createArtifacts(sourceModel(current), physical, actualTruth);
      const work = world.work!;
      if (work.reasoningGrade === 'Junior') return artifacts;
      const historical = work.historicalWorld!;
      const previous = base.createArtifacts(
        sourceModel(current),
        historical,
        base.deriveTruth(current, historical),
      );
      const result = artifacts.map((artifact) =>
        combinedEvidence(
          artifact,
          previous.find((entry) => entry.id === artifact.id),
          work,
        ),
      );
      result.push({
        id: 'workflow',
        type: 'lineage',
        label: 'Связь источников и подтверждённого состояния',
        usefulness: 1,
        content: JSON.stringify({
          handoff: work.handoff,
          records: work.actors.map((actor, index) => ({
            actor,
            responsibility:
              index === 0
                ? 'создать и сохранить исходное состояние'
                : index === 1
                  ? 'применить результат только к соответствующей версии'
                  : work.policy
                    ? 'учесть последствия решения и возможность восстановления'
                    : 'проверить взаимодействующую область контракта',
            checkpoint: work.activeRevision === 0 ? 'revision-A' : 'revision-B',
            evidence:
              index === 0
                ? 'подтверждённая запись состояния'
                : 'report может прийти позже и относиться к прежней записи',
          })),
        }),
      });
      if (work.policy) {
        const native = nativeDecisionContexts[current.specialization]!;
        result.push({
          id: 'strategy',
          type: native.artifact,
          label: 'Стратегии, ограничения и последствия',
          usefulness: 1,
          content: JSON.stringify({
            ...(work.transition
              ? {
                  transitionContract: publicTransitionContract(work),
                  proposedTransition: work.decisionArchetypes[work.transition.probe]!.action,
                }
              : {}),
            records: strategyDecision(work).outcomes.map((outcome) => ({
              strategy: work.decisionArchetypes[outcome.index]!.action,
              ...(work.transition
                ? { operations: work.transition.programs[outcome.index] }
                : {
                    functionalContract: outcome.functionalContract,
                    ...(work.policy!.kind === 'research'
                      ? {
                          supportedDecisionScope: outcome.compatibleConsumers,
                          revisableDecision: outcome.rollbackSafe,
                          irreversibleExposure: outcome.interruption,
                        }
                      : {
                          compatibleConsumers: outcome.compatibleConsumers,
                          retainedRollback: outcome.rollbackSafe,
                          interruption: outcome.interruption,
                        }),
                  }),
              cost: outcome.cost,
              delay: outcome.delay,
              residualRisk: outcome.residualRisk,
            })),
            policy: {
              scope: native.scope,
              reversibility: native.reversibility,
              maxCost: work.policy.maxCost,
              maxDelay: work.policy.maxDelay,
              maxResidualRisk: work.policy.maxResidualRisk,
              irreversibleExposureCap: work.policy.maxInterruption,
            },
            priority: work.policy.priority,
            priorityRule:
              work.policy.kind === 'research'
                ? 'Сначала ограничить вывод допустимой популяцией, сохранить пересмотр решения и выполнить study/deadline budgets. Среди допустимых минимизировать priority; при равенстве — cost, затем delay, затем residualRisk.'
                : 'Сначала сохранить профессиональный контракт, возможность восстановления/пересмотра и бюджеты. Среди допустимых минимизировать priority; при равенстве — cost, затем delay, затем residualRisk.',
            costMeaning: native.cost,
            delayMeaning: `${native.delay}, условные единицы`,
            riskMeaning:
              work.policy.kind === 'research'
                ? 'заданная условием относительная экспозиция ошибочного бизнес-решения; причинная неопределённость не заменяется вероятностью'
                : 'заданная сценарием относительная операционная экспозиция, не вероятность',
            consequences: work.consequences.join(' '),
          }),
        });
      }
      if (!result.some((artifact) => artifact.id === truth.bestDiagnosticArtifact))
        throw new Error('Потерян диагностический источник');
      return result;
    },
    renderScenario(current, world, _truth) {
      const physical = physicalWorld(world);
      const original = base.renderScenario(current, physical, base.deriveTruth(current, physical));
      const work = world.work!;
      const design = getGradeDesign(current.specialization);
      const native = nativeDecisionContexts[current.specialization]!;
      const scope =
        work.reasoningGrade === 'Junior'
          ? design.local
          : work.reasoningGrade === 'Middle'
            ? design.interaction
            : design.strategic;
      const scenario = {
        ...original.scenario,
        context: `${current.title}. ${scope}`,
        observations: [
          ...original.scenario.observations,
          ...(work.diagnosticMode === 'identified'
            ? [
                'Обоснуйте диагноз и изменение по наблюдениям и контракту; готовое причинное объяснение не задано.',
              ]
            : work.diagnosticMode === 'competing'
              ? [
                  'Наблюдения допускают конкурирующие объяснения; различите их по происхождению данных, подтверждённому состоянию и независимому checkpoint.',
                ]
              : [
                  'Причину установите по связи наблюдения с контрактом и принадлежности evidence текущему состоянию.',
                ]),
          ...(work.reasoningGrade === 'Junior'
            ? [
                'Основные входы и наблюдаемое локальное состояние приведены; сложный переход нескольких версий не требуется.',
              ]
            : [
                'Источники содержат reports разных revisions. Установите принадлежность результата по checkpoint и правилу передачи; порядок прихода reports не является доказательством актуальности.',
              ]),
        ],
        constraints: [
          ...original.scenario.constraints,
          work.operationalConstraint,
          ...(work.policy
            ? [
                work.policy.kind === 'research'
                  ? `Наблюдаемая популяция: ${work.policy.newConsumers}; за пределами подтверждённой поддержки: ${work.policy.oldConsumers}. Недопустима необратимая экспозиция неподтверждённого вывода. Study cost ≤ ${work.policy.maxCost}; срок бизнес-решения ≤ ${work.policy.maxDelay}; остаточная экспозиция ≤ ${work.policy.maxResidualRisk}; возможность пересмотра обязательна. Приоритет среди допустимых: минимальный ${work.policy.priority}.`
                  : `Сохранить ${native.scope}. Обязательное условие: ${native.reversibility}. ${native.cost} ≤ ${work.policy.maxCost}; ${native.delay} ≤ ${work.policy.maxDelay}; необратимая экспозиция ≤ ${work.policy.maxInterruption}; остаточная экспозиция ≤ ${work.policy.maxResidualRisk}. Приоритет среди допустимых: минимальный ${work.policy.priority}; смысл риска — ${native.exposure}.`,
                ...design.consequences,
              ]
            : []),
        ],
        assumptions: [
          ...original.scenario.assumptions,
          ...(work.policy
            ? [
                work.policy.kind === 'research'
                  ? 'Все планы исправляют локальную интерпретацию данных. Допустимость переноса вывода и последствия бизнес-решения проверяются отдельно. Параметры study cost, срока и экспозиции заданы условием; статистическая уверенность не выдумывается.'
                  : 'Каждая стратегия включает локальное корректное исправление. Их последствия перехода различаются; числовые показатели заданы моделью сценария и не являются статистической оценкой риска.',
              ]
            : []),
        ],
      };
      return {
        scenario,
        text: [
          scenario.context,
          ...scenario.observations,
          ...scenario.constraints,
          ...scenario.assumptions,
        ].join('\n\n'),
        templateIds: original.templateIds,
      };
    },
    prompt(kind, world) {
      if (world?.work?.policy?.kind === 'research' && strategicKinds.includes(kind))
        return 'Какой аналитический план и бизнес-решение допустимы при ограниченной области вывода, стоимости новой информации и указанном приоритете?';
      if (world?.work?.policy && strategicKinds.includes(kind))
        return kind === 'negative_guarantee' || kind === 'critical_assumption'
          ? 'Какая стратегия сохраняет требуемые гарантии и допустимый остаточный риск при указанных ограничениях?'
          : 'Какой переход лучше среди технически допустимых решений при заданных ограничениях и приоритете?';
      return (
        base.prompt?.(kind) ||
        (kind === 'falsification'
          ? 'Какое наблюдение сильнее всего опровергает это причинное объяснение?'
          : kind === 'diagnosis'
            ? 'Какое объяснение лучше всего согласуется с наблюдениями?'
            : kind === 'adaptation'
              ? 'Какое решение сохраняет гарантию после изменения условий?'
              : 'Какое решение подтверждается приведёнными данными и ограничениями?')
      );
    },
    semanticState(world) {
      return {
        physical: base.semanticState?.(physicalWorld(world)) || physicalWorld(world).radicals,
        band: world.work?.band,
        confirmedRevision: world.work?.activeRevision,
        profile: world.work?.profile,
        decisionArchetypes: world.work?.decisionArchetypes,
        policy: world.work?.policy,
        transition: world.work?.transition,
      };
    },
  };
  return {
    ...model,
    runtime,
    version: model.specialization === 'backend' ? '7.0.1' : '7.0.0',
    supportsJunior: gradeRange.includes('Junior'),
    supportsMiddle: gradeRange.includes('Middle'),
    supportsSenior: gradeRange.includes('Senior'),
    gradeConfigurations: Object.fromEntries(
      gradeRange.map((grade) => [grade, configurations[grade]]),
    ),
    availableArtifacts: [
      ...new Set([...(model.availableArtifacts || []), 'lineage' as const, 'deployment' as const]),
    ],
  };
}

/** Register role-owned grade designs and natural recipes without changing the existing model inventory. */
export function withPackGradeModel(pack: SpecializationPack): SpecializationPack {
  if (!pack.enabled) return pack;
  const design = getGradeDesign(pack.id);
  const configurations = trackGradeConfigurations(pack.id);
  const models = pack.itemModels.map((model) => {
    const capabilities = [...(model.capabilities || [])];
    if (design.incidentDomains.includes(model.competencyDomain!))
      capabilities.push('native-investigation');
    if (design.reviewDomains.includes(model.competencyDomain!))
      capabilities.push('native-decision');
    return withQualitativeGrades(
      auditGradeSupport({
        ...model,
        capabilities,
      }),
    );
  });
  const recipes = Object.fromEntries(
    (['Junior', 'Middle', 'Senior'] as const).map((grade) => [
      grade,
      assessmentRecipe(pack.id, grade),
    ]),
  ) as Record<TargetGrade, ReturnType<typeof assessmentRecipe>>;
  return {
    ...pack,
    version: pack.id === 'backend' ? '7.0.1' : '7.0.0',
    gradeProgressionVocabulary: { ...decisionCatalogs[pack.id]!.progression },
    decisionArchetypeCatalog: structuredClone(decisionCatalogs[pack.id]!),
    itemModels: models,
    gradeConfigurations: configurations,
    assessmentRecipes: recipes,
    ...(pack.presentation
      ? {
          presentation: {
            ...pack.presentation,
            gradeDescriptions: {
              Junior: design.local,
              Middle: design.interaction,
              Senior: design.strategic,
            },
            stages: pack.presentation.stages.map((stage) => ({
              ...stage,
              purpose: stage.id === 'incident' ? design.workForm : stage.purpose,
              minSteps:
                stage.id === 'incident' || stage.id === 'review'
                  ? Math.min(
                      ...Object.values(recipes).map((recipe) => recipe.stages[stage.id]!.length),
                    )
                  : stage.minSteps,
              maxSteps:
                stage.id === 'incident' || stage.id === 'review'
                  ? Math.max(
                      ...Object.values(recipes).map((recipe) => recipe.stages[stage.id]!.length),
                    )
                  : stage.maxSteps,
            })),
          },
        }
      : {}),
    ...(pack.id !== 'backend'
      ? { stageRequirements: { incident: ['native-investigation'], review: ['native-decision'] } }
      : {}),
  };
}
