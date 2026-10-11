import { random } from '../random.js';
import { assessmentVersion } from './config.js';
import type {
  Artifact,
  CompetencyDimension,
  ItemFamily,
  ItemStep,
  ItemVariant,
  Stage,
  TargetGrade,
} from './model.js';

type Choice = [prompt: string, best: string, partial: string, weak: string, incorrect: string];
type Levels<T> = Record<TargetGrade, T>;
const grades: TargetGrade[] = ['Junior', 'Middle', 'Senior'];
const scope: Levels<string> = {
  Junior:
    'Один сервис и одна БД. Вы отвечаете за локальную корректность и можете изменить handler.',
  Middle: 'API, несколько workers и общая БД. Возможны параллельные запросы и частичные отказы.',
  Senior:
    'Несколько команд и регионов. Нужны совместимость, поэтапное внедрение и безопасный откат.',
};

function step(
  id: string,
  dimension: CompetencyDimension,
  choice: Choice,
  context: string,
  type: ItemStep['type'] = 'situational_choice',
  weight = 1,
): ItemStep {
  return {
    id,
    type,
    prompt: choice[0],
    context,
    options: choice.slice(1).map((text, i) => ({ id: `${id}-o${i}`, text })),
    rubric: {
      dimension,
      informationWeight: weight,
      scores: Object.fromEntries([1, 0.65, 0.3, 0].map((score, i) => [`${id}-o${i}`, score])),
      rationale: choice[1],
      expertExpectedSuccessRate: 0.65,
      expertRatings: [],
    },
  };
}
function family(
  concept: string,
  grade: TargetGrade,
  stage: Stage,
  tags: string[],
  construct: string,
  steps: ItemStep[],
  artifacts: Artifact[] = [],
  architecture = ['Client', 'API', 'Service', 'DB'],
): ItemFamily {
  return {
    id: `${stage}-${concept}-${grade.toLowerCase()}`,
    concept,
    version: '1.0.0',
    specialization: 'backend',
    targetGrade: grade,
    stage,
    difficultyBand:
      grade === 'Junior'
        ? 'local-defined'
        : grade === 'Middle'
          ? 'multi-component-ambiguous'
          : 'system-conflicting-constraints',
    measuredConstruct: construct,
    contentTags: tags,
    approved: true,
    expertCalibration: {
      status: 'provisional',
      expectedSuccessRate: grade === 'Junior' ? 0.6 : grade === 'Middle' ? 0.65 : 0.72,
      expertRatings: [],
    },
    steps: steps.map((s) => ({
      ...s,
      rubric: {
        ...s.rubric,
        expertExpectedSuccessRate: grade === 'Junior' ? 0.6 : grade === 'Middle' ? 0.65 : 0.72,
      },
    })),
    artifacts,
    architecture,
  };
}
interface Scenario {
  id: string;
  dimension: CompetencyDimension;
  tags: string[];
  context: string;
  choices: Levels<Choice>;
}
const anchors: Scenario[] = [
  {
    id: 'contract-null',
    dimension: 'correctness',
    tags: ['api-contracts'],
    context:
      'PATCH /users/{id}: поле phone может отсутствовать или быть null. Текущий handler сохраняет phone = body.phone ?? old.phone. Клиент пытается очистить номер.',
    choices: {
      Junior: [
        'Почему номер не очищается?',
        'Отсутствие поля и явный null слиты; проверять наличие ключа отдельно.',
        'Добавить отдельный endpoint очистки, сохранив текущий PATCH.',
        'Считать пустую строку сигналом очистки и обновить только клиент.',
        'Заменить PATCH на PUT без изменения обработки null.',
      ],
      Middle: [
        'Как исправить контракт для нескольких клиентов?',
        'Различать absent/null, закрепить семантику в схеме и контрактных тестах.',
        'Ввести endpoint очистки и перевести на него новые клиенты.',
        'Нормализовать null в пустую строку на API gateway.',
        'Заменять отсутствующий phone на null при каждом PATCH.',
      ],
      Senior: [
        'Legacy-клиенты посылают null как «не менять». Как внедрить очистку?',
        'Версионировать семантику, наблюдать клиентов и мигрировать поэтапно.',
        'Ввести endpoint очистки только для новых клиентов.',
        'Переключить весь трафик на новую схему после уведомления.',
        'Принять новую семантику на всех версиях и откатывать клиентами.',
      ],
    },
  },
  {
    id: 'inventory-race',
    dimension: 'correctness',
    tags: ['concurrency', 'data'],
    context:
      'Остаток товара = 1. Два запроса читают остаток, затем делают UPDATE stock SET count = count - 1. Оба получают успех.',
    choices: {
      Junior: [
        'Как сохранить неотрицательный остаток?',
        'Уменьшать count одним UPDATE с условием count > 0; проверять число строк.',
        'Сериализовать покупки внутри одного процесса.',
        'Повторно читать остаток непосредственно перед UPDATE.',
        'Отклонять повторную покупку того же пользователя.',
      ],
      Middle: [
        'Что работает при {{replicas}} replicas и повторе запроса?',
        'Атомарное списание с условием и уникальная запись операции в транзакции.',
        'Блокировка строки в транзакции без защиты повторного запроса.',
        'Распределённая блокировка товара перед отдельным UPDATE.',
        'Обновление остатка из последнего значения в кэше.',
      ],
      Senior: [
        'Как внедрить гарантию при старом writer и безопасном rollback?',
        'Сначала ограничить все writers инвариантом в БД, затем включать новый протокол.',
        'Включить новую транзакцию только в новом сервисе.',
        'Перевести запись в один регион и оставить старый writer для отката.',
        'Включить новый протокол во всех регионах одновременно.',
      ],
    },
  },
  {
    id: 'unknown-outcome',
    dimension: 'engineering_judgment',
    tags: ['reliability'],
    context:
      'POST к провайдеру завершился timeout через {{timeout}} с. Провайдер мог выполнить операцию. Есть endpoint статуса по operation_id.',
    choices: {
      Junior: [
        'Какое действие предпочтительнее?',
        'Проверить статус исходной операции перед повторной отправкой.',
        'Подождать дольше и повторить тот же запрос.',
        'Попросить клиента вручную повторить действие.',
        'Создать новую операцию с новым идентификатором.',
      ],
      Middle: [
        'Как восстановить обработку после рестарта worker?',
        'Сохранить идентичность и статус операции; сверить outcome и повторять с тем же ключом.',
        'Проверять статус в памяти worker перед повтором.',
        'Увеличить timeout и снизить число повторов.',
        'Считать timeout окончательным отказом и компенсировать сразу.',
      ],
      Senior: [
        'Провайдер хранит ключ 24 ч, очередь может ждать 48 ч. Какую гарантию принять?',
        'Сверять просроченные операции и не повторять эффект после срока ключа автоматически.',
        'Ограничить число повторов в пределах текущего бюджета.',
        'Продлить timeout для операций старше суток.',
        'Переиздать ключ после 24 ч и повторить платёж.',
      ],
    },
  },
  {
    id: 'pool-saturation',
    dimension: 'diagnosis',
    tags: ['performance', 'observability'],
    context:
      'После релиза p95 вырос с 180 ms до 2.4 s. CPU 32%, память и RPS {{rps}} без изменений. DB pool занят на 100%.',
    choices: {
      Junior: [
        'Что проверить первым?',
        'Время удержания соединений и незакрытые транзакции в handler.',
        'Время выполнения медленных SQL запросов.',
        'Профиль CPU нового handler.',
        'Число запросов на балансировщике за сутки.',
      ],
      Middle: [
        'Как различить медленный SQL и ожидание внутри транзакции?',
        'Сопоставить pool wait, query time и span внешнего вызова в одной трассе.',
        'Сравнить только план наиболее медленного SQL.',
        'Временно увеличить pool и смотреть p95.',
        'Сравнить средний CPU всех replicas.',
      ],
      Senior: [
        'Как получить evidence с минимальным blast radius?',
        'На canary измерить hold/wait и dependency spans, задать критерий отката.',
        'Откатить релиз и сравнить только общую latency.',
        'Увеличить pool во всех регионах и наблюдать очередь.',
        'Изменить timeout БД глобально и повторить нагрузку.',
      ],
    },
  },
  {
    id: 'trace-gap',
    dimension: 'diagnosis',
    tags: ['observability'],
    context:
      'API отвечает 202, worker сообщает об ошибках, но trace API заканчивается на enqueue. Время сообщений и запросов частично перекрывается.',
    choices: {
      Junior: [
        'Какие данные помогут связать сбой с запросом?',
        'Сопоставить operation_id в API log и worker log.',
        'Посмотреть stack trace одной ошибки worker.',
        'Сравнить число ошибок API и worker за минуту.',
        'Проверить общий uptime сервиса.',
      ],
      Middle: [
        'Как восстановить causal chain через очередь?',
        'Передавать correlation context, связывать producer/consumer spans и номер доставки.',
        'Поставить один trace_id всем сообщениям одной минуты.',
        'Включить полные payload logs для всех сообщений.',
        'Увеличить sampling только синхронных API spans.',
      ],
      Senior: [
        'Как сохранить диагностику при sampling и ограничении персональных данных?',
        'Связанные spans с безопасными ID, tail sampling ошибок и ограниченной retention.',
        'Полные payload logs только в одном регионе.',
        'Head sampling 100% без изменения схемы событий.',
        'Локальные IDs каждой команды с объединением по времени.',
      ],
    },
  },
  {
    id: 'deployment-expand',
    dimension: 'adaptation',
    tags: ['deployments', 'compatibility'],
    context:
      'Новый код ожидает обязательный столбец currency. Старые строки его не имеют. Старый и новый код работают одновременно при rolling deploy.',
    choices: {
      Junior: [
        'Как изменить план релиза?',
        'Сначала добавить nullable столбец и безопасное значение при чтении старых строк.',
        'Заполнить столбец перед запуском нового кода.',
        'Перезапустить сервис после добавления NOT NULL.',
        'Добавить NOT NULL столбец и сразу включить новый код.',
      ],
      Middle: [
        'Как совместить backfill и старые writers?',
        'Expand, совместимые writers/readers, backfill с проверкой, затем constraint.',
        'Backfill и новый reader с default, без изменения старого writer.',
        'Заблокировать writes на время миграции таблицы.',
        'Добавить constraint перед backfill и ретраить старые writes.',
      ],
      Senior: [
        'Rollback должен работать неделю. Когда удалить совместимость?',
        'После проверки backfill и прекращения старых writes, отдельно от окна rollback.',
        'После полного завершения первого rolling deploy.',
        'Сразу после backfill, оставив старый бинарник для rollback.',
        'По истечении часа без ошибок в новом reader.',
      ],
    },
  },
  {
    id: 'cache-permissions',
    dimension: 'engineering_judgment',
    tags: ['api-contracts', 'security'],
    context:
      'Профиль кэшируется по user_id на 10 минут. Права доступа могут быть отозваны немедленно. Cache hit возвращается до проверки прав.',
    choices: {
      Junior: [
        'Как исправить нарушение доступа?',
        'Проверять текущие права до возврата кэшированного профиля.',
        'Очищать кэш при известном изменении прав.',
        'Снизить TTL до одной минуты.',
        'Кэшировать ответ вместе с результатом прежней проверки.',
      ],
      Middle: [
        'Как обеспечить немедленный revoke при нескольких replicas?',
        'Проверка актуальных прав на каждый запрос; кэшировать данные отдельно.',
        'События revoke очищают каждый локальный кэш.',
        'Ключ включает роль, полученную из долгоживущего токена.',
        'Общий кэш профиля с TTL 10 секунд без проверки.',
      ],
      Senior: [
        'Auth зависимость недоступна, SLA чтения строгий. Как принять решение?',
        'Явная политика fail-closed для защищённых данных и деградация публичных чтений.',
        'Короткий grace period для всех ранее авторизованных пользователей.',
        'Переключение на локальный кэш прав до восстановления.',
        'Отключение проверки только в регионе с отказом auth.',
      ],
    },
  },
  {
    id: 'pagination-change',
    dimension: 'adaptation',
    tags: ['api-contracts', 'data'],
    context:
      'Список заказов использует OFFSET. Между запросами страниц поступают новые заказы. Клиент видит дубли и пропуски.',
    choices: {
      Junior: [
        'Что изменить в чтении страниц?',
        'Фиксировать порядок по времени и ID, продолжать после последнего ключа.',
        'Сортировать по ID и оставить OFFSET.',
        'Увеличить размер страницы.',
        'Удалять дубли только в текущей странице.',
      ],
      Middle: [
        'Клиенту нужен стабильный экспорт, а данные продолжают меняться. Как адаптировать?',
        'Зафиксировать snapshot watermark и использовать составной cursor.',
        'Использовать cursor без фиксации состояния экспорта.',
        'Кэшировать каждую страницу на минуту.',
        'Загрузить все данные в память API одним запросом.',
      ],
      Senior: [
        'Legacy-клиенты ожидают номера страниц и точный total. Что внедрить?',
        'Версионированный cursor export и ограниченный snapshot для старого контракта.',
        'Cursor endpoint рядом со старым без определения consistency.',
        'Заменить total приблизительной оценкой на старом endpoint.',
        'Перевести старые номера страниц в cursor только на клиенте.',
      ],
    },
  },
];

const boundaries: Scenario[] = [
  {
    id: 'replica-read',
    dimension: 'correctness',
    tags: ['consistency'],
    context:
      'После успешной записи профиль читается с replica с lag {{lag}} ms. Клиент видит старое значение.',
    choices: {
      Junior: [
        'Как обеспечить чтение своей записи?',
        'Прочитать изменённый профиль с primary после сохранения.',
        'Повторять чтение replica до изменения значения.',
        'Уменьшить TTL кэша профиля.',
        'Задержать ответ API на средний replica lag.',
      ],
      Middle: [
        'Как дать read-your-writes при балансировке?',
        'Version token направляет чтение к достигшей версии replica или primary.',
        'Закрепить клиента за одной replica и читать её после успешного write.',
        'Отключить кэш после write и оставить чтения в обычном replica pool.',
        'После HTTP 200 ждать средний lag и считать следующее чтение актуальным.',
      ],
      Senior: [
        'Регион primary недоступен. Как сохранить контракт?',
        'Отказать в чтении требуемой версии или явно сообщить деградацию, не обещая freshness.',
        'Вернуть stale значение с коротким TTL.',
        'Ждать фиксированные {{lag}} ms перед чтением другого региона.',
        'Снять version check на период failover без изменения ответа.',
      ],
    },
  },
  {
    id: 'ack-window',
    dimension: 'correctness',
    tags: ['delivery'],
    context: 'Worker ACK отправляет до COMMIT результата. Между ACK и COMMIT процесс завершился.',
    choices: {
      Junior: [
        'Какой failure window нужно закрыть?',
        'Сообщение потеряно без результата; ACK после успешной фиксации.',
        'Добавить retry при ошибке COMMIT.',
        'Увеличить visibility timeout.',
        'Повторять ACK после рестарта без чтения сообщения.',
      ],
      Middle: [
        'Как закрыть потерю и повтор после COMMIT?',
        'COMMIT результата и ключа обработки атомарно, затем ACK; дубликат читает результат.',
        'ACK после COMMIT без записи идентичности обработки.',
        'Записать processed перед выполнением эффекта.',
        'Разнести COMMIT и ACK в две независимые очереди.',
      ],
      Senior: [
        'Consumer мигрирует, старые keys несовместимы. Как сохранить replay?',
        'Версионировать identity, сохранить legacy lookup и контролировать replay окно.',
        'Включить новую identity только новым consumers.',
        'Удалить старые keys после первого успешного сообщения.',
        'Считать все сообщения старого consumer уже обработанными.',
      ],
    },
  },
  {
    id: 'latency-average',
    dimension: 'diagnosis',
    tags: ['observability'],
    context: 'Средняя latency 80 ms, p99 = 8 s. Ошибок нет. Жалобы приходят от одного tenant.',
    choices: {
      Junior: [
        'Какие данные собрать?',
        'Latency и queue wait для запросов проблемного tenant.',
        'Наиболее медленные запросы всей системы.',
        'Среднюю latency за неделю.',
        'Суммарный uptime API.',
      ],
      Middle: [
        'Как проверить noisy-neighbor гипотезу?',
        'Связать tenant latency, общие лимиты и очередь ресурсов по одному временному окну.',
        'Сравнить только RPS проблемного tenant.',
        'Проверить общее число соединений за сутки.',
        'Отключить tenant routing перед сбором трасс.',
      ],
      Senior: [
        'Cardinality метрик ограничена. Как получить evidence?',
        'Сэмплированные traces по affected cohort и bounded metrics очередей.',
        'Отдельная постоянная metric label для каждого пользователя.',
        'Полные request bodies в централизованном log.',
        'Сравнение глобальных averages двух регионов.',
      ],
    },
  },
  {
    id: 'clock-order',
    dimension: 'diagnosis',
    tags: ['observability', 'causality'],
    context:
      'Worker log timestamp на 400 ms раньше producer log. Часы хостов расходятся на 600 ms. Сообщения имеют operation_id и sequence.',
    choices: {
      Junior: [
        'Что позволяет установить порядок?',
        'Operation_id и sequence, а не только wall-clock timestamps.',
        'Порядок строк в объединённом log файле.',
        'Средняя разница времени двух хостов.',
        'Количество сообщений до и после релиза.',
      ],
      Middle: [
        'Какие события связать для causal chain?',
        'Enqueue/delivery/commit одной операции с delivery attempt и sequence.',
        'Логи одного worker отсортированные по времени.',
        'Ближайшие timestamps разных operations.',
        'Только последний log перед ошибкой.',
      ],
      Senior: [
        'Есть межрегиональный replay. Что нужно доказать?',
        'Identity, sequence и epoch подтверждают causal order и происхождение записи.',
        'Синхронизация часов региона достаточна для порядка.',
        'Последний timestamp определяет действующий writer.',
        'Регион с большим числом сообщений считается первичным.',
      ],
    },
  },
  {
    id: 'retry-budget',
    dimension: 'engineering_judgment',
    tags: ['reliability', 'cost'],
    context:
      'Downstream перегружен. Каждый из {{replicas}} workers делает 4 немедленных повтора. Основной SLA — не усугубить отказ и сохранить задания.',
    choices: {
      Junior: [
        'Как ограничить повторную нагрузку?',
        'Ограниченные повторы с задержкой и сохранение неуспешного задания.',
        'Увеличить timeout без изменения частоты retries.',
        'Снизить число workers вдвое.',
        'Отправлять новый запрос сразу после каждой ошибки.',
      ],
      Middle: [
        'Как избежать retry amplification между слоями?',
        'Один владелец retry, общий budget, backoff с jitter и наблюдаемая очередь.',
        'Backoff на каждом слое с прежним количеством retries.',
        'Общий фиксированный timeout для всех слоёв.',
        'Повысить concurrency worker чтобы быстрее пройти очередь.',
      ],
      Senior: [
        'Стоимость растёт, очередь приближается к пределу. Какую деградацию выбрать?',
        'Admission control по приоритету, retry budget и явный SLA deferred операций.',
        'Глобально отключить retries на сутки.',
        'Временно увеличить очередь без предела.',
        'Перенести все retries в регион с запасом CPU.',
      ],
    },
  },
  {
    id: 'index-rollout',
    dimension: 'engineering_judgment',
    tags: ['deployments', 'data'],
    context:
      'Нужен индекс на большой таблице. Обычное CREATE INDEX блокирует writes. Допустимый перерыв — менее секунды.',
    choices: {
      Junior: [
        'Какой план учитывает ограничение?',
        'Использовать неблокирующее создание с проверкой готовности индекса.',
        'Создать индекс в момент минимального RPS.',
        'Увеличить timeout запросов на время создания.',
        'Остановить API до завершения индексирования.',
      ],
      Middle: [
        'Что проверить до смены query plan?',
        'Проверить invalid index, load и готовность; включать запрос после проверки.',
        'Создать неблокирующий индекс и сразу переключить query.',
        'Добавить больше replicas перед индексированием.',
        'Принудить planner использовать индекс ещё до готовности.',
      ],
      Senior: [
        'На одном shard нет места; нужен rollback. Как принять rollout?',
        'По shard gates ёмкости и latency; сохранять старый query path до приёмки.',
        'Начать со shard с наибольшей нагрузкой.',
        'Включить query глобально после успеха одного shard.',
        'Удалить старые индексы до создания нового.',
      ],
    },
  },
  {
    id: 'schema-message',
    dimension: 'adaptation',
    tags: ['compatibility', 'delivery'],
    context:
      'Consumer ожидает amount в рублях. Новый producer пишет amount в копейках. Старые сообщения остаются в очереди.',
    choices: {
      Junior: [
        'Как читать обе формы корректно?',
        'Добавить version/unit и явно разбирать старый и новый формат.',
        'Умножать amount на 100 только при небольшом значении.',
        'Очистить очередь перед релизом producer.',
        'Интерпретировать все сообщения как новый формат.',
      ],
      Middle: [
        'Как адаптировать порядок deployment?',
        'Сначала dual reader, затем versioned producer; учитывать replay старых сообщений.',
        'Одновременно обновить producer и consumer.',
        'Новый producer пишет оба значения без version.',
        'Остановить consumer пока очередь не опустеет.',
      ],
      Senior: [
        'Legacy consumer нельзя обновить месяц. Как изменить план?',
        'Версионированный поток/адаптер с контролем доставок и обратимого переключения.',
        'Согласовать дату обновления без промежуточного контракта.',
        'Публиковать оба формата в один topic для всех consumers.',
        'Поменять unit только в документации API.',
      ],
    },
  },
  {
    id: 'ttl-contract',
    dimension: 'adaptation',
    tags: ['consistency', 'cache'],
    context:
      'Кэш каталога с TTL 5 минут подходит для описаний. Теперь поле availability используется для резервирования последней единицы.',
    choices: {
      Junior: [
        'Как изменится решение?',
        'Проверять и списывать остаток атомарно в БД, кэш оставить для описания.',
        'Уменьшить TTL availability до секунды.',
        'Очищать кэш после каждого резервирования.',
        'Доверять последнему значению availability в клиенте.',
      ],
      Middle: [
        'Что адаптировать при нескольких replicas?',
        'Авторитетная операция резерва в БД; кэш не участвует в инварианте остатка.',
        'Рассылать invalidation events всем replicas.',
        'Включить общий кэш вместо локального.',
        'Проверять availability дважды перед резервом.',
      ],
      Senior: [
        'Теперь резерв межрегиональный и важнее availability. Что определить?',
        'Явного владельца инварианта, границы недоступности и наблюдаемые отказы резерва.',
        'Региональные остатки с reconciliation в конце дня.',
        'Уменьшить TTL глобального кэша до 100 ms.',
        'Разрешить запись каждому региону при потере связи.',
      ],
    },
  },
];

interface IncidentSpec {
  id: string;
  tags: string[];
  context: Levels<string>;
  artifacts: Levels<Artifact[]>;
  investigate: Levels<Choice>;
  interpretation: Levels<Choice>;
  cause: Levels<Choice>;
  remediation: Levels<Choice>;
  truth: Levels<string>;
}
const artifact = (id: string, label: string, content: string, usefulness: number): Artifact => ({
  id,
  label,
  content,
  usefulness,
});
const incidents: IncidentSpec[] = [
  {
    id: 'payment-outcome',
    tags: ['reliability', 'delivery'],
    context: {
      Junior:
        'После timeout клиент повторяет оплату. В БД два списания за один заказ. API → Service → DB.',
      Middle:
        'Worker вызывает провайдера; после timeout {{timeout}} с и рестарта повторяет оплату. У заказа два provider_charge_id. API → DB → Queue → Worker → Provider.',
      Senior:
        'Во время миграции legacy gateway в двух регионах появились дубли оплат старше суток. Старый gateway не передаёт стабильный ключ; новый хранит его 24 ч. Нужны безопасное внедрение и rollback.',
    },
    artifacts: {
      Junior: [
        artifact(
          'logs',
          'Logs',
          'order=42 request=a INSERT debit\norder=42 request=b INSERT debit after timeout',
          1,
        ),
        artifact('metrics', 'Metrics', 'CPU=24%; error_rate=0.2%; retry_count=2', 0.3),
        artifact('trace', 'Trace', 'POST /pay: commit at 140 ms, response lost at network', 0.8),
        artifact('db', 'DB records', 'order 42: debit A, debit B; operation key absent', 1),
        artifact('queue', 'Queue events', 'Этот локальный handler не использует очередь.', 0.1),
      ],
      Middle: [
        artifact(
          'logs',
          'Logs',
          'order=42 attempt=1 provider timeout\nrestart\norder=42 attempt=2 key=new-id outcome=charged',
          0.9,
        ),
        artifact('metrics', 'Metrics', 'provider p99={{timeout}}s; queue lag=1s; API CPU=24%', 0.3),
        artifact('trace', 'Trace', 'provider key=K1 commit; response lost; retry key=K2 commit', 1),
        artifact('db', 'DB records', 'order=42 charge_id=A key=K1; charge_id=B key=K2', 1),
        artifact(
          'queue',
          'Queue events',
          'message=42 delivery_attempt=2 after visibility timeout',
          0.65,
        ),
      ],
      Senior: [
        artifact(
          'logs',
          'Logs',
          'legacy region=B retry age=27h key=random\nnew gateway retention=24h',
          0.8,
        ),
        artifact('metrics', 'Metrics', 'duplicate cohort: legacy age>24h; new age<24h clean', 0.8),
        artifact(
          'trace',
          'Trace',
          'intent=42 first key=old-42; replay key=new-42 after failover',
          1,
        ),
        artifact(
          'db',
          'DB records',
          'intent=42 two provider receipts; dedup key expired; identity mapping absent',
          1,
        ),
        artifact('queue', 'Queue events', 'replay age=27h, original legacy operation_id=42', 0.8),
      ],
    },
    investigate: {
      Junior: [
        'Какую гипотезу проверить первой?',
        'Повтор создал второй эффект после потерянного ответа.',
        'Первое списание откатилось после timeout.',
        'Витрина заказов отстала от БД.',
        'CPU задержал ответ и создал вторую строку.',
      ],
      Middle: [
        'Какой следующий шаг сужает причины?',
        'Связать исходный и повторный provider вызов по identity и результату.',
        'Сравнить общую latency API и worker.',
        'Проверить длительность SQL запроса заказов.',
        'Измерить число replicas перед следующим retry.',
      ],
      Senior: [
        'Как сузить область сбоя?',
        'Сравнить legacy/new cohorts по возрасту операции, ключу и региону replay.',
        'Сравнить общий error rate двух регионов.',
        'Измерить throughput провайдера после failover.',
        'Сопоставить размер payload старого и нового gateway.',
      ],
    },
    interpretation: {
      Junior: [
        'Что следует из DB и trace?',
        'Первый эффект завершён; потеря ответа не означает откат.',
        'Провайдер должен откатить эффект после timeout.',
        'Оба debit соответствуют разным заказам.',
        'Списания возникли из-за слишком короткой транзакции.',
      ],
      Middle: [
        'Что следует из trace и DB?',
        'Повтор с новым ключом создал отдельный эффект после успешного первого.',
        'Повторная доставка сама доказывает rollback первого эффекта.',
        'Queue ACK был отправлен два раза, поэтому БД дублирует.',
        'Дубли объясняются исключительно replica lag.',
      ],
      Senior: [
        'Какое заключение поддержано artifacts?',
        'Identity теряется на legacy replay; истёкшее окно dedup не защищает новый ключ.',
        'Проблема только в latency нового gateway.',
        'Новый gateway безопасен для replay любого возраста.',
        'Регион B пишет неверную валюту в provider request.',
      ],
    },
    cause: {
      Junior: [
        'Какова root cause?',
        'Нет идентичности повторной операции при unknown outcome.',
        'Два обработчика независимо создают списание до фиксации общего результата.',
        'Клиент отправил две различные покупки, которые ошибочно имеют один order_id.',
        'Replica вернула старый outcome, хотя повторной записи списания не было.',
      ],
      Middle: [
        'Какая causal chain объясняет дубли?',
        'Effect committed → response lost → restart → new key → second effect.',
        'Queue lag → DB lag → две записи одного provider receipt.',
        'High CPU → slow SQL → повторный ACK.',
        'Provider timeout → обязательный rollback → новый charge.',
      ],
      Senior: [
        'Где нарушена гарантия?',
        'Replay horizon превышает retention, legacy identity не переносится между gateway.',
        'Failover всегда требует нового ключа операции.',
        'Старые clients используют меньший timeout.',
        'Схема DB не содержит регион в имени таблицы.',
      ],
    },
    truth: {
      Junior:
        'Команда установила: первое списание сохранено; повтор без стабильного operation_id создал второе.',
      Middle:
        'Команда установила: провайдер выполнил эффект, ответ потерян, worker после рестарта создал новый ключ.',
      Senior:
        'Команда установила: replay старше retention и потеря legacy identity обходят дедупликацию. Это исходные данные для следующего шага независимо от предыдущего ответа.',
    },
    remediation: {
      Junior: [
        'Как исправить с установленной причиной?',
        'Записывать operation_id и эффект атомарно; повтор возвращает сохранённый результат.',
        'Проверять наличие заказа перед отдельным INSERT debit.',
        'Увеличить timeout перед повтором.',
        'Ограничить повтор одним запросом в минуту.',
      ],
      Middle: [
        'Как восстановить работу после неизвестного outcome?',
        'Сохранённый intent/identity, provider status lookup и retry с исходным ключом.',
        'Стабильный ключ только в памяти worker до ACK.',
        'Новый ключ после каждого рестарта с ограниченным budget.',
        'Компенсация каждого timeout до проверки provider status.',
      ],
      Senior: [
        'Как безопасно внедрить решение?',
        'Legacy identity mapping, age gate со сверкой outcome, cohort rollout и rollback без потери ключей.',
        'Продлить хранение ключей нового gateway до 48 ч.',
        'Отменить replay старых сообщений в обоих регионах.',
        'Включить новую схему на всём трафике после canary latency check.',
      ],
    },
  },
  {
    id: 'connection-hold',
    tags: ['performance', 'observability'],
    context: {
      Junior:
        'После нового handler DB pool занят. RPS {{rps}}, CPU 32%. Service читает профиль и вызывает HTTP API внутри транзакции.',
      Middle:
        'API → DB → External API. После релиза p95=2.4s, pool wait=2.1s. SQL p95=12ms, external p95=2s. Несколько replicas используют общий лимит соединений.',
      Senior:
        'В двух регионах pool exhaustion после canary. Новый flow держит DB transaction во время внешнего risk-check. Требуется свежесть решения; внешний ответ может потеряться. Rollback не должен восстановить опасный flow.',
    },
    artifacts: {
      Junior: [
        artifact('logs', 'Logs', 'BEGIN; SELECT profile; call external 2100ms; COMMIT', 1),
        artifact('metrics', 'Metrics', 'pool_used=100%; sql_p95=12ms; CPU=32%', 1),
        artifact('trace', 'Trace', 'db connection hold=2150ms; HTTP wait=2100ms', 1),
        artifact('db', 'DB records', 'lock_wait=0; active transaction awaits client', 0.8),
        artifact('queue', 'Queue events', 'Очередь в этом синхронном flow не используется.', 0.1),
      ],
      Middle: [
        artifact(
          'logs',
          'Logs',
          'pool acquire waited 2100ms; BEGIN; external request delayed',
          0.8,
        ),
        artifact('metrics', 'Metrics', 'pool wait p95=2.1s; SQL p95=12ms; hold p95=2.2s', 1),
        artifact('trace', 'Trace', 'connection acquired → query 12ms → external 2s → commit', 1),
        artifact('db', 'DB records', 'pg activity: idle in transaction; lock wait=0', 0.9),
        artifact('queue', 'Queue events', 'Background worker queue lag=50ms; rate stable.', 0.2),
      ],
      Senior: [
        artifact(
          'logs',
          'Logs',
          'risk-check waits inside DB transaction; retry after unknown response',
          0.8,
        ),
        artifact(
          'metrics',
          'Metrics',
          'canary hold=2.2s; control hold=20ms; pool cap shared across replicas',
          1,
        ),
        artifact(
          'trace',
          'Trace',
          'risk-check span nested in DB transaction; version read before wait',
          1,
        ),
        artifact(
          'db',
          'DB records',
          'many idle-in-transaction connections, no lock contention; profile version changes',
          0.9,
        ),
        artifact(
          'queue',
          'Queue events',
          'async jobs latency unchanged; no delivery anomalies',
          0.2,
        ),
      ],
    },
    investigate: {
      Junior: [
        'Какую гипотезу исследовать?',
        'Соединение удерживается во время HTTP ожидания.',
        'Каждый SQL стал вычислительно дорогим.',
        'Очередь фоновых jobs задерживает API.',
        'CPU API не справляется с сериализацией.',
      ],
      Middle: [
        'Как отделить причину от симптома?',
        'Разделить pool acquire wait, SQL time и connection hold на одной трассе.',
        'Увеличить pool, затем измерить общий p95.',
        'Сравнить query text до и после релиза.',
        'Проверить число DB rows после релиза.',
      ],
      Senior: [
        'Какая проверка наиболее информативна?',
        'Сравнить hold time canary/control и placement risk-check при одинаковом RPS.',
        'Сравнить средний CPU регионов.',
        'Увеличить DB connections всех replicas.',
        'Переключить весь трафик в регион без canary.',
      ],
    },
    interpretation: {
      Junior: [
        'Что следует из trace?',
        'HTTP занимает соединение, хотя SQL быстрый.',
        'DB lock удерживается другим запросом.',
        'HTTP вызов начинается после COMMIT.',
        'Connection wait возникает из-за большого результата SELECT.',
      ],
      Middle: [
        'Что объясняет metrics и DB activity?',
        'Pool насыщен длительным hold, SQL не является узким местом.',
        'БД вычисляет каждый запрос около двух секунд.',
        'Фоновые jobs занимают все locks.',
        'CPU загрузка не позволяет увеличивать pool.',
      ],
      Senior: [
        'Какая связь подтверждается?',
        'Canary добавил ожидание risk-check в transaction; свежесть read при этом не гарантирована.',
        'Pool cap является единственным дефектом архитектуры.',
        'Только control cohort удерживает соединение.',
        'Risk-check и состояние профиля атомарны благодаря HTTP внутри BEGIN.',
      ],
    },
    cause: {
      Junior: [
        'Какова причина деградации?',
        'Внешний вызов удерживает транзакцию и connection.',
        'Недостаточный размер SQL индекса.',
        'Replica lag увеличивает connection hold.',
        'Высокий backlog очереди сообщений.',
      ],
      Middle: [
        'Как выглядит causal chain?',
        'External delay → long hold → pool saturation → acquire wait → API latency.',
        'SQL scan → high CPU → external timeout.',
        'Queue lag → lock contention → HTTP fail.',
        'API p95 → более быстрые retries → меньший hold.',
      ],
      Senior: [
        'Какое предположение было неверным?',
        'Длительная transaction вокруг HTTP не делает внешнее решение атомарным и свежим.',
        'Все DB transactions должны быть синхронными.',
        'Canary нельзя сравнивать с control cohort.',
        'Общий DB limit достаточен для любого числа replicas.',
      ],
    },
    truth: {
      Junior:
        'Дополнительная диагностика установила: HTTP ожидание держит connection; SQL выполняется за 12ms.',
      Middle:
        'Команда установила: внешнее ожидание удерживает DB transaction и насыщает общий pool. Lock contention отсутствует.',
      Senior:
        'Команда установила: внешний risk-check внутри transaction увеличил hold и не обеспечил атомарность. Состояние профиля может измениться за время ожидания.',
    },
    remediation: {
      Junior: [
        'Какое локальное исправление предпочтительнее?',
        'Закрыть транзакцию перед внешним чтением и не удерживать connection на HTTP.',
        'Увеличить pool до большего числа соединений.',
        'Снизить HTTP timeout, оставив вызов внутри BEGIN.',
        'Кэшировать всю страницу пользователя на пять минут.',
      ],
      Middle: [
        'Как сохранить корректность, сократив hold?',
        'Внешний вызов вне transaction; короткий commit с проверкой версии и ограниченным retry.',
        'Просто вынести HTTP после COMMIT без проверки версии.',
        'Удвоить pool каждой replica.',
        'Поставить mutex только вокруг HTTP вызова.',
      ],
      Senior: [
        'Какой план соответствует всем ограничениям?',
        'Versioned intent, внешний check вне transaction, conditional commit; canary gates и совместимый rollback.',
        'Вынести HTTP из transaction и оставить прежний контракт результата.',
        'Создать отдельный большой DB pool для risk-check.',
        'Откатить binary без проверки сохранённых intents.',
      ],
    },
  },
  {
    id: 'queue-redelivery',
    tags: ['reliability', 'delivery'],
    context: {
      Junior:
        'Worker отправляет письмо, затем записывает processed. После рестарта клиент получил письмо дважды.',
      Middle:
        'Queue → Worker → DB → Provider. Delivery at-least-once, visibility timeout {{timeout}} с, обработка 40 с. Один event одновременно получают несколько workers.',
      Senior:
        'При replay backlog после regional failover старый и новый consumer одновременно выполняют внешние effects. Требуется ограничить blast radius и сохранить accepted jobs.',
    },
    artifacts: {
      Junior: [
        artifact('logs', 'Logs', 'event=42 send email ok; worker crash; event=42 send email ok', 1),
        artifact('metrics', 'Metrics', 'delivery_attempt=2; CPU=20%; queue lag=1s', 0.6),
        artifact('trace', 'Trace', 'effect committed before processed write; crash in gap', 1),
        artifact(
          'db',
          'DB records',
          'processed missing after first send; provider receipt exists',
          0.9,
        ),
        artifact('queue', 'Queue events', 'event=42 delivered again after worker exit', 0.8),
      ],
      Middle: [
        artifact(
          'logs',
          'Logs',
          'event=42 worker=A begin; worker=B begin after visibility expired',
          0.8,
        ),
        artifact(
          'metrics',
          'Metrics',
          'duration=40s; visibility={{timeout}}s; duplicates correlate with redelivery',
          0.9,
        ),
        artifact(
          'trace',
          'Trace',
          'same event two workers; both SELECT processed false; both effect',
          1,
        ),
        artifact(
          'db',
          'DB records',
          'processed key lacks unique constraint; effects=2 event=42',
          1,
        ),
        artifact(
          'queue',
          'Queue events',
          'message=42 delivery attempts 1,2 overlap; same event_id',
          1,
        ),
      ],
      Senior: [
        artifact(
          'logs',
          'Logs',
          'old region writer epoch=7; new writer epoch=8; both apply event=42',
          0.9,
        ),
        artifact(
          'metrics',
          'Metrics',
          'duplicates only failover/replay cohort; accepted jobs count stable',
          0.8,
        ),
        artifact(
          'trace',
          'Trace',
          'event=42 delayed old writer commit after new writer success',
          1,
        ),
        artifact(
          'db',
          'DB records',
          'epoch not checked on write; processed identity differs by region',
          1,
        ),
        artifact(
          'queue',
          'Queue events',
          'replay preserves event_id but resets regional message_id',
          0.9,
        ),
      ],
    },
    investigate: {
      Junior: [
        'Что исследовать первым?',
        'Окно между внешним эффектом и записью processed.',
        'Latency отправки письма.',
        'Общий размер очереди.',
        'Записи статуса отправки и правила повторного выбора адресата.',
      ],
      Middle: [
        'Как проверить гипотезу о параллельной доставке?',
        'Связать event_id, delivery attempts, visibility и записи обработчиков.',
        'Посчитать число сообщений за сутки.',
        'Измерить только среднюю latency provider.',
        'Сравнить версии библиотек двух workers.',
      ],
      Senior: [
        'Как локализовать нарушение после failover?',
        'Связать event identity, writer epoch и delayed commits старого региона.',
        'Сравнить скорость replay двух регионов.',
        'Проверить количество replicas нового consumer.',
        'Отсортировать все effects по wall-clock времени.',
      ],
    },
    interpretation: {
      Junior: [
        'Что следует из logs и DB?',
        'Эффект уже выполнен, но marker отсутствует, поэтому повтор его воспроизводит.',
        'Provider не принял первую операцию.',
        'Очередь создала новое независимое бизнес-событие.',
        'Processed записывается раньше внешнего эффекта.',
      ],
      Middle: [
        'Что объясняет дубли?',
        'Visibility истекает, checks processed неатомарны; две deliveries выполняют effect.',
        'Очередь обещает exactly-once и нарушает договор.',
        'Все дубли появились до первого запуска worker.',
        'Медленный SELECT сам по себе дублирует DB rows.',
      ],
      Senior: [
        'Что подтверждено trace и DB?',
        'Old writer после failover не fenced, региональная identity разделяет один event.',
        'Новый consumer потерял все accepted jobs.',
        'Дубли возможны только из-за рассинхронизации часов.',
        'Replay автоматически отменяет эффект старого writer.',
      ],
    },
    cause: {
      Junior: [
        'Какая root cause?',
        'Нет устойчивой identity эффекта при повторе после crash.',
        'Слишком большая очередь сообщений.',
        'SELECT статуса прочитал отстающую replica после успешной фиксации marker.',
        'Планировщик создал два независимых события для одного и того же адресата.',
      ],
      Middle: [
        'Какова causal chain?',
        'Long processing → redelivery overlap → non-atomic check → duplicate effect.',
        'Queue lag → duplicate unique constraint → extra effect.',
        'Slow provider → DB rollback → обязательный новый event.',
        'High RPS → новые event IDs для старых сообщений.',
      ],
      Senior: [
        'Какой инвариант не защищён?',
        'Один business event и действующий writer epoch должны ограничивать commit эффекта.',
        'В каждом регионе должно быть своё имя event.',
        'Каждый replay обязан создавать новый business event.',
        'Любой failover должен удалять processed markers.',
      ],
    },
    truth: {
      Junior:
        'Команда установила: crash после effect, до processed marker; повторная доставка выполняет тот же эффект.',
      Middle:
        'Команда установила: overlapping redelivery и неатомарная проверка processed создают дубли. Очередь штатно работает at-least-once.',
      Senior:
        'Команда установила: identity зависит от региона, old writer не ограничен epoch. Доставка очереди работает согласно контракту.',
    },
    remediation: {
      Junior: [
        'Как исправить установленную причину?',
        'Стабильный event_id у provider и сохранённый outcome; повтор сверяет прежний эффект.',
        'Записать processed перед отправкой письма.',
        'Увеличить timeout до минуты.',
        'Удалять сообщение сразу после начала обработки.',
      ],
      Middle: [
        'Как защитить effect при overlapping deliveries?',
        'Общий event_id, атомарный claim, сверка unknown outcome; ACK после commit.',
        'Только увеличить visibility timeout до минуты.',
        'Mutex внутри одного worker процесса.',
        'Записать processed и ACK до вызова provider.',
      ],
      Senior: [
        'Как ограничить последствия при внедрении?',
        'Глобальная business identity, fencing на commit, приоритетный replay и cohort gates с сохранением jobs.',
        'Выключить старый регион через control plane без write fence.',
        'Оставить региональные identities и ограничить скорость replay.',
        'Очистить backlog перед переключением writer.',
      ],
    },
  },
];

interface ReviewSpec {
  id: string;
  tags: string[];
  context: Levels<string>;
  risk: Levels<Choice>;
  fix: Levels<Choice>;
  mutation: Levels<string>;
  adapt: Levels<Choice>;
  truth: Levels<string>;
}
const reviews: ReviewSpec[] = [
  {
    id: 'reservation',
    tags: ['data', 'concurrency'],
    context: {
      Junior:
        'Production patch:\nconst stock = await db.readStock(id);\nif (stock > 0) { await db.setStock(id, stock - 1); return 201; }\nДва запроса могут выполняться параллельно.',
      Middle:
        'Production patch:\nif (!await db.findReservation(requestId)) {\n  const count = await db.readStock(id);\n  await db.setStock(id, count - 1);\n  await db.insertReservation(requestId);\n}\nНесколько writers, клиент повторяет запрос.',
      Senior:
        'Design diff: локальный mutex → региональный reserve API; старые writers продолжают прямой UPDATE stock. Новые reservations пишутся отдельно от stock. Требуется rolling rollout и rollback без oversell.',
    },
    risk: {
      Junior: [
        'Какой риск наиболее серьёзный?',
        'Два чтения одного остатка разрешат две продажи последней единицы.',
        'Повтор запроса после потерянного ответа может повторно списать остаток.',
        'Отсутствие reservation state мешает освободить товар после отмены.',
        'При ошибке DB записи клиент не узнает, был ли товар зарезервирован.',
      ],
      Middle: [
        'Какой инвариант patch не защищает?',
        'Списание и уникальная reservation неатомарны; concurrent/retry может дать лишний эффект.',
        'Потерянный ответ после commit требует endpoint чтения статуса reservation.',
        'Резерв без expiry может надолго заблокировать доступность товара.',
        'Раздельные SQL round trips повышают вероятность client timeout при нагрузке.',
      ],
      Senior: [
        'Какой риск блокирует rollout?',
        'Старые writers обходят новый инвариант; rollback может вернуть незащищённые writes.',
        'Новый authority добавляет зависимость доступности на пути каждой покупки.',
        'Миграция reservation identity усложняет дедупликацию запросов старых clients.',
        'Региональный routing может повысить latency для удалённых покупателей.',
      ],
    },
    truth: {
      Junior:
        'Ревью команды установило lost update/oversell между read и write. Следующий шаг оценивается отдельно.',
      Middle:
        'Ревью команды установило неатомарность остатка и reservation; повторная identity не защищена constraint.',
      Senior:
        'Команда установила: инвариант должен распространяться на все writers и переживать rollback. Новый API сам по себе этого не обеспечивает.',
    },
    fix: {
      Junior: [
        'Какое исправление предпочтительнее?',
        'Атомарный условный UPDATE count=count-1 WHERE count>0 и проверка результата.',
        'Mutex в единственном API процессе.',
        'Повторное чтение перед setStock.',
        'Кэшировать остаток и очищать его после покупки.',
      ],
      Middle: [
        'Как обеспечить оба инварианта?',
        'В одной transaction уникальная reservation и условное списание; повтор читает outcome.',
        'Блокировка строки товара без constraint на reservation.',
        'Распределённый lock и отдельные DB commits.',
        'Проверка requestId в Redis перед UPDATE stock.',
      ],
      Senior: [
        'Какой план безопаснее?',
        'Ограничить DB writes общим invariant, мигрировать writers по cohorts и сохранить rollback path.',
        'Сначала подключить всех clients к новому API.',
        'Отключить старые replicas сразу после первого canary.',
        'Включить глобальный mutex перед API gateway.',
      ],
    },
    mutation: {
      Junior:
        'Изменение: API теперь работает в {{replicas}} replicas. Локальные locks не разделяются между процессами.',
      Middle:
        'Изменение: резерв нужно отменять через 15 минут; expiry worker может повторить отмену одновременно с подтверждением.',
      Senior:
        'Изменение: второй регион должен принимать запросы при потере связи. Oversell запрещён, допустимо отказывать в резерве.',
    },
    adapt: {
      Junior: [
        'Как адаптировать решение?',
        'Сохранить инвариант в общем условном UPDATE БД; локальный lock недостаточен.',
        'Увеличить число локальных locks на каждой replica.',
        'Направлять каждый товар в replica через случайный hash.',
        'Считать replicas независимыми продавцами одного остатка.',
      ],
      Middle: [
        'Как адаптировать state transitions?',
        'Условный переход reserved→expired/confirmed и освобождение остатка атомарно один раз.',
        'Expiry worker возвращает остаток после проверки времени.',
        'Хранить expiry timer только в API памяти.',
        'Подтверждать заказ после любого результата expiry worker.',
      ],
      Senior: [
        'Как изменить гарантию при partition?',
        'Один authority/заранее выделенные quotas; отказ при невозможности безопасного резерва.',
        'Оба региона пишут общий остаток с eventual reconciliation.',
        'Копировать остаток в каждый регион после failover.',
        'Считать более поздний timestamp истинным результатом.',
      ],
    },
  },
  {
    id: 'currency-migration',
    tags: ['data', 'deployments', 'compatibility'],
    context: {
      Junior:
        'Migration:\nALTER TABLE orders ADD COLUMN total_cents INT NOT NULL DEFAULT 0;\nНовый reader читает total_cents, старые строки содержат total_rubles. Нулевые заказы недопустимы.',
      Middle:
        'Deployment plan: добавить total_cents, backfill = total_rubles * 100, переключить reader, удалить total_rubles. Старые writers ещё работают при rolling deployment.',
      Senior:
        'Design review: перейти с DECIMAL рублей на BIGINT minor units в 8 shards; старые consumers ожидают рубли. Rollback обязателен 7 дней, исторический rounding должен сохраниться.',
    },
    risk: {
      Junior: [
        'Какой риск наиболее серьёзный?',
        'Default 0 скрывает отсутствие backfill и выдаёт неверную сумму старого заказа.',
        'Миграция с DEFAULT может надолго заблокировать запись большой таблицы.',
        'INT может переполниться для крупных заказов при переводе рублей в копейки.',
        'Backfill в одной transaction создаёт большой log и задерживает replica.',
      ],
      Middle: [
        'Где failure window?',
        'Старый writer меняет только рубли после backfill, новый reader видит устаревшие копейки.',
        'Длинный backfill может задержать replica и увеличить latency read endpoints.',
        'Преобразование дробных рублей может изменить rounding части старых заказов.',
        'Удаление старого столбца ломает старые аналитические запросы consumers.',
      ],
      Senior: [
        'Что блокирует безопасную миграцию?',
        'Unit/rounding contract и старые writers/consumers не согласованы; rollback теряет семантику.',
        'Неравномерный backfill создаёт разные query costs между shards.',
        'Shadow сравнение удваивает часть чтений и может увеличить latency API.',
        'Minor units в JSON number требуют ограничения для клиентов с неточными integers.',
      ],
    },
    truth: {
      Junior:
        'Команда установила: zero default не отличает отсутствующий backfill от реального нуля.',
      Middle:
        'Команда установила: старые writers после backfill создают рассинхронизацию двух представлений суммы.',
      Senior:
        'Команда установила: несовместимые units и rounding, продолжающиеся legacy writes и rollback требуют независимых rollout gates.',
    },
    fix: {
      Junior: [
        'Какое исправление выбрать?',
        'Nullable новый столбец, fallback старого значения и проверяемый backfill до ограничения.',
        'Заполнить все строки нулём и позже пересчитать.',
        'Включить reader только для последних заказов.',
        'Удалить default без обработки старых null.',
      ],
      Middle: [
        'Какой порядок учитывает старые writers?',
        'Совместимые dual writers/readers, проверяемый backfill, сверка и отдельный contract step.',
        'Backfill дважды перед переключением reader.',
        'Новый reader конвертирует значение без version marker.',
        'Перезапустить все writers одновременно с DROP COLUMN.',
      ],
      Senior: [
        'Какой rollout предпочтительнее?',
        'Versioned unit/rounding, shadow comparisons по shard, dual representation и rollback gates.',
        'Применить одинаковый backfill SQL ко всем shards сразу.',
        'Сохранить только новый формат и конвертировать при rollback.',
        'Переименовать старое поле, сохранив тип JSON number.',
      ],
    },
    mutation: {
      Junior:
        'Изменение: новые заказы поступают во время backfill. Он не должен пропустить строки или перезаписать новое значение.',
      Middle:
        'Изменение: миграция должна работать без остановки writes; один legacy writer нельзя обновить сегодня.',
      Senior:
        'Изменение: отдельный регион откатывается на legacy binary, а consumers продолжают replay событий недельной давности.',
    },
    adapt: {
      Junior: [
        'Как изменить backfill?',
        'Обновлять только незаполненные строки по устойчивому cursor; новые writes заполняют обе формы.',
        'Обновлять все строки одним запросом каждый час.',
        'Отключить новые заказы до окончания backfill.',
        'Считать все ID выше максимального уже обработанными.',
      ],
      Middle: [
        'Как сохранить корректность сегодня?',
        'Сохранить legacy representation авторитетной и обеспечить синхронизацию/адаптер до миграции writer.',
        'Считать backfill окончательным после одной полной проходки.',
        'Переключить reader и игнорировать legacy writes.',
        'Уменьшить interval backfill без контроля рассинхронизации.',
      ],
      Senior: [
        'Что нужно сохранить при regional rollback?',
        'Dual contract и readers обеих versions в течение replay/rollback окна; сверки по cohorts.',
        'Удалить новые events из очереди откатываемого региона.',
        'Использовать один unit по дате запуска consumer.',
        'Переинтерпретировать старые messages в новых единицах.',
      ],
    },
  },
  {
    id: 'api-evolution',
    tags: ['api-contracts', 'deployments', 'compatibility'],
    context: {
      Junior:
        'Code diff:\n- return { status: "pending", id };\n+ return { status: "queued", id };\nМобильный клиент показывает ошибку на неизвестном status.',
      Middle:
        'API diff: синхронный ответ 200 {result} заменён на 202 {operation_id}. Старый client повторяет POST при отсутствии result; запрос имеет побочный эффект.',
      Senior:
        'Design diff: объединить legacy синхронный API и async workflow. Половина clients не умеет polling, consumers используют старую status enum; rollback обязан сохранить уже accepted operations.',
    },
    risk: {
      Junior: [
        'Какой риск основной?',
        'Изменение enum нарушает контракт клиента даже при валидном JSON.',
        'Кэш клиента может продолжить показывать pending после фактического завершения.',
        'Новый status без правил retry усложняет восстановление после network timeout.',
        'Мониторинг по старому enum может пропустить рост новой очереди запросов.',
      ],
      Middle: [
        'Какой failure mode опаснее?',
        'Legacy client повторяет accepted POST как failed, создавая повторный эффект.',
        'Polling клиентов может создать нагрузку на общий store операций.',
        'Отложенный результат требует отдельной политики retention и авторизации чтения.',
        'Старый alert по latency POST перестанет отражать время выполнения операции.',
      ],
      Senior: [
        'Что блокирует изменение?',
        'Протокол принятия/наблюдения/повтора несовместим; rollback не должен потерять accepted intents.',
        'Разные client cohorts будут иметь разные ожидания доступности результата.',
        'Polling и retention операций увеличат стоимость хранилища и чтения.',
        'Метрика HTTP latency перестанет отражать бизнес-SLA завершения операции.',
      ],
    },
    truth: {
      Junior:
        'Ревью установило: unknown enum ломает клиентскую обработку. JSON schema сама по себе совместимость не обеспечивает.',
      Middle:
        'Команда установила: old client воспринимает 202 как отсутствие результата и повторяет уже accepted operation.',
      Senior:
        'Команда установила: acceptance contract и сохранность accepted intents должны пережить coexistence clients и rollback.',
    },
    fix: {
      Junior: [
        'Какое исправление предпочтительнее?',
        'Сохранить старый status в старом контракте, новый добавить в версионированный endpoint.',
        'Обновить документацию перед заменой enum.',
        'Возвращать одновременно queued и pending в одной строке.',
        'Оставить HTTP 200 с новым enum для всех clients.',
      ],
      Middle: [
        'Как внедрить async workflow?',
        'Версионированный acceptance contract, стабильная operation identity и совместимый legacy adapter.',
        'Новый polling endpoint рядом со старым POST без identity.',
        'Увеличить timeout client перед 202.',
        'Возвращать 200 с пустым result после enqueue.',
      ],
      Senior: [
        'Какой migration plan предпочтительнее?',
        'Client capability cohorts, совместимый adapter, durable intents и gates принятия/rollback.',
        'Мигрировать все clients в заранее назначенный час.',
        'Dual response без version и без telemetry cohorts.',
        'Отключать legacy clients при первом неизвестном status.',
      ],
    },
    mutation: {
      Junior: 'Изменение: старый mobile client останется активным ещё 3 месяца.',
      Middle:
        'Изменение: proxy повторяет POST после timeout; accepted operation завершится только через {{timeout}} с.',
      Senior:
        'Изменение: async workers нужно откатить независимо от API; операции уже приняты и находятся в очереди.',
    },
    adapt: {
      Junior: [
        'Как адаптировать план?',
        'Поддерживать прежний контракт до прекращения старых clients и измерять их использование.',
        'Переключить enum после недели уведомлений.',
        'Скрыть ошибку клиента на API gateway.',
        'Возвращать queued только старым clients.',
      ],
      Middle: [
        'Как учесть повтор proxy?',
        'Одинаковая identity на retry, durable acceptance и status endpoint для исходной операции.',
        'Ограничить retry proxy до одного без identity.',
        'Увеличить timeout API до средней длительности.',
        'Создавать новую operation_id при каждом POST retry.',
      ],
      Senior: [
        'Что обеспечить при независимом rollback workers?',
        'Versioned jobs и backward reader/adapter; accepted intents остаются наблюдаемыми и доставляемыми.',
        'Очистить очередь перед rollback workers.',
        'Откатывать API при каждом rollback consumer.',
        'Считать незавершённые intents не принятыми после rollback.',
      ],
    },
  },
];

/** Authored, internally reviewed seed bank. Approval is publication approval, not human calibration. */
export function buildBank(): ItemFamily[] {
  return grades.flatMap((grade) => [
    ...anchors.map((s) =>
      family(s.id, grade, 'anchors', s.tags, s.choices[grade][0], [
        step('anchor', s.dimension, s.choices[grade], `${scope[grade]}\n${s.context}`),
      ]),
    ),
    ...incidents.map((s) => {
      const context = `${scope[grade]}\n${s.context[grade]}`;
      const explore = step(
        'evidence',
        'diagnosis',
        [
          'Какие два источника evidence открыть первыми?',
          'Сопоставлены наиболее релевантные источники.',
          'Один полезный источник.',
          'Контекстные данные.',
          'Недостаточные данные.',
        ],
        context,
        'artifact_interpretation',
      );
      explore.exploration = true;
      explore.options = [];
      return family(
        s.id,
        grade,
        'incident',
        s.tags,
        'Causal diagnosis with independently scored remediation',
        [
          step('investigate', 'diagnosis', s.investigate[grade], context),
          explore,
          step(
            'interpret',
            'diagnosis',
            s.interpretation[grade],
            context,
            'artifact_interpretation',
          ),
          step('cause', 'diagnosis', s.cause[grade], context, 'artifact_interpretation'),
          {
            ...step(
              'remediate',
              'engineering_judgment',
              s.remediation[grade],
              context,
              'design_review',
              1.3,
            ),
            resetContext: s.truth[grade],
          },
        ],
        s.artifacts[grade],
        grade === 'Junior'
          ? ['Client', 'API', 'Service', 'DB']
          : ['Client', 'API', 'DB', 'Queue / External API', 'Worker / Provider'],
      );
    }),
    ...reviews.map((s) =>
      family(
        s.id,
        grade,
        'review',
        s.tags,
        'Independent correctness review and constraint adaptation',
        [
          step('risk', 'correctness', s.risk[grade], s.context[grade], 'design_review', 1.3),
          {
            ...step('fix', 'correctness', s.fix[grade], s.context[grade], 'design_review', 1.3),
            resetContext: s.truth[grade],
          },
          {
            ...step(
              'adapt',
              'adaptation',
              s.adapt[grade],
              s.mutation[grade],
              'constraint_mutation',
              1.5,
            ),
            resetContext: `Для этого шага команда приняла базовое решение: ${s.fix[grade][1]} Предыдущий выбор не ограничивает ответ.`,
          },
        ],
      ),
    ),
    ...boundaries.map((s) =>
      family(s.id, grade, 'boundary', s.tags, s.choices[grade][0], [
        step(
          'boundary',
          s.dimension,
          s.choices[grade],
          `${scope[grade]}\n${s.context}`,
          s.dimension === 'adaptation' ? 'constraint_mutation' : 'artifact_interpretation',
          1.6,
        ),
      ]),
    ),
  ]);
}
export const backendDefinition = {
  version: assessmentVersion,
  specialization: 'backend',
  families: buildBank(),
};

/** Generate a reproducible variant; parameters preserve failure model and solution class. */
export function generateVariant(f: ItemFamily, seed: number): ItemVariant {
  const rng = random(seed);
  const parameters = {
    rps: [30, 300, 800][Math.floor(rng() * 3)]!,
    replicas: [4, 8, 12][Math.floor(rng() * 3)]!,
    timeout: [5, 10, 20][Math.floor(rng() * 3)]!,
    lag: [100, 300, 600][Math.floor(rng() * 3)]!,
    incidentId: `INC-${1000 + Math.floor(rng() * 9000)}`,
  };
  const render = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
      String(parameters[key as keyof typeof parameters]),
    );
  const variant = structuredClone(f) as ItemVariant;
  variant.variantSeed = seed;
  variant.parameters = parameters;
  variant.steps = variant.steps.map((s) => {
    const options = s.options.map((o) => ({ ...o, text: render(o.text) }));
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [options[i], options[j]] = [options[j]!, options[i]!];
    }
    // Opaque IDs avoid leaking rubric rank (o0) through the public API.
    const scores: Record<string, number> = {};
    options.forEach((o, i) => {
      const id = `${s.id}-${Math.floor(rng() * 0x100000000).toString(36)}-${i}`;
      scores[id] = s.rubric.scores[o.id]!;
      o.id = id;
    });
    return {
      ...s,
      context: render(s.context),
      prompt: render(s.prompt),
      ...(s.resetContext ? { resetContext: render(s.resetContext) } : {}),
      options,
      rubric: { ...s.rubric, scores, rationale: render(s.rubric.rationale) },
    };
  });
  variant.artifacts = variant.artifacts.map((a) => ({ ...a, content: render(a.content) }));
  return variant;
}
