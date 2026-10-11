import { random } from '../random.js';
import { difficultyPoints } from '../adaptive/scoring.js';
import { calibratedFormDistance } from '../adaptive/item-calibration.js';
import { createHash } from 'node:crypto';
import {
  dimensions,
  type CompetencyDimension,
  type ItemStep,
  type Stage,
  type TargetGrade,
} from '../adaptive/model.js';
import {
  buildIntents,
  buildWorld,
  deriveGroundTruth,
  evaluateIntent,
  mutateWorld,
} from './world.js';
import { generateArtifacts, renderContext } from './render.js';
import { fingerprint, questionFingerprint, validateGeneratedItem } from './validators.js';
import { getPack, getItemModel } from './packs.js';
import { validatedFallbackPool } from './pool.js';
import { humanReasoning } from './narrative.js';
import { defaultBand, reasoningGrade, type DifficultyBand } from './difficulty.js';
import { difficultyMetadata } from './qualitative-runtime.js';
import type {
  AnswerIntent,
  ExposureRecord,
  GeneratedItem,
  ItemModel,
  SpecializationPack,
  WorldState,
} from './model.js';

export const generatorVersion = 'formal-generator-7.3.3';
export interface GenerationAudit {
  candidates: number;
  passed: number;
  rejected: number;
  issuesByGate: Record<string, number>;
  exposureRejected: number;
  blueprintRejected: number;
}
function randomSource(seed: number | string, attempt: number): () => number {
  if (typeof seed === 'number') return random(seed + attempt * 7919);
  let counter = 0;
  return () =>
    createHash('sha256')
      .update(`${seed}:blueprint:${attempt}:${counter++}`)
      .digest()
      .readUInt32LE() / 0x100000000;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
const prompts: Record<AnswerIntent['kind'], string[]> = {
  diagnosis: [
    'Какую гипотезу проверить первой по этим наблюдениям?',
    'Какая цепочка событий лучше всего объясняет проблему?',
    'Какое предположение следует проверить следующим?',
  ],
  interpretation: [
    'Какой вывод подтверждается доступными данными?',
    'Что можно обоснованно заключить из этих наблюдений?',
    'Какой механизм объясняет зафиксированные события?',
  ],
  remediation: [
    'Какое исправление сохраняет указанные гарантии?',
    'Какое решение предпочтительнее при этих ограничениях?',
    'Как изменить обработку, чтобы закрыть установленный риск?',
  ],
  adaptation: [
    'Как изменить решение после изменения условий?',
    'Какая адаптация сохранит нужную гарантию?',
    'Как скорректировать план с учётом новых фактов?',
  ],
  falsification: [
    'Какое наблюдение сильнее всего опровергло бы установленную гипотезу?',
    'Какой результат дополнительной проверки противоречит этой причине?',
    'Какие новые данные заставят пересмотреть эту гипотезу?',
  ],
  negative_guarantee: [
    'Какую из перечисленных гарантий текущий обработчик не обеспечивает?',
    'Какое требование нарушено, несмотря на остальные работающие проверки?',
  ],
  critical_assumption: [
    'Какое условие нужно восстановить, чтобы закрыть доказанное нарушение?',
    'Какое предположение об обработке не подтверждается этими данными?',
  ],
};
/** Full formal generation. The returned snapshot is deeply frozen after the quality gate. */
export function generateItem(
  pack: SpecializationPack,
  model: ItemModel,
  grade: TargetGrade,
  stage: Stage,
  dimension: CompetencyDimension,
  seed: number,
  source: GeneratedItem['generated']['source'] = 'on-demand',
  audit?: GenerationAudit,
  requestedBand?: DifficultyBand,
  coreProbe = false,
): GeneratedItem {
  if (audit) audit.candidates++;
  if (model.gradeRange && !model.gradeRange.includes(grade))
    throw new Error('ItemModel не опубликован для этого grade');
  const rng = random(seed ^ 0x91e10da5);
  const world = buildWorld(pack, model, grade, seed, requestedBand || defaultBand(grade, stage));
  const truth = deriveGroundTruth(model, world);
  const rendered = renderContext(model, world, truth);
  const generated: GeneratedItem['generated'] = {
    ...(coreProbe ? { coreProbe: true } : {}),
    ...(difficultyMetadata(world) ? { difficulty: difficultyMetadata(world)! } : {}),
    ...(model.competencyDomain ? { competencyDomain: model.competencyDomain } : {}),
    seed,
    generatorVersion,
    packVersion: pack.version,
    itemModelId: model.id,
    itemModelVersion: model.version,
    siblingGroup: model.siblingGroup,
    worldState: world,
    groundTruth: truth,
    stepWorlds: {},
    stepTruths: {},
    stepArtifacts: {},
    intents: {},
    optionIntents: {},
    responseChecks: {},
    templateIds: rendered.templateIds,
    semanticFingerprint: '',
    surfaceFingerprint: '',
    renderedContent: '',
    validation: { passed: false, issues: [] },
    source,
  };
  const makeStep = (
    id: string,
    d: CompetencyDimension,
    kind: AnswerIntent['kind'],
    sw: WorldState = world,
    resetContext?: string,
  ): ItemStep => {
    const gt = deriveGroundTruth(model, sw);
    const execution =
      id === 'evidence' ? undefined : model.runtime?.responseTask?.(model, sw, kind);
    if (execution) generated.responseChecks![id] = { accepted: execution.accepted };
    const candidates = buildIntents(model, sw, kind, Math.floor(rng() * 0x100000000));
    if (
      stage === 'boundary' &&
      !sw.work?.policy &&
      ['negative_guarantee', 'critical_assumption'].includes(kind)
    ) {
      const gradeIndex = ['Junior', 'Middle', 'Senior'].indexOf(grade);
      const alternatives = model.cases.filter(
        (causalCase) =>
          causalCase.hazard !== gt.hazard &&
          ['Junior', 'Middle', 'Senior'].indexOf(causalCase.minimumGrade || 'Junior') <=
            gradeIndex &&
          ['Junior', 'Middle', 'Senior'].indexOf(causalCase.maximumGrade || 'Senior') >= gradeIndex,
      );
      const alternative = alternatives[seed % alternatives.length]!;
      resetContext = `Предложенное изменение: ${alternative.repair} Остальное поведение обработчика остаётся прежним. Оцените, закрывает ли это изменение доказанное нарушение.`;
    }
    generated.stepWorlds[id] = sw;
    generated.stepTruths[id] = gt;
    generated.stepArtifacts[id] = generateArtifacts(model, sw, gt);
    generated.intents[id] = candidates;
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
    }
    const scores: Record<string, number> = {};
    const options = candidates.map((intent) => {
      const optionId = `choice-${Math.floor(rng() * 0x100000000).toString(36)}`;
      scores[optionId] = evaluateIntent(intent, sw, gt);
      generated.optionIntents[optionId] = intent.id;
      return { id: optionId, text: intent.text };
    });
    return {
      ...(execution ? { responseTask: execution.task } : {}),
      id,
      type:
        kind === 'adaptation'
          ? 'constraint_mutation'
          : kind === 'remediation'
            ? 'design_review'
            : kind === 'diagnosis'
              ? 'situational_choice'
              : 'artifact_interpretation',
      prompt:
        model.runtime?.prompt?.(kind, sw) ||
        prompts[kind][Math.floor(rng() * prompts[kind].length)]!,
      context: renderContext(model, sw, gt).text,
      scenario: renderContext(model, sw, gt).scenario,
      ...(resetContext
        ? { resetContext: humanReasoning(resetContext) }
        : kind === 'falsification'
          ? { resetContext: humanReasoning(`Проверяем гипотезу: ${gt.causalChain.at(-1)}`) }
          : {}),
      options,
      rubric: {
        dimension: d,
        ...(execution
          ? { executionDimension: d === 'diagnosis' ? ('correctness' as const) : d }
          : {}),
        informationWeight: stage === 'boundary' && !coreProbe ? 2.5 : 1,
        resultWeight: difficultyPoints(
          grade,
          sw.work?.band || requestedBand || defaultBand(grade, stage),
        ),
        scores,
        rationale: candidates.find((i) => evaluateIntent(i, sw, gt) === 1)!.text,
        expertExpectedSuccessRate: grade === 'Junior' ? 0.6 : grade === 'Middle' ? 0.65 : 0.72,
        expertRatings: [],
      },
    };
  };
  let steps: ItemStep[];
  const recipe = pack.assessmentRecipes?.[grade]?.stages[stage];
  if (recipe) {
    const separateConsequence =
      grade === 'Senior' && recipe.some((entry) => entry.id === 'consequence');
    const consequenceWorld = separateConsequence ? mutateWorld(model, world, seed ^ 0xd47a) : world;
    const changed = recipe.some((entry) => entry.changed)
      ? mutateWorld(model, consequenceWorld, seed ^ 0xcafe)
      : world;
    steps = recipe.map((entry) => {
      const currentWorld = entry.changed
        ? changed
        : entry.id === 'consequence'
          ? consequenceWorld
          : world;
      const step = makeStep(
        entry.id,
        entry.dimension,
        entry.kind,
        currentWorld,
        entry.changed || (separateConsequence && entry.id === 'consequence')
          ? currentWorld.mutation
          : entry.kind === 'remediation'
            ? 'Следующее решение оценивается независимо от предыдущей диагностики; используйте приведённые факты и ограничения.'
            : undefined,
      );
      if (entry.prompt) step.prompt = entry.prompt;
      if (entry.exploration) {
        step.options = [];
        step.exploration = true;
        step.requiredEvidenceSources = world.work?.reasoningGrade === 'Junior' ? 1 : 2;
      }
      return step;
    });
  } else if (stage === 'incident') {
    const explore = makeStep('evidence', 'diagnosis', 'interpretation');
    explore.options = [];
    explore.exploration = true;
    steps = [
      makeStep('investigate', 'diagnosis', 'diagnosis'),
      explore,
      makeStep('interpret', 'diagnosis', 'interpretation'),
      makeStep('cause', 'diagnosis', 'falsification'),
      makeStep(
        'remediate',
        'engineering_judgment',
        'remediation',
        world,
        `Дополнительная диагностика установила: ${truth.causalChain.at(-1)} Следующий шаг оценивается независимо от предыдущего ответа.`,
      ),
    ];
  } else if (stage === 'review') {
    const changed = mutateWorld(model, world, seed ^ 0xcafe);
    const baseline = buildIntents(model, world, 'remediation', seed).find(
      (intent) => evaluateIntent(intent, world, truth) === 1,
    )!.text;
    steps = [
      makeStep('risk', 'correctness', 'interpretation'),
      makeStep(
        'fix',
        'correctness',
        'remediation',
        world,
        `Команда установила риск: ${truth.causalChain.at(-1)} Предыдущий ответ не ограничивает выбор исправления.`,
      ),
      makeStep(
        'adapt',
        'adaptation',
        'adaptation',
        changed,
        `Базовое решение команды: ${baseline} ${changed.mutation}`,
      ),
    ];
  } else {
    const kind =
      dimension === 'diagnosis'
        ? stage === 'boundary'
          ? 'falsification'
          : 'diagnosis'
        : dimension === 'correctness'
          ? stage === 'boundary'
            ? 'negative_guarantee'
            : 'interpretation'
          : dimension === 'adaptation'
            ? 'adaptation'
            : stage === 'boundary'
              ? 'critical_assumption'
              : 'remediation';
    const sw = dimension === 'adaptation' ? mutateWorld(model, world, seed ^ 0xf00d) : world;
    steps = [
      makeStep(
        stage === 'boundary' ? 'boundary' : 'anchor',
        dimension,
        kind,
        sw,
        sw.mutation ? `Начальные условия: ${truth.causalChain.at(-1)} ${sw.mutation}` : undefined,
      ),
    ];
  }
  const item: GeneratedItem = {
    id: `item-${fingerprint([pack.id, model.id, grade, stage, dimension, seed]).slice(0, 20)}`,
    concept: model.title,
    version: model.version,
    specialization: pack.id,
    targetGrade: grade,
    stage,
    difficultyBand:
      world.work?.band ||
      `${grade.toLowerCase()}-${stage === 'boundary' ? 'around-cut' : 'expert-profile'}`,
    measuredConstruct: model.title,
    contentTags: model.contentTags,
    approved: true,
    expertCalibration: {
      status: 'provisional',
      expectedSuccessRate: grade === 'Junior' ? 0.6 : grade === 'Middle' ? 0.65 : 0.72,
      expertRatings: [],
    },
    steps,
    artifacts: generateArtifacts(model, world, truth),
    architecture: world.topology.nodes.map((n) => n.label),
    topology: world.topology,
    variantSeed: seed,
    parameters: {
      ...world.incidentals,
      workers: world.radicals.workers,
      failure: JSON.stringify(world.radicals.failure),
    },
    generated,
  };
  generated.semanticFingerprint = fingerprint({
    model: model.id,
    version: model.version,
    grade,
    radicals: model.runtime?.semanticState?.(world) || world.radicals,
    truth: truth.hazard,
    topology: world.topology.edges,
    artifacts: item.artifacts.map((a) => a.type),
  });
  generated.renderedContent = steps
    .map(
      (s) =>
        `${s.context}\n${s.prompt}\n${s.options
          .map((o) => o.text)
          .sort()
          .join('\n')}`,
    )
    .join('\n');
  const normalize = (text: string) =>
    text
      .replaceAll(world.incidentals.operationId, '<sample>')
      .replaceAll(world.incidentals.timestamp, '<timestamp>')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  generated.surfaceFingerprint = fingerprint({
    text: normalize(generated.renderedContent),
    evidence: Object.values(generated.stepArtifacts).map((artifacts) =>
      artifacts.map((artifact) => ({ type: artifact.type, content: normalize(artifact.content) })),
    ),
  });
  generated.validation.issues = validateGeneratedItem(item, model, pack);
  generated.validation.passed = generated.validation.issues.length === 0;
  if (audit) {
    if (generated.validation.passed) audit.passed++;
    else {
      audit.rejected++;
      for (const issue of generated.validation.issues)
        audit.issuesByGate[issue.gate] = (audit.issuesByGate[issue.gate] || 0) + 1;
    }
  }
  if (!generated.validation.passed)
    throw new Error(
      `Quality gate: ${model.id}: ${generated.validation.issues.map((i) => `${i.gate}: ${i.message}`).join('; ')}`,
    );
  return freeze(item);
}

/** Penalize globally overexposed and recent candidate models in the same grade/construct. */
export function modelExposurePenalty(
  model: ItemModel,
  records: ExposureRecord[],
  userId: string,
): number {
  const count = records.filter((r) => r.itemModelId === model.id).length;
  const recent = records
    .slice(-40)
    .filter((r) => r.userId === userId && r.siblingGroup === model.siblingGroup).length;
  return 1 + count + recent * 30;
}
/** Reproduce a saved item with its original model, leaf seed and published versions. */
export function reproduceGeneratedItem(saved: GeneratedItem): GeneratedItem {
  const pack = getPack(saved.specialization);
  const model = getItemModel(pack.id, saved.generated.itemModelId);
  if (
    saved.generated.generatorVersion !== generatorVersion ||
    saved.generated.packVersion !== pack.version ||
    saved.generated.itemModelVersion !== model.version
  )
    throw new Error('Reproduction requires the original generator, pack and model versions');
  const reproduced = generateItem(
    pack,
    model,
    saved.targetGrade,
    saved.stage,
    saved.steps[0]!.rubric.dimension,
    saved.generated.seed,
    saved.generated.source,
    undefined,
    saved.generated.difficulty?.band,
    Boolean(saved.generated.coreProbe),
  );
  if (
    reproduced.generated.surfaceFingerprint !== saved.generated.surfaceFingerprint ||
    reproduced.generated.semanticFingerprint !== saved.generated.semanticFingerprint
  )
    throw new Error('Saved item does not match its seed and published versions');
  return reproduced;
}
export interface BlueprintOptions {
  calibratedForms?: boolean;
  excludedQuestionFingerprints?: string[];
  audit?: GenerationAudit;
  specialization?: string;
  userId?: string;
  exposure?: ExposureRecord[];
  pool?: GeneratedItem[];
  excludedSiblings?: string[];
  fallbackAttempted?: boolean;
  fallbackItems?: GeneratedItem[];
}
function generateBlueprintCandidate(
  grade: TargetGrade,
  seed: number | string,
  options: BlueprintOptions = {},
) {
  const pack = getPack(options.specialization || 'backend');
  const balanced = (models: ItemModel[]) => {
    if (pack.validateBalance && !pack.validateBalance(models, grade)) return false;
    if (!pack.contentBalance) return true;
    const counts = new Map<string, number>();
    for (const model of models) {
      const domain = model.competencyDomain!;
      counts.set(domain, (counts.get(domain) || 0) + 1);
    }
    return (
      counts.size >= pack.contentBalance.minDomains &&
      [...counts.values()].every((count) => count <= pack.contentBalance!.maxPerDomain)
    );
  };
  const exposure = (options.exposure || []).filter(
    (r) => r.specialization === pack.id && r.targetGrade === grade,
  );
  const recentSurface = new Set(exposure.map((r) => r.surfaceFingerprint));
  const usedQuestions = new Set([
    ...exposure.flatMap((record) => record.questionFingerprints || []),
    ...(options.excludedQuestionFingerprints || []),
  ]);
  const questionsFresh = (item: GeneratedItem) =>
    !usedQuestions.size ||
    item.steps.every((step) => !usedQuestions.has(questionFingerprint(item, step, pack)));
  const gradeIndex = ['Junior', 'Middle', 'Senior'].indexOf(grade);
  const semanticCapacity = pack.itemModels
    .filter((model) => model.gradeRange?.includes(grade))
    .reduce(
      (sum, model) =>
        sum +
        model.cases.filter(
          (c) =>
            ['Junior', 'Middle', 'Senior'].indexOf(c.minimumGrade || 'Junior') <= gradeIndex &&
            ['Junior', 'Middle', 'Senior'].indexOf(c.maximumGrade || 'Senior') >= gradeIndex,
        ).length *
          pack.worldBounds[grade].workers.length *
          (grade === 'Senior' ? 4 : 1),
      0,
    );
  const requiredStages = Object.keys(pack.stageRequirements || {}) as Stage[];
  const constrainedCapacity = requiredStages.map((stage) =>
    pack.itemModels
      .filter(
        (model) =>
          model.gradeRange?.includes(grade) &&
          model.stages.includes(stage) &&
          (pack.stageRequirements?.[stage] || []).every((capability) =>
            model.capabilities?.includes(capability),
          ),
      )
      .reduce((sum, model) => sum + model.cases.length * (grade === 'Senior' ? 4 : 1), 0),
  );
  const semanticWindow = Math.min(
    32,
    Math.max(6, Math.floor(Math.min(semanticCapacity, ...constrainedCapacity) / 3)),
  );
  const recentSemantic = new Set(exposure.slice(-semanticWindow).map((r) => r.semanticFingerprint));
  const pool = options.pool || [];
  const fallbackItems = options.fallbackAttempted
    ? []
    : options.fallbackItems || validatedFallbackPool(pack.id, grade);
  let lastError = '';
  for (let attempt = 0; attempt < 256; attempt++) {
    const rng = randomSource(seed, attempt);
    const used = new Set(options.excludedSiblings || []);
    const claimedQuestions = new Set<string>();
    const freshWithinProgram = (item: GeneratedItem) =>
      questionsFresh(item) &&
      item.steps.every((step) => !claimedQuestions.has(questionFingerprint(item, step, pack)));
    const claim = (item: GeneratedItem) => {
      for (const step of item.steps) claimedQuestions.add(questionFingerprint(item, step, pack));
      return freeze(item);
    };
    const rank = (models: ItemModel[]) =>
      models
        .map((m) => ({
          model: m,
          rank:
            -Math.log(Math.max(1e-9, rng())) *
            modelExposurePenalty(m, exposure, options.userId || ''),
        }))
        .sort((a, b) => a.rank - b.rank)
        .map((v) => v.model);
    const eligible = (stage: Stage, d?: CompetencyDimension) => {
      const candidates = pack.itemModels.filter(
        (m) =>
          m.stages.includes(stage) &&
          (pack.stageRequirements?.[stage] || []).every((capability) =>
            m.capabilities?.includes(capability),
          ) &&
          (!m.gradeRange || m.gradeRange.includes(grade)) &&
          !used.has(m.siblingGroup) &&
          (!d || m.measuredDimensions.includes(d)),
      );
      const recentUserModels = new Set(
        exposure
          .filter((r) => r.userId === options.userId)
          .slice(-6)
          .map((r) => r.itemModelId),
      );
      const fresh = candidates.filter((m) => !recentUserModels.has(m.id));
      // Freshness is a preference, not permission to destroy construct coverage in small packs.
      const minimumFresh =
        pack.stageRequirements?.[stage]?.length && ['incident', 'review'].includes(stage) ? 2 : 1;
      return attempt < 24 && fresh.length >= minimumFresh ? fresh : candidates;
    };
    const issue = (
      model: ItemModel,
      stage: Stage,
      dimension: CompetencyDimension,
      band: DifficultyBand = defaultBand(grade, stage),
    ): GeneratedItem => {
      const matchingPool = pool.filter(
        (i) =>
          i.specialization === pack.id &&
          i.targetGrade === grade &&
          i.stage === stage &&
          !i.generated.coreProbe &&
          i.steps[0]!.rubric.dimension === dimension &&
          i.generated.itemModelId === model.id &&
          i.generated.generatorVersion === generatorVersion &&
          i.generated.packVersion === pack.version &&
          (!i.generated.difficulty || i.generated.difficulty.band === band) &&
          !recentSurface.has(i.generated.surfaceFingerprint) &&
          freshWithinProgram(i) &&
          (options.fallbackAttempted || !recentSemantic.has(i.generated.semanticFingerprint)),
      );
      if (matchingPool.length) {
        const original = matchingPool[Math.floor(rng() * matchingPool.length)]!;
        const copy = structuredClone(original);
        copy.generated.source = options.fallbackAttempted ? 'fallback' : 'pool';
        return claim(copy);
      }
      for (let trial = 0; trial < 8; trial++) {
        try {
          const item = generateItem(
            pack,
            model,
            grade,
            stage,
            dimension,
            Math.floor(rng() * 0x100000000),
            'on-demand',
            options.audit,
            band,
          );
          if (
            !recentSurface.has(item.generated.surfaceFingerprint) &&
            freshWithinProgram(item) &&
            !recentSemantic.has(item.generated.semanticFingerprint)
          )
            return claim(item);
          if (options.audit) options.audit.exposureRejected++;
        } catch (e) {
          lastError = String(e);
        }
      }
      throw new Error(lastError || 'Recent variant exposure');
    };
    try {
      let reservedPair: [ItemModel, ItemModel] | undefined;
      const reservedDomains = new Set<string>();
      if (pack.contentBalance?.maxPerDomain === 1) {
        for (const candidate of rank(eligible('incident'))) {
          const partner = rank(
            eligible('review').filter(
              (model) =>
                model.siblingGroup !== candidate.siblingGroup &&
                model.competencyDomain !== candidate.competencyDomain &&
                !model.contentTags.some((tag) => candidate.contentTags.includes(tag)),
            ),
          )[0];
          if (partner) {
            reservedPair = [candidate, partner];
            break;
          }
        }
        if (!reservedPair) throw new Error('Нет независимых областей для incident/review');
        reservedPair.forEach((model) => reservedDomains.add(model.competencyDomain!));
      }
      const anchorModels: { model: ItemModel; dimension: CompetencyDimension }[] = [];
      for (const dimension of dimensions) {
        const band =
          pack.assessmentRecipes?.[grade]?.anchorBands[anchorModels.length] ||
          defaultBand(grade, 'anchors');
        const model = rank(
          eligible('anchors', dimension).filter((candidate) => {
            if (
              candidate.gradeConfigurations &&
              !candidate.gradeRange?.includes(reasoningGrade(band))
            )
              return false;
            if (reservedDomains.has(candidate.competencyDomain!)) return false;
            const quota = pack.coreDomainCounts?.[grade]?.[candidate.competencyDomain!];
            return (
              quota === undefined ||
              anchorModels.filter(
                (anchor) => anchor.model.competencyDomain === candidate.competencyDomain,
              ).length < quota
            );
          }),
        )[0];
        if (!model) throw new Error('Нет независимого anchor');
        anchorModels.push({ model, dimension });
        used.add(model.siblingGroup);
        if (reservedPair) reservedDomains.add(model.competencyDomain!);
      }
      let incident: ItemModel | undefined;
      let review: ItemModel | undefined;
      for (const candidate of rank(eligible('incident'))) {
        if (reservedPair && candidate.id !== reservedPair[0].id) continue;
        const choices = eligible('review').filter(
          (m) =>
            (!reservedPair || m.id === reservedPair[1].id) &&
            m.siblingGroup !== candidate.siblingGroup &&
            !m.contentTags.some((t) => candidate.contentTags.includes(t)) &&
            balanced([...anchorModels.map((anchor) => anchor.model), candidate, m]) &&
            dimensions.every((d) =>
              pack.itemModels.some(
                (boundary) =>
                  boundary.stages.includes('boundary') &&
                  (!boundary.gradeRange || boundary.gradeRange.includes(grade)) &&
                  boundary.measuredDimensions.includes(d) &&
                  !used.has(boundary.siblingGroup) &&
                  boundary.siblingGroup !== candidate.siblingGroup &&
                  boundary.siblingGroup !== m.siblingGroup,
              ),
            ),
        );
        if (choices.length) {
          incident = candidate;
          review = rank(choices)[0];
          break;
        }
      }
      if (!incident || !review) throw new Error('Нет независимой пары incident/review');
      const coreModels = [...anchorModels.map((anchor) => anchor.model), incident, review];
      if (!balanced(coreModels)) throw new Error('Недостаточное покрытие competency domains');
      const items = anchorModels.map(({ model, dimension }, index) =>
        issue(
          model,
          'anchors',
          dimension,
          pack.assessmentRecipes?.[grade]?.anchorBands[index] || defaultBand(grade, 'anchors'),
        ),
      );
      items.push(issue(incident, 'incident', 'diagnosis'));
      used.add(incident.siblingGroup);
      items.push(issue(review, 'review', 'correctness'));
      used.add(review.siblingGroup);
      const boundaryPool: GeneratedItem[] = [];
      for (const dimension of dimensions)
        for (const model of rank(eligible('boundary', dimension)).slice(0, 4)) {
          const bands = pack.assessmentRecipes?.[grade]?.boundaryBands || [
            defaultBand(grade, 'boundary'),
          ];
          for (const band of bands) {
            try {
              boundaryPool.push(issue(model, 'boundary', dimension, band));
            } catch {
              /* A different approved model may cover this construct. */
            }
          }
        }
      if (dimensions.some((d) => !boundaryPool.some((i) => i.steps[0]?.rubric.dimension === d)))
        throw new Error('Не все dimensions имеют независимый boundary');
      if (
        new Set(
          boundaryPool.map(
            (item) => `${item.generated.siblingGroup}/${item.steps[0]!.rubric.dimension}`,
          ),
        ).size < 6
      )
        throw new Error('Резерв не покрывает шесть независимых пар family/competency');
      return {
        items,
        boundaryPool,
        specialization: pack.id,
        version: `${pack.id}-generative-${pack.version}`,
        generation: {
          generatorVersion,
          packVersion: pack.version,
          exposureSnapshot: exposure.map((r) => fingerprint(r)),
          exposureContext: structuredClone(exposure),
          selectionAttempt: attempt,
          fallbackUsed: Boolean(options.fallbackAttempted),
          poolSnapshot: pool.map((i) => i.generated.surfaceFingerprint),
        },
      };
    } catch (e) {
      if (options.audit) options.audit.blueprintRejected++;
      lastError = String(e);
    }
  }
  // A pool is a genuine fallback only when it contains previously validated generated snapshots.
  if (fallbackItems.length && !options.fallbackAttempted)
    return generateBlueprintCandidate(grade, seed, {
      ...options,
      pool: fallbackItems,
      fallbackAttempted: true,
    });
  throw new Error(`Не удалось собрать валидную программу: ${lastError}`);
}

/** Select a valid form nearest the fixed synthetic role/band reference, without relaxing gates. */
export function generateBlueprint(
  grade: TargetGrade,
  seed: number | string,
  options: BlueprintOptions = {},
) {
  const first = generateBlueprintCandidate(grade, seed, options);
  if (options.calibratedForms !== true) return first;
  let selected = first;
  let distance = calibratedFormDistance(first);
  for (let candidate = 1; candidate < 3; candidate++) {
    const form = generateBlueprintCandidate(grade, `${seed}:balanced-form:${candidate}`, options);
    const candidateDistance = calibratedFormDistance(form);
    if (candidateDistance < distance) {
      selected = form;
      distance = candidateDistance;
    }
  }
  return selected;
}
