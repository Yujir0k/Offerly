import { randomBytes } from 'node:crypto';
import type {
  Assessment,
  AssessmentResult,
  ExpressChoice,
  Grade,
  Plan,
  Variant,
} from './domain.js';
import { generateVariant, variantFingerprint } from './generator.js';
import { families } from './families/registry.js';
import { makeQuestions, type Theory } from './families/core.js';
import {
  engineeringVariant,
  engineeringProgress,
  engineeringExperiment,
  evaluateEngineering,
} from './engineering.js';
import { random } from './random.js';
import { runExperiment } from './simulator.js';

const question = (
  prompt: string,
  correct: string,
  wrong: string,
  other: string,
  skill: string,
): Theory => ({ prompt, options: [correct, wrong, other], correct: 0, skill });
export const expressTheory: Record<Grade, Theory[]> = {
  Junior: [
    question(
      'Как обработать запрос с пустым обязательным телом?',
      'Вернуть 400 до изменения данных',
      'Подставить значения по умолчанию и вернуть 200',
      'Начать запись и проверить тело после commit',
      'reliability',
    ),
    question(
      'Как запретить два одинаковых события одного клиента в SQL?',
      'Уникальное ограничение на пару tenant_id и event_id',
      'Обычный индекс без ограничения уникальности',
      'SELECT перед INSERT без ограничения в базе',
      'data',
    ),
    question(
      'Запись эффекта и маркера должна быть неделимой. Как это обеспечить в одной БД?',
      'Записать обе части в одной транзакции',
      'Записать маркер в следующем запросе',
      'Добавить паузу между записями',
      'reliability',
    ),
    question(
      'Неверный формат параметра обнаружен до выполнения запроса. Что делать?',
      'Вернуть понятную ошибку и не менять состояние',
      'Вернуть успешный статус и скрыть ошибку',
      'Повторять тот же запрос бесконечно',
      'reasoning',
    ),
  ],
  Middle: [
    question(
      'Повтор платежа пришёл после неизвестного результата. Что сохранять?',
      'Исходный ключ идемпотентности и область tenant',
      'Генерировать новый ключ на каждую попытку',
      'Использовать время получения запроса как новый ключ',
      'reliability',
    ),
    question(
      'База и брокер сообщений не имеют общей транзакции. Как избежать потери события?',
      'Сохранить outbox вместе с бизнес-изменением и доставлять с повторами',
      'Отправить сообщение после commit без журнала',
      'Сначала отправить сообщение, затем надеяться на commit',
      'delivery',
    ),
    question(
      'После истечения TTL тысячи запросов одновременно перестраивают один кэш. Что помогает?',
      'Single-flight или ограниченная координация обновления',
      'Неограниченно увеличить число параллельных обновлений',
      'Отключить проверку доступа на cache hit',
      'reliability',
    ),
    question(
      'Внешний сервис отвечает 30 секунд при бюджете ответа 3 секунды. Как сохранить запрос?',
      'Подтвердить приём после записи задания и завершать обработку асинхронно',
      'Блокировать клиентский запрос 30 секунд',
      'Вернуть старый ответ, не сохраняя новое задание',
      'delivery',
    ),
  ],
  Senior: [
    question(
      'Между регионами произошёл сетевой раздел, а денежный баланс требует строгой консистентности. Какой компромисс корректен?',
      'Ограничить запись там, где нельзя подтвердить единственного владельца и согласованность',
      'Разрешить независимую запись в обеих половинах без сверки',
      'Считать CAP гарантией одновременно полной доступности и консистентности при разделе',
      'reasoning',
    ),
    question(
      'После failover старый лидер продолжает работать. Что защищает запись от split-brain?',
      'Fencing token и проверка актуального владельца записи',
      'Только DNS-переключение на новый регион',
      'Одинаковый retry timeout на обоих лидерах',
      'reliability',
    ),
    question(
      'Как разделить данные нескольких tenant, сохранив безопасную повторную доставку?',
      'Учитывать tenant в области ключей и в маршрутизации партиций',
      'Использовать общий короткий ключ без области tenant',
      'Привязывать ключ только к текущему дата-центру',
      'data',
    ),
    question(
      'При предельной нагрузке важнее не потерять принятые операции, чем отвечать всеми функциями. Как деградировать?',
      'Ограничить нагрузку, сохранять задания и явно ограничить доступные операции',
      'Возвращать 200, отбрасывая очередь незаметно',
      'Бесконечно повторять вызовы во всех регионах',
      'delivery',
    ),
  ],
};
const categories = [
  { id: 'isolation', label: 'Коллизия ключей / Нарушение изоляции tenant' },
  { id: 'race', label: 'Гонка данных / Неатомарная фиксация (Race Condition)' },
  { id: 'delivery', label: 'Потеря событий / Неверный retry budget' },
  { id: 'none', label: 'Дефекта в этом узле нет' },
];
function group(id: string, index: number): 'isolation' | 'race' | 'delivery' {
  if (/key|tenant|auth|feature|split|group|join|unit/i.test(id)) return 'isolation';
  if (/retry|budget|policy|window|watermark|fallback|batch|rollback|queue|limit/i.test(id))
    return 'delivery';
  if (/transaction|version|invalid|merge|snapshot|threshold|precision|normal/i.test(id))
    return 'race';
  return (['isolation', 'race', 'delivery'] as const)[index % 3]!;
}
const focus: Record<Grade, string> = {
  Junior: 'Простой CRUD-сервис: дублирование записи и локальная транзакция',
  Middle: 'Tenant-scoped Idempotency: распределённый пайплайн и восстановление после сбоя',
  Senior: 'Каскадный сбой: межрегиональная доставка, изоляция tenant и failover',
};

/** Replay delayed old-leader writes, regional loss and durable queue recovery. */
export function simulateExpressFailover(policy: string, seed: number) {
  const accepted = Array.from({ length: 3 + (seed % 4) }, (_, index) => `operation-${index}`);
  const durable = new Set(policy === 'dual-writer' ? accepted.slice(0, -1) : accepted);
  const writes: { operation: string; epoch: number; region: string }[] = [];
  const epoch = 2;
  for (const operation of durable) {
    if (policy !== 'degraded') writes.push({ operation, epoch, region: 'DC-B' });
    if (policy === 'dual-writer') writes.push({ operation, epoch: 1, region: 'DC-A' });
  }
  const singleWriterAfterFailover = writes.every((write) => write.epoch === epoch);
  const zeroLostAcceptedOperations = accepted.every((operation) => durable.has(operation));
  return {
    checks: { singleWriterAfterFailover, zeroLostAcceptedOperations },
    trace: [
      '[INFO] DC-A недоступен; новый epoch=2 в DC-B; старый writer отправляет задержанные записи с epoch=1.',
      `[${singleWriterAfterFailover ? 'PASS' : 'FAIL'}] Записей со старым epoch: ${writes.filter((write) => write.epoch < epoch).length}.`,
      `[${zeroLostAcceptedOperations ? 'PASS' : 'FAIL'}] После потери региона восстановлено ${durable.size}/${accepted.length} принятых операций${policy === 'degraded' ? '; запись приостановлена, задания ожидают восстановления' : ''}.`,
    ],
  };
}

/** Create one grade-specific express case with two reproducible questions and bundled engineering decisions. */
export function expressVariant(base: Variant): Variant {
  const referenceBase = base.oracle.specialized!.referencePlans[0];
  const proposal =
    base.trackId === 'backend' && base.familyId === 'backend-payment-idempotency'
      ? {
          ...referenceBase,
          transaction:
            base.grade === 'Junior'
              ? 'separate'
              : base.grade === 'Middle' && base.seed % 5 === 0
                ? referenceBase.transaction!
                : 'separate',
          ...(base.grade !== 'Junior' ? { key: 'event' } : {}),
          ...(base.grade === 'Middle' && base.seed % 5 === 0 ? { retry: 'new-id' } : {}),
          ...(base.grade === 'Senior' ? { retryLimit: 0, retry: 'new-id' } : {}),
        }
      : undefined;
  const variant = engineeringVariant(base, 'common', proposal);
  const spec = variant.engineering!;
  const rng = random(base.seed + 1661);
  const shuffle = <T>(items: T[]) =>
    items
      .map((value) => ({ value, order: rng() }))
      .sort((a, b) => a.order - b.order)
      .map(({ value }) => value);
  const answers: Record<string, string> = {};
  const questions = makeQuestions(shuffle(expressTheory[base.grade]).slice(0, 2), answers, rng);
  const controls = variant.lab!.controls;
  const groups = Object.fromEntries(
    controls.map((control, index) => [control.id, group(control.id, index)]),
  );
  const defectMap = Object.fromEntries(
    Object.keys(variant.oracle.engineering!.defects).map((id) => [groups[id]!, groups[id]!]),
  );
  const nodes = [
    spec.nodes[0]!,
    ...(['isolation', 'race', 'delivery'] as const).map((id) => {
      const members = spec.nodes.filter((node) => groups[node.id] === id);
      return {
        id,
        name:
          id === 'isolation'
            ? 'Idempotency / Key Check'
            : id === 'race'
              ? base.grade === 'Junior'
                ? 'Local DB Transaction'
                : 'Ledger Transaction'
              : base.grade === 'Junior'
                ? 'Response / Error Handling'
                : 'Outbox / Retry Worker',
        code: members.map((node) => node.code).join('\n\n') || 'validate_output_contract()',
        description:
          members.map((node) => node.description).join(' ') ||
          'Результат соответствует контракту обработки запроса.',
      };
    }),
  ];
  const reference = variant.oracle.specialized!.referencePlans[0];
  const mutants = variant.oracle.specialized!.mutants[0];
  const describe = (plan: Plan) =>
    controls
      .map(
        (control) =>
          `${control.label}: ${control.options.find((option) => option.value === plan[control.id])?.label || String(plan[control.id])}`,
      )
      .join(' · ');
  const strategies = shuffle([
    {
      id: 'strategy-a',
      title:
        base.grade === 'Junior'
          ? 'Одна транзакция + устойчивый ключ операции'
          : base.grade === 'Senior'
            ? 'Изоляция tenant + надёжная фиксация + ограниченная доставка'
            : 'Ключ tenant + атомарная фиксация + устойчивая доставка',
      comment: describe(reference),
      plan: reference,
    },
    {
      id: 'strategy-b',
      title: 'Упростить протокол фиксации и повторов',
      comment: describe(mutants[0]!),
      plan: mutants[0]!,
    },
    {
      id: 'strategy-c',
      title: 'Сохранить предложенный протокол с альтернативной политикой',
      comment: describe(mutants[1] || mutants[0]!),
      plan: mutants[1] || mutants[0]!,
    },
  ]).filter(
    (choice, index, all) =>
      all.findIndex((item) => JSON.stringify(item.plan) === JSON.stringify(choice.plan)) === index,
  );
  const changed = variant.oracle.specialized!.referencePlans[1];
  const adaptations: ExpressChoice[] =
    base.grade === 'Junior'
      ? [
          {
            id: 'adapt-a',
            title: 'Отклонять неверный запрос до записи',
            comment: '400 для пустого тела и неверных параметров; корректный запрос сохраняется.',
            plan: { ...changed, expressPolicy: 'strict' },
          },
          {
            id: 'adapt-b',
            title: 'Подставлять значения по умолчанию',
            comment: 'Продолжать обработку даже при неполном теле или неверном типе.',
            plan: { ...changed, expressPolicy: 'defaults' },
          },
          {
            id: 'adapt-c',
            title: 'Всегда отвечать успешно',
            comment: '200 без проверки тела и без гарантированной записи.',
            plan: { ...changed, expressPolicy: 'ack' },
          },
        ]
      : base.grade === 'Senior'
        ? [
            {
              id: 'adapt-a',
              title: 'Failover с fencing + очередь + контроль владельца',
              comment:
                'Единственный writer, защищённое переключение DC и сохранение принятых операций.',
              plan: { ...changed, expressPolicy: 'fenced', resilience: 'breaker-async' },
            },
            {
              id: 'adapt-b',
              title: 'Независимые записи в обоих DC',
              comment: 'Active-active без координации владельца и области ключей.',
              plan: { ...changed, expressPolicy: 'dual-writer', resilience: 'async' },
            },
            {
              id: 'adapt-c',
              title: 'Degraded read-only + сохранение очереди',
              comment:
                'Ограничить запись, сохранить операции для восстановления; клиент получает явный 202.',
              plan: { ...changed, expressPolicy: 'degraded', resilience: 'breaker-async' },
            },
          ]
        : [
            {
              id: 'adapt-a',
              title: 'Circuit Breaker + очередь + polling + DLQ',
              comment:
                'Ограничить повторы, подтвердить приём после записи задания, изолировать отказ провайдера.',
              plan: { ...changed, resilience: 'breaker-async' },
            },
            {
              id: 'adapt-b',
              title: 'Синхронный вызов и немедленные повторы',
              comment: 'Клиент ждёт внешний сервис; каждый timeout вызывает новый вызов.',
              plan: { ...changed, resilience: 'sync' },
            },
            {
              id: 'adapt-c',
              title: 'Degraded cache-mode без сохранения задания',
              comment: 'Отвечать из кэша, отбрасывая новые операции при перегрузке.',
              plan: { ...changed, resilience: 'cache' },
            },
          ];
  const contract = variant.artifacts.find((item) => item.name === 'contract.md')!.content;
  return {
    ...variant,
    version: 'express-1.0.0',
    title:
      base.trackId === 'backend' ? focus[base.grade] : `${variant.title} · экспресс ${base.grade}`,
    questions,
    oracle: { ...variant.oracle, answers, engineering: { defects: defectMap } },
    stageModes: ['closed', 'docs', 'docs'],
    engineering: {
      ...spec,
      version: 'express-v1',
      benchmark: 'claimed',
      business:
        base.trackId === 'backend'
          ? `${focus[base.grade]}. ${base.grade === 'Junior' ? 'Операция должна сохраняться один раз в локальной базе.' : 'Принятые операции нельзя потерять, продублировать или смешать между клиентами.'}`
          : spec.business,
      nodes,
      defectTypes: categories,
      artifactSource: 'deterministic-template',
      express: {
        durationMinutes: [5, 7],
        strategies,
        adaptations: shuffle(adaptations),
        focus: focus[base.grade],
        nodeControls: Object.fromEntries(
          ['isolation', 'race', 'delivery'].map((id) => [
            id,
            controls.filter((control) => groups[control.id] === id).map((control) => control.id),
          ]),
        ),
        invalidRequests: [
          { name: 'Пустое тело', body: null },
          {
            name: 'Неверный формат параметра',
            body: { tenant: 'invalid', event: 12, amount: 100 },
          },
          {
            name: 'Корректный запрос',
            body: { tenant: 1, event: 12, amount: 100 + (base.seed % 100) },
          },
        ],
      },
      edge: {
        ...spec.edge,
        description:
          base.grade === 'Junior'
            ? 'В сервис пришли запрос с пустым телом и запрос с неверным типом параметра. Оба должны быть отклонены до изменения данных; корректный запрос должен сохраняться.'
            : base.grade === 'Senior'
              ? `${spec.edge.description} Основной DC недоступен. При сетевом разделе старый writer может оставаться активным. RPO для принятых операций — 0; допустима явная деградация функциональности.`
              : spec.edge.description,
      },
    },
    artifacts: [
      { name: 'contract.md', content: contract },
      {
        name: 'proposed-plan.json',
        content: variant.artifacts.find((item) => item.name === 'proposed-plan.json')!.content,
      },
    ],
  };
}

/** Generate a unique claimed-grade variant locally, including external-effect and tenant complexity where required. */
export function generateExpressVariant(
  trackId: string,
  grade: Grade,
  previous: Variant[],
  familyId?: string,
): Variant {
  const id =
    familyId ||
    (trackId === 'backend'
      ? 'backend-payment-idempotency'
      : families.find((family) => family.trackId === trackId)!.id);
  const used = new Set(previous.map(variantFingerprint));
  for (let attempt = 0; attempt < 48; attempt++) {
    const seed = randomBytes(4).readUInt32LE();
    const base = generateVariant(trackId, grade, seed, 'docs', id);
    if (
      trackId === 'backend' &&
      grade !== 'Junior' &&
      (!base.lab!.data.parameters.externalEffect || base.lab!.data.parameters.globalIds)
    )
      continue;
    const variant = expressVariant(base);
    if (!used.has(variantFingerprint(variant))) return variant;
  }
  throw new Error('Новый экспресс-вариант не подготовлен; повторное задание не выдано');
}

/** Evaluate a selected package with real family checks and grade-specific edge validation. */
export function expressExperiment(
  assessment: Assessment,
  stage: 1 | 2,
  strategyId: string,
  adaptationId?: string,
) {
  const spec = assessment.variant.engineering!.express!;
  const strategy = spec.strategies.find((item) => item.id === strategyId);
  const adaptation = spec.adaptations.find((item) => item.id === adaptationId);
  if (!strategy || (stage === 2 && !adaptation)) throw new Error('Выберите предложенную стратегию');
  const plan = stage === 1 ? strategy.plan : { ...strategy.plan, ...adaptation!.plan };
  let report;
  if (stage === 1) report = engineeringExperiment(assessment, 1, plan);
  else if (assessment.variant.grade === 'Junior') {
    report = runExperiment(
      assessment.variant,
      { plan: Object.fromEntries(Object.entries(plan).filter(([id]) => id !== 'expressPolicy')) },
      2,
    );
    const policy = plan.expressPolicy;
    const responses = spec.invalidRequests.map(({ body }) => {
      const valid = Boolean(
        body &&
        typeof body.tenant === 'number' &&
        typeof body.event === 'number' &&
        typeof body.amount === 'number' &&
        body.amount > 0,
      );
      return policy === 'strict'
        ? { status: valid ? 201 : 400, written: valid }
        : policy === 'defaults'
          ? { status: 201, written: true }
          : { status: 200, written: false };
    });
    report.checks = {
      emptyBodyRejected: responses[0]!.status === 400 && !responses[0]!.written,
      malformedParameterRejected: responses[1]!.status === 400 && !responses[1]!.written,
      validRequestCommitted: responses[2]!.status === 201 && responses[2]!.written,
    };
    report.trace = spec.invalidRequests.map(
      (item, index) =>
        `[${index === 2 ? (responses[index]!.written ? 'PASS' : 'FAIL') : responses[index]!.status === 400 ? 'PASS' : 'FAIL'}] ${item.name}: HTTP ${responses[index]!.status}; запись ${responses[index]!.written ? 'выполнена' : 'не выполнена'}`,
    );
    report.engineering = true;
  } else {
    report = engineeringExperiment(
      assessment,
      2,
      Object.fromEntries(Object.entries(plan).filter(([id]) => id !== 'expressPolicy')),
    );
    if (assessment.variant.grade === 'Senior') {
      const failover = simulateExpressFailover(String(plan.expressPolicy), assessment.variant.seed);
      Object.assign(report.checks, failover.checks);
      report.trace = [...(report.trace || []), ...failover.trace];
    }
  }
  report.input = {
    plan: {
      ...plan,
      expressStrategyId: strategyId,
      ...(adaptationId ? { expressAdaptationId: adaptationId } : {}),
    },
  };
  engineeringProgress(assessment).plans[stage === 1 ? 'main' : 'edge'] = report.input.plan!;
  return report;
}

/** Confirm only the stated level at 70%; never silently downgrade or promote the candidate. */
export function evaluateExpress(assessment: Assessment): AssessmentResult {
  const base = evaluateEngineering(assessment);
  const maturity = base.maturity!;
  const score = Math.round(
    maturity.theoryAccuracy * 0.2 +
      maturity.rootCauseAccuracy * 0.3 +
      maturity.strategyQuality * 0.25 +
      maturity.edgeCaseHandling * 0.25,
  );
  return {
    ...base,
    score,
    proposedGrade: score >= 70 ? assessment.variant.grade : null,
    status: score >= 70 ? 'provisional' : 'not_confirmed',
    rubricVersion: 'express-v1',
    feedback: [
      'Блиц 20%, аудит архитектуры 30%, стратегия 25%, устойчивость 25%. Подтверждение заявленного грейда: ≥70%.',
      score >= 70
        ? `${assessment.variant.grade} подтверждён по экспресс-тесту. Более высокий уровень требует отдельной попытки.`
        : `${assessment.variant.grade} не подтверждён. Уровень не понижается автоматически; попытка ниже доступна сразу. Повтор этого уровня — через 30 дней.`,
      'Диагностика и оценка выполняются локально. История ФСП не влияет на баллы теста.',
    ],
  };
}

/** Compute the failed-level retry date independently for each track and claimed grade. */
export function expressRetryAt(
  assessments: Assessment[],
  trackId: string,
  grade: Grade,
): string | null {
  const failed = assessments
    .filter(
      (item) =>
        item.variant.trackId === trackId &&
        item.variant.grade === grade &&
        item.result?.rubricVersion === 'express-v1' &&
        !item.result.proposedGrade &&
        item.submittedAt,
    )
    .sort((a, b) => b.submittedAt!.localeCompare(a.submittedAt!))[0];
  return failed ? new Date(Date.parse(failed.submittedAt!) + 30 * 86400000).toISOString() : null;
}
