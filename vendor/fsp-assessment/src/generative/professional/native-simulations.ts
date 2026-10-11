import { select, num, choice, type Family, type LabResult } from '../../families/core.js';
import type { Grade, LabRow, LabData, Plan } from '../../domain.js';
const yes = (plan: Plan, key: string) => choice(plan, key) === 'yes';
function result(
  metrics: Record<string, number>,
  checks: Record<string, boolean>,
  explanation: string,
): LabResult {
  return { metrics, checks, explanation };
}
function family(
  id: string,
  trackId: string,
  title: string,
  fields: [string, string][],
  rows: (grade: Grade, seed: number) => LabRow[],
  parameters: LabData['parameters'],
  contract: string,
  change: string,
  run: Family['run'],
): Family {
  return {
    id,
    trackId,
    title,
    skills: ['professional-work-sample'],
    build(grade, seed) {
      const source = rows(grade, seed);
      const configuration = (configurationSeed: number) => {
        const missing = 1 + ((configurationSeed >>> 3) % 2);
        const masks = Array.from({ length: 2 ** fields.length }, (_, mask) => mask).filter(
          (mask) => fields.filter((_field, index) => !(mask & (1 << index))).length === missing,
        );
        const mask = masks[(configurationSeed >>> 0) % masks.length]!;
        const baseline = Object.fromEntries(
          fields.map(([key], index) => [key, !!(mask & (1 << index))]),
        );
        return {
          ...parameters,
          baseline: JSON.stringify(baseline),
          changeBudget: fields.filter(([key]) => !baseline[key]).length,
        };
      };
      return {
        data: { rows: source, parameters: configuration(seed) },
        changedData: { rows: rows(grade, seed + 701), parameters: configuration(seed + 701) },
        controls: fields.map(([key, label]) =>
          select(key, `Изменить: ${label}`, [
            ['no', 'Оставить текущую настройку'],
            ['yes', 'Включить в текущем изменении'],
          ]),
        ),
        contract: `${contract} baseline задаёт уже работающие настройки. Каждое включение расходует одну единицу changeBudget, в том числе повторное включение работающей настройки. Сохраните работающие настройки и устраните нарушения в пределах бюджета.`,
        change,
        rubric: fields.map(([, label]) => label),
        theory: [],
      };
    },
    run(data, plan) {
      if (typeof data.parameters.baseline !== 'string') return run(data, plan);
      const baseline = JSON.parse(data.parameters.baseline) as Record<string, boolean>;
      const effective = Object.fromEntries(
        fields.map(([key]) => [key, baseline[key] || yes(plan, key) ? 'yes' : 'no']),
      );
      const outcome = run(data, effective);
      const changeEffort = fields.filter(([key]) => yes(plan, key)).length;
      const changeBudget = Number(data.parameters.changeBudget);
      return {
        metrics: { ...outcome.metrics, changeEffort, changeBudget },
        checks: { ...outcome.checks, changeBudget: changeEffort <= changeBudget },
        explanation: `${outcome.explanation} Изменений: ${changeEffort}; бюджет: ${changeBudget}.`,
      };
    },
  };
}
const count = (grade: Grade) => (grade === 'Junior' ? 4 : grade === 'Middle' ? 8 : 12);

export const nativeSimulations: Family[] = [
  family(
    'native-fe-dialog',
    'frontend',
    'Диалог: клавиатурный маршрут и доступный контекст',
    [
      ['focus', 'Фокус внутри открытого диалога'],
      ['label', 'Доступное имя диалога'],
      ['restore', 'Возврат фокуса к инициатору'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        trigger: `button-${seed}-${index}`,
        dialog: `dialog-${index}`,
        closeByKeyboard: index % 2 === 0,
      })),
    {},
    'Каждый диалог получает фокус и доступное имя. Закрытие возвращает фокус к своему инициатору; клавиатурный маршрут не теряется.',
    'Появились несколько независимых диалогов и инициаторов; повторно проверьте ownership фокуса.',
    (data, plan) => {
      const missingFocus = yes(plan, 'focus') ? 0 : data.rows.length;
      const unnamed = yes(plan, 'label') ? 0 : data.rows.length;
      const lostReturn = yes(plan, 'restore')
        ? 0
        : data.rows.filter((row) => row.closeByKeyboard).length;
      return result(
        { missingFocus, unnamed, lostReturn },
        { focus: missingFocus === 0, name: unnamed === 0, return: lostReturn === 0 },
        `Диалогов без фокуса: ${missingFocus}; без имени: ${unnamed}; потерянных возвратов: ${lostReturn}.`,
      );
    },
  ),
  family(
    'native-sre-restore',
    'sre',
    'Восстановление: измеренные RPO, RTO и целостность',
    [
      ['snapshot', 'Выбрать согласованную копию'],
      ['keys', 'Проверить доступность ключей'],
      ['parallel', 'Параллелить независимые этапы восстановления'],
    ],
    (grade, seed) => [
      {
        backupAgeMinutes: 12 + (seed % 8),
        restoreCopyMinutes: count(grade),
        restoreVerifyMinutes: count(grade) + 1,
        dependencyCopies: 2,
      },
    ],
    { rpoMinutes: 30, rtoMinutes: 18 },
    'Пригодная копия согласована, ключи доступны, возраст не превышает RPO. Независимые этапы можно выполнять параллельно; общая длительность не превышает RTO.',
    'Размер восстановления вырос; повторно проверьте критический путь и RTO.',
    (data, plan) => {
      const row = data.rows[0]!;
      const restoreMinutes = yes(plan, 'parallel')
        ? Math.max(num(row, 'restoreCopyMinutes'), num(row, 'restoreVerifyMinutes'))
        : num(row, 'restoreCopyMinutes') +
          num(row, 'restoreVerifyMinutes') +
          num(row, 'dependencyCopies');
      return result(
        { restoreMinutes, backupAgeMinutes: num(row, 'backupAgeMinutes') },
        {
          consistent: yes(plan, 'snapshot'),
          decryptable: yes(plan, 'keys'),
          rpo: num(row, 'backupAgeMinutes') <= num(data.parameters, 'rpoMinutes'),
          rto: restoreMinutes <= num(data.parameters, 'rtoMinutes'),
        },
        `Проверяемая длительность восстановления ${restoreMinutes} мин.; пригодность копии и ключа проверяются отдельно.`,
      );
    },
  ),
  family(
    'native-qa-ci',
    'qa',
    'CI: пропущенная проверка, устаревший отчёт и exit code',
    [
      ['required', 'Проверить запуск обязательного сценария'],
      ['version', 'Связать отчёт с текущим build'],
      ['exit', 'Передать failure в exit code'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        build: seed,
        reportBuild: index === 0 ? seed - 1 : seed,
        required: index % 2 === 0,
        status: index === 2 ? 'failed' : index === 0 ? 'skipped' : 'passed',
      })),
    {},
    'Gate не принимает skipped обязательной проверки, чужой build и failed проверку как pass. Разрешённый выпуск требует корректного сигнала всех трёх условий.',
    'Количество сценариев и build-сегментов изменилось; проверьте текущий run manifest.',
    (data, plan) => {
      const missed = data.rows.filter((row) => row.required && row.status === 'skipped').length;
      const stale = data.rows.filter((row) => row.build !== row.reportBuild).length;
      const failed = data.rows.filter((row) => row.status === 'failed').length;
      return result(
        {
          undetectedSkipped: yes(plan, 'required') ? 0 : missed,
          acceptedStale: yes(plan, 'version') ? 0 : stale,
          hiddenFailures: yes(plan, 'exit') ? 0 : failed,
        },
        {
          skipped: yes(plan, 'required') || missed === 0,
          build: yes(plan, 'version') || stale === 0,
          exit: yes(plan, 'exit') || failed === 0,
        },
        `В manifest есть ${missed} пропущенных обязательных, ${stale} устаревших отчётов и ${failed} failure.`,
      );
    },
  ),
  family(
    'native-de-lineage',
    'data-engineering',
    'Lineage: воспроизводимый пересчёт partition',
    [
      ['input', 'Фиксировать версию input'],
      ['transform', 'Фиксировать версию transform'],
      ['reference', 'Фиксировать версию справочника'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        partition: index,
        inputVersion: seed + index,
        transformVersion: 2 + (index % 2),
        referenceVersion: 4 + (index % 3),
      })),
    {},
    'Для каждой partition воспроизводимый manifest содержит точные версии input, transform и справочника. Потеря любой версии оставляет происхождение неоднозначным.',
    'Появились дополнительные partition с другими справочниками; проверьте полноту manifest.',
    (data, plan) => {
      const ambiguousInput = yes(plan, 'input')
        ? 0
        : new Set(data.rows.map((row) => row.inputVersion)).size;
      const ambiguousTransform = yes(plan, 'transform')
        ? 0
        : new Set(data.rows.map((row) => row.transformVersion)).size;
      const ambiguousReference = yes(plan, 'reference')
        ? 0
        : new Set(data.rows.map((row) => row.referenceVersion)).size;
      return result(
        { ambiguousInput, ambiguousTransform, ambiguousReference },
        {
          input: ambiguousInput === 0,
          transform: ambiguousTransform === 0,
          reference: ambiguousReference === 0,
        },
        `Неопределённых версий input: ${ambiguousInput}; transform: ${ambiguousTransform}; справочника: ${ambiguousReference}.`,
      );
    },
  ),
  family(
    'native-mp-retrain',
    'mlops',
    'Retraining: зрелость labels, quality gate и promotion',
    [
      ['maturity', 'Исключать незрелые labels'],
      ['quality', 'Проверять качество данных'],
      ['approval', 'Требовать promotion gate'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        prediction: seed + index,
        labelMature: index % 3 !== 0,
        validData: index % 4 !== 0,
        approvedCandidate: index % 2 === 0,
      })),
    {},
    'Незрелые labels и непригодные данные не допускаются в training. Неодобренный candidate не получает production promotion.',
    'Окно данных увеличилось; пересчитайте зрелость и пригодность до promotion.',
    (data, plan) => {
      const immature = yes(plan, 'maturity')
        ? 0
        : data.rows.filter((row) => !row.labelMature).length;
      const invalid = yes(plan, 'quality') ? 0 : data.rows.filter((row) => !row.validData).length;
      const unapproved = yes(plan, 'approval')
        ? 0
        : data.rows.filter((row) => !row.approvedCandidate).length;
      return result(
        { immature, invalid, unapproved },
        { maturity: immature === 0, data: invalid === 0, promotion: unapproved === 0 },
        `В неподготовленном lifecycle: незрелые labels ${immature}, непригодные входы ${invalid}, неодобренные candidate ${unapproved}.`,
      );
    },
  ),
  family(
    'native-ga-tools',
    'llm',
    'LLM tools: schema, полномочия и подтверждение действия',
    [
      ['schema', 'Валидировать arguments вне модели'],
      ['auth', 'Проверять серверную identity'],
      ['confirmation', 'Подтверждать значимое действие'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        call: seed + index,
        schemaValid: index % 3 !== 0,
        authorized: index % 4 !== 0,
        sensitive: index % 2 === 0,
        confirmed: index % 5 === 0,
      })),
    {},
    'Невалидный arguments и неавторизованный вызов не выполняются. Значимое действие допускается только с требуемым подтверждением вне модели. Все три серверные проверки обязательны независимо от текущей выборки.',
    'Появились дополнительные tools с иными комбинациями прав и подтверждения; проверьте enforcement.',
    (data, plan) => {
      const executed = data.rows.filter(
        (row) =>
          (!yes(plan, 'schema') || row.schemaValid) &&
          (!yes(plan, 'auth') || row.authorized) &&
          (!yes(plan, 'confirmation') || !row.sensitive || row.confirmed),
      );
      const invalidExecuted = executed.filter((row) => !row.schemaValid).length;
      const unauthorizedExecuted = executed.filter((row) => !row.authorized).length;
      const unconfirmedExecuted = executed.filter((row) => row.sensitive && !row.confirmed).length;
      return result(
        {
          executedCalls: executed.length,
          invalidExecuted,
          unauthorizedExecuted,
          unconfirmedExecuted,
        },
        {
          schema: yes(plan, 'schema') && invalidExecuted === 0,
          authorization: yes(plan, 'auth') && unauthorizedExecuted === 0,
          confirmation: yes(plan, 'confirmation') && unconfirmedExecuted === 0,
        },
        `Недопустимые выполненные вызовы: schema=${invalidExecuted}, authorization=${unauthorizedExecuted}, confirmation=${unconfirmedExecuted}.`,
      );
    },
  ),
  family(
    'native-an-restore',
    'android',
    'Android: сохранение черновика при process recreation',
    [
      ['persist', 'Сохранять черновик в Room'],
      ['identity', 'Хранить черновик по document ID'],
      ['restore', 'Восстанавливать по SavedStateHandle key'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        documentId: `doc-${seed}-${index % 3}`,
        draft: `edit-${index}`,
        event: index % 2 ? 'configuration-change' : 'process-death',
      })),
    {},
    'Room сохраняет последний черновик каждого document ID. Process death уничтожает память ViewModel; восстановление должно использовать сохранённый ключ и собственный document ID.',
    'Количество документов выросло; rotation и process death чередуются.',
    (data, plan) => {
      const store = new Map<string, string>();
      let lost = 0;
      let wrongDocument = 0;
      for (const row of data.rows) {
        const key = yes(plan, 'identity') ? String(row.documentId) : 'global';
        if (yes(plan, 'persist')) store.set(key, String(row.draft));
        const restored = yes(plan, 'restore') ? store.get(key) : undefined;
        if (row.event === 'process-death' && restored !== row.draft) lost++;
      }
      if (!yes(plan, 'identity'))
        wrongDocument = Math.max(0, new Set(data.rows.map((row) => row.documentId)).size - 1);
      return result(
        { lost, wrongDocument, savedDocuments: store.size },
        {
          processDeath: lost === 0,
          identity: wrongDocument === 0,
          restoration: yes(plan, 'restore'),
        },
        `Потеря при process death: ${lost}; конфликт document identity: ${wrongDocument}.`,
      );
    },
  ),
  family(
    'native-an-offline',
    'android',
    'Android: offline edits и запоздалый ack',
    [
      ['persist', 'Сохранять pending edit в Room'],
      ['revision', 'Применять ack только к отправленной ревизии'],
      ['action', 'Повторять с тем же action ID'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        actionId: seed + index,
        sentRevision: index,
        currentRevision: index + (index % 2),
        retries: 1 + (index % 3),
      })),
    {},
    'Pending edit переживает завершение процесса. Ack прежней ревизии не стирает новую правку. Повтор сохраняет action ID и не создаёт второе действие.',
    'Новые offline edits чаще изменяются во время синхронизации; пересчитайте потерянные ревизии.',
    (data, plan) => {
      const lostPending = yes(plan, 'persist') ? 0 : data.rows.length;
      const overwritten = yes(plan, 'revision')
        ? 0
        : data.rows.filter((row) => row.sentRevision !== row.currentRevision).length;
      const duplicates = yes(plan, 'action')
        ? 0
        : data.rows.reduce((sum, row) => sum + num(row, 'retries') - 1, 0);
      return result(
        { lostPending, overwritten, duplicates },
        { persistence: lostPending === 0, revision: overwritten === 0, action: duplicates === 0 },
        `Потеря pending: ${lostPending}; стёртых новых правок: ${overwritten}; дополнительных эффектов: ${duplicates}.`,
      );
    },
  ),
  family(
    'native-an-frame',
    'android',
    'Android: frame budget и resource pressure',
    [
      ['io', 'Вынести disk IO в Dispatchers.IO'],
      ['cpu', 'Вынести CPU work в Dispatchers.Default'],
      ['images', 'Декодировать thumbnail по размеру'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        diskMs: 12 + (seed % 17),
        computeMs: 20 + index + ((seed >>> 5) % 13),
        fullImageMb: 8 + index,
        thumbnailMb: 0.2,
      })),
    { frameBudgetMs: 16, memoryBudgetMb: 16 },
    'UI frame не превышает 16 мс работы; декодированные изображения не превышают 16 MiB. IO и CPU имеют отдельные подходящие dispatchers.',
    'Лента выросла; проверьте UI работу и пиковую память.',
    (data, plan) => {
      const mainMs = Math.max(
        ...data.rows.map(
          (row) =>
            (yes(plan, 'io') ? 0 : num(row, 'diskMs')) +
            (yes(plan, 'cpu') ? 0 : num(row, 'computeMs')),
        ),
      );
      const imageMb = data.rows.reduce(
        (sum, row) => sum + num(row, yes(plan, 'images') ? 'thumbnailMb' : 'fullImageMb'),
        0,
      );
      return result(
        { mainMs, imageMb },
        {
          frame: mainMs <= num(data.parameters, 'frameBudgetMs'),
          memory: imageMb <= num(data.parameters, 'memoryBudgetMb'),
        },
        `Main thread: ${mainMs} мс; изображения: ${imageMb.toFixed(1)} MiB.`,
      );
    },
  ),
  family(
    'native-io-scene',
    'ios',
    'iOS: SceneStorage key и persistent draft',
    [
      ['persist', 'Сохранять черновик в persistent store'],
      ['scene', 'Разделять маршрут по scene ID'],
      ['key', 'Восстанавливать объект по SceneStorage key'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        sceneId: `scene-${index % 3}`,
        documentId: `doc-${seed + index}`,
        draft: `text-${index}`,
        transition: index % 2 ? 'inactive' : 'terminated',
      })),
    {},
    'Завершение процесса не сохраняет память view. Каждая scene восстанавливает собственный маршрут и черновик по устойчивому ключу.',
    'Появились дополнительные scenes и новые document IDs; проверьте независимость восстановления.',
    (data, plan) => {
      const lostDrafts = yes(plan, 'persist')
        ? 0
        : data.rows.filter((row) => row.transition === 'terminated').length;
      const wrongRoutes = yes(plan, 'scene')
        ? 0
        : Math.max(0, new Set(data.rows.map((row) => row.sceneId)).size - 1);
      const missingObjects = yes(plan, 'key') ? 0 : data.rows.length;
      return result(
        { lostDrafts, wrongRoutes, missingObjects },
        { draft: lostDrafts === 0, scene: wrongRoutes === 0, key: missingObjects === 0 },
        `Потерянных drafts: ${lostDrafts}; смешанных scene routes: ${wrongRoutes}; невосстановленных объектов: ${missingObjects}.`,
      );
    },
  ),
  family(
    'native-io-actors',
    'ios',
    'iOS: MainActor, reentrancy и cancellation',
    [
      ['actor', 'Обновлять UI через MainActor'],
      ['recheck', 'Проверять revision после await'],
      ['cancel', 'Отбрасывать отменённый результат'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        requestId: seed + index,
        actor: index % 2 ? 'MainActor' : 'worker',
        revisionBefore: index,
        revisionAfter: index + (index % 3),
        cancelled: index % 4 === 0,
      })),
    {},
    'UI меняется только в MainActor. После await устаревшая revision и отменённая task не применяют результат.',
    'Новые tasks завершаются в другом порядке и чаще меняют revision после await.',
    (data, plan) => {
      const isolationViolations = yes(plan, 'actor')
        ? 0
        : data.rows.filter((row) => row.actor !== 'MainActor').length;
      const staleWrites = yes(plan, 'recheck')
        ? 0
        : data.rows.filter((row) => row.revisionBefore !== row.revisionAfter).length;
      const cancelledWrites = yes(plan, 'cancel')
        ? 0
        : data.rows.filter((row) => row.cancelled).length;
      return result(
        { isolationViolations, staleWrites, cancelledWrites },
        {
          isolation: isolationViolations === 0,
          revision: staleWrites === 0,
          cancellation: cancelledWrites === 0,
        },
        `Нарушений isolation: ${isolationViolations}; устаревших записей: ${staleWrites}; записей отменённой task: ${cancelledWrites}.`,
      );
    },
  ),
  family(
    'native-io-bgtime',
    'ios',
    'iOS: BGTask expiration и checkpoint',
    [
      ['expiration', 'Останавливать работу по expiration'],
      ['checkpoint', 'Сохранять прогресс перед завершением'],
      ['completion', 'Сообщать completion после результата'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        taskId: seed + index,
        requiredMs: 200 + index * 40,
        grantedMs: 230 + (seed % 50),
        completed: index % 3 === 0,
      })),
    {},
    'Превышение предоставленного окна недопустимо. Незавершённая работа сохраняет checkpoint; completion отражает реальный терминальный исход.',
    'Количество незавершённых tasks выросло; проверьте обработку ограниченного окна.',
    (data, plan) => {
      const overrun = yes(plan, 'expiration')
        ? 0
        : data.rows.reduce(
            (sum, row) => sum + Math.max(0, num(row, 'requiredMs') - num(row, 'grantedMs')),
            0,
          );
      const lostProgress = yes(plan, 'checkpoint')
        ? 0
        : data.rows.filter((row) => !row.completed).length;
      const falseCompletion = yes(plan, 'completion')
        ? 0
        : data.rows.filter((row) => !row.completed).length;
      return result(
        { overrun, lostProgress, falseCompletion },
        { window: overrun === 0, checkpoint: lostProgress === 0, outcome: falseCompletion === 0 },
        `Выход за окно: ${overrun} мс; потерянный прогресс: ${lostProgress}; ложный completion: ${falseCompletion}.`,
      );
    },
  ),
  family(
    'native-se-authz',
    'security',
    'AppSec: object, tenant и function policy',
    [
      ['tenant', 'Enforce tenant scope'],
      ['owner', 'Enforce object ownership'],
      ['function', 'Enforce право на export'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        subjectTenant: (seed + index) % 3,
        objectTenant: ((seed >>> 3) + index) % 4,
        subjectId: seed + index,
        ownerId: seed + index + (((seed >>> 7) + index) % 3 === 0 ? 0 : 1),
        action: index % 2 ? 'read' : 'export',
        canExport: (seed + index) % 5 === 0,
      })),
    {},
    'Запрос к другому tenant запрещён. Чтение требует ownership. Export дополнительно требует соответствующего права; UI не является enforcement. Все три серверные проверки обязательны независимо от текущей выборки.',
    'Расширился набор объектов и субъектов; повторно проверьте каждый запрос.',
    (data, plan) => {
      let crossTenant = 0,
        wrongOwner = 0,
        forbiddenExport = 0;
      const accepted = data.rows.filter(
        (row) =>
          (!yes(plan, 'tenant') || row.subjectTenant === row.objectTenant) &&
          (!yes(plan, 'owner') || row.subjectId === row.ownerId) &&
          (!yes(plan, 'function') || row.action !== 'export' || row.canExport),
      );
      for (const row of accepted) {
        if (row.subjectTenant !== row.objectTenant) crossTenant++;
        if (row.subjectId !== row.ownerId) wrongOwner++;
        if (row.action === 'export' && !row.canExport) forbiddenExport++;
      }
      return result(
        { acceptedRequests: accepted.length, crossTenant, wrongOwner, forbiddenExport },
        {
          tenant: yes(plan, 'tenant') && crossTenant === 0,
          owner: yes(plan, 'owner') && wrongOwner === 0,
          function: yes(plan, 'function') && forbiddenExport === 0,
        },
        `Недопустимые решения policy: tenant=${crossTenant}, ownership=${wrongOwner}, export=${forbiddenExport}.`,
      );
    },
  ),
  family(
    'native-se-provenance',
    'security',
    'AppSec: provenance и release digest',
    [
      ['digest', 'Проверять artifact digest'],
      ['builder', 'Проверять trusted builder'],
      ['approval', 'Enforce release approval'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        artifact: `build-${seed}-${index}`,
        digestMatches: index !== 0 && (seed + index) % 7 !== 0,
        trustedBuilder: index !== 1 && ((seed >>> 3) + index) % 5 !== 0,
        approved: index !== 2 && ((seed >>> 7) + index) % 3 === 0,
      })),
    {},
    'Release принимает только артефакт с совпадающим digest, доверенным builder и обязательным approval. Mutable tag не заменяет digest. Все три проверки обязательны независимо от текущей выборки.',
    'Добавлены новые сборки и разные builder identities; проверяйте каждую публикацию.',
    (data, plan) => {
      const accepted = data.rows.filter(
        (row) =>
          (!yes(plan, 'digest') || row.digestMatches) &&
          (!yes(plan, 'builder') || row.trustedBuilder) &&
          (!yes(plan, 'approval') || row.approved),
      );
      const wrongDigest = accepted.filter((row) => !row.digestMatches).length;
      const untrusted = accepted.filter((row) => !row.trustedBuilder).length;
      const unapproved = accepted.filter((row) => !row.approved).length;
      return result(
        { acceptedArtifacts: accepted.length, wrongDigest, untrusted, unapproved },
        {
          digest: yes(plan, 'digest') && wrongDigest === 0,
          builder: yes(plan, 'builder') && untrusted === 0,
          approval: yes(plan, 'approval') && unapproved === 0,
        },
        `Принятых нарушений: digest=${wrongDigest}, builder=${untrusted}, approval=${unapproved}.`,
      );
    },
  ),
  family(
    'native-se-session',
    'security',
    'AppSec: expiry, отзыв и сессионная identity',
    [
      ['expiry', 'Проверять expiry на сервере'],
      ['revocation', 'Проверять отзыв сессии'],
      ['rotation', 'Обновлять identity после входа'],
    ],
    (grade, seed) =>
      Array.from({ length: count(grade) }, (_, index) => ({
        sessionId: seed + index,
        requestAt: index === 0 ? 140 : 120 + index,
        expiresAt: 118 + (seed % 11) + (index % 3),
        revoked: index === 1 || ((seed >>> 3) + index) % 5 === 0,
        preauthIdentity: index === 2 || ((seed >>> 7) + index) % 3 === 0,
      })),
    {},
    'Истёкшая и отозванная сессия не разрешает действие. Pre-auth identity не сохраняет полномочия после аутентификации. Все три серверные проверки обязательны независимо от текущей выборки.',
    'Появились дополнительные сессии с разными временем отзыва и истечения.',
    (data, plan) => {
      const accepted = data.rows.filter(
        (row) =>
          (!yes(plan, 'expiry') || num(row, 'requestAt') <= num(row, 'expiresAt')) &&
          (!yes(plan, 'revocation') || !row.revoked) &&
          (!yes(plan, 'rotation') || !row.preauthIdentity),
      );
      const expiredAccepted = accepted.filter(
        (row) => num(row, 'requestAt') > num(row, 'expiresAt'),
      ).length;
      const revokedAccepted = accepted.filter((row) => row.revoked).length;
      const fixedIdentity = accepted.filter((row) => row.preauthIdentity).length;
      return result(
        { acceptedSessions: accepted.length, expiredAccepted, revokedAccepted, fixedIdentity },
        {
          expiry: yes(plan, 'expiry') && expiredAccepted === 0,
          revocation: yes(plan, 'revocation') && revokedAccepted === 0,
          rotation: yes(plan, 'rotation') && fixedIdentity === 0,
        },
        `Недопустимые сессии: expired=${expiredAccepted}, revoked=${revokedAccepted}, pre-auth identity=${fixedIdentity}.`,
      );
    },
  ),
];
