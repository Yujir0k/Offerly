interface CasePresentation {
  title: string;
  situation: string;
  action: string;
}

export const casePresentations: Record<string, CasePresentation> = {
  'ds-decision-cost': {
    title: 'Модель с подозрительно хорошей метрикой',
    situation:
      'Отчёт обещает отличное качество. Но решение должно работать на будущих данных и учитывать стоимость ошибок.',
    action: 'Проверьте признаки, способ оценки и порог решения. Подкрепите вывод экспериментом.',
  },
  'ds-segment-thresholds': {
    title: 'За средней метрикой скрываются потери',
    situation:
      'Один порог работает для всех сегментов. Хороший общий результат ещё не объясняет качество в каждом из них.',
    action: 'Сравните сегменты и выберите пороги с учётом ограничений и стоимости ошибок.',
  },
  'mle-serving-contract': {
    title: 'На обучении работает. В production — нет',
    situation:
      'Модель получает другие преобразования и пропуски при обслуживании запросов. Нужно разобраться с контрактом признаков.',
    action:
      'Проверьте преобразования, обработку пропусков и версию артефакта на реальных данных лаборатории.',
  },
  'mle-batching-precision': {
    title: 'Быстрее inference, меньше ресурсов',
    situation:
      'Сервису нужно выдержать очередь запросов. Размер batch и квантование влияют на задержку, качество и расход ресурсов.',
    action:
      'Подберите конфигурацию, измерьте результат и повторите проверку после изменения нагрузки.',
  },
  'mlops-canary-rollback': {
    title: 'Выпустить модель или откатить?',
    situation:
      'Canary-релиз выглядит удачным по общей метрике. Нужно проверить, что происходит в отдельных сегментах.',
    action: 'Оцените SLO и выберите решение о релизе, которое выдержит изменение условий.',
  },
  'mlops-point-in-time': {
    title: 'Признаки из будущего',
    situation:
      'Feature Store собирает признаки из источников с задержкой. Важно восстановить именно то, что было известно на момент прогноза.',
    action: 'Настройте point-in-time join, TTL и учёт задержки источника.',
  },
  'llm-retrieval-trust': {
    title: 'Когда RAG доверяет не тому источнику',
    situation:
      'В базе есть устаревшие документы и недоверенные инструкции. Убедительный ответ может оказаться опасно неверным.',
    action: 'Настройте выбор источников и проверьте ответы на актуальность и доверие.',
  },
  'llm-grounding-abstention': {
    title: 'Ответить или признать, что данных нет?',
    situation:
      'Часть вопросов подтверждается источниками, а часть — нет. Нужно сохранить качество и не раздувать контекст.',
    action: 'Сбалансируйте подтверждённость ответа, корректный отказ и расход контекста.',
  },
  'cv-detection-nms': {
    title: 'Объекты есть. Детекции дублируются',
    situation:
      'Пороги и подавление пересечений меняют precision и recall. Важно не потерять объекты разных классов.',
    action: 'Сравните настройки IoU и NMS по измеряемому качеству детекции.',
  },
  'cv-camera-shortcut': {
    title: 'Новая камера меняет всё',
    situation:
      'Классификатор мог запомнить особенности камеры вместо полезного сигнала. Предстоит проверить перенос на новые источники.',
    action: 'Исследуйте признаки и разбиение данных, затем проверьте переносимость решения.',
  },
  'ranking-ndcg-availability': {
    title: 'Рекомендации, которые нельзя купить',
    situation:
      'Высокий NDCG не гарантирует полезную выдачу: в ранжирование могут попасть недоступные товары и будущая обратная связь.',
    action: 'Проверьте допустимость сигналов и настройте ранжирование доступных товаров.',
  },
  'ranking-off-policy-ips': {
    title: 'Новая политика по старым логам',
    situation: 'Есть логи предыдущей политики. Нужно понять, можно ли по ним честно оценить новую.',
    action: 'Исследуйте propensity, overlap и устойчивость оценки при изменении условий.',
  },
  'research-paired-ablation': {
    title: 'Улучшение или удачный seed?',
    situation:
      'Новый метод показывает выигрыш. Но отдельный удачный запуск может скрывать разброс и слабую воспроизводимость.',
    action: 'Проведите парное сравнение и ablation, учитывая вариативность запусков.',
  },
  'research-compute-parity': {
    title: 'Честное сравнение с baseline',
    situation:
      'Метод может выигрывать за счёт дополнительного compute. Нужно отделить эффект идеи от расхода ресурсов.',
    action: 'Сопоставьте бюджеты и проверьте вывод об улучшении в равных условиях.',
  },
  'backend-payment-idempotency': {
    title: 'Один платёж. Два списания?',
    situation:
      'Платёжные события повторяются, а процесс может упасть между операциями. Нужно сохранить корректность для каждого клиента.',
    action: 'Настройте идемпотентность и восстановление. Проверьте повторы и сбой в эксперименте.',
  },
  'backend-cache-isolation': {
    title: 'Кэш, который отдаёт чужие данные',
    situation:
      'API использует общий кэш. Изоляция клиентов, авторизация и смена версии должны работать вместе.',
    action: 'Выберите ключ и правила доступа, затем проверьте изоляцию и актуальность результата.',
  },
  'frontend-request-races': {
    title: 'Старый ответ перезаписывает новый',
    situation:
      'Пользователь быстро меняет запрос. Ответы приходят в другом порядке, а компонент может уже исчезнуть.',
    action: 'Соберите стратегию обновления состояния и проверьте гонки запросов.',
  },
  'frontend-list-reconciliation': {
    title: 'Список теряет состояние',
    situation:
      'После перестановки элементов состояние оказывается не там, где ожидает пользователь. Большой список добавляет нагрузку.',
    action: 'Проверьте ключи, сохранение состояния и параметры виртуализации.',
  },
  'de-cdc-schema-money': {
    title: 'Деньги не сходятся после загрузки',
    situation:
      'Пайплайн обрабатывает денежные значения, изменения схемы и повторы загрузки. Ошибка преобразования меняет итог.',
    action: 'Настройте decimal, обработку схемы и повторов, подтвердите целостность данных.',
  },
  'de-event-time-windows': {
    title: 'Опоздавшие события меняют отчёт',
    situation:
      'Streaming-пайплайн получает события с задержкой. Время обработки и время события дают разные агрегаты.',
    action: 'Выберите окна и правила коррекции, затем проверьте результат на новом потоке.',
  },
  'qa-mutation-risk': {
    title: 'Тесты зелёные. Дефекты остаются',
    situation:
      'Ресурс на проверки ограничен. Нужно выбрать тесты, которые находят важные дефекты, а не только увеличивают число запусков.',
    action: 'Соберите портфель проверок по риску и измерьте, какие мутации он обнаруживает.',
  },
  'qa-flaky-async-isolation': {
    title: 'Retries скрывают настоящую ошибку',
    situation:
      'Асинхронные тесты нестабильны. Повторный запуск может маскировать дефект или проблему общего состояния.',
    action: 'Выберите ожидания и изоляцию, проверьте устойчивость и чувствительность тестов.',
  },
  'sre-multiwindow-burn': {
    title: 'Алерт, которому можно доверять',
    situation:
      'Распределение трафика меняется. Простое среднее может скрывать расход error budget или создавать лишние тревоги.',
    action: 'Настройте окна burn rate и взвешивание, проверьте обнаружение инцидентов.',
  },
  'sre-rolling-capacity': {
    title: 'Обновление без потери мощности',
    situation:
      'Сервис обновляется по репликам. Во время релиза одна из них может отказать, а нагрузка продолжает поступать.',
    action: 'Подберите параметры rolling update и запас мощности, проверьте сценарий сбоя.',
  },
  'analytics-stratified-ab': {
    title: 'A/B-тест с неожиданным победителем',
    situation:
      'Состав групп различается. Общая конверсия может говорить противоположное тому, что видно внутри сегментов.',
    action: 'Исследуйте эффект состава групп и рассчитайте сопоставимую оценку.',
  },
  'analytics-funnel-joins': {
    title: 'Воронка считает заказы дважды',
    situation:
      'Соединение событий раздувает число строк. Нужно восстановить конверсию когорты без дублирования заказов.',
    action: 'Проверьте join, уникальность и горизонт наблюдения, затем подтвердите расчёт.',
  },
};

/** Present a case without exposing reference answers or generating additional claims. */
export function describeCase(id: string, fallback: string): CasePresentation {
  return (
    casePresentations[id] || {
      title: fallback,
      situation:
        'Исследуйте материалы и предложенный план. Проверьте, выполняет ли решение условия задачи.',
      action: 'Проведите эксперимент, повторите его после изменения условий и объясните результат.',
    }
  );
}

const artifactNames: Record<string, string> = {
  'contract.md': 'Условие и контракт',
  'proposed-plan.json': 'Предложенное решение',
  'acceptance-rubric.md': 'Критерии проверки',
  'working-notes.md': 'Как работать с лабораторией',
};

/** Keep original file names for downloads while making the workspace readable. */
export function artifactTitle(name: string): string {
  return artifactNames[name] || name;
}

const resultLabels: Record<string, string> = {
  profit: 'Результат',
  recall: 'Recall',
  precision: 'Precision',
  totalProfit: 'Общий результат',
  segment0Profit: 'Результат сегмента 0',
  segment1Profit: 'Результат сегмента 1',
  segment0Recall: 'Recall сегмента 0',
  segment1Recall: 'Recall сегмента 1',
  predictionMismatches: 'Несовпадения прогнозов',
  maxScoreError: 'Максимальная ошибка оценки',
  requests: 'Запросы',
  p95: 'Задержка p95',
  workUnits: 'Расход ресурсов',
  rmse: 'RMSE',
  aggregateErrorRate: 'Общая доля ошибок',
  worstSegmentErrorRate: 'Ошибки худшего сегмента',
  worstP95: 'Худший p95',
  futureLeaks: 'Утечки из будущего',
  staleFeatures: 'Устаревшие признаки',
  coverage: 'Покрытие',
  correctSources: 'Корректные источники',
  injectionExecutions: 'Выполненные вредоносные инструкции',
  missing: 'Пропуски',
  sourceAccuracy: 'Точность источников',
  falseAccept: 'Ошибочные ответы',
  trueAccept: 'Подтверждённые ответы',
  correctRefusal: 'Корректные отказы',
  missedSupported: 'Пропущенные подтверждённые ответы',
  tokenUnits: 'Расход контекста',
  tp: 'Верные детекции',
  fp: 'Ложные детекции',
  fn: 'Пропущенные объекты',
  accuracy: 'Accuracy',
  trainFrames: 'Кадры обучения',
  testFrames: 'Кадры проверки',
  meanNdcg: 'Средний NDCG',
  unavailableInTop: 'Недоступные товары в выдаче',
  queries: 'Запросы',
  estimate: 'Оценка',
  absoluteError: 'Абсолютная ошибка',
  effectiveSampleSize: 'Эффективный размер выборки',
  delta: 'Разница',
  lower: 'Нижняя граница',
  upper: 'Верхняя граница',
  runs: 'Запуски',
  estimatedEffect: 'Оценённый эффект',
  controlledEffect: 'Эффект при равных условиях',
  confoundingBias: 'Смещение из-за compute',
  wrongTenants: 'Нарушения изоляции клиентов',
  ledgerError: 'Ошибка баланса',
  deduplicatedAttempts: 'Устранённые повторы',
  requiredRetries: 'Необходимые повторы',
  configuredRetries: 'Настроенный лимит повторов',
  deliveryWithinBudget: 'Доставка в пределах бюджета повторов',
  tenants: 'Клиенты',
  unauthorizedResponses: 'Ответы без права доступа',
  staleResponses: 'Устаревшие ответы',
  hits: 'Попадания в кэш',
  staleWrites: 'Записи устаревших ответов',
  postUnmountWrites: 'Записи после unmount',
  missingRoutes: 'Пропущенные маршруты',
  renderedRoutes: 'Отображённые маршруты',
  misassignedStates: 'Ошибки привязки состояния',
  renderedRows: 'Отрисованные строки',
  totalRows: 'Всего строк',
  totalCents: 'Итоговая сумма, в центах',
  expectedCents: 'Ожидаемая сумма, в центах',
  quarantined: 'Изолированные записи',
  invalidMain: 'Некорректные записи в результате',
  aggregateError: 'Ошибка агрегата',
  droppedEvents: 'Потерянные события',
  windows: 'Окна',
  killedMutations: 'Обнаруженные мутации',
  coveredRisk: 'Покрытый риск',
  executionCost: 'Стоимость выполнения',
  falseFailures: 'Ложные падения',
  hiddenDefects: 'Скрытые дефекты',
  executed: 'Выполненные проверки',
  fastBurn: 'Burn rate короткого окна',
  slowBurn: 'Burn rate длинного окна',
  minimumCapacity: 'Минимальная мощность',
  peakReplicas: 'Максимум реплик',
  load: 'Нагрузка',
  estimatedLift: 'Оценённый прирост',
  standardizedLift: 'Прирост при одинаковом составе',
  aggregationBias: 'Смещение агрегации',
  conversion: 'Конверсия',
  expectedConversion: 'Ожидаемая конверсия',
  revenue: 'Выручка',
  expectedRevenue: 'Ожидаемая выручка',
  joinedRows: 'Строки после join',
  cohort: 'Размер когорты',
  pointInTime: 'Признаки доступны на момент прогноза',
  temporalValidation: 'Оценка учитывает время',
  businessOutcome: 'Бизнес-ограничения соблюдены',
  requiredUtility: 'Требования к результату выполнены',
  numericalParity: 'Численные результаты согласованы',
  decisionParity: 'Решения модели согласованы',
  latencySla: 'Ограничение задержки соблюдено',
  resourceSla: 'Ресурсов достаточно',
  qualitySla: 'Требование к качеству выполнено',
  criticalCoverage: 'Критичные сегменты покрыты',
  appropriateDecision: 'Решение соответствует результатам',
  recoverableRelease: 'Релиз можно восстановить',
  temporalIntegrity: 'Временная целостность сохранена',
  freshFeatures: 'Признаки актуальны',
  sufficientCoverage: 'Покрытие достаточно',
  explicitMissing: 'Пропуски обработаны явно',
  sourceContract: 'Контракт источников соблюдён',
  noInstructionExecution: 'Недоверенные инструкции не исполняются',
  factualAcceptance: 'Ответы подтверждены фактами',
  supportedCoverage: 'Подтверждённые вопросы покрыты',
  tokenEfficiency: 'Ограничение контекста соблюдено',
  preciseDetections: 'Точность детекций достаточна',
  completeDetections: 'Полнота детекций достаточна',
  heldoutDomain: 'Проверка на независимом источнике',
  transferQuality: 'Качество переноса достаточно',
  rankingQuality: 'Качество ранжирования достаточно',
  inventoryIntegrity: 'В выдаче доступные товары',
  queryMetric: 'Метрика считается по запросам',
  estimatorAccuracy: 'Оценка достаточно точна',
  overlapVerified: 'Overlap проверен',
  fullPairedSeries: 'Парные запуски учтены полностью',
  uncertaintyReported: 'Неопределённость отражена',
  justifiedClaim: 'Вывод подтверждён',
  comparableCompute: 'Вычислительные бюджеты сопоставимы',
  completeReport: 'Отчёт полный',
  appropriateClaim: 'Утверждение соответствует данным',
  correctBalances: 'Балансы корректны',
  scopedKeys: 'Ключи изолированы по клиентам',
  atomicRecovery: 'Восстановление атомарно',
  stableRetryIdentity: 'Идентичность повторов сохранена',
  accessIsolation: 'Доступ изолирован',
  consistentResponses: 'Ответы согласованы',
  currentResult: 'Отображён актуальный результат',
  lifecycleSafe: 'Жизненный цикл учтён',
  routeIsolation: 'Маршруты изолированы',
  stableIdentity: 'Идентичность элементов стабильна',
  renderBudget: 'Бюджет отрисовки соблюдён',
  monetaryIntegrity: 'Денежные значения сохранены',
  invalidIsolation: 'Некорректные данные изолированы',
  eventTimeIntegrity: 'Время события учтено',
  replaySafe: 'Повторы безопасны',
  lateDataPreserved: 'Опоздавшие данные сохранены',
  criticalRiskCovered: 'Критичный риск покрыт',
  affordablePortfolio: 'Портфель укладывается в бюджет',
  deterministicHealthyTests: 'Исправные тесты стабильны',
  defectsRemainVisible: 'Дефекты остаются видимыми',
  weightedTraffic: 'Трафик взвешен корректно',
  multiWindow: 'Оба окна учтены',
  appropriatePage: 'Решение об алерте обосновано',
  enoughCapacity: 'Мощности достаточно',
  withinQuota: 'Квота соблюдена',
  deploymentProgress: 'Обновление завершается',
  recoverable: 'Сбой восстанавливается',
  comparableComposition: 'Состав групп сопоставим',
  correctUnit: 'Единица анализа корректна',
  correctConversion: 'Конверсия корректна',
  correctRevenue: 'Выручка корректна',
  prescribedHorizon: 'Горизонт наблюдения соблюдён',
};

/** Translate a technical signal while preserving the server's numeric value and decision. */
export function resultLabel(name: string): string {
  return resultLabels[name] || name.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
}
