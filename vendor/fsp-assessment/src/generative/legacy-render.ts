import type { Artifact } from '../adaptive/model.js';
import type { ArtifactType, GroundTruth, ItemModel, TemplateBlock, WorldState } from './model.js';
import { humanObservation } from './narrative.js';
import { seniorRollout } from './senior-rollout.js';

export const templateBlocks: TemplateBlock[] = [
  {
    id: 'intro-release',
    slot: 'intro',
    requires: [],
    render: (w) =>
      `После изменения обработчика команда проверяет сценарий «${w.incidentals.domain}».`,
  },
  {
    id: 'intro-support',
    slot: 'intro',
    requires: [],
    render: (w) => `Поддержка передала воспроизводимый сбой в сценарии «${w.incidentals.domain}».`,
  },
  {
    id: 'intro-review',
    slot: 'intro',
    requires: [],
    render: (w) => `Перед следующим релизом команда проверяет сценарий «${w.incidentals.domain}».`,
  },
  {
    id: 'legacy-constraint',
    slot: 'constraints',
    requires: [{ path: 'radicals.legacyClients', equals: true }],
    render: () => 'Во время исправления старые клиенты продолжают использовать прежний контракт.',
  },
  {
    id: 'browser-context',
    slot: 'symptom',
    requires: [{ path: 'specialization', equals: 'frontend' }],
    render: (w) =>
      `Наблюдения относятся к браузеру и запросу ${w.incidentals.endpoint}; состояние интерфейса изменяется независимо от завершения запросов.`,
  },
];
export function templateCompatible(block: TemplateBlock, world: WorldState): boolean {
  return block.requires.every((r) => {
    let value: unknown = world;
    for (const key of r.path.split('.'))
      value =
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
    return value === r.equals;
  });
}
/** Compose only compatible authored Russian fragments and facts from the formal world. */
export function renderContext(model: ItemModel, world: WorldState, truth: GroundTruth) {
  const intro = templateBlocks.filter((b) => b.slot === 'intro' && templateCompatible(b, world))[
    world.incidentals.wording
  ]!;
  const extras = templateBlocks.filter((b) => b.slot !== 'intro' && templateCompatible(b, world));
  const observation = humanObservation(model.cases.find((c) => c.hazard === truth.hazard)!);
  const topology = world.topology.edges
    .map(
      (e) =>
        `${world.topology.nodes.find((n) => n.id === e.from)!.label} → ${world.topology.nodes.find((n) => n.id === e.to)!.label}`,
    )
    .join('; ');
  const rollout = seniorRollout(model);
  const scenario = {
    context: `${intro.render(world, truth)} ${model.introduction}`,
    observations: [
      observation,
      ...(world.radicals.workers > 1
        ? [
            `Одновременно работают ${world.radicals.workers} исполнителей; нагрузка ${world.incidentals.rps} запросов/с.`,
          ]
        : []),
      `Контур: ${topology}.`,
    ],
    constraints: [
      ...world.constraints,
      ...(world.radicals.legacyClients
        ? [rollout[world.radicals.failure.legacyMode as keyof typeof rollout].constraint]
        : []),
    ],
    assumptions: world.assumptions.slice(3),
  };
  return {
    scenario,
    text: [
      scenario.context,
      ...scenario.observations,
      ...scenario.assumptions,
      ...scenario.constraints,
    ].join('\n\n'),
    templateIds: [intro.id, ...extras.map((b) => b.id)],
  };
}
const labels: Partial<Record<ArtifactType, string>> = {
  architecture: 'Архитектура',
  code: 'Код',
  diff: 'Изменение кода',
  logs: 'Logs',
  metrics: 'Metrics',
  trace: 'Trace',
  db: 'DB records',
  queue: 'Queue events',
  network: 'Network',
  deployment: 'Развёртывание',
  table: 'Таблица наблюдений',
  chart: 'График',
  console: 'Console',
  browser_state: 'Состояние браузера',
};
/** Every artifact is a projection of the same world; no independent fixture bank exists. */
export function generateArtifacts(
  model: ItemModel,
  world: WorldState,
  truth: GroundTruth,
): Artifact[] {
  const f = world.radicals.failure;
  const observation = model.cases.find((c) => c.hazard === truth.hazard)!.evidence;
  const facts = Object.entries(f).map(([name, value]) => ({ name, value }));
  const isBest = (type: ArtifactType) => type === truth.bestDiagnosticArtifact;
  const numericFacts = Object.fromEntries(
    Object.entries(f).filter(([, v]) => typeof v === 'number'),
  );
  let elapsedMs = 0;
  const trace = world.topology.nodes.map((n) => {
    const durationMs =
      /Worker|Consumer/.test(n.label) && typeof f.processingSeconds === 'number'
        ? f.processingSeconds * 1000
        : n.label.includes('Renderer') && typeof f.mainThreadMs === 'number'
          ? f.mainThreadMs
          : n.label.includes('DB')
            ? Number(f.queryMs || 12)
            : /Dependency/.test(n.label)
              ? Number(f.externalMs || 40)
              : 10;
    const span = {
      nodeId: n.id,
      node: n.label,
      startMs: elapsedMs,
      durationMs,
      operationId: world.incidentals.operationId,
    };
    elapsedMs += durationMs;
    return span;
  });
  const data: Partial<Record<ArtifactType, unknown>> = {
    architecture: world.topology,
    code: model.code(world),
    diff: `--- existing-handler\n+++ proposed-handler\n${model
      .code(world)
      .split('\n')
      .map((line) => `+ ${line}`)
      .join('\n')}`,
    logs: `${world.incidentals.timestamp} service=${world.incidentals.service} operation=${world.incidentals.operationId}\n${isBest('logs') ? observation : 'request_received; operation identity сохранена в журнале. Подробности исполнения находятся в других источниках.'}`,
    metrics: {
      rps: world.incidentals.rps,
      workers: world.radicals.workers,
      ...numericFacts,
      ...(isBest('metrics') ? { observation } : {}),
    },
    trace: {
      spans: trace,
      scope: isBest('trace')
        ? 'Наблюдаемое выполнение'
        : 'Схема пути; завершение шагов не подтверждено',
      ...(isBest('trace') ? { observation } : {}),
    },
    network: {
      endpoint: world.incidentals.endpoint,
      operation: world.incidentals.operationId,
      timeoutSeconds: world.incidentals.timeoutSeconds,
      timeline: trace.map((s) => ({ component: s.node, elapsedMs: s.startMs + s.durationMs })),
      ...(isBest('network') ? { observation } : {}),
    },
    deployment: {
      activeWorkers: world.radicals.workers,
      legacyActive: world.radicals.legacyClients,
      rollbackRequired: world.radicals.rollbackRequired,
      ...(isBest('deployment') ? { state: f, observation } : {}),
    },
    table: isBest('table') ? facts : facts.filter((v) => typeof v.value === 'number'),
    chart: {
      series: [
        {
          name: 'rps',
          points: [world.incidentals.rps, world.incidentals.rps, world.incidentals.rps],
        },
        ...facts
          .filter((v) => typeof v.value === 'number')
          .map((v) => ({ name: v.name, points: [v.value, v.value, v.value] })),
      ],
    },
  };
  if (world.specialization === 'frontend') {
    data.console = `${world.incidentals.timestamp} ${isBest('console') ? observation : 'Экран смонтирован; события связаны с текущим owner.'}`;
    data.browser_state = {
      route: world.incidentals.endpoint,
      operation: world.incidentals.operationId,
      ...(isBest('browser_state')
        ? { state: f, observation }
        : { state: 'Нужны дополнительные данные о порядке изменений.' }),
    };
  } else {
    data.db = {
      table: world.incidentals.table,
      operationId: world.incidentals.operationId,
      authoritative: isBest('db'),
      ...(isBest('db')
        ? { records: facts, observation }
        : { records: [], observation: 'Этот снимок не содержит результата бизнес-операции.' }),
    };
    if (world.topology.nodes.some((n) => /Queue|Consumer|Producer/.test(n.label)))
      data.queue = {
        operationId: world.incidentals.operationId,
        delivery: f.delivery || 'at_least_once',
        ...(isBest('queue')
          ? { records: facts, observation }
          : {
              records: [],
              observation: 'Этот снимок не подтверждает отправку или получение события.',
            }),
      };
  }
  const supporting: Record<string, string[]> = {
    logs: ['trace', 'db'],
    metrics: ['trace', 'table'],
    trace: ['metrics', 'logs'],
    db: ['trace', 'logs'],
    queue: ['trace', 'db'],
    network: ['code', 'browser_state'],
    browser_state: ['network', 'code'],
    console: ['browser_state', 'code'],
    code: ['browser_state', 'network'],
    deployment: ['db', 'table'],
    table: ['metrics', 'trace'],
  };
  return (Object.entries(data) as [ArtifactType, unknown][])
    .filter(([type]) => !model.availableArtifacts || model.availableArtifacts.includes(type))
    .map(([type, content]) => ({
      id: type,
      type,
      label: labels[type] || type,
      content: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
      data: content,
      usefulness: isBest(type)
        ? 1
        : supporting[truth.bestDiagnosticArtifact]?.includes(type)
          ? 0.85
          : type === 'architecture' || type === 'chart'
            ? 0.25
            : 0.35,
    }));
}
