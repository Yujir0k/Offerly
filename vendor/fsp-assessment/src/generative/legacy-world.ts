import { random } from '../random.js';
import { humanReasoning, humanRequirement } from './narrative.js';
import { seniorRollout } from './senior-rollout.js';
import type {
  AnswerIntent,
  GroundTruth,
  ItemModel,
  SpecializationPack,
  WorldState,
  Fact,
  Topology,
} from './model.js';
import type { TargetGrade } from '../adaptive/model.js';

/** Logical topology changes when an effect moves across the database boundary. */
export function worldTopology(
  model: ItemModel,
  grade: TargetGrade,
  facts: Record<string, Fact>,
): Topology {
  const labels = [...model.topology];
  if (
    (facts.effectInDatabase === false || facts.effectOutsideFence === true) &&
    !labels.includes('Provider')
  )
    labels.push('Provider');
  const diagnostic = model.cases.find((c) => c.predicate(facts))?.diagnostic;
  if (
    (diagnostic === 'queue' || facts.admissionBounded === false) &&
    !labels.some((label) => /Queue|Consumer|Producer/.test(label))
  )
    labels.splice(Math.max(1, labels.length - 1), 0, 'Queue');
  const actual =
    grade === 'Junior' && labels.length > 3
      ? [labels[0]!, labels.slice(1, -1).join(' / '), labels.at(-1)!]
      : labels;
  const nodes = actual.map((label, i) => ({
    id: `node-${i}`,
    label,
    state: i === actual.length - 1 ? 'наблюдаемый результат' : 'в работе',
    highlightable: true,
  }));
  return {
    nodes,
    edges: nodes
      .slice(0, -1)
      .map((n, i) => ({ from: n.id, to: nodes[i + 1]!.id, label: `шаг ${i + 1}` })),
  };
}
function contractConstraints(facts: Record<string, Fact>): string[] {
  return [
    ...(typeof facts.providerSupportsIdempotency === 'boolean'
      ? [
          facts.providerSupportsIdempotency
            ? `Провайдер гарантирует дедупликацию по исходному operation_id; окно ключа ${facts.keyExpired ? 'уже истекло' : 'ещё действует'}.`
            : 'Провайдер не гарантирует дедупликацию эффекта по operation_id.',
        ]
      : []),
    ...(typeof facts.statusLookup === 'boolean'
      ? [
          facts.statusLookup
            ? 'Доступен авторитетный статус исходной операции по business identity.'
            : 'Авторитетный endpoint статуса отсутствует.',
        ]
      : []),
    ...(typeof facts.effectInDatabase === 'boolean'
      ? [
          facts.effectInDatabase
            ? 'Эффект изменяет ту же БД, что отметка обработки; их можно фиксировать одной транзакцией. Выбранный обработчиком ключ отметки уникален в таблице; конфликт вставки откатывает весь эффект транзакции.'
            : 'Эффект выполняет внешний провайдер; его нельзя включить в локальную DB transaction.',
        ]
      : []),
    ...(facts.conflictResponseAllowed === false
      ? [
          'Клиент не умеет повторять конфликт: сервер обязан ограниченно перечитать данные и пересчитать решение без смены HTTP-контракта.',
        ]
      : []),
  ];
}

/** Derive the unique cause from predicates over formal facts, never from option position. */
export function deriveGroundTruth(model: ItemModel, world: WorldState): GroundTruth {
  const matches = model.cases.filter((c) => c.predicate(world.radicals.failure));
  if (matches.length !== 1)
    throw new Error(`Модель ${model.id}: причинная модель должна иметь ровно один исход`);
  const found = matches[0]!;
  return {
    hazard: found.hazard,
    violatedInvariant: found.invariant,
    causalChain: [model.introduction, found.evidence, found.cause],
    requirements: [
      ...found.requirements,
      ...(world.radicals.legacyClients
        ? [`безопасная coexistence: ${String(world.radicals.failure.legacyMode)}`]
        : []),
      ...(world.radicals.rollbackRequired ? ['сохранность результата при откате'] : []),
    ],
    bestDiagnosticArtifact: found.diagnostic,
    falsifyingObservation: found.falsifier,
  };
}
/** Sample complexity radicals separately from surface wording and names. */
export function buildWorld(
  pack: SpecializationPack,
  model: ItemModel,
  grade: TargetGrade,
  seed: number,
): WorldState {
  const rng = random(seed);
  const pick = <T>(values: T[]) => values[Math.floor(rng() * values.length)]!;
  const profile = pack.worldBounds[grade];
  const grades: TargetGrade[] = ['Junior', 'Middle', 'Senior'];
  const chosen = pick(
    model.cases.filter((c) => grades.indexOf(c.minimumGrade || 'Junior') <= grades.indexOf(grade)),
  );
  const topology = worldTopology(model, grade, chosen.facts);
  const domain = pick(
    pack.id === 'frontend'
      ? ['Поиск документов', 'Редактор заказов', 'Лента уведомлений', 'Кабинет клиента']
      : pack.id === 'devops-sre'
        ? ['Обработка доставок', 'Сбор телеметрии', 'Сервис каталога', 'Обработка отчётов']
        : ['Бронирование мест', 'Оплата заказа', 'Доставка уведомлений', 'Обработка возвратов'],
  );
  return {
    modelId: model.id,
    specialization: pack.id,
    grade,
    radicals: {
      workers: pick(profile.workers),
      components: topology.nodes.length,
      observability: grade === 'Junior' ? 'clear' : grade === 'Middle' ? 'correlated' : 'cohort',
      interactingFailures: 1,
      legacyClients: profile.legacyClients,
      rollbackRequired: profile.rollbackRequired,
      failure: {
        ...structuredClone(chosen.facts),
        ...(profile.legacyClients
          ? { legacyMode: pick(['old_writer', 'old_reader', 'rollback', 'replay']) }
          : {}),
      },
    },
    incidentals: {
      domain,
      service: pick([
        'сервис заказов',
        'сервис возвратов',
        'сервис уведомлений',
        'сервис бронирования',
        'сервис документов',
        'сервис отчётов',
      ]),
      entity: pick(['операция', 'запись', 'заказ', 'задание']),
      table: pick(['operations', 'requests', 'orders', 'tasks']),
      endpoint: pick(['/api/orders', '/api/operations', '/api/tasks', '/api/requests']),
      operationId: `op-${Math.floor(rng() * 0xfffffff).toString(36)}`,
      timestamp: new Date(
        Date.parse('2026-10-06T08:00:00Z') + Math.floor(rng() * 86400000),
      ).toISOString(),
      rps: pick([40, 120, 240, 480]),
      timeoutSeconds: pick([5, 10, 15, 20]),
      wording: Math.floor(rng() * 3),
    },
    assumptions: [
      'Все указанные наблюдения относятся к одной бизнес-операции.',
      'Источник, помеченный авторитетным, содержит подтверждённый результат.',
      'Неупомянутые свойства инфраструктуры не меняются в рамках этого задания.',
    ],
    constraints: [
      ...(['db_lost_update', 'transaction_constraints'].includes(model.id)
        ? [
            'БД использует READ COMMITTED; чтение само по себе не резервирует право на последующую запись.',
          ]
        : []),
      ...(/concurrency|data|delivery/.test(model.contentTags.join(' ')) ||
      model.id === 'transaction_constraints'
        ? [
            'Запросы могут перекрываться во времени; проверку и изменение состояния нужно рассматривать вместе.',
          ]
        : []),
      ...(profile.rollbackRequired
        ? ['Переключение и откат должны сохранять уже подтверждённые операции.']
        : []),
      ...contractConstraints(chosen.facts),
    ],
    topology,
  };
}
/** Mutate a causal assumption; the new ground truth is recomputed from the changed state. */
export function mutateWorld(model: ItemModel, world: WorldState, seed: number): WorldState {
  const current = deriveGroundTruth(model, world);
  const grades: TargetGrade[] = ['Junior', 'Middle', 'Senior'];
  const candidates = model.cases.filter(
    (c) =>
      c.hazard !== current.hazard &&
      grades.indexOf(c.minimumGrade || 'Junior') <= grades.indexOf(world.grade),
  );
  const selected = candidates[Math.floor(random(seed)() * candidates.length)]!;
  const next = structuredClone(world);
  next.radicals.failure = {
    ...structuredClone(selected.facts),
    ...(world.radicals.legacyClients ? { legacyMode: world.radicals.failure.legacyMode! } : {}),
  };
  next.topology = worldTopology(model, next.grade, next.radicals.failure);
  next.radicals.components = next.topology.nodes.length;
  next.constraints = world.constraints
    .filter((text) => !contractConstraints(world.radicals.failure).includes(text))
    .concat(contractConstraints(next.radicals.failure));
  next.mutation =
    'Первоначальная проблема исправлена. Ниже приведены новые наблюдения; оцените решение с учётом изменившихся условий.';
  return next;
}

/** Simulate which semantic intent satisfies the formal goal and current constraints. */
export function evaluateIntent(
  intent: AnswerIntent,
  world: WorldState,
  truth: GroundTruth,
): number {
  const predicts = intent.predictsHazard === truth.hazard;
  const fulfils = truth.requirements.every((r) => intent.guarantees.includes(r));
  const assumptionsHold = intent.availableUnder.includes(truth.hazard);
  const applicable =
    !intent.applicability ||
    Object.entries(intent.applicability).every(
      ([name, value]) => world.radicals.failure[name] === value,
    );
  if (
    predicts &&
    assumptionsHold &&
    applicable &&
    (['remediation', 'adaptation'].includes(intent.kind) ? fulfils : true)
  )
    return 1;
  // Partial evidence must be explicitly authored for this intent, never inferred
  // from a generic error label that may describe a different causal world.
  return intent.partialCredit || 0;
}
/** Competing intents are valid under other formal assumptions, never equivalent here. */
export function buildIntents(
  model: ItemModel,
  world: WorldState,
  kind: AnswerIntent['kind'],
  seed: number,
): AnswerIntent[] {
  const truth = deriveGroundTruth(model, world);
  if (world.grade === 'Senior' && ['remediation', 'adaptation'].includes(kind)) {
    const repair = model.cases.find((c) => c.hazard === truth.hazard)!.repair;
    const plans = Object.entries(seniorRollout(model)).map(([mode, value]) => ({
      mode,
      text: value.plan,
    }));
    const wrong = plans.filter((p) => p.mode !== world.radicals.failure.legacyMode);
    const misconceptions = [
      'unsafe_migration_order',
      'wrong_causal_layer',
      'incorrect_consistency_assumption',
    ];
    return plans.map((p) => ({
      id: `${kind}:${truth.hazard}:${p.mode}`,
      kind,
      text: humanReasoning(`${repair} ${p.text}`),
      predictsHazard: truth.hazard,
      guarantees: [
        truth.requirements[0]!,
        `безопасная coexistence: ${p.mode}`,
        'сохранность результата при откате',
      ],
      availableUnder: [truth.hazard],
      applicability: { ...world.radicals.failure, legacyMode: p.mode },
      misconception:
        p.mode === world.radicals.failure.legacyMode ? null : misconceptions[wrong.indexOf(p)]!,
      partialCredit:
        p.mode === world.radicals.failure.legacyMode
          ? 0
          : legacyPartialCredit(misconceptions[wrong.indexOf(p)]!),
    }));
  }
  const other = model.cases.filter((c) => c.hazard !== truth.hazard);
  const rng = random(seed);
  for (let i = other.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [other[i], other[j]] = [other[j]!, other[i]!];
  }
  const ordered = [...model.cases.filter((c) => c.hazard === truth.hazard), ...other];
  return ordered.map((c) => {
    const matchesObservedCase = c.hazard === truth.hazard;
    const suffix =
      world.grade === 'Senior' && ['remediation', 'adaptation'].includes(kind)
        ? ' Проверить старых клиентов, выполнить поэтапный rollout и сохранить путь отката.'
        : '';
    const text =
      kind === 'diagnosis'
        ? c.cause
        : kind === 'interpretation'
          ? c.cause
          : kind === 'falsification'
            ? c.falsifier
            : ['negative_guarantee', 'critical_assumption'].includes(kind)
              ? humanRequirement(c.requirements[0]!)
              : `${c.repair}${suffix}`;
    return {
      id: `${kind}:${c.id}`,
      kind,
      text: humanReasoning(text),
      predictsHazard: c.hazard,
      guarantees: [
        ...c.requirements,
        ...(world.radicals.legacyClients ? ['совместимость прежнего контракта'] : []),
        ...(world.radicals.rollbackRequired ? ['сохранность результата при откате'] : []),
      ],
      availableUnder: [c.hazard],
      applicability: { ...c.facts },
      // These cases describe mutually exclusive worlds, not incomplete solutions
      // to the observed case. Presentation order cannot create partial evidence.
      misconception: matchesObservedCase ? null : 'wrong_causal_layer',
      partialCredit: 0,
    };
  });
}
function legacyPartialCredit(misconception: string): number {
  return ['insufficient_observability', 'unsafe_migration_order'].includes(misconception)
    ? 0.65
    : misconception === 'wrong_causal_layer'
      ? 0.3
      : 0;
}
