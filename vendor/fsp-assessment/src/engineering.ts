import type {
  Assessment,
  AssessmentResult,
  DiagnosticKind,
  EngineeringProgress,
  Experiment,
  Grade,
  Maturity,
  Plan,
  Variant,
} from './domain.js';
import { getFamily } from './families/registry.js';
import { runExperiment } from './simulator.js';
import { random } from './random.js';
import { describeCase, resultLabel } from '../offerly-web/lib/assessment-presentation.js';

const defectFor = (id: string): string =>
  ({
    key: 'identity-collision',
    transaction: 'atomicity-gap',
    retry: 'unsafe-retry',
    retryLimit: 'retry-budget',
    auth: 'access-bypass',
    invalidation: 'stale-state',
    split: 'evaluation-leak',
    features: 'data-contract',
  })[id] || 'contract-mismatch';
const defects = [
  ['none', 'Дефекта в этом узле нет'],
  ['identity-collision', 'Коллизия ключей / нет изоляции операций'],
  ['atomicity-gap', 'Гонка / неатомарная фиксация эффекта'],
  ['unsafe-retry', 'Повтор создаёт новый побочный эффект'],
  ['retry-budget', 'Неверный бюджет повторов'],
  ['access-bypass', 'Проверку доступа можно обойти'],
  ['stale-state', 'Устаревшее состояние / неверная инвалидация'],
  ['evaluation-leak', 'Утечка в оценке / неверное разбиение'],
  ['data-contract', 'Нарушен контракт данных'],
  ['contract-mismatch', 'Решение нарушает ограничение контракта'],
] as const;
function decisionText(variant: Variant, id: string, value: unknown): string {
  const control = variant.lab!.controls.find((item) => item.id === id)!;
  const label = (part: unknown) =>
    control.options.find((option) => option.value === String(part))?.label || String(part);
  return Array.isArray(value) ? value.map(label).join(', ') || 'Ничего не выбрано' : label(value);
}
function architectureCode(variant: Variant, id: string, plan: Plan): string {
  const assignment = `${id} := ${JSON.stringify(plan[id])}`;
  if (variant.familyId === 'backend-payment-idempotency') {
    const effect = variant.lab!.data.parameters.externalEffect
      ? 'provider.charge(operation)'
      : 'ledger.apply(operation)';
    const snippets: Record<string, string> = {
      key:
        plan.key === 'tenant-event'
          ? 'identity = tenant_id + event_id\nlookup_processed(identity)'
          : plan.key === 'event'
            ? 'identity = event_id\nlookup_processed(identity)'
            : 'identity = new_uuid()\nlookup_processed(identity)',
      transaction:
        plan.transaction === 'outbox'
          ? 'BEGIN\n  save_intent(identity)\n  append_outbox(identity)\nCOMMIT\nworker -> provider.charge(identity)'
          : plan.transaction === 'atomic'
            ? `BEGIN\n  ${effect}\n  mark_processed(identity)\nCOMMIT`
            : `${effect}\n// процесс может завершиться здесь\nmark_processed(identity)`,
      retry:
        plan.retry === 'same-id'
          ? 'on_unknown_result:\n  retry(original_identity)'
          : 'on_unknown_result:\n  retry(new_uuid())',
      retryLimit: `on_transient_failure:\n  repeat_at_most(${String(plan.retryLimit)})\n  preserve_operation_identity()`,
    };
    return `${assignment}\n${snippets[id] || ''}`;
  }
  if (variant.familyId === 'backend-cache-isolation') {
    const snippets: Record<string, string> = {
      key:
        plan.key === 'resource' ? 'cache_key = resource_id' : 'cache_key = tenant_id + resource_id',
      auth:
        plan.auth === 'miss-only'
          ? 'if cache_hit: return cached\ncheck_access(request)'
          : 'check_access(request)\nif cache_hit: return cached',
      invalidation:
        plan.invalidation === 'version'
          ? 'if cached.version != request.version:\n  reload_data(request.version)'
          : 'if cache_hit: return first_cached_value',
    };
    return `${assignment}\n${snippets[id] || ''}`;
  }
  return `${assignment}\napply_decision_to_input()\ncheck_contract_invariants()`;
}

/** Turn a verified fixture into an inspectable architecture with independently known faulty nodes. */
export function engineeringVariant(
  variant: Variant,
  benchmark: 'common' | 'legacy' = 'common',
  proposal?: Plan,
): Variant {
  if (!variant.lab || !variant.oracle.specialized)
    throw new Error('Для кейса необходим проверенный симулятор');
  const rng = random(variant.seed + 941);
  const reference = variant.oracle.specialized.referencePlans[0];
  const mutants = variant.oracle.specialized.mutants[0];
  const proposed = structuredClone(proposal || mutants[Math.floor(rng() * mutants.length)]!);
  const truth: Record<string, string> = {};
  const family = getFamily(variant.familyId);
  if (!proposal && variant.seed % 2 === 1) {
    const second = mutants.find((mutant) =>
      variant.lab!.controls.some(
        (control) =>
          JSON.stringify(mutant[control.id]) !== JSON.stringify(reference[control.id]) &&
          JSON.stringify(proposed[control.id]) === JSON.stringify(reference[control.id]),
      ),
    );
    if (second) {
      const combined = { ...proposed };
      for (const control of variant.lab.controls)
        if (JSON.stringify(second[control.id]) !== JSON.stringify(reference[control.id]))
          combined[control.id] = second[control.id]!;
      if (!Object.values(family.run(variant.lab.data, combined).checks).every(Boolean))
        Object.assign(proposed, combined);
    }
  }
  for (const control of variant.lab.controls) {
    if (JSON.stringify(proposed[control.id]) === JSON.stringify(reference[control.id])) continue;
    const isolated = { ...reference, [control.id]: proposed[control.id]! };
    if (!Object.values(family.run(variant.lab.data, isolated).checks).every(Boolean))
      truth[control.id] = defectFor(control.id);
  }
  if (!Object.keys(truth).length) throw new Error('Аудит отклонён: дефект не подтверждён');
  const situation = describeCase(variant.familyId, variant.title);
  const rps = 10 * (20 + Math.floor(rng() * 15));
  const outage = rng() >= 0.5;
  const edge = {
    title: outage ? 'Внешняя зависимость нестабильна' : 'Нагрузка выросла в десять раз',
    description: `Нагрузка выросла в 10 раз: ${rps} запросов/с в течение 5 секунд. Зависимость отвечает за 30 секунд${outage ? ', 60% вызовов завершаются временным отказом' : ''}. Ответ клиенту должен укладываться в 3 секунды. Операции нельзя терять или дублировать; очередь вмещает ${rps * 5 + 100} заданий. ${variant.lab.change} Выберите способ адаптации и перепроверьте инварианты в новых данных.`,
    rps,
    durationSeconds: 5,
    delaySeconds: 30,
    failurePercent: outage ? 60 : 0,
    responseBudgetSeconds: 3,
    queueCapacity: rps * 5 + 100,
    data: variant.oracle.specialized.changedData,
    decision: {
      id: 'resilience',
      label: 'Обработка нагрузки и отказов',
      help: 'Учитывайте время ответа, сохранность задания и состояние зависимости.',
      type: 'select' as const,
      values: [],
      initial: 'sync',
      options: [
        { value: 'sync', label: 'Синхронные вызовы с немедленными повторами' },
        { value: 'async', label: 'Ограниченная очередь + асинхронный polling + DLQ' },
        { value: 'breaker-async', label: 'Circuit Breaker + ограниченная очередь + polling + DLQ' },
        { value: 'cache', label: 'Вернуть кэшированный ответ и не сохранять новое задание' },
      ],
    },
  };
  return {
    ...variant,
    version: '3.0.0',
    context: situation.situation,
    engineering: {
      version: 'engineering-v1',
      benchmark,
      business: `${situation.situation} ${situation.action} Требуется найти причину нарушения контракта, выбрать инженерное решение и выдержать стресс-сценарий.`,
      artifactSource: 'deterministic-template',
      nodes: [
        {
          id: 'input',
          name: 'Входные данные',
          code: 'request -> validate_schema -> dispatch',
          description:
            'Запросы соответствуют опубликованной схеме. Содержимое данных доступно в материалах.',
        },
        ...variant.lab.controls.map((control) => ({
          id: control.id,
          name: control.label,
          code: architectureCode(variant, control.id, proposed),
          description: `Предложение в исходном плане: ${decisionText(variant, control.id, proposed[control.id])}`,
        })),
        {
          id: 'output',
          name: 'Контроль результата',
          code: 'result -> compare_contract -> record_trace',
          description:
            'Результат сопоставляется с инвариантами контракта. Сам факт успешного вызова не означает корректность.',
        },
      ],
      defectTypes: defects.map(([id, label]) => ({ id, label })),
      decisions: variant.lab.controls.map((control) => ({
        ...control,
        initial: proposed[control.id]!,
      })),
      edge,
    },
    artifacts: variant.artifacts.map((artifact) =>
      artifact.name === 'proposed-plan.json'
        ? { ...artifact, content: JSON.stringify(proposed, null, 2) }
        : artifact.name === 'working-notes.md'
          ? {
              ...artifact,
              content:
                'Исследуйте архитектуру по узлам. Для проверки гипотез доступны логи, метрики и трассировка симулятора. Отметьте дефекты, выберите инженерные решения и примените стратегию. Отчёт PASS/FAIL показывает обязательные инварианты. Все блоки доступны в любом порядке; последний применённый план участвует в оценке.',
            }
          : artifact,
    ),
    oracle: { ...variant.oracle, engineering: { defects: truth } },
  };
}

/** Initialize server-owned progress; drafts and assistant traces survive navigation and reloads. */
export function engineeringProgress(assessment: Assessment): EngineeringProgress {
  return (assessment.engineeringProgress ??= {
    audit: {},
    auditSaved: false,
    plans: {},
    diagnostics: [],
  });
}

/** Validate and save the candidate's localization without leaking the answer map. */
export function recordAudit(assessment: Assessment, audit: Record<string, unknown>): void {
  const spec = assessment.variant.engineering!;
  if (Object.keys(audit).some((id) => !spec.nodes.some((node) => node.id === id)))
    throw new Error('Неизвестный узел архитектуры');
  if (Object.values(audit).some((value) => !spec.defectTypes.some((defect) => defect.id === value)))
    throw new Error('Неизвестный тип дефекта');
  const progress = engineeringProgress(assessment);
  progress.audit = Object.fromEntries(
    Object.entries(audit).map(([id, value]) => [id, String(value)]),
  );
  progress.auditSaved = true;
}

/** Run actual fixture invariants and a deterministic burst/dependency model for the selected strategy. */
export function engineeringExperiment(
  assessment: Assessment,
  stage: 1 | 2,
  plan: Plan,
): Experiment {
  const variant = assessment.variant;
  const spec = variant.engineering!;
  const permitted = [
    ...spec.decisions.map((control) => control.id),
    ...(stage === 2 ? ['resilience'] : []),
  ];
  if (Object.keys(plan).some((id) => !permitted.includes(id)))
    throw new Error('Неизвестное инженерное решение');
  const base = Object.fromEntries(
    Object.entries(plan).filter(([id]) => id !== 'resilience' && !id.startsWith('express')),
  );
  const experiment = runExperiment(variant, { plan: base }, stage);
  experiment.engineering = true;
  if (stage === 2) {
    const policy = plan.resilience;
    if (!spec.edge.decision.options.some((option) => option.value === policy))
      throw new Error('Выберите стратегию адаптации');
    const asynchronous = policy === 'async' || policy === 'breaker-async';
    const arrivals = spec.edge.rps * spec.edge.durationSeconds;
    const acknowledgement = asynchronous ? 0.05 : spec.edge.delaySeconds;
    experiment.checks = {
      ...experiment.checks,
      clientResponseBudget: acknowledgement <= spec.edge.responseBudgetSeconds,
      boundedQueue: asynchronous && arrivals <= spec.edge.queueCapacity,
      dependencyProtection: spec.edge.failurePercent < 50 || policy === 'breaker-async',
      noLostWork: asynchronous,
    };
    experiment.metrics = {
      ...experiment.metrics,
      simulatedRequests: arrivals,
      acknowledgementSeconds: acknowledgement,
      queuedTasks: asynchronous ? arrivals : 0,
    };
    experiment.explanation = `Виртуальный поток из ${arrivals} запросов; проверены время подтверждения, вместимость очереди, защита зависимости и сохранность заданий. ${experiment.explanation}`;
  }
  experiment.input = { plan };
  engineeringProgress(assessment).plans[stage === 1 ? 'main' : 'edge'] = plan;
  return experiment;
}

/** Provide grounded diagnostic material for a node; free text is retained but never graded by length or style. */
export function engineeringDiagnostic(
  assessment: Assessment,
  nodeId: string,
  kind: DiagnosticKind,
  question: string,
  stage: 1 | 2 = 1,
): { text: string; live: false } {
  const spec = assessment.variant.engineering!;
  const node = spec.nodes.find((item) => item.id === nodeId);
  if (!node || !['logs', 'metrics', 'explain', 'alternative'].includes(kind))
    throw new Error('Выберите узел и диагностический запрос');
  if (assessment.variant.stageModes[1] === 'closed')
    throw new Error('В этом кейсе ассистент не предусмотрен');
  const progress = engineeringProgress(assessment);
  if (progress.diagnostics.length >= 40)
    throw new Error('Доступно не более 40 запросов диагностики на кейс');
  const proposed = JSON.parse(
    assessment.variant.artifacts.find((artifact) => artifact.name === 'proposed-plan.json')!
      .content,
  ) as Plan;
  const input = stage === 2 ? spec.edge.data : assessment.variant.lab!.data;
  const plan = stage === 2 ? progress.plans.edge || proposed : proposed;
  const base = Object.fromEntries(Object.entries(plan).filter(([id]) => id !== 'resilience'));
  const report = getFamily(assessment.variant.familyId).run(input, base);
  const labels = Object.entries(report.checks).map(
    ([name, passed]) => `${passed ? 'PASS' : 'FAIL'} · ${testTitle(name)}`,
  );
  const reference = assessment.variant.oracle.specialized!.referencePlans[stage - 1]!;
  const controlIds = spec.express?.nodeControls[nodeId] || [nodeId];
  const faulty =
    controlIds.some((id) =>
      assessment.variant.lab!.controls.some((control) => control.id === id),
    ) &&
    !Object.values(
      getFamily(assessment.variant.familyId).run(input, {
        ...reference,
        ...Object.fromEntries(controlIds.map((id) => [id, base[id]!])),
      }).checks,
    ).every(Boolean);
  const texts: Record<DiagnosticKind, string> = {
    logs: `[INFO] Trace collected: ${node.name}\n${report.trace?.join('\n') || `${faulty ? '[WARN] Контрольный повтор нарушает контракт выбранного узла.' : '[INFO] Изолированная проверка узла не выявила нарушения.'}\n${labels.join('\n')}`}`,
    metrics: `Результаты воспроизводимой симуляции ${stage === 2 ? 'в изменённых условиях' : 'исходного плана'}:\n${Object.entries(
      report.metrics,
    )
      .map(([name, value]) => `${resultLabel(name)}: ${Number(value.toFixed(4))}`)
      .join(
        '\n',
      )}\n${labels.join('\n')}${stage === 2 ? `\nRPS: ${spec.edge.rps}; задержка зависимости: ${spec.edge.delaySeconds} с; временные отказы: ${spec.edge.failurePercent}%` : ''}`,
    explain: `Трассировка «${node.name}»:\n1. ${node.code}\n2. ${node.description}\n3. ${faulty ? 'Изменение этого решения при фиксированных остальных настройках влияет на нарушение. Проверьте область ключа, границу операции или ограничение контракта.' : 'Нарушение нужно искать в других решениях. Не отмечайте узел только потому, что он участвует в потоке.'}\nЭто трассировка симулятора, а не SQL EXPLAIN реальной базы.`,
    alternative: `Альтернативы для узла «${node.name}»:\n${
      spec.decisions
        .find((control) => control.id === nodeId)
        ?.options.map((option) => `• ${option.label}`)
        .join('\n') || 'Сохранить схему входа и проверку инвариантов.'
    }\nВыберите альтернативу по контракту и подтвердите её стресс-тестом; изменение без проверки не является доказательством.`,
  };
  const text = spec.express
    ? kind === 'logs'
      ? `[${faulty ? 'WARN' : 'INFO'}] ${node.name}: ${faulty ? 'изолированное воспроизведение нарушает контракт' : 'нарушение в изолированной проверке не воспроизведено'}.\n${(report.trace || labels).slice(0, 3).join('\n')}`
      : kind === 'metrics'
        ? `${Object.values(report.checks).filter(Boolean).length}/${labels.length} инвариантов подтверждено\n${Object.entries(
            report.metrics,
          )
            .slice(0, 3)
            .map(([name, value]) => `${resultLabel(name)}: ${Number(value.toFixed(3))}`)
            .join('\n')}`
        : `Узел: ${node.name}\n${node.code}\n[${faulty ? 'WARN' : 'INFO'}] ${faulty ? 'Проверьте область ключа, атомарность или бюджет повторов.' : 'Изолированная проверка не нарушает контракт.'}`
    : texts[kind];
  progress.diagnostics.push({ nodeId, kind, question, text, at: new Date().toISOString() });
  return { text, live: false };
}

/** Render validator checks as explicit virtual tests, with a readable fallback for every existing family. */
export function testTitle(name: string): string {
  const names: Record<string, string> = {
    correctBalances: 'Идемпотентность: повторы не меняют итоговый баланс',
    scopedKeys: 'Изоляция операций разных клиентов',
    atomicRecovery: 'Конкурентность и восстановление после сбоя',
    stableRetryIdentity: 'Повтор сохраняет идентичность операции',
    deliveryWithinBudget: 'Доставка укладывается в бюджет retry',
    clientResponseBudget: 'Клиент получает ответ в пределах 3 секунд',
    boundedQueue: 'Всплеск нагрузки помещается в ограниченную очередь',
    dependencyProtection: 'Отказы зависимости не вызывают лавину повторов',
    noLostWork: 'Принятые задания сохранены и будут обработаны',
    accessIsolation: 'Изоляция tenant и проверка доступа до ответа из кэша',
    consistentResponses: 'Версионирование: ответ соответствует актуальному состоянию',
  };
  return names[name] || resultLabel(name);
}

/** Assign a benchmark level independently of the claimed level using a published fixed rubric. */
export function confirmsEngineeringGrade(
  targetGrade: Grade,
  score: number,
  maturity: Pick<
    Maturity,
    'rootCauseAccuracy' | 'edgeCaseHandling' | 'strategyQuality' | 'theoryAccuracy'
  >,
): boolean {
  if (targetGrade === 'Senior')
    return (
      score >= 85 &&
      maturity.rootCauseAccuracy >= 80 &&
      maturity.edgeCaseHandling >= 80 &&
      maturity.strategyQuality >= 80 &&
      maturity.theoryAccuracy >= 60
    );
  if (targetGrade === 'Middle')
    return (
      score >= 65 &&
      maturity.rootCauseAccuracy >= 60 &&
      maturity.strategyQuality >= 60 &&
      maturity.edgeCaseHandling >= 40
    );
  return score >= 40 && maturity.strategyQuality >= 40;
}

/** Deterministic grading uses final audit, final tested strategies and structured diagnostic traces only. */
export function evaluateEngineering(assessment: Assessment): AssessmentResult {
  const progress = engineeringProgress(assessment);
  const expected = assessment.variant.oracle.engineering!.defects;
  const selected = Object.entries(progress.audit).filter(([, type]) => type !== 'none');
  const correct = selected.filter(([id, type]) => expected[id] === type).length;
  const root = Math.round((100 * (2 * correct)) / (Object.keys(expected).length + selected.length));
  const quality = (stage: number) => {
    const report = assessment.experiments
      .filter((item) => item.stage === stage && item.engineering)
      .at(-1);
    return report
      ? Math.round(
          (100 * Object.values(report.checks).filter(Boolean).length) /
            Object.keys(report.checks).length,
        )
      : 0;
  };
  const theory = Math.round(
    (100 *
      assessment.variant.questions.filter(
        (item) => assessment.answers[item.id] === assessment.variant.oracle.answers[item.id],
      ).length) /
      assessment.variant.questions.length,
  );
  const relevant = progress.diagnostics.filter((item) => expected[item.nodeId]);
  const unique = new Set(relevant.map((item) => `${item.nodeId}:${item.kind}`));
  const depth = Math.min(3, new Set(relevant.map((item) => item.kind)).size);
  const maturity: Maturity = {
    rootCauseAccuracy: root,
    strategyQuality: quality(1),
    edgeCaseHandling: quality(2),
    theoryAccuracy: theory,
    aiIterations: progress.diagnostics.length,
    aiDepth: depth,
    aiEfficiency: progress.diagnostics.length
      ? Math.round((((100 * unique.size) / progress.diagnostics.length) * depth) / 3)
      : null,
  };
  const score = Math.round(
    theory * 0.15 +
      root * 0.35 +
      maturity.strategyQuality * 0.25 +
      maturity.edgeCaseHandling * 0.25,
  );
  const confirmed = confirmsEngineeringGrade(assessment.variant.grade, score, maturity);
  return {
    score,
    maxScore: 100,
    proposedGrade: confirmed ? assessment.variant.grade : null,
    status: confirmed ? 'provisional' : 'not_confirmed',
    rubricVersion: 'engineering-v1',
    maturity,
    evidence: [
      {
        skillId: 'reasoning',
        score: root,
        source: 'architecture-audit',
        explanation: 'Точность локализации с учётом ложных отметок и пропусков.',
      },
      ...assessment.variant.lab!.measuredSkills.map((skillId) => ({
        skillId,
        score: Math.min(maturity.strategyQuality, maturity.edgeCaseHandling),
        source: assessment.experiments
          .filter((item) => [1, 2].includes(item.stage))
          .slice(-2)
          .map((item) => item.id)
          .join(','),
        explanation: 'Доля выполненных инвариантов в основном и стресс-сценарии.',
      })),
    ],
    feedback: [
      `Заявлено ${assessment.variant.grade}; уровень ${confirmed ? 'подтверждён' : 'не подтверждён'}. Другой грейд требует отдельной проверки.`,
      'Баллы: теория 15%, локализация 35%, стратегия 25%, адаптация 25%. Учитываются последние сохранённые решения.',
      'AI-метрика показывает долю уникальных диагностических запросов по проблемным узлам и число видов диагностики; длина текста не влияет на оценку. Отсутствие запросов означает самостоятельную работу и не снижает общий балл.',
      'Уровень относится к задачам этой программы. Это автоматическая оценка платформы, а не внешняя профессиональная сертификация.',
    ],
  };
}
