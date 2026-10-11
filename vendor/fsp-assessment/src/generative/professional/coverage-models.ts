import { m, q } from './catalog.js';

/** Three bounded work samples authored only after support audit exposed Junior coverage holes. */
export const qaLayerContract = m(
  'qa_layer_contract',
  'Проверка контракта тестового слоя',
  'strategy',
  'В проверке округления суммы используется нестабильный UI-тест. Даны трасса запроса, независимый расчёт и границы ответственности слоёв. Выберите локальное подтверждение бизнес-правила, сохранив отдельную проверку доставки ответа и доступности формы.',
  'const testContract = { oracle: "{{0}}", input: "{{1}}", layer: "{{2}}", scope: "{{3}}" };\n// trace: request.amount=10.005; response.amount=10.01\n// expected rounding: decimal half-up, not binary float equality',
  [
    q(
      'Oracle отражает правило округления, а не случайный текст DOM',
      'decimal-contract',
      'dom-snapshot-only',
      'Проверить бизнес-результат независимым decimal oracle по заданному правилу округления.',
      'test_run',
    ),
    q(
      'Boundary input действительно достигает business handler',
      'boundary-reaches-handler',
      'ui-coerces-input',
      'Передать граничное значение непосредственно в контрактный тест и подтвердить его по trace.',
      'ci_log',
    ),
    q(
      'Выбранный слой наблюдает бизнес-результат независимо от анимации',
      'contract-layer',
      'animation-dependent-ui',
      'Разместить проверку округления на contract layer; UI доставку проверить отдельным тестом.',
      'test_run',
    ),
    q(
      'Локальная замена не удаляет проверку доступности и доставки',
      'independent-ui-check-retained',
      'all-ui-checks-removed',
      'Сохранить независимые UI-проверки пользовательского пути при замене локального oracle.',
      'table',
    ),
  ],
  ['Тест', 'API handler', 'Ответ'],
);

export const mlCandidateGate = m(
  'ml_candidate_gate',
  'Допуск одного model artifact',
  'deployment',
  'Один кандидат модели подготовлен к локальному serving test. Даны manifest, feature schema, независимые validation rows и предел inference latency. Решение касается допуска этого artifact; rollout между сегментами и политика retraining остаются вне задачи.',
  'const gate = { features: "{{0}}", validation: "{{1}}", preprocessing: "{{2}}", latency: "{{3}}" };\n// serving row: amount_currency=RUB, amount_decimal=10.01\n// model manifest: feature_schema=decimal-v2; p95 budget=40ms',
  [
    q(
      'Serving features соответствуют manifest модели',
      'decimal-v2',
      'minor-units-v1',
      'Согласовать единицы и feature schema с manifest до локального serving test.',
      'feature_distribution',
    ),
    q(
      'Validation row не использовалась для обучения кандидата',
      'independent-validation',
      'training-row-reused',
      'Проверить artifact на независимой validation row с подтверждённым split.',
      'model_metrics',
    ),
    q(
      'Serving preprocessing повторяет проверенное преобразование',
      'manifest-preprocessing',
      'serving-defaults',
      'Применить версию preprocessing из manifest и сверить преобразованные features.',
      'lineage',
    ),
    q(
      'Измеренная задержка укладывается в заданный локальный budget',
      'within-40ms',
      'above-40ms',
      'Проверить допустимую конфигурацию inference на тех же входах до допуска artifact.',
      'metrics',
    ),
  ],
  ['Manifest', 'Serving test', 'Validation result'],
);

export const dsClaimBoundary = m(
  'ds_claim_boundary',
  'Граница вывода по одной выборке',
  'causality',
  'Таблица сравнивает покупки пользователей, добровольно выбравших новый экран, с остальными. Возраст и прежняя активность групп различаются; рандомизации не было. По исходным строкам и описанию отбора составьте ограниченный вывод для этой выборки. Общая бизнес-стратегия и дизайн нового эксперимента не входят в задачу.',
  'const report = { claim: "{{0}}", population: "{{1}}", comparison: "{{2}}", interval: "{{3}}" };\n// opted-in: n=100, prior_active=80%, purchases=30\n// other: n=100, prior_active=20%, purchases=15\n// assignment: voluntary; measured period: one week',
  [
    q(
      'Описание не превращает наблюдаемую связь в причинный эффект',
      'association-only',
      'causal-effect-claimed',
      'Ограничить формулировку наблюдаемой связью; добровольный выбор не устраняет confounding.',
      'experiment_table',
    ),
    q(
      'Популяция вывода совпадает с наблюдаемой выборкой',
      'observed-users',
      'all-future-users',
      'Указать наблюдаемую популяцию и период, не переносить вывод на неподдерживаемых пользователей.',
      'table',
    ),
    q(
      'Состав групп учтён при интерпретации разницы',
      'composition-explicit',
      'composition-ignored',
      'Показать различие прежней активности и не приписывать всю разницу новому экрану.',
      'experiment_table',
    ),
    q(
      'Неопределённость результата не заменяется гарантией',
      'uncertainty-explicit',
      'guaranteed-uplift',
      'Сохранить ограничение наблюдательных данных и не обещать гарантированный прирост.',
      'table',
    ),
  ],
  ['Строки выборки', 'Правило отбора', 'Ограниченный вывод'],
);
