import { dimensions, type TargetGrade } from '../../adaptive/model.js';
import { random } from '../../random.js';
import { select } from '../../families/core.js';
import type {
  ArtifactType,
  Fact,
  FormalCase,
  ItemModel,
  ItemRuntime,
  PackPresentation,
  SpecializationPack,
  WorldState,
} from '../model.js';

export interface Probe {
  name: string;
  expected: string;
  observed: string;
  cause: string;
  repair: string;
  source: ArtifactType;
}
export interface ProfessionalModel {
  id: string;
  title: string;
  domain: string;
  context: string;
  topology: string[];
  code: string;
  probes: [Probe, Probe, Probe, Probe];
}
export interface ProfessionalDefinition {
  contexts: [string, string, string];
  id: string;
  name: string;
  presentation: PackPresentation;
  models: ProfessionalModel[];
  misconceptions: [string, string, string];
}
const gradeOrder: TargetGrade[] = ['Junior', 'Middle', 'Senior'];

/** Build independent causal configurations from authored professional measurements. */
export function buildProfessionalPack(definition: ProfessionalDefinition): SpecializationPack {
  const authored = new Map(definition.models.map((model) => [model.id, model]));
  const spec = (model: ItemModel) => authored.get(model.id)!;
  const scopeFacts = (
    model: ItemModel,
    facts: Record<string, Fact>,
    seed: number,
    grade: TargetGrade,
  ) => {
    const rng = random(seed ^ 0x7acd);
    return Object.fromEntries(
      spec(model).probes.flatMap((probe, index) =>
        facts[`measurement${index}`] === probe.expected
          ? []
          : [
              [
                `scope${index}`,
                grade === 'Junior' ? 0 : Math.floor(rng() * definition.contexts.length),
              ],
            ],
      ),
    );
  };
  const selected = (model: ItemModel, world: WorldState) => {
    const matches = model.cases.filter((candidate) => candidate.predicate(world.radicals.failure));
    if (matches.length !== 1) throw new Error(`Неоднозначное состояние ${model.id}`);
    return matches[0]!;
  };
  const topology: ItemRuntime['topology'] = (model, grade) => {
    const labels =
      grade === 'Junior' && model.topology.length > 3
        ? [model.topology[0]!, model.topology.slice(1, -1).join(' / '), model.topology.at(-1)!]
        : model.topology;
    const nodes = labels.map((label, index) => ({
      id: `node-${index}`,
      label,
      state: 'наблюдаемый контур',
      highlightable: true,
    }));
    return {
      nodes,
      edges: nodes.slice(1).map((node, index) => ({
        from: nodes[index]!.id,
        to: node.id,
        label: 'поток данных / управления',
      })),
    };
  };
  const runtime: ItemRuntime = {
    topology,
    responseTask(model, world) {
      const professional = spec(model);
      const expected = Object.fromEntries(
        professional.probes.map((probe, index) => [
          `repair${index}`,
          world.radicals.failure[`measurement${index}`] === probe.expected
            ? 'keep'
            : `repair:${world.radicals.failure[`scope${index}`]}`,
        ]),
      );
      const controls = professional.probes.map((probe, index) =>
        select(`repair${index}`, probe.name, [
          ['keep', 'Сохранить работающий контракт'],
          ...(world.grade === 'Junior' ? definition.contexts.slice(0, 1) : definition.contexts).map(
            (scope, scopeIndex): [string, string] => [
              `repair:${scopeIndex}`,
              `${probe.repair} Область изменения: ${scope}.`,
            ],
          ),
        ]),
      );
      return {
        task: {
          title: 'План исправления текущего сценария',
          instructions:
            'Для каждого измерения выберите исправление и область воздействия по данным источника. Каждый контекст независим; исправление другого контекста оставляет исходное нарушение и затрагивает работающий контракт. Бюджет допускает только исправление установленных нарушений.',
          controls,
        },
        accepted: [expected],
      };
    },
    createWorld(pack, model, grade, seed) {
      const rng = random(seed);
      const eligible = model.cases;
      const causal = eligible[Math.floor(rng() * eligible.length)]!;
      const scope = Math.floor(rng() * 3);
      const professional = spec(model);
      const graph = topology(model, grade, causal.facts);
      return {
        modelId: model.id,
        specialization: pack.id,
        grade,
        radicals: {
          workers: 1,
          components: graph.nodes.length,
          observability:
            grade === 'Junior' ? 'clear' : grade === 'Middle' ? 'correlated' : 'cohort',
          interactingFailures: causal.requirements.length,
          legacyClients: false,
          rollbackRequired: false,
          failure: {
            ...causal.facts,
            ...scopeFacts(model, causal.facts, seed, grade),
          },
        },
        incidentals: {
          domain: professional.title,
          service: definition.name,
          entity: professional.topology[0]!,
          table: 'observations',
          endpoint: 'professional-work-sample',
          operationId: `sample-${seed.toString(36)}`,
          timestamp: new Date(Date.parse('2026-10-07T08:00:00Z') + (seed % 86400000)).toISOString(),
          rps: 0,
          timeoutSeconds: 0,
          wording: scope,
        },
        assumptions: [
          'Измерения относятся к одному воспроизводимому сценарию и одной версии.',
          'Наблюдаемые значения проверены инструментом, указанным в источнике.',
          'Свойства, не изменённые в условии, сохраняются.',
        ],
        constraints: [
          grade === 'Junior'
            ? 'Проверяется локальный сценарий с известными входными данными.'
            : 'Общий успешный показатель не исключает нарушение в отдельном сегменте; сопоставьте источники по версии и времени.',
          'Изменять следует только условия, нарушение которых подтверждено наблюдениями; работающие контракты сохраняются.',
          grade === 'Junior'
            ? `Проверяется локальный контекст: ${definition.contexts[0]}.`
            : `Проверяются взаимодействия независимых контекстов: ${definition.contexts.join('; ')}. Исправление действует только в выбранном контексте; измерения из разных контекстов нельзя смешивать.`,
        ],
        topology: graph,
      };
    },
    mutateWorld(model, world, seed) {
      const next = structuredClone(world);
      const previous = selected(model, world);
      const eligible = model.cases.filter((candidate) => candidate.id !== previous.id);
      const causal = eligible[Math.floor(random(seed)() * eligible.length)]!;
      next.radicals.failure = {
        ...causal.facts,
        ...scopeFacts(model, causal.facts, seed, world.grade),
      };
      next.radicals.interactingFailures = causal.requirements.length;
      next.mutation =
        'Первоначальная причина устранена. Новые измерения относятся к следующему изменению условий; предыдущее решение не переносится автоматически.';
      return next;
    },
    deriveTruth(model, world) {
      const causal = selected(model, world);
      return {
        hazard: causal.hazard,
        violatedInvariant: causal.invariant,
        causalChain: [model.introduction, causal.evidence, causal.cause],
        requirements: [...causal.requirements],
        bestDiagnosticArtifact: causal.diagnostic,
        falsifyingObservation: causal.falsifier,
      };
    },
    createIntents(model, world, kind) {
      const truth = runtime.deriveTruth(model, world);
      const causal = selected(model, world);
      const alternatives = model.cases
        .filter((candidate) => candidate.id !== causal.id)
        .sort(
          (left, right) =>
            Math.abs(left.requirements.length - causal.requirements.length) -
            Math.abs(right.requirements.length - causal.requirements.length),
        );
      return [causal, ...alternatives.slice(0, 3)].map((candidate, index) => ({
        id: `${kind}:${candidate.id}`,
        kind,
        text:
          kind === 'falsification'
            ? candidate.falsifier
            : ['remediation', 'adaptation'].includes(kind)
              ? candidate.repair
              : ['negative_guarantee', 'critical_assumption'].includes(kind)
                ? candidate.invariant
                : candidate.cause,
        predictsHazard: candidate.hazard,
        guarantees: [...candidate.requirements],
        availableUnder: [candidate.hazard],
        applicability: { ...candidate.facts },
        misconception:
          candidate.hazard === truth.hazard ? null : definition.misconceptions[index % 3]!,
      }));
    },
    createArtifacts(model, world, truth) {
      const professional = spec(model);
      const scope = 'независимые профессиональные контексты';
      const types = model.availableArtifacts!;
      return types.map((type) => {
        let content: string;
        if (type === 'code') {
          content = professional.code.replace(/\{\{([0-3])\}\}/g, (_, index: string) =>
            String(world.radicals.failure[`measurement${index}`]),
          );
        } else if (type === 'topology') {
          content = JSON.stringify(world.topology);
        } else {
          const records = professional.probes.flatMap((probe, index) =>
            probe.source === type
              ? (world.grade === 'Junior'
                  ? definition.contexts.slice(0, 1)
                  : definition.contexts
                ).map((context, contextIndex) => ({
                  source: probe.name,
                  scope: context,
                  version: world.incidentals.operationId,
                  observed:
                    contextIndex === world.radicals.failure[`scope${index}`]
                      ? world.radicals.failure[`measurement${index}`]
                      : probe.expected,
                  reference: probe.expected,
                }))
              : [],
          );
          const controlRecords = professional.probes.flatMap((probe) =>
            probe.source === type
              ? [
                  {
                    source: probe.name,
                    scope: 'контрольный сегмент',
                    version: world.incidentals.operationId,
                    observed: probe.expected,
                    reference: probe.expected,
                  },
                ]
              : [],
          );
          content = JSON.stringify({
            format: 'professional-observations-v1',
            scope,
            timestamp: world.incidentals.timestamp,
            records,
            ...(world.grade !== 'Junior'
              ? {
                  controlRecords,
                  aggregate:
                    'Контрольная выборка проходит; независимые контексты сравниваются с контрактом отдельно.',
                }
              : {}),
          });
        }
        return {
          id: type,
          type,
          label:
            type === 'dom' && definition.id === 'android'
              ? 'Дерево компонентов Compose'
              : type === 'dom' && definition.id === 'ios'
                ? 'Дерево компонентов SwiftUI'
                : artifactLabels[type] || type,
          content,
          usefulness: type === truth.bestDiagnosticArtifact ? 1 : type === 'topology' ? 0.25 : 0.65,
        };
      });
    },
    renderScenario(model, world, truth) {
      const professional = spec(model);
      const source = selected(model, world);
      const scenario = {
        context: professional.context,
        observations: [
          'В профессиональных контекстах воспроизводится нарушение заявленного контракта. Рабочий фрагмент иллюстрирует отличающиеся условия; область каждого нарушения определите по измерениям источника.',
          ...(world.grade !== 'Junior'
            ? [
                'Контрольный сегмент проходит; независимые контексты отличаются. Сопоставьте измерения, конфигурацию и профессиональный контракт.',
              ]
            : []),
          ...(world.mutation ? [world.mutation] : []),
        ],
        constraints: world.constraints,
        assumptions: world.assumptions,
      };
      // Truth affects the selected observation, never candidate metadata or artifact labels.
      if (source.hazard !== truth.hazard) throw new Error('Неверная проекция сценария');
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
  const models: ItemModel[] = definition.models.map((professional) => {
    if (professional.probes.length !== 4) throw new Error('Нужны четыре причинные конфигурации');
    const cases: FormalCase[] = Array.from({ length: 14 }, (_, offset) => {
      const mask = offset + 1;
      const failures = professional.probes.filter((_probe, index) => mask & (1 << index));
      const probe = failures[0]!;
      const facts: Record<string, Fact> = Object.fromEntries(
        professional.probes.map((candidate, position) => [
          `measurement${position}`,
          mask & (1 << position) ? candidate.observed : candidate.expected,
        ]),
      );
      return {
        id: `${professional.id}:${mask}`,
        minimumGrade: 'Junior',
        facts,
        predicate: (actual) =>
          Object.entries(facts).every(([name, value]) => actual[name] === value),
        hazard: `${professional.id}:failure-set-${mask}`,
        invariant: failures
          .map(
            (failure) =>
              `Измерение «${failure.name}» соответствует значению «${failure.expected}».`,
          )
          .join(' '),
        cause: failures.map((failure) => failure.cause).join(' '),
        evidence: failures
          .map((failure) => `${failure.name}: ${failure.observed}; контракт: ${failure.expected}.`)
          .join(' '),
        requirements: professional.probes.flatMap((_failure, index) =>
          mask & (1 << index) ? [`${professional.id}:requirement-${index}`] : [],
        ),
        repair: failures.map((failure) => failure.repair).join(' '),
        diagnostic: probe.source,
        falsifier:
          'При повторной проверке исходное нарушение сохраняется, остальные условия не изменены. ' +
          failures
            .map((failure) => `Измерение «${failure.name}» при этом даёт «${failure.expected}».`)
            .join(' '),
        narrative: failures
          .map((failure) => `Проверка «${failure.name}» дала «${failure.observed}».`)
          .join(' '),
      };
    });
    return {
      id: professional.id,
      version: '5.0.0',
      siblingGroup: professional.id,
      title: professional.title,
      specialization: definition.id,
      runtime,
      capabilities: ['focused-contract'],
      gradeRange: [...gradeOrder],
      competencyDomain: professional.domain,
      competencyDomains: [professional.domain],
      availableArtifacts: [
        ...new Set<ArtifactType>([
          'topology',
          'code',
          ...professional.probes.map((probe) => probe.source),
        ]),
      ],
      worldStateSchema: `${definition.id}-professional-world-1`,
      boundarySuitability: true,
      informationWeight: 2.5,
      itemTypes: [
        'diagnosis',
        'interpretation',
        'remediation',
        'adaptation',
        'falsification',
        'negative_guarantee',
        'critical_assumption',
      ],
      measuredDimensions: [...dimensions],
      stages: ['anchors', 'incident', 'review', 'boundary'],
      contentTags: [professional.domain],
      radicalDefinitions: [
        {
          name: 'measurement0..3',
          affects: 'Выбирает нарушенный профессиональный контракт и доказуемое исправление',
        },
        {
          name: 'observability',
          affects:
            'Junior: локальные измерения; Middle: целевой и контрольный сегменты с различными результатами',
        },
        {
          name: 'decisionConstraint',
          affects: 'Senior: меняет допустимый профессиональный план при одном и том же исправлении',
        },
      ],
      incidentalDefinitions: ['идентификатор выборки', 'время измерения'],
      misconceptionClasses: [...definition.misconceptions],
      cases,
      topology: professional.topology,
      introduction: professional.context,
      code: (world) =>
        professional.code.replace(/\{\{([0-3])\}\}/g, (_, index: string) =>
          String(world.radicals.failure[`measurement${index}`]),
        ),
    };
  });
  return {
    id: definition.id,
    name: definition.name,
    enabled: true,
    version: '5.0.0',
    presentation: definition.presentation,
    contentBalance: { minDomains: 6, maxPerDomain: 1 },
    itemModels: models,
    competencyBlueprint: [...dimensions],
    artifactGenerators: [...new Set(models.flatMap((model) => model.availableArtifacts!))],
    renderers: ['professional-evidence-1'],
    misconceptionCatalog: [...definition.misconceptions],
    worldBounds: Object.fromEntries(
      gradeOrder.map((grade) => [
        grade,
        {
          workers: [1],
          maxComponents: grade === 'Junior' ? 3 : 6,
          legacyClients: false,
          rollbackRequired: false,
        },
      ]),
    ) as SpecializationPack['worldBounds'],
  };
}

export const artifactLabels: Partial<Record<ArtifactType, string>> = {
  topology: 'Контур задачи',
  code: 'Фрагмент обсуждаемого решения',
  dom: 'DOM',
  accessibility_tree: 'Дерево доступности',
  timeline: 'Хронология',
  network: 'Сеть',
  metrics: 'Измерения',
  logs: 'Журнал событий',
  deployment: 'Параметры внедрения',
  test_run: 'Прогон тестов',
  ci_log: 'Журнал CI',
  table: 'Выборка данных',
  schema: 'Контракт данных',
  dag: 'Граф обработки',
  lineage: 'Происхождение данных',
  model_metrics: 'Качество модели',
  feature_distribution: 'Распределение признаков',
  experiment_table: 'Результаты эксперимента',
  model_registry: 'Реестр моделей',
  retrieval_results: 'Результаты поиска',
  tool_trace: 'Вызовы инструментов',
  lifecycle: 'Жизненный цикл',
  crash_report: 'Отчёт о сбое',
  security_policy: 'Политика безопасности',
  http_exchange: 'HTTP-взаимодействие',
  code_diff: 'Изменение кода',
};
