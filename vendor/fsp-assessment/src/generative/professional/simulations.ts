import { families } from '../../families/registry.js';
import { select, solve, type Family, type Fixture } from '../../families/core.js';
import { canonical } from '../validators.js';
import type { Grade, LabData, Plan } from '../../domain.js';
import { dimensions } from '../../adaptive/model.js';
import { random } from '../../random.js';
import { nativeSimulations } from './native-simulations.js';
import type {
  ArtifactType,
  Fact,
  ItemModel,
  ItemRuntime,
  SpecializationPack,
  WorldState,
} from '../model.js';

interface SimulationState extends Fixture {
  affectedContext: number;
  data: LabData;
  changedData: LabData;
  controls: Fixture['controls'];
  contract: string;
  change: string;
  proposed: Plan;
}
const bindings: Record<string, { family: string; domain: string; source: ArtifactType }[]> = {
  frontend: [
    { family: 'frontend-request-races', domain: 'state', source: 'timeline' },
    { family: 'frontend-list-reconciliation', domain: 'rendering', source: 'dom' },
  ],
  'devops-sre': [
    { family: 'sre-multiwindow-burn', domain: 'slo', source: 'metrics' },
    { family: 'sre-rolling-capacity', domain: 'capacity', source: 'deployment' },
  ],
  'qa-automation': [
    { family: 'qa-mutation-risk', domain: 'risk', source: 'test_run' },
    { family: 'qa-flaky-async-isolation', domain: 'automation', source: 'test_run' },
  ],
  'data-engineering': [
    { family: 'de-cdc-schema-money', domain: 'ingestion', source: 'table' },
    { family: 'de-event-time-windows', domain: 'streaming', source: 'timeline' },
  ],
  'ml-engineer': [
    { family: 'mle-serving-contract', domain: 'features', source: 'feature_distribution' },
    { family: 'mle-batching-precision', domain: 'serving', source: 'table' },
  ],
  'data-scientist': [
    { family: 'ds-decision-cost', domain: 'validation', source: 'experiment_table' },
    { family: 'ds-segment-thresholds', domain: 'metrics', source: 'experiment_table' },
    { family: 'analytics-stratified-ab', domain: 'experimentation', source: 'experiment_table' },
  ],
  mlops: [
    { family: 'mlops-canary-rollback', domain: 'deployment', source: 'model_metrics' },
    { family: 'mlops-point-in-time', domain: 'lineage', source: 'lineage' },
  ],
  genai: [
    { family: 'llm-retrieval-trust', domain: 'retrieval', source: 'retrieval_results' },
    { family: 'llm-grounding-abstention', domain: 'grounding', source: 'retrieval_results' },
  ],
};
const planCache = new Map<string, { reference: Plan; rejected: Plan[]; accepted: Plan[] }>();
function enumerate(family: Family, fixture: Fixture, data: LabData) {
  const cacheKey = JSON.stringify([family.id, fixture.controls, data]);
  const cached = planCache.get(cacheKey);
  if (cached) return cached;
  const solution = solve(family, fixture, data);
  let candidates: Plan[] = [{}];
  for (const control of fixture.controls) {
    const values =
      control.type === 'number'
        ? control.values
        : control.type === 'select'
          ? control.options.map((option) => option.value)
          : Array.from({ length: 2 ** control.options.length }, (_, mask) =>
              control.options
                .filter((_option, index) => mask & (1 << index))
                .map((option) => option.value),
            );
    candidates = candidates.flatMap((plan) =>
      values.map((value) => ({ ...plan, [control.id]: value })),
    );
  }
  const rejected = [
    ...solution.mutants,
    ...candidates.filter((plan) => !Object.values(family.run(data, plan).checks).every(Boolean)),
  ];
  const unique = [...new Map(rejected.map((plan) => [JSON.stringify(plan), plan])).values()];
  if (unique.length < 4)
    throw new Error(`${family.id}: недостаточно независимых ошибочных конфигураций`);
  const accepted = candidates.filter((plan) =>
    Object.values(family.run(data, plan).checks).every(Boolean),
  );
  const output = { reference: solution.reference, rejected: unique, accepted };
  if (planCache.size >= 128) planCache.delete(planCache.keys().next().value!);
  planCache.set(cacheKey, output);
  return output;
}
function description(state: SimulationState, plan: Plan): string {
  return Object.entries(plan)
    .map(([key, value]) => {
      const control = state.controls.find((entry) => entry.id === key)!;
      const display = Array.isArray(value)
        ? value
            .map(
              (entry) => control.options.find((option) => option.value === entry)?.label || entry,
            )
            .join(', ')
        : control.options.find((option) => option.value === value)?.label || String(value);
      return `${control.label}: ${display || 'пустой набор'}`;
    })
    .join('; ');
}
function comparisonPlans(family: Family, state: SimulationState): Plan[] {
  const plans = enumerate(family, state, state.data);
  const referenceLength = description(state, plans.reference).length;
  const distractors = [...plans.rejected].sort(
    (left, right) =>
      Math.abs(description(state, left).length - referenceLength) -
      Math.abs(description(state, right).length - referenceLength),
  );
  return [plans.reference, ...distractors.slice(0, 3)];
}
function repairPlans(family: Family, state: SimulationState) {
  const accepted = enumerate(family, state, state.data).accepted;
  const patches = accepted.map((plan) =>
    Object.fromEntries(
      state.controls.map((control) => [
        control.id,
        canonical(plan[control.id]) === canonical(state.proposed[control.id])
          ? 'keep'
          : `set:${canonical(plan[control.id])}`,
      ]),
    ),
  );
  const effort = (plan: Plan) => Object.values(plan).filter((value) => value !== 'keep').length;
  const budget = Math.min(...patches.map(effort));
  return { budget, accepted: patches.filter((plan) => effort(plan) === budget) };
}
function proposedScenario(
  family: Family,
  fixture: Fixture,
  data: LabData,
  grade: Grade,
  seed: number,
): Plan {
  const plans = enumerate(family, fixture, data);
  const start = Math.floor(random(seed ^ 0x714d)() * plans.rejected.length);
  for (let offset = 0; offset < plans.rejected.length; offset++) {
    const candidate = plans.rejected[(start + offset) % plans.rejected.length]!;
    const distance = Math.min(
      ...plans.accepted.map(
        (plan) =>
          fixture.controls.filter(
            (control) => canonical(plan[control.id]) !== canonical(candidate[control.id]),
          ).length,
      ),
    );
    if (grade !== 'Junior' || distance <= 2) return candidate;
  }
  throw new Error(`${family.id}: нет локально допустимой неисправной конфигурации`);
}

/** Reuse existing executable domain simulators inside the frozen adaptive item contract. */
export function attachExecutableSamples(pack: SpecializationPack): SpecializationPack {
  const fixedReview: Record<string, string> = {
    'devops-sre': 'sre-rolling-capacity',
    'data-engineering': 'de-event-time-windows',
    'qa-automation': 'qa-mutation-risk',
  };
  const nativeBindings: Record<string, { family: string; domain: string; source: ArtifactType }[]> =
    {
      frontend: [
        { family: 'native-fe-dialog', domain: 'accessibility', source: 'accessibility_tree' },
      ],
      'devops-sre': [{ family: 'native-sre-restore', domain: 'recovery', source: 'timeline' }],
      'qa-automation': [{ family: 'native-qa-ci', domain: 'ci', source: 'ci_log' }],
      'data-engineering': [{ family: 'native-de-lineage', domain: 'lineage', source: 'lineage' }],
      'ml-engineer': [
        { family: 'ranking-ndcg-availability', domain: 'evaluation', source: 'model_metrics' },
      ],
      mlops: [{ family: 'native-mp-retrain', domain: 'retraining', source: 'model_registry' }],
      genai: [{ family: 'native-ga-tools', domain: 'tools', source: 'tool_trace' }],
      android: [
        { family: 'native-an-restore', domain: 'lifecycle', source: 'lifecycle' },
        { family: 'native-an-offline', domain: 'offline', source: 'table' },
        { family: 'native-an-frame', domain: 'performance', source: 'timeline' },
      ],
      ios: [
        { family: 'native-io-scene', domain: 'lifecycle', source: 'lifecycle' },
        { family: 'native-io-actors', domain: 'concurrency', source: 'timeline' },
        { family: 'native-io-bgtime', domain: 'lifecycle', source: 'timeline' },
      ],
      'security-appsec': [
        { family: 'native-se-authz', domain: 'authorization', source: 'http_exchange' },
        { family: 'native-se-provenance', domain: 'supply-chain', source: 'lineage' },
        { family: 'native-se-session', domain: 'session', source: 'timeline' },
      ],
    };
  const models = [...(bindings[pack.id] || []), ...(nativeBindings[pack.id] || [])].map(
    (binding): ItemModel => {
      const family = [...families, ...nativeSimulations].find(
        (candidate) => candidate.id === binding.family,
      )!;
      const id = `work-${family.id}`;
      const state = (world: WorldState): SimulationState =>
        JSON.parse(String(world.radicals.failure.simulation));
      const hazard = (world: WorldState) => `${id}:fault-${world.radicals.failure.fault}`;
      const topology: ItemRuntime['topology'] = (model, grade) => {
        const labels =
          grade === 'Junior'
            ? [model.topology[0]!, 'Профессиональное преобразование', model.topology.at(-1)!]
            : model.topology;
        const nodes = labels.map((label, index) => ({
          id: `node-${index}`,
          label,
          state: 'воспроизводимая симуляция',
          highlightable: true,
        }));
        return {
          nodes,
          edges: nodes.slice(1).map((node, index) => ({
            from: nodes[index]!.id,
            to: node.id,
            label: 'обработка наблюдений',
          })),
        };
      };
      const runtime: ItemRuntime = {
        topology,
        responseTask(_model, world) {
          const current = state(world);
          const patches = repairPlans(family, current);
          return {
            task: {
              title: 'Изменение предложенной конфигурации',
              instructions:
                'Определите минимально достаточные изменения по текущим данным. Сохраните работающие настройки: повторная запись прежнего значения не устраняет нарушение. Принимаются все минимальные планы, выполняющие контракт.',
              controls: [
                ...(world.grade === 'Junior'
                  ? []
                  : [
                      select('context', 'Контекст изменения', [
                        ['0', 'Контекст A'],
                        ['1', 'Контекст B'],
                        ['2', 'Контекст C'],
                      ]),
                    ]),
                ...current.controls.map((control) => {
                  const values =
                    control.type === 'number'
                      ? control.values
                      : control.type === 'select'
                        ? control.options.map((option) => option.value)
                        : Array.from({ length: 2 ** control.options.length }, (_, mask) =>
                            control.options
                              .filter((_option, index) => mask & (1 << index))
                              .map((option) => option.value),
                          );
                  const display = (value: Plan[string]) =>
                    Array.isArray(value)
                      ? value
                          .map(
                            (entry) =>
                              control.options.find((option) => option.value === entry)?.label ||
                              entry,
                          )
                          .join(', ') || 'пустой набор'
                      : control.options.find((option) => option.value === value)?.label ||
                        String(value);
                  return select(control.id, control.label, [
                    ['keep', `Сохранить: ${display(current.proposed[control.id]!)}`],
                    ...values.map((value): [string, string] => [
                      `set:${canonical(value)}`,
                      `Установить: ${display(value)}`,
                    ]),
                  ]);
                }),
              ],
            },
            accepted: patches.accepted.map((plan) => ({
              ...plan,
              ...(world.grade === 'Junior' ? {} : { context: String(current.affectedContext) }),
            })),
          };
        },
        semanticState(world) {
          const current = state(world);
          const changed = { ...current, data: current.changedData };
          const behavior = (input: SimulationState) =>
            comparisonPlans(family, input).map((plan) => ({
              plan,
              outcome: family.run(input.data, plan),
            }));
          return {
            parameters: current.data.parameters,
            affectedContext: current.affectedContext,
            proposed: current.proposed,
            current: behavior(current),
            changed: behavior(changed),
          };
        },
        prompt: (kind) =>
          kind === 'falsification'
            ? 'Какая конфигурация служит проверяемым контрпримером гипотезе о невыполнимости контракта на этих данных?'
            : kind === 'adaptation'
              ? 'Какая конфигурация выполняет контракт после изменения данных?'
              : kind === 'diagnosis'
                ? 'Какой разбор предложенной конфигурации объясняет нарушение контракта?'
                : kind === 'interpretation'
                  ? 'Какой результат относится к прогону именно предложенного плана?'
                  : 'Какая конфигурация подтверждается данными и выполняет все указанные ограничения?',
        createWorld(currentPack, model, grade, seed) {
          const fixture = family.build(grade, seed);
          const fault = Math.floor(random(seed ^ 71)() * 4);
          const graph = topology(model, grade, {});
          const simulation: SimulationState = {
            ...fixture,
            affectedContext: grade === 'Junior' ? 0 : Math.floor(random(seed ^ 0x718e)() * 3),
            proposed: proposedScenario(family, fixture, fixture.data, grade, seed),
          };
          return {
            modelId: model.id,
            specialization: currentPack.id,
            grade,
            radicals: {
              workers: 1,
              components: graph.nodes.length,
              observability:
                grade === 'Junior' ? 'clear' : grade === 'Middle' ? 'correlated' : 'cohort',
              interactingFailures: Object.values(
                family.run(fixture.data, simulation.proposed).checks,
              ).filter((passed) => !passed).length,
              legacyClients: false,
              rollbackRequired: false,
              failure: { fault, simulation: JSON.stringify(simulation) },
            },
            incidentals: {
              domain: family.title,
              service: currentPack.name,
              entity: 'выборка',
              table: 'observations',
              endpoint: 'simulation',
              operationId: `sample-${seed}`,
              timestamp: new Date(
                Date.parse('2026-10-07T08:00:00Z') + (seed % 86400000),
              ).toISOString(),
              rps: 0,
              timeoutSeconds: 0,
              wording: 0,
            },
            assumptions: [
              'Данные и параметры принадлежат одному зафиксированному сценарию.',
              'Показатели вычислены детерминированным симулятором над приведённой выборкой.',
              'Неизменённые условия сохраняются при выборе плана.',
            ],
            constraints: [fixture.contract],
            topology: graph,
          };
        },
        mutateWorld(_model, world, seed) {
          const next = structuredClone(world);
          const current = state(world);
          const changed: SimulationState = { ...current, data: current.changedData };
          changed.affectedContext =
            world.grade === 'Junior' ? 0 : Math.floor(random(seed ^ 0x718e)() * 3);
          changed.proposed = proposedScenario(family, changed, changed.data, world.grade, seed);
          next.radicals.interactingFailures = Object.values(
            family.run(changed.data, changed.proposed).checks,
          ).filter((passed) => !passed).length;
          next.radicals.failure = {
            fault: (Number(world.radicals.failure.fault) + 1) % 4,
            simulation: JSON.stringify(changed),
          };
          next.mutation = current.change;
          return next;
        },
        deriveTruth(_model, world) {
          const current = state(world);
          const result = family.run(current.data, current.proposed);
          if (Object.values(result.checks).every(Boolean))
            throw new Error('Предложенный ошибочный план неожиданно выполнил контракт');
          return {
            hazard: hazard(world),
            violatedInvariant: current.contract,
            causalChain: [family.title, JSON.stringify(result.metrics), result.explanation],
            requirements: [`${id}:all-contract-checks`],
            bestDiagnosticArtifact: 'comparisons',
            falsifyingObservation:
              'На тех же данных контрпримером будет конфигурация, которая выполняет все проверки контракта.',
          };
        },
        createIntents(_model, world, kind) {
          const current = state(world);
          const describesProposed = kind === 'diagnosis' || kind === 'interpretation';
          const candidates = describesProposed
            ? [
                current.proposed,
                ...enumerate(family, current, current.data)
                  .rejected.filter(
                    (plan) => JSON.stringify(plan) !== JSON.stringify(current.proposed),
                  )
                  .slice(0, 3),
              ]
            : comparisonPlans(family, current);
          return candidates.map((plan, index) => {
            const outcome = family.run(current.data, plan);
            const valid = describesProposed
              ? index === 0
              : Object.values(outcome.checks).every(Boolean);
            const measurements = Object.entries(outcome.metrics)
              .map(([key, value]) => `${key}=${value}`)
              .join('; ');
            const violated = Object.entries(outcome.checks)
              .filter(([, passed]) => !passed)
              .map(([key]) => key)
              .join(', ');
            const text =
              kind === 'diagnosis'
                ? `${description(current, plan)}. Нарушены проверки: ${violated || 'нет'}. Измерения: ${measurements}.`
                : kind === 'interpretation'
                  ? `${description(current, plan)}. Результат прогона: ${measurements}.`
                  : kind === 'falsification'
                    ? `${description(current, plan)}. Проверяемый результат: ${measurements}.`
                    : description(current, plan);
            return {
              id: `${kind}:plan-${index}`,
              kind,
              text,
              predictsHazard: valid ? hazard(world) : `${id}:invalid-plan-${index}`,
              guarantees: valid ? [`${id}:all-contract-checks`] : [],
              availableUnder: [hazard(world)],
              applicability: { ...world.radicals.failure },
              misconception: valid ? null : `${pack.id}:simulated-contract-violation`,
            };
          });
        },
        createArtifacts(_model, world) {
          const current = state(world);
          const result = family.run(current.data, current.proposed);
          return [
            {
              id: 'comparisons',
              type: 'experiment_table' as const,
              label: 'Контролируемые прогоны конфигураций',
              content: JSON.stringify({
                scope: 'одни и те же входные данные; вычисленные результаты, без оценочных ключей',
                records: [...comparisonPlans(family, current)]
                  .sort((left, right) =>
                    description(current, left).localeCompare(description(current, right)),
                  )
                  .map((plan) => ({
                    configuration: description(current, plan),
                    ...family.run(current.data, plan).metrics,
                  })),
              }),
              usefulness: 1,
            },
            {
              id: binding.source,
              type: binding.source,
              label: `Исходные данные · ${family.title}`,
              content: JSON.stringify({
                records: current.data.rows,
                parameters: current.data.parameters,
              }),
              usefulness: 1,
            },
            {
              id: 'schema',
              type: 'schema',
              label: 'Контракт и предложенный план',
              content: JSON.stringify({
                contract: current.contract,
                proposed: description(current, current.proposed),
                records: (world.grade === 'Junior' ? [0] : [0, 1, 2]).map((index) => ({
                  context: ['A', 'B', 'C'][index],
                  configuration: description(
                    current,
                    index === current.affectedContext
                      ? current.proposed
                      : enumerate(family, current, current.data).reference,
                  ),
                  ...family.run(
                    current.data,
                    index === current.affectedContext
                      ? current.proposed
                      : enumerate(family, current, current.data).reference,
                  ).metrics,
                })),
                contextContract:
                  'Три независимых контекста используют приведённую выборку отдельно. Исправьте только нарушенный контекст. Изменение другого контекста оставит доказанную неисправность; работающие конфигурации должны сохраняться.',
                parameters: current.data.parameters,
              }),
              usefulness: 0.85,
            },
            {
              id: 'computed',
              type: 'metrics' as const,
              label: 'Результат предложенного плана',
              content: JSON.stringify({ ...result.metrics, observation: result.explanation }),
              usefulness: 0.85,
            },
          ];
        },
        renderScenario(_model, world) {
          const current = state(world);
          const scenario = {
            context: family.title,
            observations: [
              'Команда предложила план, который нарушает контракт на приведённых данных.',
              `Предложенный план: ${description(current, current.proposed)}.`,
              world.grade === 'Junior'
                ? 'План относится к приведённому локальному контексту.'
                : 'Определите область исправления по конфигурациям и измерениям. Подтверждённая версия состояния устанавливается через workflow; работающие контексты сохраняются.',
              ...(world.mutation ? [world.mutation] : []),
            ],
            constraints: [current.contract],
            assumptions: world.assumptions,
          };
          return {
            scenario,
            text: [
              scenario.context,
              ...scenario.observations,
              ...scenario.constraints,
              ...scenario.assumptions,
            ].join('\n\n'),
            templateIds: [],
          };
        },
      };
      const cases = Array.from({ length: 4 }, (_, fault) => ({
        id: `${id}:${fault}`,
        facts: { fault },
        predicate: (facts: Record<string, Fact>) => facts.fault === fault,
        hazard: `${id}:fault-${fault}`,
        invariant: 'План выполняет все профессиональные проверки контракта.',
        cause: 'Вычислительный результат предложенного плана расходится с контрактом.',
        evidence: 'Данные и результат вычисления представлены отдельно.',
        requirements: [`${id}:all-contract-checks`],
        repair: 'Пересчитать конфигурацию по данным и выполнить все проверки контракта.',
        diagnostic: binding.source,
        falsifier: 'При тех же данных план выполняет все проверки контракта.',
        narrative: family.title,
      }));
      return {
        id,
        capabilities: [
          'executable-work-sample',
          ...(fixedReview[pack.id]
            ? [fixedReview[pack.id] === family.id ? 'equivalent-review' : 'equivalent-incident']
            : ['equivalent-incident', 'equivalent-review']),
        ],
        version: '5.0.0',
        siblingGroup: id,
        title: family.title,
        specialization: pack.id,
        runtime,
        gradeRange: ['Junior', 'Middle', 'Senior'],
        worldBounds: Object.fromEntries(
          ['Junior', 'Middle', 'Senior'].map((grade) => [
            grade,
            {
              ...pack.worldBounds[grade as Grade],
            },
          ]),
        ),
        competencyDomain: binding.domain,
        competencyDomains: [binding.domain],
        availableArtifacts: [
          ...new Set<ArtifactType>([binding.source, 'schema', 'metrics', 'experiment_table']),
        ],
        worldStateSchema: `${id}-executable-world-1`,
        boundarySuitability: true,
        informationWeight: 2.5,
        measuredDimensions: [...dimensions],
        stages: ['anchors', 'incident', 'review', 'boundary'],
        contentTags: [binding.domain],
        radicalDefinitions: [
          {
            name: 'simulation',
            affects:
              'Данные, параметры и ошибочная конфигурация меняют проверяемый результат вычисления',
          },
          { name: 'fault', affects: 'Выбирает ошибочный план; oracle вычисляется заново' },
        ],
        incidentalDefinitions: ['идентификатор выборки', 'время фиксации'],
        misconceptionClasses: [`${pack.id}:simulated-contract-violation`],
        cases,
        topology: [
          family.title,
          'Данные',
          'Предложенный план',
          'Вычисление',
          'Проверяемый контракт',
        ],
        introduction: family.title,
        code: (world) => description(state(world), state(world).proposed),
      };
    },
  );
  return {
    ...pack,
    stageRequirements: {
      anchors: ['focused-contract'],
      incident: ['executable-work-sample', 'equivalent-incident'],
      review: ['executable-work-sample', 'equivalent-review'],
    },
    itemModels: [...pack.itemModels, ...models],
    artifactGenerators: [
      ...new Set([
        ...pack.artifactGenerators,
        ...models.flatMap((model) => model.availableArtifacts!),
      ]),
    ],
    misconceptionCatalog: [
      ...new Set([
        ...pack.misconceptionCatalog,
        ...models.flatMap((model) => model.misconceptionClasses),
      ]),
    ],
  };
}
