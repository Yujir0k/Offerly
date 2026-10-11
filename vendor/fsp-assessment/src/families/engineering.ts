import { random } from '../random.js';
import type { LabData, LabRow } from '../domain.js';
import {
  choice,
  level,
  mean,
  multi,
  num,
  numeric,
  select,
  value,
  type Family,
  type Theory,
} from './core.js';

const theory = (
  prompt: string,
  correct: string,
  wrong: string,
  other: string,
  skill: string,
): Theory => ({ prompt, options: [correct, wrong, other], correct: 0, skill });
const yesNo = (id: string, label: string) =>
  select(id, label, [
    ['no', 'Нет'],
    ['yes', 'Да'],
  ]);
const data = (rows: LabRow[], parameters: LabData['parameters'] = {}): LabData => ({
  rows,
  parameters,
});

const legacyPayments: Family = {
  id: 'backend-payment-idempotency',
  trackId: 'backend',
  title: 'Платежи: tenant-scoped idempotency и восстановление после сбоя',
  skills: ['reliability', 'data', 'delivery'],
  build(grade, seed) {
    const rng = random(seed);
    const rows: LabRow[] = [];
    for (let tenant = 0; tenant < 2 + level(grade); tenant++)
      for (let event = 0; event < 3; event++) {
        const amount = Math.floor(rng() * 800 + 100);
        rows.push(
          { tenant, event, amount, failAfterWrite: event === 1 },
          { tenant, event, amount, failAfterWrite: false },
        );
      }
    return {
      data: data(rows),
      changedData: data([...rows].reverse().concat(rows.slice(0, 4))),
      controls: [
        select('key', 'Ключ повторной операции', [
          ['event', 'Только event ID'],
          ['tenant-event', 'Tenant и event ID'],
          ['none', 'Каждая попытка новая'],
        ]),
        select('transaction', 'Запись эффекта и маркера', [
          ['separate', 'Раздельные записи'],
          ['atomic', 'Одна атомарная операция'],
        ]),
        select('retry', 'Повтор после неизвестного исхода', [
          ['new-id', 'Создать новую операцию'],
          ['same-id', 'Повторить исходную операцию'],
        ]),
      ],
      contract:
        'Event ID уникален только внутри tenant. Сумма каждого уникального (tenant,event) учитывается один раз. При failAfterWrite происходит сбой между эффектом и маркером, если запись раздельная. Повтор сохраняет исходный ключ.',
      change:
        'События пришли в обратном порядке, часть попыток повторилась. Сбой остаётся в исходной операции.',
      rubric: ['Изоляция tenants', 'Атомарность эффекта', 'Корректное восстановление'],
      theory: [
        theory(
          'Какой ключ соответствует контракту?',
          'Tenant и event ID',
          'Только event ID',
          'Новая случайная строка при каждом повторе',
          'data',
        ),
        theory(
          'Как защитить эффект и маркер обработки?',
          'Записать атомарно',
          'Записать маркер позже без транзакции',
          'Добавить длинный timeout',
          'reliability',
        ),
        theory(
          'Что делать после неизвестного исхода?',
          'Повторить с исходным idempotency key',
          'Всегда создать новый платёж',
          'Удалить историю',
          'delivery',
        ),
        theory(
          'Как доказать корректность?',
          'Проверить итог каждого tenant на повторах и сбоях',
          'Проверить только успешный ответ',
          'Посчитать попытки',
          'validation',
        ),
      ],
    };
  },
  run(input, plan) {
    const ledger = new Map<string, number>();
    const seen = new Set<string>();
    const expected = new Map<string, number>();
    const processedUnique = new Set<string>();
    let duplicates = 0;
    let attempt = 0;
    for (const row of input.rows) {
      const actualKey = `${row.tenant}:${row.event}`;
      if (!processedUnique.has(actualKey)) {
        expected.set(
          String(row.tenant),
          (expected.get(String(row.tenant)) ?? 0) + num(row, 'amount'),
        );
        processedUnique.add(actualKey);
      }
      const key =
        choice(plan, 'key') === 'none'
          ? `attempt-${attempt++}`
          : choice(plan, 'key') === 'event'
            ? String(row.event)
            : actualKey;
      const apply = (retryKey: string, failing: boolean) => {
        if (seen.has(retryKey)) {
          duplicates++;
          return;
        }
        ledger.set(String(row.tenant), (ledger.get(String(row.tenant)) ?? 0) + num(row, 'amount'));
        if (!failing || choice(plan, 'transaction') === 'atomic') seen.add(retryKey);
      };
      apply(key, Boolean(row.failAfterWrite));
      if (row.failAfterWrite)
        apply(choice(plan, 'retry') === 'same-id' ? key : `${key}-retry-${attempt++}`, false);
    }
    const wrongTenants = [...expected].filter(
      ([tenant, balance]) => ledger.get(tenant) !== balance,
    ).length;
    const error = [...expected].reduce(
      (sum, [tenant, balance]) => sum + Math.abs((ledger.get(tenant) ?? 0) - balance),
      0,
    );
    return {
      metrics: {
        wrongTenants,
        ledgerError: error,
        deduplicatedAttempts: duplicates,
        tenants: expected.size,
      },
      checks: {
        correctBalances: error === 0,
        scopedKeys: choice(plan, 'key') === 'tenant-event',
        atomicRecovery: choice(plan, 'transaction') === 'atomic',
        stableRetryIdentity: choice(plan, 'retry') === 'same-id',
      },
      explanation:
        'Ledger и маркеры обработки проиграны с промежуточным сбоем; сравнение выполнено с суммой уникальных операций каждого tenant.',
    };
  },
};

const payments: Family = {
  ...legacyPayments,
  build(grade, seed) {
    const fixture = legacyPayments.build(grade, seed);
    const globalIds = seed % 3 === 0;
    const externalEffect = grade !== 'Junior' && seed % 2 === 0;
    const retries = 1 + (seed % level(grade));
    const changedRetries = grade === 'Junior' ? retries : 1 + ((seed + 1) % level(grade));
    const enrich = (input: LabData, requiredRetries: number, external: boolean): LabData => ({
      rows: input.rows.map((row) => ({
        ...row,
        event: globalIds ? num(row, 'tenant') * 100 + num(row, 'event') : row.event!,
        failuresBeforeSuccess: row.failAfterWrite ? requiredRetries : 0,
      })),
      parameters: {
        globalIds,
        externalEffect: external,
        requiredRetries,
        maxRetryBudget: requiredRetries,
      },
    });
    return {
      ...fixture,
      data: enrich(fixture.data, retries, externalEffect),
      changedData: enrich(
        fixture.changedData,
        changedRetries,
        grade === 'Senior' ? !externalEffect : externalEffect,
      ),
      controls: [
        ...fixture.controls.map((control) =>
          control.id === 'transaction'
            ? select('transaction', 'Фиксация результата', [
                ['separate', 'Раздельные записи'],
                ['atomic', 'Локальная транзакция'],
                ['outbox', 'Outbox и ключ провайдера'],
              ])
            : control,
        ),
        numeric(
          'retryLimit',
          'Допустимое число повторов',
          [0, 1, 2, 3],
          'Сверьте число временных отказов и бюджет из условий.',
        ),
      ],
      contract: `${globalIds ? 'Event ID уникален во всей системе; контракт требует использовать исходный event ID как ключ провайдера.' : 'Event ID уникален только внутри tenant; ключом операции является пара tenant и event ID.'} ${externalEffect ? 'Эффект исполняется внешним провайдером: локальная транзакция не охватывает внешний вызов. Нужен outbox с идемпотентным ключом провайдера.' : 'Эффект и маркер находятся в одной базе; контракт требует атомарную локальную транзакцию без дополнительного outbox.'} В failuresBeforeSuccess указано число временных отказов. Настройте достаточно повторов для доставки; максимальный бюджет повторов ${retries}. Сумма каждой операции учитывается один раз.`,
      change: `${fixture.change} Максимальный бюджет повторов теперь ${changedRetries}. ${grade === 'Senior' ? `Исполнение эффекта перенесено ${externalEffect ? 'в локальную базу: используйте локальную транзакцию' : 'к внешнему провайдеру: используйте outbox и ключ провайдера'}.` : 'Место исполнения эффекта сохраняется.'}`,
      rubric: [
        ...fixture.rubric,
        'Доставка в пределах бюджета повторов',
        'Выбор границы транзакции по контракту',
      ],
      theory: [
        theory(
          `Какой ключ требуется контрактом этого варианта? ${globalIds ? 'Идентификаторы глобально уникальны.' : 'Идентификаторы повторяются между tenant.'}`,
          globalIds ? 'Только event ID' : 'Tenant и event ID',
          globalIds ? 'Произвольный составной ключ вместо ключа провайдера' : 'Только event ID',
          'Новый случайный ключ на каждом повторе',
          'data',
        ),
        theory(
          `Где нужно обеспечить надёжную фиксацию? ${externalEffect ? 'Провайдер находится вне нашей базы.' : 'Обе записи находятся в одной базе.'}`,
          externalEffect ? 'Outbox и идемпотентный ключ провайдера' : 'Одна локальная транзакция',
          externalEffect ? 'Только локальная транзакция' : 'Раздельные записи без транзакции',
          'Увеличить timeout без изменения протокола',
          'reliability',
        ),
        theory(
          `В журнале до успеха происходит ${retries} временных отказа; бюджет составляет ${retries}. Какой лимит повторов нужен?`,
          String(retries),
          '0',
          String(retries + 1),
          'delivery',
        ),
        fixture.theory[3]!,
      ],
    };
  },
  run(input, plan) {
    if (!('globalIds' in input.parameters)) return legacyPayments.run(input, plan);
    const key = input.parameters.globalIds ? 'event' : 'tenant-event';
    const transaction = input.parameters.externalEffect ? 'outbox' : 'atomic';
    const transformed = {
      ...plan,
      key: choice(plan, 'key') === key ? 'tenant-event' : choice(plan, 'key'),
      transaction: choice(plan, 'transaction') === transaction ? 'atomic' : 'separate',
    };
    const result = legacyPayments.run(input, transformed);
    const limit = value(plan, 'retryLimit');
    const required = Number(input.parameters.requiredRetries);
    const budget = Number(input.parameters.maxRetryBudget);
    return {
      ...result,
      metrics: { ...result.metrics, requiredRetries: required, configuredRetries: limit },
      checks: {
        ...result.checks,
        scopedKeys: choice(plan, 'key') === key,
        atomicRecovery: choice(plan, 'transaction') === transaction,
        deliveryWithinBudget: limit >= required && limit <= budget,
      },
      explanation: `${result.explanation} Проверены граница транзакции и доставка после ${required} временных отказов в бюджете ${budget} повторов.`,
    };
  },
};

const cache: Family = {
  id: 'backend-cache-isolation',
  trackId: 'backend',
  title: 'Кэш API: изоляция tenants, авторизация и смена версии',
  skills: ['data', 'reliability', 'delivery'],
  build(grade, seed) {
    const rng = random(seed);
    const rows: LabRow[] = [];
    for (let round = 0; round < 2 + level(grade); round++)
      for (let tenant = 0; tenant < 2; tenant++)
        rows.push(
          {
            tenant,
            resource: 'account',
            version: round + 1,
            value: tenant * 1000 + round * 10 + Math.floor(rng() * 5),
            allowed: true,
          },
          {
            tenant,
            resource: 'account',
            version: round + 1,
            value: tenant * 1000 + round * 10,
            allowed: false,
          },
        );
    return {
      data: data(rows),
      changedData: data([...rows].reverse()),
      controls: [
        select('key', 'Ключ кэша', [
          ['resource', 'Только ресурс'],
          ['tenant-resource', 'Tenant и ресурс'],
        ]),
        select('invalidation', 'Обновление кэша', [
          ['ttl-only', 'Использовать первое значение'],
          ['version', 'Проверять версию данных'],
        ]),
        select('auth', 'Когда проверять доступ?', [
          ['miss-only', 'Только при cache miss'],
          ['every-request', 'До ответа на каждый запрос'],
        ]),
      ],
      contract:
        'Чужой tenant и denied-запрос не получают значение. Для разрешённого запроса актуальное значение определяется его version. Кэш не заменяет проверку доступа. Поле value в denied-строке не используется.',
      change:
        'Порядок запросов изменился: запрещённый запрос может прийти до разрешённого, версии идут в обратном порядке.',
      rubric: ['Изоляция ключа', 'Свежесть значения', 'Доступ на каждом запросе'],
      theory: [
        theory(
          'Может cache hit отменить авторизацию?',
          'Нет, доступ проверяется до каждого ответа',
          'Да, запись уже проверялась',
          'Да для быстрых запросов',
          'reliability',
        ),
        theory(
          'Что должен включать ключ здесь?',
          'Tenant и ресурс',
          'Только имя ресурса',
          'Только TTL',
          'data',
        ),
        theory(
          'Как проверять смену данных?',
          'Сопоставлять версию ответа с запросом',
          'Только число cache hits',
          'Только размер кэша',
          'delivery',
        ),
        theory(
          'Какой тест важен для безопасности?',
          'Другой tenant и denied-запрос на cache hit',
          'Только cache miss',
          'Только успешная авторизация',
          'experiments',
        ),
      ],
    };
  },
  run(input, plan) {
    const entries = new Map<string, LabRow>();
    let leaks = 0;
    let stale = 0;
    let hits = 0;
    const trace: string[] = [];
    for (const row of input.rows) {
      const key =
        choice(plan, 'key') === 'resource' ? String(row.resource) : `${row.tenant}:${row.resource}`;
      let cached = entries.get(key);
      const hit = Boolean(cached);
      if (hit) hits++;
      if (!row.allowed && (choice(plan, 'auth') === 'every-request' || !hit)) continue;
      if (
        !cached ||
        (choice(plan, 'invalidation') === 'version' && cached.version !== row.version)
      ) {
        cached = row;
        entries.set(key, row);
      }
      if (!row.allowed || cached.tenant !== row.tenant) {
        leaks++;
        if (trace.length < 8)
          trace.push(
            !row.allowed
              ? `[WARN] Cache hit returned for tenant_id=${row.tenant} without token re-validation.`
              : `[WARN] Tenant isolation violated: tenant_id=${row.tenant} received cached data from tenant_id=${cached.tenant}.`,
          );
      }
      if (row.allowed && (cached.version !== row.version || cached.value !== row.value)) {
        stale++;
        if (trace.length < 8)
          trace.push(
            cached.version !== row.version
              ? `[WARN] Stale cache response: version v${cached.version} returned instead of v${row.version}.`
              : `[WARN] Cached value mismatch for tenant_id=${row.tenant} at version v${row.version}.`,
          );
      }
    }
    return {
      metrics: { unauthorizedResponses: leaks, staleResponses: stale, hits },
      trace: trace.length
        ? trace
        : [`[INFO] ${hits} cache hits inspected; access and version checks passed.`],
      checks: { accessIsolation: leaks === 0, consistentResponses: stale === 0 },
      explanation:
        'Каждый запрос обработан через кэш с выбранными правилами; проверены авторизация, tenant и версия.',
    };
  },
};

const requestRace: Family = {
  id: 'frontend-request-races',
  trackId: 'frontend',
  title: 'Асинхронный интерфейс: гонки запросов и unmount',
  skills: ['reliability', 'delivery', 'evaluation'],
  build(grade, seed) {
    const rng = random(seed);
    const rows = Array.from({ length: 3 + level(grade) }, (_, index) => ({
      request: index,
      issued: index * 10,
      completed: index * 10 + (index === 0 ? 70 : 3 + Math.floor(rng() * 8)),
      route: index < 2 ? 'search' : 'detail',
    }));
    return {
      data: data(rows, { unmount: 1000 }),
      changedData: data(
        rows.map((row) => ({ ...row, completed: row.completed + 35 })),
        { unmount: 45 },
      ),
      controls: [
        select('responses', 'Приёмка ответа', [
          ['all', 'Каждый пришедший ответ'],
          ['request-id', 'Только актуальный request ID'],
        ]),
        yesNo('cleanup', 'Очистить подписку после unmount'),
        select('key', 'Контекст запроса', [
          ['global', 'Один глобальный номер'],
          ['route-id', 'Route и request ID'],
        ]),
      ],
      contract:
        'Актуален последний выданный запрос каждой route. Ответ старого request ID не изменяет состояние. После unmount записи состояния запрещены. Разные routes имеют независимые запросы.',
      change:
        'Ответы стали медленнее, unmount происходит на 45 мс. Проверьте отсутствие записей после ухода пользователя.',
      rubric: ['Актуальность результата', 'Независимость routes', 'Очистка жизненного цикла'],
      theory: [
        theory(
          'Какой ответ имеет право обновить поиск?',
          'Ответ актуального request ID этой route',
          'Последний пришедший ответ',
          'Первый самый медленный',
          'reliability',
        ),
        theory(
          'Что делать после unmount?',
          'Остановить или игнорировать обновления состояния',
          'Продолжить render',
          'Обнулить только счётчик ошибок',
          'delivery',
        ),
        theory(
          'Почему глобального ID может не хватить?',
          'У независимых routes разные актуальные запросы',
          'Он всегда слишком длинный',
          'Он запрещён языком',
          'reasoning',
        ),
        theory(
          'Как проверить гонку?',
          'Управляемо переставить порядок завершения',
          'Запустить один быстрый запрос',
          'Проверить только UI-текст',
          'experiments',
        ),
      ],
    };
  },
  run(input, plan) {
    const state = new Map<string, number>();
    let postUnmount = 0;
    let staleWrites = 0;
    const newestAt = (row: LabRow, perRoute: boolean) =>
      input.rows
        .filter(
          (entry) =>
            (!perRoute || entry.route === row.route) &&
            num(entry, 'issued') <= num(row, 'completed'),
        )
        .sort(
          (a, b) => num(b, 'issued') - num(a, 'issued') || num(b, 'request') - num(a, 'request'),
        )[0]?.request;
    for (const row of [...input.rows].sort((a, b) => num(a, 'completed') - num(b, 'completed'))) {
      if (
        num(row, 'completed') >= num(input.parameters, 'unmount') &&
        choice(plan, 'cleanup') === 'yes'
      )
        continue;
      if (
        choice(plan, 'responses') === 'request-id' &&
        row.request !== newestAt(row, choice(plan, 'key') === 'route-id')
      )
        continue;
      if (num(row, 'completed') >= num(input.parameters, 'unmount')) postUnmount++;
      staleWrites += row.request !== newestAt(row, true) ? 1 : 0;
      state.set(String(row.route), num(row, 'request'));
    }
    const routes = [...new Set(input.rows.map((row) => String(row.route)))];
    const missing = routes.filter(
      (route) =>
        !state.has(route) &&
        input.rows.some(
          (row) =>
            row.route === route &&
            row.request === newestAt(row, true) &&
            num(row, 'completed') < num(input.parameters, 'unmount'),
        ),
    ).length;
    return {
      metrics: {
        staleWrites,
        postUnmountWrites: postUnmount,
        missingRoutes: missing,
        renderedRoutes: state.size,
      },
      checks: {
        currentResult: staleWrites === 0 && missing === 0,
        lifecycleSafe: postUnmount === 0,
        routeIsolation: choice(plan, 'key') === 'route-id',
      },
      explanation:
        'Очередь завершения запросов воспроизведена по timestamp, включая уход со страницы.',
    };
  },
};

const listState: Family = {
  id: 'frontend-list-reconciliation',
  trackId: 'frontend',
  title: 'Список: стабильные ключи, сохранение состояния и виртуализация',
  skills: ['reliability', 'evaluation', 'cost'],
  build(grade, seed) {
    const rng = random(seed);
    const n = 20 + level(grade) * 20;
    const rows = Array.from({ length: n }, (_, index) => ({
      id: `item-${index}`,
      state: Math.floor(rng() * 100),
      nextPosition: n - index - 1,
    }));
    return {
      data: data(rows, { maxRendered: 20 }),
      changedData: data(
        rows
          .filter((_row, index) => index % 3 !== 0)
          .map((row, index) => ({ ...row, nextPosition: index })),
        { maxRendered: 20 },
      ),
      controls: [
        select('keys', 'Ключ компонента строки', [
          ['index', 'Позиция в списке'],
          ['id', 'Идентификатор сущности'],
        ]),
        numeric('window', 'Количество строк в окне', [10, 20, 100]),
        select('state', 'Хранение редактируемого значения', [
          ['position', 'Привязка к позиции'],
          ['entity', 'Привязка к сущности'],
        ]),
      ],
      contract:
        'Состояние строки принадлежит item ID и сохраняется при перестановке/удалении соседей. Не больше 20 строк одновременно в модели render-окна. Оценка считает операции и перенос состояния, а не реальное browser p95.',
      change:
        'Удалена каждая третья сущность и пересчитаны позиции. Проверьте сохранение оставшихся значений.',
      rubric: [
        'Корректная идентичность',
        'Сохранение локального состояния',
        'Ограниченный render-объём',
      ],
      theory: [
        theory(
          'Когда index-key опасен?',
          'При изменении порядка и локальном состоянии',
          'Только при большом шрифте',
          'Всегда запрещён компилятором',
          'reliability',
        ),
        theory(
          'Что принадлежит редактируемой строке?',
          'Состояние конкретной сущности',
          'Текущий номер позиции',
          'Название страницы',
          'reasoning',
        ),
        theory(
          'Что ограничивает виртуализация?',
          'Одновременный объём render-элементов',
          'Количество записей в базе',
          'Права доступа',
          'cost',
        ),
        theory(
          'Как проверить reconciliation?',
          'Переставить и удалить строки с известным состоянием',
          'Посмотреть первый экран',
          'Проверить только CSS',
          'evaluation',
        ),
      ],
    };
  },
  run(input, plan) {
    const ordered = [...input.rows].sort((a, b) => num(a, 'nextPosition') - num(b, 'nextPosition'));
    const original = [...input.rows].sort((a, b) =>
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true }),
    );
    let wrong = 0;
    for (let index = 0; index < ordered.length; index++) {
      const row = ordered[index]!;
      const identity = choice(plan, 'keys') === 'id' && choice(plan, 'state') === 'entity';
      const state = identity ? row.state : original[index]?.state;
      if (state !== row.state) wrong++;
    }
    const rendered = Math.min(value(plan, 'window'), input.rows.length);
    return {
      metrics: { misassignedStates: wrong, renderedRows: rendered, totalRows: input.rows.length },
      checks: {
        stableIdentity:
          wrong === 0 && choice(plan, 'keys') === 'id' && choice(plan, 'state') === 'entity',
        renderBudget: rendered <= num(input.parameters, 'maxRendered'),
      },
      explanation:
        'В модели reconciliation состояния сопоставлены после перестановки. Виртуализация проверяется по числу элементов, не по выдуманным миллисекундам.',
    };
  },
};

function cents(raw: string): number {
  const match = raw.match(/^(-?)(\d+)\.(\d{2})$/);
  if (!match) throw new Error('Некорректная денежная строка');
  return Number(BigInt(match[2]!) * 100n + BigInt(match[3]!)) * (match[1] ? -1 : 1);
}
const cdc: Family = {
  id: 'de-cdc-schema-money',
  trackId: 'data-engineering',
  title: 'CDC: decimal, schema evolution и повторная загрузка',
  skills: ['data', 'reliability', 'delivery'],
  build(grade, seed) {
    const rng = random(seed);
    const rows: LabRow[] = [];
    for (let index = 0; index < 8 + level(grade) * 5; index++) {
      const units = Math.floor(rng() * 9000 + 100);
      const raw = `${Math.floor(units / 100)}.${String(units % 100).padStart(2, '0')}`;
      rows.push(
        { id: index, schema: index % 2 ? 2 : 1, amount: index % 2 ? raw : units, valid: true },
        { id: index, schema: index % 2 ? 2 : 1, amount: index % 2 ? raw : units, valid: true },
      );
    }
    rows.push({ id: 999, schema: 2, amount: 'invalid', valid: false });
    return {
      data: data(rows),
      changedData: data(
        [...rows].reverse().concat([{ id: 1000, schema: 2, amount: '0.29', valid: true }]),
      ),
      controls: [
        select('decoder', 'Декодирование суммы', [
          ['coerce', 'Привести все схемы к Number'],
          ['schema-cents', 'V1 cents; V2 точный decimal в cents'],
        ]),
        yesNo('dedupe', 'Убрать повторы по ID'),
        select('invalid', 'Некорректная запись', [
          ['zero', 'Подставить ноль'],
          ['quarantine', 'В отдельную очередь ошибок'],
        ]),
      ],
      contract:
        'V1 содержит integer cents. V2 содержит строку decimal с двумя знаками. Один ID учитывается один раз. Некорректные значения должны быть помещены в quarantine и не попадать в основную таблицу.',
      change:
        'Повторы пришли в другом порядке, добавилась V2-запись 0.29. Проверьте сумму и контроль ошибок.',
      rubric: ['Контракт схемы', 'Точный денежный результат', 'Повторная обработка и quarantine'],
      theory: [
        theory(
          'Что меняется при schema evolution?',
          'Правила декодирования и контракт совместимости',
          'Только название таблицы',
          'Ничего для чисел',
          'data',
        ),
        theory(
          'Как декодировать 0.29 в cents без float-ошибки?',
          'Разобрать целую и дробную части как integers',
          'Округлить любую строку до integer',
          'Принять 0.29 за 0 cents',
          'data',
        ),
        theory(
          'Что делать с invalid?',
          'Зафиксировать ошибку отдельно от основной таблицы',
          'Незаметно заменить нулём',
          'Удалить весь поток',
          'delivery',
        ),
        theory(
          'Как проверить replay?',
          'Повторить ID и проверить неизменность итогов',
          'Считать все попытки новыми строками',
          'Сменить ID всех записей',
          'reliability',
        ),
      ],
    };
  },
  run(input, plan) {
    const seen = new Set<string>();
    let total = 0;
    let quarantine = 0;
    let invalidMain = 0;
    let expected = 0;
    const unique = new Set<string>();
    for (const row of input.rows) {
      const id = String(row.id);
      if (row.valid && !unique.has(id)) {
        unique.add(id);
        expected += row.schema === 1 ? num(row, 'amount') : cents(String(row.amount));
      }
      if (choice(plan, 'dedupe') === 'yes' && seen.has(id)) continue;
      seen.add(id);
      if (!row.valid) {
        if (choice(plan, 'invalid') === 'quarantine') quarantine++;
        else invalidMain++;
        continue;
      }
      total +=
        choice(plan, 'decoder') === 'schema-cents'
          ? row.schema === 1
            ? num(row, 'amount')
            : cents(String(row.amount))
          : Number(row.amount);
    }
    return {
      metrics: {
        totalCents: total,
        expectedCents: expected,
        absoluteError: Math.abs(total - expected),
        quarantined: quarantine,
        invalidMain,
      },
      checks: {
        monetaryIntegrity: total === expected,
        invalidIsolation: invalidMain === 0 && quarantine > 0,
      },
      explanation:
        'Каждая запись декодирована по выбранной схеме; точный decimal-парсер использует целочисленные разряды.',
    };
  },
};

const windows: Family = {
  id: 'de-event-time-windows',
  trackId: 'data-engineering',
  title: 'Streaming: event time, late data и коррекция агрегатов',
  skills: ['data', 'reliability', 'experiments'],
  build(grade, seed) {
    const rng = random(seed);
    const rows: LabRow[] = [];
    for (let index = 0; index < 8 + level(grade) * 5; index++) {
      const event = index * 2;
      const row = {
        id: index,
        event,
        arrival: event + (index % 3 === 0 ? 12 : 1),
        amount: Math.floor(rng() * 20 + 1),
      };
      rows.push(row);
      if (index % 4 === 0) rows.push({ ...row, arrival: row.arrival + 2 });
    }
    const make = (changed: boolean) =>
      data(
        rows
          .map((row) => ({
            ...row,
            arrival: num(row, 'arrival') + (changed && num(row, 'id') % 2 === 0 ? 16 : 0),
          }))
          .sort((a, b) => num(a, 'arrival') - num(b, 'arrival')),
        { windowMinutes: 10 },
      );
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        select('clock', 'Время окна', [
          ['arrival', 'Время доставки'],
          ['event', 'Время события'],
        ]),
        numeric('lateness', 'Допустимая задержка, минуты', [0, 5, 15]),
        select('late', 'Поздняя запись', [
          ['drop', 'Отбросить после watermark'],
          ['correct', 'Скорректировать исторический агрегат'],
        ]),
        yesNo('dedupe', 'Дедупликация по ID'),
      ],
      contract:
        'Итог каждого 10-минутного окна должен совпадать с суммой уникальных событий по event time. Поздние данные требуют корректировки. Arrival нужен для порядка обработки, не для принадлежности к окну.',
      change:
        'Часть событий задержалась ещё на 16 минут. Проверьте исторические окна после окончания потока.',
      rubric: ['Правильные временные окна', 'Late-data correction', 'Дедупликация'],
      theory: [
        theory(
          'Какое время определяет окно по контракту?',
          'Event time',
          'Arrival time',
          'Время запуска сервера',
          'data',
        ),
        theory(
          'Что означает watermark?',
          'Границу ожидания в обработке, а не истинность данных',
          'Запрет исправлять ошибки',
          'Новый ID события',
          'reliability',
        ),
        theory(
          'Что делать с late data здесь?',
          'Скорректировать исходное окно',
          'Перенести в текущее окно',
          'Всегда удалить',
          'delivery',
        ),
        theory(
          'Как проверить агрегат?',
          'Сравнить с уникальными event-time событиями',
          'Посчитать сообщения',
          'Проверить только последний batch',
          'experiments',
        ),
      ],
    };
  },
  run(input, plan) {
    const expected = new Map<number, number>();
    const expectedIds = new Set<string>();
    const actual = new Map<number, number>();
    const seen = new Set<string>();
    let watermark = -Infinity;
    let dropped = 0;
    for (const row of input.rows) {
      const id = String(row.id);
      const event = num(row, 'event');
      const amount = num(row, 'amount');
      const expectedWindow = Math.floor(event / num(input.parameters, 'windowMinutes'));
      if (!expectedIds.has(id)) {
        expectedIds.add(id);
        expected.set(expectedWindow, (expected.get(expectedWindow) ?? 0) + amount);
      }
      if (choice(plan, 'dedupe') === 'yes' && seen.has(id)) continue;
      seen.add(id);
      if (event < watermark - value(plan, 'lateness') && choice(plan, 'late') === 'drop') {
        dropped++;
        continue;
      }
      watermark = Math.max(watermark, event);
      const bucket = Math.floor(
        num(row, choice(plan, 'clock')) / num(input.parameters, 'windowMinutes'),
      );
      actual.set(bucket, (actual.get(bucket) ?? 0) + amount);
    }
    const error = [...new Set([...actual.keys(), ...expected.keys()])].reduce(
      (sum, key) => sum + Math.abs((actual.get(key) ?? 0) - (expected.get(key) ?? 0)),
      0,
    );
    return {
      metrics: { aggregateError: error, droppedEvents: dropped, windows: actual.size },
      checks: {
        eventTimeIntegrity: error === 0,
        replaySafe: choice(plan, 'dedupe') === 'yes',
        lateDataPreserved: dropped === 0,
      },
      explanation:
        'Поток обработан по arrival; watermark и коррекции применены к реальным event-time окнам.',
    };
  },
};

function mutationFailures(testName: string, mutation: string, amount: number): boolean {
  const charge = (attempts: number, tenants: number) =>
    mutation === 'duplicates'
      ? amount * attempts * tenants
      : mutation === 'tenant'
        ? amount
        : amount * tenants;
  if (testName === 'duplicates') return charge(2, 1) !== amount;
  if (testName === 'tenants') return charge(1, 2) !== amount * 2;
  if (testName === 'crash') {
    const markerWritten = mutation !== 'atomicity';
    return (markerWritten ? amount : amount * 2) !== amount;
  }
  if (testName === 'negative') {
    const accepted = mutation === 'negative';
    return accepted;
  }
  return false;
}
const testPortfolio: Family = {
  id: 'qa-mutation-risk',
  trackId: 'qa',
  title: 'QA: mutation testing и портфель проверок по риску',
  skills: ['evaluation', 'experiments', 'reliability'],
  build(grade, seed) {
    const rng = random(seed);
    const rows = ['duplicates', 'tenant', 'atomicity', 'negative'].map((mutation, index) => ({
      mutation,
      risk: index < 2 ? 10 : 8,
      cost: index < 2 ? 2 : 1,
      amount: Math.floor(rng() * 900 + 100),
    }));
    return {
      data: data(rows, { maxCost: 6, requiredRisk: 36 }),
      changedData: data(
        rows.map((row) => ({ ...row, amount: row.amount * (level(grade) + 1) })),
        { maxCost: 6, requiredRisk: 36 },
      ),
      controls: [
        multi('tests', 'Проверки портфеля', [
          ['smoke', 'Smoke успешного платежа'],
          ['duplicates', 'Повтор одного события'],
          ['tenants', 'Одинаковый ID разных tenants'],
          ['crash', 'Сбой между эффектом и маркером'],
          ['negative', 'Отрицательная сумма'],
        ]),
        select('oracle', 'Критерий теста', [
          ['status', 'Только HTTP 200'],
          ['invariants', 'Фактический ledger и отказ от invalid'],
        ]),
      ],
      contract:
        'Критичные мутации: дубликаты, tenant collision, раздельная запись, отрицательная сумма. Нужно обнаружить risk=36 при cost<=6. Smoke стоит 1 и не покрывает критичные мутации. Тест должен проверять результат, а не только статус.',
      change: 'Суммы операций увеличились. Повторите контрпримеры, сохраняя инварианты.',
      rubric: ['Обнаружение реальных мутаций', 'Риск и бюджет проверок', 'Содержательный oracle'],
      theory: [
        theory(
          'Что доказывает mutation testing?',
          'Чувствительность проверок к заданным дефектам',
          'Отсутствие всех возможных ошибок',
          'Только успешный запуск',
          'evaluation',
        ),
        theory(
          'Почему HTTP 200 недостаточно?',
          'Ledger может быть неверным при успешном статусе',
          'Статусы всегда случайны',
          'Потому что нужен другой HTTP-код',
          'reliability',
        ),
        theory(
          'Как выбирать портфель?',
          'По критичным рискам и стоимости проверок',
          'По числу названий тестов',
          'Только по скорости smoke',
          'experiments',
        ),
        theory(
          'Как проверять данные после сбоя?',
          'Инварианты эффекта и повторной обработки',
          'Только лог запуска',
          'Только отсутствие exception',
          'reasoning',
        ),
      ],
    };
  },
  run(input, plan) {
    const selected = plan.tests as string[];
    let risk = 0;
    let killed = 0;
    let cost = selected.includes('smoke') ? 1 : 0;
    const testCosts: Record<string, number> = { duplicates: 2, tenants: 2, crash: 1, negative: 1 };
    for (const name of selected) cost += testCosts[name] ?? 0;
    for (const row of input.rows)
      if (
        choice(plan, 'oracle') === 'invariants' &&
        selected.some((name) => mutationFailures(name, String(row.mutation), num(row, 'amount')))
      ) {
        killed++;
        risk += num(row, 'risk');
      }
    return {
      metrics: { killedMutations: killed, coveredRisk: risk, executionCost: cost },
      checks: {
        criticalRiskCovered: risk >= num(input.parameters, 'requiredRisk'),
        affordablePortfolio: cost <= num(input.parameters, 'maxCost'),
      },
      explanation:
        'Контрпримеры запущены против изменённых функций расчёта; risk считается по реально обнаруженным мутациям.',
    };
  },
};

const flaky: Family = {
  id: 'qa-flaky-async-isolation',
  trackId: 'qa',
  title: 'QA: асинхронные ожидания, shared state и скрывающие дефект retries',
  skills: ['reliability', 'evaluation', 'experiments'],
  build(grade, seed) {
    const rng = random(seed);
    const rows = Array.from({ length: 8 + level(grade) * 4 }, (_, index) => ({
      test: index,
      completeAt: 5 + Math.floor(rng() * 40),
      initial: index < 2 ? 0 : Math.floor(rng() * 2),
      defect: index % 5 === 0,
    }));
    return {
      data: data(rows, { deadline: 80 }),
      changedData: data(
        rows.map((row) => ({ ...row, completeAt: row.completeAt + 25 })),
        { deadline: 80 },
      ),
      controls: [
        select('wait', 'Ожидание результата', [
          ['sleep', 'Фиксированный sleep 10 мс'],
          ['event', 'Событие завершения с deadline'],
        ]),
        select('isolation', 'Начальное состояние', [
          ['shared', 'Общий mutable state'],
          ['fresh', 'Новая fixture для каждого теста'],
        ]),
        select('retries', 'Интерпретация повторов', [
          ['mask', 'Любой успешный повтор означает pass'],
          ['diagnose', 'Отделить дефект от нестабильной инфраструктуры'],
        ]),
      ],
      contract:
        'Исправная операция должна дождаться завершения до deadline. Каждая fixture начинается независимо. Строки defect моделируют устойчивую продуктовую ошибку и должны оставаться failed, даже если первый статус выглядит успешным.',
      change:
        'Все операции стали на 25 мс медленнее, deadline остался 80 мс. Проверьте ожидание и классификацию.',
      rubric: ['Ожидание реального события', 'Изоляция состояния', 'Сохранение сигнала дефекта'],
      theory: [
        theory(
          'Что предпочтительнее фиксированного sleep?',
          'Наблюдаемое событие с ограниченным deadline',
          'Бесконечное ожидание',
          'Немедленное утверждение',
          'reliability',
        ),
        theory(
          'Почему shared state вызывает flakiness?',
          'Результат зависит от порядка других тестов',
          'Он всегда ускоряет тесты',
          'Он гарантирует изоляцию',
          'experiments',
        ),
        theory(
          'Что может скрыть retries-until-pass?',
          'Настоящий дефект и зависимость от условий',
          'Только длину отчёта',
          'Ничего',
          'evaluation',
        ),
        theory(
          'Что делать с постоянной ошибкой продукта?',
          'Сохранять failed и расследовать',
          'Считать инфраструктурной без доказательств',
          'Удалить assertion',
          'reasoning',
        ),
      ],
    };
  },
  run(input, plan) {
    let falseFailures = 0;
    let hiddenDefects = 0;
    let state = 0;
    for (const row of input.rows) {
      const initial = choice(plan, 'isolation') === 'fresh' ? num(row, 'initial') : state;
      const ready =
        choice(plan, 'wait') === 'event'
          ? num(row, 'completeAt') <= num(input.parameters, 'deadline')
          : num(row, 'completeAt') <= 10;
      if (!row.defect && (!ready || initial !== row.initial)) falseFailures++;
      if (row.defect && choice(plan, 'retries') === 'mask') hiddenDefects++;
      state = 1 - initial;
    }
    return {
      metrics: { falseFailures, hiddenDefects, executed: input.rows.length },
      checks: {
        deterministicHealthyTests: falseFailures === 0,
        defectsRemainVisible: hiddenDefects === 0,
      },
      explanation:
        'Порядок fixture и времена завершения воспроизведены. Продуктовые дефекты не превращаются в pass из-за повторов.',
    };
  },
};

const burnRate: Family = {
  id: 'sre-multiwindow-burn',
  trackId: 'sre',
  title: 'SRE: multi-window burn rate и взвешивание трафика',
  skills: ['reliability', 'evaluation', 'delivery'],
  build(grade, seed) {
    const rng = random(seed);
    const make = (sustained: boolean) =>
      data(
        Array.from({ length: 60 }, (_, minute) => ({
          minute,
          requests: 100 + Math.floor(rng() * 50),
          errors: minute >= 55 || sustained ? 8 + level(grade) : 0,
        })),
        { slo: 0.99, fastWindow: 5, slowWindow: 60, fastThreshold: 5, slowThreshold: 3 },
      );
    const sustained = seed % 2 === 0;
    return {
      data: make(sustained),
      changedData: make(!sustained),
      controls: [
        select('aggregation', 'Агрегация ошибок', [
          ['mean-rates', 'Среднее процентов по минутам'],
          ['traffic', 'Сумма ошибок / сумма запросов'],
        ]),
        select('windows', 'Окна решения', [
          ['fast-only', 'Только последние 5 минут'],
          ['both', '5 и 60 минут'],
        ]),
        select('decision', 'Решение', [
          ['page', 'Вызвать дежурного'],
          ['observe', 'Продолжить наблюдение'],
        ]),
      ],
      contract:
        'Burn rate = errorRate/(1-SLO). Page, если fast burn>=5 И slow burn>=3. Проценты взвешиваются трафиком. Один быстрый spike недостаточен для page по этому контракту.',
      change:
        'Характер нарушения изменился: короткий spike заменён устойчивой деградацией или наоборот. Повторите решение.',
      rubric: ['Корректная нормировка', 'Два окна', 'Решение по контракту'],
      theory: [
        theory(
          'Как считать error rate при разном трафике?',
          'Сумма ошибок / сумма запросов',
          'Среднее процентов без весов',
          'Максимальный размер лога',
          'evaluation',
        ),
        theory(
          'Что такое burn rate здесь?',
          'Скорость расходования допустимой доли ошибок',
          'CPU utilization',
          'Количество серверов',
          'reliability',
        ),
        theory(
          'Зачем два окна?',
          'Отделить краткий spike от устойчивого нарушения',
          'Удвоить число alerts',
          'Скрыть ошибки',
          'delivery',
        ),
        theory(
          'Когда page по этому контракту?',
          'Когда пороги превышены в обоих окнах',
          'При любом одном fail',
          'Всегда раз в час',
          'reasoning',
        ),
      ],
    };
  },
  run(input, plan) {
    const calculate = (rows: LabRow[], traffic: boolean) =>
      (traffic
        ? rows.reduce((sum, row) => sum + num(row, 'errors'), 0) /
          rows.reduce((sum, row) => sum + num(row, 'requests'), 0)
        : mean(rows.map((row) => num(row, 'errors') / num(row, 'requests')))) /
      (1 - num(input.parameters, 'slo'));
    const fastRows = input.rows.slice(-num(input.parameters, 'fastWindow'));
    const slowRows = input.rows.slice(-num(input.parameters, 'slowWindow'));
    const correctPage =
      calculate(fastRows, true) >= num(input.parameters, 'fastThreshold') &&
      calculate(slowRows, true) >= num(input.parameters, 'slowThreshold');
    const traffic = choice(plan, 'aggregation') === 'traffic';
    const fast = calculate(fastRows, traffic);
    const slow = calculate(slowRows, traffic);
    return {
      metrics: { fastBurn: fast, slowBurn: slow },
      checks: {
        weightedTraffic: traffic,
        multiWindow: choice(plan, 'windows') === 'both',
        appropriatePage: choice(plan, 'decision') === (correctPage ? 'page' : 'observe'),
      },
      explanation:
        'Burn rate вычислен из сумм ошибок и запросов двух временных окон. Пороги — условия конкретного сценария.',
    };
  },
};

const capacity: Family = {
  id: 'sre-rolling-capacity',
  trackId: 'sre',
  title: 'SRE: rolling update, запас мощности и сбой реплики',
  skills: ['reliability', 'delivery', 'cost'],
  build(grade, seed) {
    const rng = random(seed);
    const load = 130 + level(grade) * 15 + Math.floor(rng() * 15);
    const rows = [
      { step: 0, unavailable: 0, failure: 0 },
      { step: 1, unavailable: 1, failure: 0 },
      { step: 2, unavailable: 1, failure: 1 },
      { step: 3, unavailable: 0, failure: 1 },
    ];
    return {
      data: data(rows, { load, replicaCapacity: 50, clusterQuota: 12 }),
      changedData: data(rows, { load: load + 90, replicaCapacity: 50, clusterQuota: 12 }),
      controls: [
        numeric('replicas', 'Рабочих реплик', [4, 6, 8, 10]),
        numeric('maxUnavailable', 'MaxUnavailable', [0, 1, 2]),
        numeric('maxSurge', 'MaxSurge', [0, 1, 2]),
        yesNo('rollback', 'Доступен rollback совместимой версии'),
      ],
      contract:
        'В каждом шаге (replicas-min(unavailable,maxUnavailable)-failure+maxSurge)*50 должно покрывать load. replicas+maxSurge не превышает clusterQuota. Для deployment нужен прогресс: surge или unavailable >0. Совместимый rollback обязателен.',
      change:
        'Нагрузка увеличилась на 90 units, один отказ остаётся в сценарии. Пересчитайте запас мощности.',
      rubric: ['Мощность на худшем шаге', 'Квота кластера', 'Прогресс и восстановление'],
      theory: [
        theory(
          'Какой шаг определяет запас мощности?',
          'Худший допустимый шаг с отказом',
          'Только исходное состояние',
          'Только средний CPU',
          'reliability',
        ),
        theory(
          'Что ограничивает maxSurge?',
          'Дополнительные реплики во время обновления',
          'Число пользователей',
          'Размер базы',
          'delivery',
        ),
        theory(
          'Почему zero surge и zero unavailable опасны?',
          'Обновление может не иметь прогресса',
          'Всегда быстрее всего',
          'Они исключают любые сбои',
          'reasoning',
        ),
        theory(
          'Что проверять при росте нагрузки?',
          'Худшую доступную мощность и квоту',
          'Только старый p95',
          'Только имя релиза',
          'cost',
        ),
      ],
    };
  },
  run(input, plan) {
    const replicas = value(plan, 'replicas');
    const unavailable = value(plan, 'maxUnavailable');
    const surge = value(plan, 'maxSurge');
    const minimum = Math.min(
      ...input.rows.map(
        (row) =>
          (replicas -
            Math.min(num(row, 'unavailable'), unavailable) -
            num(row, 'failure') +
            surge) *
          num(input.parameters, 'replicaCapacity'),
      ),
    );
    return {
      metrics: {
        minimumCapacity: minimum,
        peakReplicas: replicas + surge,
        load: num(input.parameters, 'load'),
      },
      checks: {
        enoughCapacity: minimum >= num(input.parameters, 'load'),
        withinQuota: replicas + surge <= num(input.parameters, 'clusterQuota'),
        deploymentProgress: unavailable + surge > 0,
        recoverable: choice(plan, 'rollback') === 'yes',
      },
      explanation:
        'Мощность пересчитана на каждом заданном шаге deployment с отдельным отказом. Это модель capacity, не настоящий Kubernetes-кластер.',
    };
  },
};

const simpson: Family = {
  id: 'analytics-stratified-ab',
  trackId: 'analytics',
  title: 'A/B: Simpson paradox и стандартизация состава групп',
  skills: ['evaluation', 'data', 'experiments'],
  build(grade, seed) {
    const rng = random(seed);
    const sign = seed % 2 ? -1 : 1;
    const effect = sign * (0.025 + rng() * 0.015);
    const rows: LabRow[] = [
      { variant: 'A', segment: 'desktop', visitors: 100, converted: 70 },
      { variant: 'A', segment: 'mobile', visitors: 900, converted: 90 },
      { variant: 'B', segment: 'desktop', visitors: 900, converted: (0.7 + effect) * 900 },
      { variant: 'B', segment: 'mobile', visitors: 100, converted: (0.1 + effect) * 100 },
    ];
    const make = (changed: boolean) =>
      data(
        rows.map((row) => ({
          ...row,
          converted:
            row.variant === 'B' && changed
              ? num(row, 'converted') - num(row, 'visitors') * effect * 2
              : row.converted!,
        })),
        { desktopWeight: 0.5, mobileWeight: 0.5, minSegments: 2 + level(grade) * 0 },
      );
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        select('metric', 'Сравнение конверсии', [
          ['raw', 'Сырые агрегированные доли'],
          ['standardized', 'Доли с одинаковыми весами сегментов'],
        ]),
        select('unit', 'Единица анализа', [
          ['events', 'Количество событий'],
          ['visitors', 'Посетители'],
        ]),
        select('decision', 'Вывод о B', [
          ['better', 'B лучше A'],
          ['worse', 'B хуже A'],
        ]),
      ],
      contract:
        'Сравнивается конверсия посетителей при одинаковом целевом составе: desktop=0,5, mobile=0,5. Поле converted — математическая сумма успехов в контролируемой синтетической таблице; дробные суммы допустимы для этого сценария.',
      change:
        'Эффект B внутри каждого сегмента поменял знак; распределение трафика осталось прежним. Пересмотрите вывод.',
      rubric: [
        'Контроль состава',
        'Корректный знаменатель',
        'Вывод по стандартизированному эффекту',
      ],
      theory: [
        theory(
          'Что может изменить агрегированную конверсию?',
          'Состав сегментов при неизменном локальном качестве',
          'Только название варианта',
          'Только число колонок',
          'evaluation',
        ),
        theory(
          'Как сравнить группы с разным составом?',
          'Использовать одинаковые целевые веса сегментов',
          'Сравнить только суммы конверсий',
          'Удалить низкую группу',
          'experiments',
        ),
        theory(
          'Какой знаменатель соответствует контракту?',
          'Посетители',
          'Все повторные события',
          'Количество сегментов',
          'data',
        ),
        theory(
          'Когда сырая доля вводит в заблуждение?',
          'При смешении групп с разными базовыми долями',
          'Всегда равна истинному эффекту',
          'Только при нулевых данных',
          'reasoning',
        ),
      ],
    };
  },
  run(input, plan) {
    const rate = (variant: string, standardized: boolean) => {
      const rows = input.rows.filter((row) => row.variant === variant);
      return standardized
        ? rows.reduce(
            (sum, row) =>
              sum +
              (num(row, 'converted') / num(row, 'visitors')) *
                num(input.parameters, `${row.segment}Weight`),
            0,
          )
        : rows.reduce((sum, row) => sum + num(row, 'converted'), 0) /
            rows.reduce((sum, row) => sum + num(row, 'visitors'), 0);
    };
    const trueEffect = rate('B', true) - rate('A', true);
    const estimate =
      rate('B', choice(plan, 'metric') === 'standardized') -
      rate('A', choice(plan, 'metric') === 'standardized');
    return {
      metrics: {
        estimatedLift: estimate,
        standardizedLift: trueEffect,
        aggregationBias: estimate - trueEffect,
      },
      checks: {
        comparableComposition: Math.abs(estimate - trueEffect) < 1e-9,
        correctUnit: choice(plan, 'unit') === 'visitors',
        appropriateDecision: choice(plan, 'decision') === (trueEffect > 0 ? 'better' : 'worse'),
      },
      explanation:
        'Агрегированные и стандартизированные доли вычислены из таблицы; вывод не является проверкой статистической значимости реального A/B.',
    };
  },
};

const funnel: Family = {
  id: 'analytics-funnel-joins',
  trackId: 'analytics',
  title: 'Воронка: cohort, fan-out join и уникальный заказ',
  skills: ['data', 'evaluation', 'experiments'],
  build(grade, seed) {
    const rng = random(seed);
    const rows: LabRow[] = [];
    for (let user = 0; user < 4 + level(grade) * 3; user++) {
      const amount = Math.floor(rng() * 100 + 10);
      const day = user % 3 === 0 ? 10 : 3;
      for (let click = 0; click < 2 + (user % 3); click++)
        rows.push({ user, order: user, click, registered: 0, purchaseDay: day, amount });
    }
    const make = (changed: boolean) =>
      data(changed ? [...rows, ...rows.filter((row) => row.click === 0)] : rows, { horizon: 7 });
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        select('denominator', 'Знаменатель воронки', [
          ['joined-rows', 'Строки после join'],
          ['users', 'Уникальные пользователи когорты'],
        ]),
        select('orders', 'Агрегация выручки', [
          ['sum-rows', 'SUM после fan-out'],
          ['distinct-orders', 'Каждый order ID один раз'],
        ]),
        numeric('horizon', 'Окно покупки, дни', [7, 14, 30]),
      ],
      contract:
        'Когорта — уникальные пользователи. Конверсия: пользователи с покупкой за 7 дней после регистрации / когорта. Выручка считается по уникальным order ID в этом же окне. Click-join размножает строку заказа.',
      change:
        'В click-источнике появились повторы первых событий. Воронка и выручка не должны измениться.',
      rubric: ['Правильная когорта', 'Защита от fan-out', 'Единое временное окно'],
      theory: [
        theory(
          'Что делает one-to-many join с суммой заказа?',
          'Может размножить сумму в нескольких строках',
          'Всегда сохраняет SUM',
          'Меняет только порядок',
          'data',
        ),
        theory(
          'Как считать выручку?',
          'По уникальным order ID в заданном окне',
          'Суммировать все joined rows',
          'По числу кликов',
          'evaluation',
        ),
        theory(
          'Почему важен единый horizon?',
          'Он определяет сопоставимые исходы когорты',
          'Он не влияет на результат',
          'Он заменяет дедупликацию',
          'experiments',
        ),
        theory(
          'Как проверить устойчивость воронки?',
          'Добавить повторы click и сравнить инварианты',
          'Удалить всех покупателей',
          'Изменить название отчёта',
          'reasoning',
        ),
      ],
    };
  },
  run(input, plan) {
    const cohort = new Set(input.rows.map((row) => row.user)).size;
    const eligible = input.rows.filter(
      (row) => num(row, 'purchaseDay') - num(row, 'registered') <= value(plan, 'horizon'),
    );
    const expectedEligible = input.rows.filter(
      (row) => num(row, 'purchaseDay') - num(row, 'registered') <= num(input.parameters, 'horizon'),
    );
    const orders = (rows: LabRow[]) => [...new Map(rows.map((row) => [row.order, row])).values()];
    const revenue =
      choice(plan, 'orders') === 'distinct-orders'
        ? orders(eligible).reduce((sum, row) => sum + num(row, 'amount'), 0)
        : eligible.reduce((sum, row) => sum + num(row, 'amount'), 0);
    const expectedRevenue = orders(expectedEligible).reduce(
      (sum, row) => sum + num(row, 'amount'),
      0,
    );
    const conversion =
      new Set(eligible.map((row) => row.user)).size /
      (choice(plan, 'denominator') === 'users' ? cohort : input.rows.length);
    const expectedConversion = new Set(expectedEligible.map((row) => row.user)).size / cohort;
    return {
      metrics: {
        conversion,
        expectedConversion,
        revenue,
        expectedRevenue,
        joinedRows: input.rows.length,
        cohort,
      },
      checks: {
        correctConversion: Math.abs(conversion - expectedConversion) < 1e-9,
        correctRevenue: revenue === expectedRevenue,
        prescribedHorizon: value(plan, 'horizon') === num(input.parameters, 'horizon'),
      },
      explanation:
        'Когорта, окно, дедупликация order и fan-out действительно пересчитаны по строкам.',
    };
  },
};

export const engineeringFamilies: Family[] = [
  payments,
  cache,
  requestRace,
  listState,
  cdc,
  windows,
  testPortfolio,
  flaky,
  burnRate,
  capacity,
  simpson,
  funnel,
];
