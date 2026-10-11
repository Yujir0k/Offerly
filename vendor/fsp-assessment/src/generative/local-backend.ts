import { dimensions } from '../adaptive/model.js';
import type { FormalCase, ItemModel, Fact } from './model.js';

type CaseSpec = [string, string, string, string, string, string];
function cases(fields: string[], specs: CaseSpec[]): FormalCase[] {
  return specs.map(([id, cause, evidence, requirement, repair, diagnostic], index) => {
    const facts: Record<string, Fact> = Object.fromEntries(
      fields.map((field, i) => [field, i !== index]),
    );
    return {
      id,
      hazard: id,
      facts,
      predicate: (f) =>
        f[fields[index]!] === false &&
        fields.filter((_, i) => i !== index).every((field) => f[field] === true),
      cause,
      evidence,
      narrative: evidence,
      invariant: `Требуется ${requirement}.`,
      requirements: [requirement],
      repair,
      diagnostic,
      falsifier: `Проверка подтвердила условие «${requirement}», но сбой продолжает воспроизводиться.`,
    };
  });
}
function local(
  id: string,
  title: string,
  introduction: string,
  fields: string[],
  specs: CaseSpec[],
  code: ItemModel['code'],
): ItemModel {
  return {
    id,
    title,
    introduction,
    code,
    version: '3.0.0',
    specialization: 'backend',
    siblingGroup: id,
    contentTags: [
      {
        request_validation: 'input-contract',
        query_pagination: 'query-shape',
        request_resource_lifecycle: 'resource-lifecycle',
        transaction_constraints: 'transaction-rules',
      }[id] || 'local-reasoning',
    ],
    measuredDimensions: [...dimensions],
    stages: ['anchors', 'incident', 'review', 'boundary'],
    topology: ['Controller', 'Service', 'DB'],
    cases: cases(fields, specs),
    radicalDefinitions: fields.map((name) => ({
      name: `failure.${name}`,
      affects: 'Корректность локального обработчика и необходимое исправление',
    })),
    incidentalDefinitions: ['domain', 'entity', 'table', 'endpoint', 'operationId', 'wording'],
    misconceptionClasses: [
      'wrong_causal_layer',
      'insufficient_observability',
      'incorrect_consistency_assumption',
    ],
  };
}

/** Local reasoning families complement operational Backend cases at all declared grades. */
export const localBackendModels: ItemModel[] = [
  local(
    'request_validation',
    'Контракт локального API',
    'Обработчик запроса должен отклонять некорректные входные данные до изменения состояния.',
    ['typedInput', 'ownershipChecked', 'nullHandled', 'bodyBounded'],
    [
      [
        'unparsed-input',
        'Строковый параметр используется как число без проверки типа.',
        'Параметр count="2" приводит к строковому сложению: результат 12 вместо 3.',
        'проверка типа и диапазона входа',
        'Разобрать count как целое число и проверить допустимый диапазон до выполнения операции.',
        'code',
      ],
      [
        'unchecked-owner',
        'Проверка входа не проверяет право пользователя на конкретную запись.',
        'Пользователь B передаёт корректный ID записи A и получает её приватные данные.',
        'проверка владельца записи',
        'Проверять доступ к найденной записи по текущему пользователю до чтения приватных полей.',
        'logs',
      ],
      [
        'missing-null-branch',
        'Отсутствующая запись используется как существующая.',
        'Для неизвестного ID поиск возвращает null; следующая строка читает поле owner и завершается ошибкой.',
        'явная обработка отсутствия записи',
        'Разделить найденную и отсутствующую запись; вернуть предусмотренный контрактом ответ 404.',
        'trace',
      ],
      [
        'unbounded-body',
        'Ограничение устанавливается после полного чтения тела запроса.',
        'Большой запрос полностью попадает в память, затем получает ответ 413; память растёт до проверки размера.',
        'ограничение размера до накопления тела',
        'Ограничить поток чтения до накопления всего тела; при превышении лимита прекратить чтение и вернуть 413.',
        'metrics',
      ],
    ],
    (w) =>
      `const count = ${w.radicals.failure.typedInput ? 'parseAndValidateCount(input.count)' : 'input.count'};\nconst row = await db.find(input.id);\n${w.radicals.failure.nullHandled ? 'if (!row) return response(404);' : ''}\n${w.radicals.failure.ownershipChecked ? 'if (row.owner !== user.id) return response(403);' : ''}\nconst body = await request.${w.radicals.failure.bodyBounded ? 'readLimited(65536)' : 'readAll()'};\nreturn row.base + count;`,
  ),
  local(
    'query_pagination',
    'Чтение и пагинация данных',
    'API выдаёт страницу записей; результат должен быть устойчивым и соответствовать фильтру пользователя.',
    ['orderStable', 'limitInDatabase', 'parametersBound', 'filterBeforeLimit'],
    [
      [
        'unstable-page-order',
        'Равные значения сортировки не имеют стабильного дополнительного ключа.',
        'При одинаковом created_at повтор страницы возвращает другой порядок и пропускает записи.',
        'устойчивый порядок страницы',
        'Добавить уникальный ID вторым ключом сортировки и включить обе части в курсор страницы.',
        'db',
      ],
      [
        'application-only-limit',
        'База возвращает всю выборку, а ограничение применяется в приложении.',
        'Размер ответа 20 строк; из БД загружается 80000 строк, время и память растут с размером таблицы.',
        'ограничение выборки в БД',
        'Применить LIMIT и условия курсора в самом запросе; передавать приложению только нужную страницу.',
        'metrics',
      ],
      [
        'interpolated-query',
        'Пользовательская строка попадает в текст SQL вместо отдельного параметра.',
        'Апостроф в имени нарушает синтаксис запроса; в коде значение соединяется со строкой SQL.',
        'параметризация SQL',
        'Передавать значение отдельно как параметр SQL; форму запроса сохранять независимо от значения.',
        'code',
      ],
      [
        'limit-before-filter',
        'Ограничение применяется раньше нужного фильтра.',
        'Из первых 20 записей только две подходят фильтру; более поздние подходящие записи не попадают на страницу.',
        'фильтрация до ограничения страницы',
        'Перенести фильтр в WHERE до ORDER BY и LIMIT; курсор строить по отфильтрованному набору.',
        'table',
      ],
    ],
    (w) =>
      `const query = ${w.radicals.failure.parametersBound ? "sql('SELECT * FROM records WHERE name = ?', [input.name])" : "'SELECT * FROM records WHERE name = ' + input.name"};\nquery.orderBy(${w.radicals.failure.orderStable ? "'created_at', 'id'" : "'created_at'"});\n${w.radicals.failure.filterBeforeLimit ? 'query.where(filter);' : ''}\n${w.radicals.failure.limitInDatabase ? 'query.limit(20);' : ''}\nconst rows = await db.run(query);\nreturn rows${w.radicals.failure.filterBeforeLimit ? '' : '.slice(0, 20).filter(matchesFilter)'}.slice(0, 20);`,
  ),
  local(
    'request_resource_lifecycle',
    'Жизненный цикл обработчика',
    'Запрос выполняет локальную работу с ресурсами; ошибка и отмена не должны оставлять незавершённую работу.',
    ['releasedOnError', 'workBounded', 'cancelPropagated', 'resultAwaited'],
    [
      [
        'resource-error-leak',
        'Ресурс освобождается только на успешном пути.',
        'После ошибочного запроса ресурс остаётся занят; новые запросы ждут даже после прекращения нагрузки.',
        'освобождение на любом пути',
        'Поместить освобождение ресурса в finally; проверить успешный, ошибочный и отменённый запросы.',
        'logs',
      ],
      [
        'unbounded-parallel-work',
        'Размер входного списка напрямую определяет число параллельных операций.',
        'Большой список создаёт 5000 одновременных операций; предел открытых ресурсов равен 100.',
        'ограничение параллельной работы',
        'Обрабатывать список с ограниченной конкурентностью; сохранять порядок результатов отдельно от порядка завершения.',
        'metrics',
      ],
      [
        'detached-after-cancel',
        'Отмена запроса не передаётся выполняемой работе.',
        'Клиент отключился, но обработчик продолжает чтение и вычисления ещё 30 секунд.',
        'распространение отмены',
        'Передать сигнал отмены во вложенную работу и освободить ресурс при завершении отменённого запроса.',
        'trace',
      ],
      [
        'reply-before-write',
        'Ответ об успешной записи отправлен до завершения записи.',
        'Клиент получает 200, затем promise записи завершается ошибкой; в БД изменения нет.',
        'ответ после результата записи',
        'Дождаться записи и обработать её ошибку до успешного HTTP-ответа.',
        'db',
      ],
    ],
    (w) =>
      `const resource = await resources.acquire();\ntry {\n  const results = await ${w.radicals.failure.workBounded ? 'mapWithLimit(items, 20, process)' : 'Promise.all(items.map(process))'};\n  ${w.radicals.failure.cancelPropagated ? 'await resource.read({ signal: request.signal });' : 'await resource.read();'}\n  ${w.radicals.failure.resultAwaited ? 'await ' : ''}db.save(results);\n  ${w.radicals.failure.releasedOnError ? '' : 'resource.release();'}\n  return response(200);\n} ${w.radicals.failure.releasedOnError ? 'finally { resource.release(); }' : 'catch (error) { return response(500); }'}`,
  ),
  local(
    'transaction_constraints',
    'Локальная транзакция',
    'Два изменения одной бизнес-операции должны сохранять ограничения данных даже при отказе.',
    ['writesAtomic', 'uniqueInDatabase', 'countConditional', 'rollbackHandled'],
    [
      [
        'split-local-writes',
        'Связанные изменения фиксируются отдельными операциями.',
        'Первая запись сохранена, вторая завершилась ошибкой; операция оставила половину изменений.',
        'атомарность связанных записей',
        'Поместить обе записи в одну транзакцию и возвращать успех только после её commit.',
        'db',
      ],
      [
        'check-only-unique',
        'Отсутствие дубликата проверяется до вставки, без ограничения в БД.',
        'Два запроса одновременно не нашли запись с одним номером и оба успешно вставили её.',
        'уникальность на уровне БД',
        'Добавить UNIQUE для бизнес-ключа и обработать конфликт вставки в соответствии с контрактом.',
        'logs',
      ],
      [
        'check-count-outside-write',
        'Остаток проверяется отдельно от изменения значения.',
        'Оба запроса видят остаток 1; после двух успешных списаний остаток становится отрицательным.',
        'условное изменение остатка',
        'Включить проверку положительного остатка в UPDATE и проверять число изменённых строк.',
        'trace',
      ],
      [
        'ignored-rollback',
        'После отката операция всё равно сообщается как успешная.',
        'Транзакция откатилась, ошибка перехвачена; обработчик возвращает тот же успешный ответ.',
        'согласование ответа с commit',
        'Отделить ответ после успешного commit от обработчика ошибки; после rollback вернуть явный отказ.',
        'code',
      ],
    ],
    (w) =>
      `const operation = async tx => {\n  ${w.radicals.failure.uniqueInDatabase ? 'await tx.insertUnique(input.number);' : 'if (!await tx.exists(input.number)) await tx.insert(input.number);'}\n  await tx.decrement(${w.radicals.failure.countConditional ? '{ onlyIfPositive: true }' : '{}'});\n};\ntry { await ${w.radicals.failure.writesAtomic ? 'db.transaction(operation)' : 'operation(db)'}; }\ncatch (error) { ${w.radicals.failure.rollbackHandled ? 'return response(409);' : 'recordError(error);'} }\nreturn response(200);`,
  ),
];
