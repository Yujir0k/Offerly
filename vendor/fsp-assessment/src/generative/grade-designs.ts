import { decisionCatalogs } from './decision-archetypes.js';
import type { TargetGrade } from '../adaptive/model.js';
import {
  anchorBands,
  gradeProfile,
  type AssessmentRecipe,
  type GradeConfiguration,
  type StepRecipe,
} from './difficulty.js';

export interface TrackGradeDesign {
  local: string;
  interaction: string;
  strategic: string;
  actors: [string, string, string];
  handoff: string;
  policyNames: [string, string, string];
  consequences: [string, string];
  adaptation: [string, string, string];
  incidentDomains: string[];
  reviewDomains: string[];
  workForm: string;
  recipe: 'engineering' | 'incident' | 'quality' | 'analysis' | 'trust' | 'lifecycle';
}
const designs: Record<string, TrackGradeDesign> = {
  backend: {
    local:
      'Один обработчик и его подтверждённая запись; вход и состояние БД известны. Исправление не меняет соседние API.',
    interaction:
      'Запрос, запись и последующее действие выполняются независимо. Свяжите идентичность операции, подтверждение записи и наблюдаемый эффект; порядок прихода журнала не равен порядку фиксации.',
    strategic:
      'Контракт используется старыми и новыми клиентами. Выберите переход, который сохраняет подтверждённые операции и возможность отката при ограниченной стоимости совместимости.',
    actors: [
      'Обработчик и локальная транзакция',
      'Фоновое выполнение и подтверждение эффекта',
      'Прежние клиенты и владельцы данных',
    ],
    handoff:
      'Фиксация состояния предшествует признанию операции завершённой; поздний ответ нельзя применять к другой операции.',
    policyNames: ['непрерывность операций', 'стоимость совместимости', 'проверяемый откат'],
    consequences: [
      'старые клиенты продолжают записывать подтверждённые операции',
      'откат кода не должен потерять записи новой версии',
    ],
    adaptation: [
      'Локальный вход теперь может содержать отсутствующее значение; пересмотрите проверку до записи.',
      'Подтверждение эффекта задерживается относительно записи; пересмотрите критерий завершения workflow.',
      'Окно совместимости продлено; откат обязателен, бюджет параллельных путей изменён.',
    ],
    incidentDomains: ['reliability', 'data', 'observability'],
    reviewDomains: ['api', 'deployment', 'performance'],
    workForm: 'failure window, транзакция и эволюция контракта',
    recipe: 'engineering',
  },
  frontend: {
    local:
      'Один компонент, один пользовательский переход и известное состояние. Сохраните ввод и результат последнего допустимого действия.',
    interaction:
      'Navigation, network response и cache живут независимо. По двум версиям наблюдений установите, какой результат относится к текущему пользовательскому переходу.',
    strategic:
      'Общий UI-контракт используется несколькими экранами и версиями клиента. Сравните совместимость, задержку выпуска и стоимость временных адаптеров.',
    actors: [
      'Компонент и состояние пользователя',
      'Navigation, network и cache',
      'Экраны и версии браузерного клиента',
    ],
    handoff:
      'Результат запроса применим только к тому navigation/state, для которого он был запрошен.',
    policyNames: [
      'непрерывность пользовательского пути',
      'стоимость адаптеров',
      'сохранение состояния при откате',
    ],
    consequences: [
      'старый экран не должен терять черновик после смены общей модели',
      'откат bundle не восстанавливает уже потерянное пользовательское состояние',
    ],
    adaptation: [
      'Компонент получает новое локальное состояние после завершения запроса.',
      'Navigation сменился до применения network response; пересмотрите владение результатом.',
      'Прежняя версия клиента остаётся активной дольше; пересмотрите выпуск общей модели состояния.',
    ],
    incidentDomains: ['state', 'rendering', 'accessibility'],
    reviewDomains: ['performance', 'delivery', 'browser-security'],
    workForm: 'state timeline и browser/network evidence',
    recipe: 'engineering',
  },
  'devops-sre': {
    local:
      'Один сервис и ясный сигнал локального ресурса. Устраните наблюдаемую причину, сохранив пользовательский контракт.',
    interaction:
      'Пользовательский SLI, сигнал зависимости и состояние выпуска относятся к разным временным окнам. Определите причинный путь до выбора containment.',
    strategic:
      'Сравните failure domains и стратегии восстановления при исчерпанном бюджете ошибок, ограниченной ёмкости и обязательном откате.',
    actors: [
      'Сервис и локальный ресурс',
      'Зависимость и пользовательский SLI',
      'Failure domains и владельцы выпуска',
    ],
    handoff: 'Успех локальной пробы не означает успех пользовательского запроса через зависимость.',
    policyNames: ['пользовательский SLO', 'стоимость резервной ёмкости', 'восстановление и откат'],
    consequences: [
      'перенос нагрузки может перегрузить оставшийся failure domain',
      'зелёный общий SLI может скрыть критический сегмент',
    ],
    adaptation: [
      'Изменился локальный лимит ресурса сервиса.',
      'Локальная проба больше не покрывает зависимость; пересмотрите пользовательский сигнал.',
      'Допустимый blast radius снижен, резервная ёмкость и окно восстановления пересмотрены.',
    ],
    incidentDomains: ['incident', 'slo', 'observability'],
    reviewDomains: ['capacity', 'delivery', 'recovery'],
    workForm: 'incident timeline, containment и reliability decision',
    recipe: 'incident',
  },
  'qa-automation': {
    local:
      'Один воспроизводимый тест и явно заданный ожидаемый результат. Проверьте oracle и границу входа.',
    interaction:
      'Shared state, asynchronous completion и CI report относятся к разным executions. Отделите дефект продукта от дефекта изоляции и устаревшего отчёта.',
    strategic:
      'Выберите портфель проверок и release gate при неполном покрытии риска, ограниченной стоимости поддержки и обязательном воспроизводимом отказе gate.',
    actors: [
      'Тест и ожидаемый результат',
      'Fixture, async completion и CI run',
      'Команды продукта и портфель release gates',
    ],
    handoff:
      'Успешный retry не доказывает успешность исходного прогона и не исправляет потерянную изоляцию.',
    policyNames: [
      'контроль release risk',
      'стоимость поддержки проверок',
      'воспроизводимость отката gate',
    ],
    consequences: [
      'повтор теста может скрыть дефект вместо снижения риска',
      'обязательный нестабильный gate задерживает безопасные релизы',
    ],
    adaptation: [
      'Изменился граничный вход одного теста.',
      'Параллельный CI run использует общую fixture; пересмотрите происхождение результата.',
      'Изменились допустимый остаточный риск релиза и бюджет обслуживания портфеля.',
    ],
    incidentDomains: ['automation', 'oracle', 'ci'],
    reviewDomains: ['risk', 'strategy', 'data'],
    workForm: 'defect reproduction, CI investigation и release-risk decision',
    recipe: 'quality',
  },
  'data-engineering': {
    local:
      'Одна таблица или преобразование с известным schema contract. Проверьте результат локальной операции.',
    interaction:
      'Событие, watermark и подтверждённая partition могут иметь разные версии. Сопоставьте lineage и consumer expectation до пересчёта.',
    strategic:
      'История используется несколькими consumers. Выберите изменение policy и reprocessing при ограниченном scan, требуемой freshness и возможности вернуть прежний dataset.',
    actors: [
      'Преобразование и схема таблицы',
      'События, watermark и потребитель',
      'Исторические datasets и внешние consumers',
    ],
    handoff:
      'Поздний arrival не меняет event time; опубликованная partition должна соответствовать подтверждённому lineage.',
    policyNames: [
      'непрерывность consumer contract',
      'стоимость scan и хранения',
      'возврат проверенной истории',
    ],
    consequences: [
      'изменение watermark меняет сопоставимость исторических метрик',
      'backfill может вытеснить свежие события из ресурсного бюджета',
    ],
    adaptation: [
      'В локальной строке появилась новая допустимая форма поля.',
      'Late event пришёл после публикации partition; пересмотрите границу подтверждения.',
      'Историю переписывать нельзя, окно совместимости consumer и бюджет reprocessing изменены.',
    ],
    incidentDomains: ['ingestion', 'streaming', 'lineage'],
    reviewDomains: ['quality', 'orchestration', 'performance'],
    workForm: 'events, DAG, lineage и reprocessing plan',
    recipe: 'engineering',
  },
  'ml-engineer': {
    local:
      'Один preprocessing/evaluation шаг и известные входные признаки. Исправьте локальную согласованность преобразования.',
    interaction:
      'Training data, feature pipeline и serving artifact используют независимые версии. Найдите слой skew через происхождение признака и результат serving.',
    strategic:
      'Несколько моделей обслуживают разные сегменты. Выберите rollout при delayed labels, ограниченном inference budget и совместимости preprocessing.',
    actors: [
      'Preprocessing и оценка модели',
      'Feature pipeline и serving',
      'Модели, сегменты и владельцы production',
    ],
    handoff:
      'Версия feature transformation должна совпадать с контрактом model artifact, а качество подтверждается зрелыми метками.',
    policyNames: [
      'сохранение качества сегментов',
      'стоимость inference',
      'откат model/feature bundle',
    ],
    consequences: [
      'улучшение средней метрики может ухудшить ущерб редкого сегмента',
      'переобучение на преждевременных метках закрепляет bias feedback',
    ],
    adaptation: [
      'Локальный preprocessing получает отсутствующий признак.',
      'Serving использует другую подтверждённую feature version; пересмотрите слой преобразования.',
      'Метки задержаны дольше, cost/latency budget и допустимая доля новой модели изменены.',
    ],
    incidentDomains: ['features', 'serving', 'monitoring'],
    reviewDomains: ['training', 'evaluation', 'deployment'],
    workForm: 'feature/serving investigation и production ML strategy',
    recipe: 'engineering',
  },
  'data-scientist': {
    local:
      'Одна выборка, заданная продуктовая цель и метрика. Проверьте, что локальный вывод следует из наблюдений.',
    interaction:
      'Temporal split, экспериментальная экспозиция и сегментный состав различаются. Свяжите происхождение выборки и допустимую область вывода.',
    strategic:
      'Сравните допустимые аналитические стратегии при неоднозначном evidence. Ограничьте причинное утверждение и выберите бизнес-решение с явным остаточным риском.',
    actors: [
      'Выборка и заявленная метрика',
      'Split, экспозиция и сегменты',
      'Продуктовые владельцы и стратегии решения',
    ],
    handoff:
      'Принадлежность наблюдения к выборке и периоду должна быть установлена до сравнения эффекта; наблюдательная связь сама по себе не задаёт причинный эффект.',
    policyNames: [
      'допустимый бизнес-риск вывода',
      'стоимость новой информации',
      'возможность пересмотра решения',
    ],
    consequences: [
      'смена состава групп может перевернуть агрегированный вывод',
      'оптимизация прокси-метрики не гарантирует продуктовую пользу',
    ],
    adaptation: [
      'Для локальной выборки изменена stated objective.',
      'Экспозиция и временной split расходятся; пересмотрите допустимую популяцию вывода.',
      'Цена ошибочного бизнес-решения и допустимая задержка получения новых данных изменены.',
    ],
    incidentDomains: ['sampling', 'experimentation', 'statistics'],
    reviewDomains: ['validation', 'metrics', 'causality'],
    workForm: 'experiment/data interpretation и decision under uncertainty',
    recipe: 'analysis',
  },
  mlops: {
    local:
      'Один pipeline run и сохранённый artifact с известным manifest. Проверьте версию и происхождение.',
    interaction:
      'Pipeline, registry, deployment и monitoring подтверждают разные версии. Сопоставьте lineage до promotion.',
    strategic:
      'Платформа обслуживает несколько команд. Выберите lifecycle policy и переход при общем GPU budget, governance и возможности вернуть согласованный bundle.',
    actors: [
      'Pipeline run и manifest',
      'Registry, deployment и monitoring',
      'Команды платформы и ресурсные quotas',
    ],
    handoff:
      'Promotion относится к точному model/data/code bundle; поздний report не может авторизовать другой deployment.',
    policyNames: [
      'непрерывность platform lifecycle',
      'общая стоимость GPU и хранения',
      'откат согласованного bundle',
    ],
    consequences: [
      'одна retraining queue может вытеснить другие команды из общей quota',
      'откат модели без feature bundle не восстанавливает прежний контракт',
    ],
    adaptation: [
      'Один run получил новую версию локального artifact.',
      'Registry report относится к прежнему deployment; пересмотрите подтверждение promotion.',
      'Quota общей платформы и срок миграции команд изменены; governance сохраняется.',
    ],
    incidentDomains: ['lineage', 'pipelines', 'deployment'],
    reviewDomains: ['registry', 'resources', 'retraining'],
    workForm: 'lineage/registry investigation и platform lifecycle policy',
    recipe: 'engineering',
  },
  genai: {
    local:
      'Один retrieval/output контракт и приведённые документы. Проверьте локальную опору ответа и допустимый инструмент.',
    interaction:
      'Retrieval, context, tool call и evaluation имеют независимые версии. Проследите, откуда пришла информация и где она получила полномочия.',
    strategic:
      'Сравните architecture/evaluation policies при cost/latency/safety constraints и переходе между моделями или индексами. Учитывайте последствия для пользователей и tools.',
    actors: [
      'Retrieval/output contract',
      'Context, tool call и evaluation',
      'Версии моделей/индексов и владельцы tool policy',
    ],
    handoff:
      'Источник данных не приобретает право менять tool policy; оценка ответа относится к его точному retrieval/context bundle.',
    policyNames: [
      'сохранение safety/output contract',
      'стоимость context и inference',
      'откат model/index/tool policy',
    ],
    consequences: [
      'смена индекса меняет grounding даже при прежней модели',
      'ускорение agent loop может увеличить число привилегированных действий',
    ],
    adaptation: [
      'Для ответа отсутствует одно локальное доказательство.',
      'Tool trace и retrieval относятся к разным context versions; пересмотрите происхождение полномочий.',
      'Допустимый safety risk, inference budget и срок перехода индекса изменены.',
    ],
    incidentDomains: ['retrieval', 'tools', 'evaluation'],
    reviewDomains: ['grounding', 'budget', 'safety'],
    workForm: 'retrieval/context/tool traces и architecture/evaluation decision',
    recipe: 'trust',
  },
  android: {
    local:
      'Один экран и известный lifecycle transition. Сохраните пользовательский ввод и корректное локальное действие.',
    interaction:
      'Lifecycle, state, Room и network acknowledgement расходятся во времени. Установите, какой результат принадлежит текущему экрану и версии данных.',
    strategic:
      'Релиз живёт одновременно на нескольких версиях приложения и платформы. Выберите offline/persistence migration при resource/background limits и сохранении данных при откате.',
    actors: [
      'Экран и локальное состояние',
      'Lifecycle, persistence и network',
      'Версии приложения и Android platform constraints',
    ],
    handoff:
      'Сетевой ack не должен подтверждать ещё не отправленную локальную правку; process recreation не сохраняет память компонента.',
    policyNames: [
      'сохранение пользовательских данных',
      'бюджет памяти и фона',
      'восстановление после отката приложения',
    ],
    consequences: [
      'перенос фоновой работы может изменить расход батареи и время синхронизации',
      'откат APK не возвращает утраченный offline draft',
    ],
    adaptation: [
      'Экран пережил локальное configuration change.',
      'Запоздалый ack относится к другой версии offline edit; пересмотрите владельца подтверждения.',
      'Срок жизни старых клиентов и background/resource budget изменены; store rollback сохраняется.',
    ],
    incidentDomains: ['lifecycle', 'state', 'background'],
    reviewDomains: ['offline', 'performance', 'release'],
    workForm: 'lifecycle/state timeline и offline/release strategy',
    recipe: 'lifecycle',
  },
  ios: {
    local:
      'Одна scene/view и известный task. Сохраните локальную identity, черновик и допустимое обновление UI.',
    interaction:
      'Scene lifecycle, actors, persistence и task completion взаимодействуют. Установите принадлежность результата и сохранённой версии перед обновлением UI.',
    strategic:
      'Несколько версий приложения и store contracts сосуществуют. Сравните offline/background architecture и migration при ограниченном времени системы и возможности восстановления.',
    actors: [
      'Scene, SwiftUI state и task',
      'Actor, persistence и lifecycle',
      'Версии store/app и системное background окно',
    ],
    handoff:
      'После await состояние может измениться; завершение task применимо только к текущей identity и сохранённой версии.',
    policyNames: [
      'сохранение state и store',
      'бюджет MainActor/background',
      'восстановление после отката версии',
    ],
    consequences: [
      'перенос работы меняет responsiveness и доступное background окно',
      'откат приложения не устраняет уже потерянный persistent draft',
    ],
    adaptation: [
      'Один task завершился после локального ухода со scene.',
      'Actor state изменилось между suspension и completion; пересмотрите принадлежность результата.',
      'Background окно сокращено, старый store contract живёт дольше; пересмотрите migration/checkpoint strategy.',
    ],
    incidentDomains: ['lifecycle', 'concurrency', 'state'],
    reviewDomains: ['offline', 'performance', 'release'],
    workForm: 'scene/actor evidence и persistence evolution',
    recipe: 'lifecycle',
  },
  'security-appsec': {
    local:
      'Одна разрешённая операция и конкретный объект. Проверьте локальный ownership/control failure, сохранив разрешённое поведение.',
    interaction:
      'Identity, object ownership и tenant policy проверяются в разных компонентах. Проследите путь данных до места приобретения полномочий.',
    strategic:
      'Несколько entry points и старых клиентов используют trust boundary. Выберите remediation/migration и компенсирующие меры при явном residual risk и ограниченном воздействии.',
    actors: [
      'Операция, объект и локальный контроль',
      'Identity, tenant и межкомпонентная policy',
      'Trust boundaries, legacy clients и владельцы риска',
    ],
    handoff:
      'Аутентификация не передаёт право на объект; полномочие должно быть проверено в месте применения к текущему tenant.',
    policyNames: [
      'сохранение защитной гарантии',
      'стоимость enforcement и совместимости',
      'безопасный откат policy',
    ],
    consequences: [
      'компенсирующий контроль оставляет явно ограниченный residual risk',
      'откат защиты не должен вновь открыть межарендный доступ',
    ],
    adaptation: [
      'У локальной операции изменился owner объекта.',
      'Объект пришёл через другой entry point; пересмотрите место применения tenant policy.',
      'Окно legacy migration и допустимый residual risk изменены; защитная гарантия не отменяется.',
    ],
    incidentDomains: ['threat', 'authorization', 'session'],
    reviewDomains: ['input', 'supply-chain', 'assurance'],
    workForm: 'trust-boundary path и defensive remediation strategy',
    recipe: 'trust',
  },
};

/** Retrieve a track-owned qualitative work model; the core never invents technology rules. */
export function getGradeDesign(track: string): TrackGradeDesign {
  const design = designs[track];
  if (!design) throw new Error(`Нет профессионального grade design: ${track}`);
  return design;
}
/** Publish expert-designed profiles and role-specific radicals for all allowed grades. */
export function trackGradeConfigurations(track: string): Record<TargetGrade, GradeConfiguration> {
  const design = getGradeDesign(track);
  return Object.fromEntries(
    (['Junior', 'Middle', 'Senior'] as const).map((grade, index) => [
      grade,
      {
        profile: gradeProfile(
          grade === 'Junior' ? 'junior_core' : grade === 'Middle' ? 'middle_core' : 'senior_core',
        ),
        radicals: [design.actors[index], design.handoff, design.adaptation[index]],
        responsibility: [design.local, design.interaction, design.strategic][index],
        typicalDecisions:
          grade === 'Junior'
            ? ['проверить локальное условие', 'сохранить работающий контракт']
            : grade === 'Middle'
              ? [
                  'выбрать различающий источник',
                  'связать версии и состояние',
                  'исправить взаимодействие',
                ]
              : decisionCatalogs[track]!.actions.map((action) => action.action),
        calibrated: false,
      },
    ]),
  ) as Record<TargetGrade, GradeConfiguration>;
}
/** Give each profession its own sequence of investigation and decision primitives. */
export function assessmentRecipe(track: string, grade: TargetGrade): AssessmentRecipe {
  const design = getGradeDesign(track);
  const interpret = {
    id: 'interpret',
    kind: 'interpretation' as const,
    dimension: 'diagnosis' as const,
  };
  const explore = {
    id: 'evidence',
    kind: 'interpretation' as const,
    dimension: 'diagnosis' as const,
    exploration: true,
  };
  const cause = { id: 'cause', kind: 'falsification' as const, dimension: 'diagnosis' as const };
  const investigate = {
    id: 'investigate',
    kind: 'diagnosis' as const,
    dimension: 'diagnosis' as const,
  };
  const remediate = {
    id: 'remediate',
    kind: 'remediation' as const,
    dimension: 'engineering_judgment' as const,
  };
  const incident: StepRecipe[] =
    design.recipe === 'analysis'
      ? [interpret, explore, cause]
      : design.recipe === 'trust'
        ? [explore, investigate, cause, remediate]
        : design.recipe === 'quality'
          ? [interpret, explore, investigate, cause]
          : design.recipe === 'incident'
            ? [explore, interpret, investigate, remediate]
            : [investigate, explore, interpret, cause];
  const review: StepRecipe[] = [
    {
      id: 'risk',
      kind:
        design.recipe === 'analysis' || design.recipe === 'quality'
          ? ('critical_assumption' as const)
          : ('interpretation' as const),
      dimension: 'correctness' as const,
    },
    { id: 'fix', kind: 'remediation' as const, dimension: 'engineering_judgment' as const },
    { id: 'adapt', kind: 'adaptation' as const, dimension: 'adaptation' as const, changed: true },
  ];
  if (grade === 'Senior' && ['analysis', 'quality', 'trust'].includes(design.recipe))
    review.splice(1, 0, {
      id: 'consequence',
      kind: 'negative_guarantee',
      dimension: 'correctness',
    });
  return {
    anchorBands: anchorBands(grade),
    stages: {
      incident: grade === 'Junior' ? incident.filter((step) => !step.exploration) : incident,
      review,
    },
    boundaryBands:
      grade === 'Junior'
        ? ['junior_upper']
        : grade === 'Middle'
          ? ['middle_core', 'middle_upper']
          : ['senior_lower', 'senior_core'],
    workForm: design.workForm,
  };
}
