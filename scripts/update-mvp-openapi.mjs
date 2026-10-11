// Keep the existing API specification and add the actual professional/hiring/recovery protocol.
import { readFile, writeFile } from "node:fs/promises";
const doc = JSON.parse(await readFile("docs/api/openapi.json", "utf8"));
const S = doc.components.schemas;
const str = { type: "string" },
  int = { type: "integer" },
  bool = { type: "boolean" },
  date = { type: "string", format: "date-time" },
  obj = { type: "object", additionalProperties: true };
const ref = (n) => ({ $ref: "#/components/schemas/" + n }),
  arr = (items) => ({ type: "array", items }),
  o = (properties, required = [], extra = false) => ({
    type: "object",
    properties,
    required,
    additionalProperties: extra,
  });
const grade = { type: "string", enum: ["Junior", "Middle", "Senior"] };
S.CandidateFilters = o(
  {
    spec: {
      ...str,
      description:
        "Одно из12 актуальных направлений или legacy alias; пустое/Все — любое.",
    },
    grade: { ...str, description: "Junior/Middle/Senior; пустое/Все — любой." },
    query: str,
    stack: str,
    skills: arr(str),
    skillSource: {
      type: "string",
      enum: ["declared", "verified"],
      default: "declared",
      description:
        "declared ищет union указанного и отдельно подтверждённого стека; verified — только отдельные подтверждения.",
    },
    location: str,
    formats: arr(str),
    salaryMin: str,
    salaryMax: str,
    experienceMin: str,
    experienceMax: str,
    fsp: bool,
    savedOnly: bool,
    sort: str,
    needId: str,
  },
  [],
  true,
);
S.VacancyFilters = o(
  {
    query: str,
    specialty: str,
    grade: str,
    skills: arr(str),
    industries: arr(str),
    salaryMin: str,
    salaryMax: str,
    location: str,
    employment: str,
    format: str,
    experience: str,
    company: str,
    companies: arr(str),
    excludeCompany: bool,
    sort: str,
    favoritesOnly: bool,
    page: int,
  },
  [],
  true,
);
for (const [path, filters] of [
  ["/api/catalog/candidates", "CandidateFilters"],
  ["/api/catalog/jobs", "VacancyFilters"],
]) {
  const op = doc.paths[path]?.get;
  if (op) {
    op.description =
      "Серверная проверка владельца, scope, видимости и блок-листа; до20 карточек за страницу. Параметр filters — JSON объекта " +
      filters +
      ".";
    const p = op.parameters?.find((p) => p.name === "filters");
    if (p)
      p.schema.description = "JSON объекта #/components/schemas/" + filters;
  }
}
S.MvpError = o({ error: str }, ["error"]);
S.AssessmentPlan = {
  type: "object",
  description:
    "Значения controls текущего публичного responseTask. Ключ — control.id; строки, числа, boolean или упорядоченный массив операций. Ответы валидируются серверным генератором.",
  additionalProperties: { oneOf: [str, { type: "number" }, bool, arr(str)] },
};
S.AssessmentAnswer = o(
  {
    itemId: str,
    stepId: str,
    optionId: str,
    execution: ref("AssessmentPlan"),
    interactionRevision: int,
  },
  ["itemId", "stepId", "optionId", "interactionRevision"],
);
S.AssessmentEvidence = o(
  { itemId: str, stepId: str, artifactId: str, interactionRevision: int },
  ["itemId", "stepId", "artifactId", "interactionRevision"],
);
S.AssessmentNavigationInput = o(
  { itemId: str, stepId: str, interactionRevision: int },
  ["itemId", "stepId", "interactionRevision"],
);
S.PublicArtifact = o(
  { id: str, type: str, label: str, content: { ...str, nullable: true } },
  ["id", "label", "content"],
);
S.PublicAssessmentStep = o(
  {
    id: str,
    type: str,
    prompt: str,
    context: str,
    options: arr(o({ id: str, text: str }, ["id", "text"])),
    scenario: o({
      context: str,
      observations: arr(str),
      constraints: arr(str),
      assumptions: arr(str),
    }),
    responseTask: o({ title: str, instructions: str, controls: arr(obj) }),
    resetContext: str,
    exploration: bool,
    requiredEvidenceSources: int,
    difficultyPoints: { type: "number" },
  },
  ["id", "type", "prompt", "context", "options"],
);
S.PublicAssessmentResult = o(
  {
    assessmentStatus: {
      type: "string",
      enum: ["confirmed", "below-standard", "insufficient-evidence"],
    },
    targetGrade: grade,
    specialization: str,
    decision: { type: "string", enum: ["CONFIRMED", "NOT_CONFIRMED"] },
    title: str,
    reason: str,
    stopReason: str,
    dimensions: arr(
      o({ dimension: str, label: str, description: str }, [
        "dimension",
        "label",
        "description",
      ]),
    ),
    contentTags: arr(str),
    recommendation: { ...grade, nullable: true },
  },
  [
    "targetGrade",
    "specialization",
    "decision",
    "title",
    "reason",
    "dimensions",
  ],
);
S.PublicAssessmentSession = o(
  {
    id: str,
    specialization: str,
    specializationName: str,
    targetGrade: grade,
    state: { type: "string", enum: ["active", "completed"] },
    startedAt: date,
    deadlineAt: date,
    serverNow: date,
    finishedAt: { ...date, nullable: true },
    stage: { ...str, nullable: true },
    coreCompleted: bool,
    boundaryUsed: bool,
    packPresentation: obj,
    progress: o({
      answered: int,
      coreCompletedSteps: int,
      coreTotalSteps: int,
      remainingMin: int,
      remainingMax: int,
      stages: arr(o({ stage: str, completed: int, total: int, status: str })),
    }),
    current: {
      ...o({
        itemId: str,
        step: ref("PublicAssessmentStep"),
        architecture: arr(str),
        topology: obj,
        artifacts: arr(ref("PublicArtifact")),
      }),
      nullable: true,
    },
    result: {
      type: "object",
      nullable: true,
      allOf: [ref("PublicAssessmentResult")],
    },
    interactionRevision: int,
    methodVersion: str,
    scoringVersion: str,
    navigation: arr(
      o({
        itemId: str,
        stepId: str,
        stage: str,
        label: str,
        selected: bool,
        status: str,
        available: bool,
      }),
    ),
    savedAnswer: o({ optionId: str, execution: ref("AssessmentPlan") }),
    revisionResetCount: int,
    retakePolicy: ref("AssessmentRetakePolicy"),
  },
  [
    "id",
    "specialization",
    "targetGrade",
    "state",
    "deadlineAt",
    "serverNow",
    "progress",
    "current",
    "result",
  ],
);
S.PublicAssessmentSession.description =
  "Только разрешённое публичное представление. Rubrics, ground truth, private generator snapshots, priors и calibration configuration никогда не выдаются. Замороженный отчёт результата берётся из сохранённой попытки.";
S.PublicMeeting = o({
  id: str,
  processId: str,
  slots: arr(date),
  timeZone: str,
  duration: int,
  status: { type: "string", enum: ["proposed", "confirmed", "cancelled"] },
  selectedAt: { ...date, nullable: true },
  revision: int,
});
S.PublicCompanyTask = o({
  id: str,
  title: str,
  periodDays: int,
  active: bool,
  occurrence: int,
  dueAt: date,
  questions: arr(o({ id: str, prompt: str, options: arr(str) })),
  history: arr(o({ occurrence: int, score: int, created_at: date })),
  answered: bool,
});
S.PublicHiringProcess = o({
  id: str,
  candidateId: int,
  companyId: str,
  title: str,
  company: str,
  stage: str,
  note: str,
  reminderAt: { ...date, nullable: true },
  revision: int,
  updatedAt: date,
  chat: {
    ...o({
      invitationId: { ...str, nullable: true },
      applicationId: { ...str, nullable: true },
    }),
    nullable: true,
  },
  meetings: arr(ref("PublicMeeting")),
  tasks: arr(ref("PublicCompanyTask")),
});
S.PublicHiringProcess.description =
  "stage/note/reminderAt выдаются только своей компании. Соискатель видит процесс только после принятого приглашения/отклика. Ключи коротких задач не выдаются ни одной роли через processes.";
const variants = [];
function action(type, props = {}, required = [], description = "") {
  variants.push({
    ...o({ type: { type: "string", enum: [type] }, ...props }, [
      "type",
      ...required,
    ]),
    description,
  });
}
action(
  "companies",
  { query: str },
  [],
  "Кандидат: публичные компании и свой блок-лист, до 30.",
);
action(
  "block",
  { companyId: str, blocked: bool },
  ["companyId", "blocked"],
  "Кандидат: запрет каталога, карточки/сравнения и новых приглашений. Старые диалоги сохранены.",
);
action(
  "compare",
  { ids: { ...arr(int), minItems: 2 } },
  ["ids"],
  "Работодатель: свежие разрешённые публичные профили.",
);
action(
  "recommend",
  { description: str, skills: arr(str) },
  [],
  "Детерминированные рекомендации категорий по словам, без заявления точности LLM.",
);
action("reminders", {}, [], "Счётчик наступивших напоминаний своей компании.");
action(
  "processes",
  { before: str },
  [],
  "До 50; opaque nextBefore содержит стабильный timestamp+id.",
);
action(
  "process-create",
  { candidateId: int, needId: str, jobId: str },
  ["candidateId"],
  "Работодатель owner/recruiter; один процесс на company/candidate/context.",
);
action(
  "process-update",
  {
    id: str,
    revision: int,
    stage: {
      type: "string",
      enum: ["saved", "invited", "talking", "interview", "offer", "closed"],
    },
    note: { type: "string", maxLength: 4000 },
    reminderAt: { ...date, nullable: true },
  },
  ["id", "revision", "stage"],
);
action(
  "meeting-propose",
  {
    processId: str,
    slots: { ...arr(date), minItems: 1, maxItems: 3 },
    timeZone: str,
    duration: { type: "integer", minimum: 15, maximum: 180 },
  },
  ["processId", "slots", "timeZone", "duration"],
  "Компания после согласия; новая встреча отменяет предыдущую.",
);
action(
  "meeting-confirm",
  { id: str, revision: int, slot: date },
  ["id", "revision", "slot"],
  "Кандидат; серверная проверка версии и пересечения подтверждённых встреч.",
);
action("meeting-cancel", { id: str, revision: int }, ["id", "revision"]);
action(
  "meeting-ics",
  { id: str },
  ["id"],
  "JSON {ics:string}, только подтверждённая встреча.",
);
action(
  "search-save",
  {
    name: { type: "string", maxLength: 100 },
    filters: { anyOf: [ref("CandidateFilters"), ref("VacancyFilters")] },
  },
  ["name", "filters"],
  "До 20 именных поисков владельца. Фильтры каталога проверяются сервером.",
);
for (const type of ["searches", "search-notifications"]) action(type);
for (const type of ["search-matches", "search-seen"])
  action(
    type,
    { id: str, page: { type: "integer", minimum: 1 } },
    ["id"],
    "Текущие права и видимость перепроверяются. До 20 карточек, newIds; seen фиксирует просмотренную страницу.",
  );
action("search-update", { id: str, enabled: bool }, ["id", "enabled"]);
action("search-delete", { id: str }, ["id"]);
action(
  "task-create",
  {
    processId: str,
    title: str,
    periodDays: { type: "integer", minimum: 1, maximum: 90 },
    questions: {
      ...arr(
        o(
          {
            prompt: str,
            options: { ...arr(str), minItems: 2, maxItems: 5 },
            correct: int,
          },
          ["prompt", "options", "correct"],
        ),
      ),
      minItems: 1,
      maxItems: 5,
    },
  },
  ["processId", "title", "periodDays", "questions"],
  "Компания после согласия. Автор задаёт ключ, он остаётся только на сервере. Отдельный результат не влияет на грейд.",
);
action("task-stop", { id: str }, ["id"]);
action(
  "task-answer",
  {
    id: str,
    occurrence: int,
    answers: { type: "object", additionalProperties: int },
  },
  ["id", "occurrence", "answers"],
  "Кандидат: одна попытка в период, точный replay идемпотентен.",
);
S.HiringOperation = { oneOf: variants };
const err = () =>
  Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 500].map((status) => [
      status,
      {
        description: {
          400: "Ошибка данных/лимит попыток",
          401: "Нет сессии",
          403: "Нет прав/не подтверждена почта",
          404: "Запись недоступна",
          409: "Конфликт версии/времени/ответа",
          413: "Большой запрос",
          500: "Временная ошибка",
        }[status],
        content: { "application/json": { schema: ref("MvpError") } },
      },
    ]),
  );
function op(summary, schema, response, description = "") {
  return {
    summary,
    description,
    parameters: [
      { name: "Origin", in: "header", required: true, schema: str },
      {
        name: "X-Offerly-Role",
        in: "header",
        required: true,
        schema: { type: "string", enum: ["candidate", "employer"] },
      },
    ],
    requestBody: {
      required: true,
      content: { "application/json": { schema } },
    },
    responses: {
      200: {
        description: "Успех",
        content: { "application/json": { schema: response } },
      },
      ...err(),
    },
  };
}
doc.paths["/api/hiring"] = {
  post: op(
    "Поиски, этапы, блок-лист, встречи, задачи компании",
    ref("HiringOperation"),
    {
      anyOf: [
        o({ ok: bool, id: str, score: int, ics: str, count: int }),
        o({
          items: arr(ref("PublicHiringProcess")),
          nextBefore: { ...str, nullable: true },
        }),
        o({
          items: arr(obj),
          newIds: arr({ oneOf: [str, int] }),
          total: int,
          page: int,
          pageSize: int,
        }),
      ],
    },
    "Сессионная авторизация; scope и принадлежность компании, owner/recruiter для записи, viewer только чтение. Ответ зависит от type; протокол docs/guides/mvp-features.md.",
  ),
};
const recoveryVariants = [
  o(
    {
      type: { enum: ["request"], type: "string" },
      email: { type: "string", format: "email" },
    },
    ["type", "email"],
  ),
  o(
    {
      type: { enum: ["verify"], type: "string" },
      id: str,
      code: { type: "string", pattern: "^[0-9]{6}$" },
    },
    ["type", "id", "code"],
  ),
  o(
    {
      type: { enum: ["complete"], type: "string" },
      id: str,
      grant: str,
      password: { type: "string", minLength: 12, maxLength: 128 },
    },
    ["type", "id", "grant", "password"],
  ),
];
doc.paths["/api/auth/recovery"] = {
  post: {
    ...op(
      "Восстановление пароля: письмо → проверка → новый пароль",
      { oneOf: recoveryVariants },
      {
        anyOf: [
          o({ id: str, message: str, resendAt: date }, [
            "id",
            "message",
            "resendAt",
          ]),
          o({ grant: str }, ["grant"]),
          o({ ok: bool }, ["ok"]),
        ],
      },
      "Не требует входа. HttpOnly offerly_reset cookie связывает браузер с потоком. Код 10 мин/5 попыток; grant 5 мин. При завершении все сеансы отозваны. Для неизвестной почты тот же текст ответа; только аккаунты с паролем, не demo.",
    ),
    security: [],
    parameters: [{ name: "Origin", in: "header", required: true, schema: str }],
  },
};
const roleParam = {
    name: "X-Offerly-Role",
    in: "header",
    required: true,
    schema: { type: "string", enum: ["candidate"] },
  },
  idParam = { name: "id", in: "path", required: true, schema: str };
const get = (summary, schema, params = []) => ({
  summary,
  parameters: [roleParam, ...params],
  responses: {
    200: {
      description: "Публичное представление",
      content: { "application/json": { schema } },
    },
    ...err(),
  },
});
doc.paths["/api/professional/generative-packs"] = {
  get: get(
    "12 активных специализаций и Junior/Middle/Senior",
    arr(
      o({
        id: str,
        name: str,
        presentation: { ...obj, nullable: true },
        grades: arr(grade),
      }),
    ),
  ),
};
doc.paths["/api/professional/adaptive-sessions"] = {
  get: get("История своих испытаний", arr(ref("PublicAssessmentSession"))),
  post: op(
    "Начать серверное испытание",
    o({ specialization: str, targetGrade: grade }, [
      "specialization",
      "targetGrade",
    ]),
    ref("PublicAssessmentSession"),
    "20 минут на сервере. Один активный тест аккаунта, восстановление той же попытки; calibratedForms выключен. После подтверждения: 90 суток по специализации; после неудачи: 7 суток для того же уровня. Дата определяется сервером, история не переоценивается.",
  ),
};
doc.paths["/api/professional/adaptive-sessions"].post.parameters[1] = roleParam;
doc.paths["/api/professional/adaptive-sessions/{id}"] = {
  get: get(
    "Восстановить своё испытание, проверить timeout",
    ref("PublicAssessmentSession"),
    [idParam],
  ),
};
for (const [type, schema, description] of [
  [
    "answer",
    "AssessmentAnswer",
    "Ответ и исполняемый план; точный replay идемпотентен.",
  ],
  ["evidence", "AssessmentEvidence", "Открыть разрешённый источник evidence."],
  [
    "navigate",
    "AssessmentNavigationInput",
    "Перейти только к available шагу. Связанные шаги открываются последовательно.",
  ],
  [
    "revise",
    "AssessmentNavigationInput",
    "Переоткрыть ответ активной попытки. Зависимые ответы сбрасываются и прогресс пересчитывается; срок не продлевается.",
  ],
]) {
  const v = op(description, ref(schema), ref("PublicAssessmentSession"));
  v.parameters = [v.parameters[0], roleParam, idParam];
  doc.paths[`/api/professional/adaptive-sessions/{id}/${type}`] = { post: v };
}
doc.info.version = "0.5.0";
doc.info.description =
  "Node.js/PostgreSQL/PGlite MVP. Реальные cookie-сессии и роли; professional formal-generator-7.3.3 / competency-4. OIDC-клиент ФСП реализован, live провайдер не настроен; ATS только концепция. Полные правила новых функций: docs/guides/mvp-features.md.";
for (const [path, item] of Object.entries(doc.paths))
  for (const [method, operation] of Object.entries(item))
    if (["get", "post", "delete", "patch", "put"].includes(method))
      operation.operationId =
        operation.operationId ||
        method + "_" + path.replace(/[^a-z0-9]/gi, "_");
S.AssessmentRetakePolicy = o(
  {
    version: str,
    confirmedDays: { ...int, example: 90 },
    unsuccessfulDays: { ...int, example: 7 },
  },
  ["version", "confirmedDays", "unsuccessfulDays"],
);
S.AssessmentEligibility = o(
  {
    allowed: bool,
    nextEligibleAt: { ...date, nullable: true },
    reason: {
      type: "string",
      enum: ["confirmed", "unsuccessful", null],
      nullable: true,
    },
    policy: ref("AssessmentRetakePolicy"),
    serverNow: date,
  },
  ["allowed", "nextEligibleAt", "reason", "policy", "serverNow"],
);
doc.paths["/api/professional/eligibility"] = {
  get: {
    ...get(
      "Доступность новой попытки и точная дата следующего старта",
      ref("AssessmentEligibility"),
      [
        { name: "specialization", in: "query", required: true, schema: str },
        { name: "targetGrade", in: "query", required: true, schema: grade },
      ],
    ),
    operationId: "professionalRetakeEligibility",
  },
};
doc.paths["/api/professional/adaptive-sessions"].post.responses["429"] = {
  description:
    "Лимит повторов либо частоты запросов. Для cooldown: code=ASSESSMENT_COOLDOWN и nextEligibleAt.",
  content: {
    "application/json": {
      schema: o(
        {
          error: str,
          code: { type: "string", enum: ["ASSESSMENT_COOLDOWN"] },
          nextEligibleAt: date,
          reason: str,
          policy: ref("AssessmentRetakePolicy"),
          serverNow: date,
        },
        ["error"],
      ),
    },
  },
};
// Hard deadlines are enforced by the application adapter and conversation transaction.
S.AssessmentTimeoutSummary = o(
  {
    policy: { type: "string", enum: ["unanswered-zero-v1"] },
    answered: int,
    unanswered: int,
    total: int,
    score: { type: "number", minimum: 0, maximum: 100 },
  },
  ["policy", "answered", "unanswered", "total", "score"],
);
S.PublicAssessmentResult.properties.timeoutSummary = ref(
  "AssessmentTimeoutSummary",
);
S.PublicAssessmentResult.description =
  "После дедлайна current=null, новые ответы/переходы/изменения отклоняются 409. Назначенные, но не отвеченные шаги учитываются как 0; score взвешен по компетенциям. Исторические отчёты не пересчитываются.";
S.EmployerTask = o(
  {
    title: str,
    instructions: str,
    criteria: str,
    minutes: { type: "integer", minimum: 1, maximum: 120 },
    status: {
      type: "string",
      enum: [
        "offered",
        "accepted",
        "declined",
        "submitted",
        "expired",
        "reviewed",
      ],
    },
    startedAt: date,
    deadlineAt: date,
    expiredAt: date,
    submittedAt: date,
    draftAnswer: { type: "string", maxLength: 12000 },
    draftRevision: { type: "integer", minimum: 0 },
    draftSavedAt: date,
    answer: str,
    feedback: str,
  },
  ["title", "instructions", "criteria", "minutes", "status"],
);
S.EmployerTask.description =
  "До принятия кандидат получает только время и статус, содержимое скрыто. Принятие запускает серверный срок. После дедлайна редактирование запрещено, последний сохранённый частичный ответ фиксируется и доступен работодателю. Черновик доступен только кандидату, условия истёкшей задачи ему скрыты. Грейд не меняется; свободный текст оценивает работодатель.";
S.ConversationMessage = o(
  {
    id: str,
    senderRole: { type: "string", enum: ["candidate", "employer"] },
    createdAt: date,
    text: str,
    task: ref("EmployerTask"),
  },
  ["id", "senderRole", "createdAt", "text"],
);
const conversation = doc.paths["/api/conversations/{id}"];
const conversationActions = [
  o(
    {
      type: { type: "string", enum: ["message"] },
      body: { type: "string", maxLength: 4000 },
      clientId: { type: "string", pattern: "^[a-zA-Z0-9-]{16,80}$" },
      task: o(
        {
          title: { type: "string", maxLength: 200 },
          instructions: { type: "string", maxLength: 10000 },
          criteria: { type: "string", maxLength: 2000 },
          minutes: { type: "integer", minimum: 1, maximum: 120 },
        },
        ["title", "instructions", "criteria", "minutes"],
      ),
    },
    ["type", "clientId"],
  ),
  o(
    {
      type: { type: "string", enum: ["read"] },
      through: { type: "string", pattern: "^[0-9]{1,18}$" },
    },
    ["type", "through"],
  ),
  o(
    {
      type: { type: "string", enum: ["task-response"] },
      messageId: str,
      status: { type: "string", enum: ["accepted", "declined", "submitted"] },
      answer: { type: "string", maxLength: 12000 },
    },
    ["type", "messageId", "status"],
  ),
  o(
    {
      type: { type: "string", enum: ["task-draft"] },
      messageId: str,
      answer: { type: "string", maxLength: 12000 },
      revision: { type: "integer", minimum: 1 },
    },
    ["type", "messageId", "answer", "revision"],
  ),
  o(
    {
      type: { type: "string", enum: ["task-review"] },
      messageId: str,
      feedback: { type: "string", maxLength: 6000 },
    },
    ["type", "messageId", "feedback"],
  ),
];
conversation.post.summary =
  "Сообщение, прочтение, добровольная задача, ответ, черновик или обратная связь";
conversation.post.requestBody.content["application/json"].schema = {
  oneOf: conversationActions,
};
conversation.post.description =
  "Сессионные ACL компании/кандидата. task-draft: revision равна текущей серверной версии плюс 1; точный повтор идемпотентен. Сохранение черновика не создаёт уведомлений. Статусы задач и истечение срока создают непрочитанные уведомления в диалоге. Отправка задачи только работодателем, принятие/отказ/ответ только кандидатом.";
conversation.post.responses["409"].description =
  "Дедлайн истёк, конфликт версии черновика/состояния или clientId с другим содержимым";
doc.info.version = "0.5.1";
// Employer import routes and MCP transports are part of the same public API inventory.
S.TaskBrief = o(
  {
    spec: str,
    grade: str,
    grades: arr(str),
    skills: arr(str),
    desiredSkills: arr(str),
    salaryMin: str,
    salaryMax: str,
    formats: arr(str),
    task: {
      type: "string",
      enum: ["balanced", "operations", "product", "quality"],
    },
    tasks: arr({ type: "string", enum: ["operations", "product", "quality"] }),
    sort: {
      type: "string",
      enum: ["Тест + ФСП", "По результату теста", "По достижениям ФСП"],
    },
  },
  [
    "spec",
    "grade",
    "skills",
    "desiredSkills",
    "salaryMin",
    "salaryMax",
    "formats",
    "task",
    "sort",
  ],
);
doc.paths["/api/task-brief"] = {
  post: op(
    "Разобрать текст задачи в редактируемые условия",
    o(
      {
        role: { type: "string", enum: ["employer"] },
        text: { type: "string", minLength: 10, maxLength: 3000 },
      },
      ["role", "text"],
    ),
    o({
      requirements: ref("TaskBrief"),
      signals: arr(o({ field: str, value: str, quote: str })),
      warnings: arr(str),
    }),
    "Локальный детерминированный разбор, без внешней LLM. Не подтверждает навыки или грейд.",
  ),
};
doc.paths["/api/recommendations"] = {
  post: op(
    "Подобрать кандидатов по подтверждённым условиям",
    o(
      {
        role: { type: "string", enum: ["employer"] },
        requirements: ref("TaskBrief"),
      },
      ["role", "requirements"],
    ),
    o({
      requirements: ref("TaskBrief"),
      total: int,
      examined: int,
      recommendations: arr(obj),
      groups: arr(o({ grade: str, total: int, examined: int })),
      relaxations: arr(obj),
      method: str,
    }),
    "Те же ACL, скрытие контактов, категории и версии тестов, что в каталоге. До 20 профилей каждого приоритета и уровня; метод и объяснения возвращаются в ответе.",
  ),
};
const sessionGet = (summary, schema) => ({
  summary,
  responses: {
    200: { description: "Успех", content: { "application/json": { schema } } },
    ...err(),
  },
});
doc.paths["/api/mcp/settings"] = {
  get: sessionGet(
    "Состояние подключения работодателя без раскрытия токена",
    obj,
  ),
  post: op(
    "Создать, показать, заменить или отозвать MCP-токен",
    o(
      {
        action: {
          type: "string",
          enum: ["create", "reveal", "rotate", "revoke"],
        },
      },
      ["action"],
    ),
    obj,
    "Только браузер той же origin и owner/recruiter действующей компании. Соискателю без компании недоступно. Токен не включается в /api/state; ответ no-store.",
  ),
};
doc.paths["/api/mcp/drafts"] = {
  get: sessionGet(
    "Черновики приглашений своей компании",
    o({ drafts: arr(obj) }),
  ),
  post: op(
    "Одобрить отправку либо удалить черновик",
    o(
      {
        id: { type: "string", maxLength: 80 },
        action: { type: "string", enum: ["approve", "delete"] },
      },
      ["id", "action"],
    ),
    o({ drafts: arr(obj), state: obj }),
    "Только явное действие работодателя в браузере. MCP-токен не разрешает одобрение или отправку. Чужая компания не получает черновик.",
  ),
};
S.McpRequest = o(
  {
    jsonrpc: { type: "string", enum: ["2.0"] },
    id: { oneOf: [str, { type: "number" }] },
    method: {
      type: "string",
      enum: [
        "initialize",
        "ping",
        "tools/list",
        "tools/call",
        "notifications/initialized",
        "notifications/cancelled",
      ],
    },
    params: obj,
  },
  ["jsonrpc", "method"],
);
S.McpResponse = o(
  {
    jsonrpc: { type: "string", enum: ["2.0"] },
    id: { oneOf: [str, { type: "number" }] },
    result: obj,
    error: o({ code: int, message: str }),
  },
  ["jsonrpc", "id"],
);
doc.components.securitySchemes.McpBearer = {
  type: "http",
  scheme: "bearer",
  description:
    "Отзываемый токен работодателя, привязанный к пользователю, компании и scope. Не даёт доступа к PII, сообщениям, файлам или отправке приглашений.",
};
const transport = (summary) => ({
  ...op(
    summary,
    ref("McpRequest"),
    ref("McpResponse"),
    "JSON-RPC 2.0. Только search_candidates, get_candidate_profile, draft_invitation; схемы аргументов возвращает tools/list. Неизвестные RPC-методы возвращают error -32601; ошибки инструментов — result.isError. Bearer ACL перепроверяются на каждом вызове.",
  ),
  security: [{ McpBearer: [] }],
  parameters: [{ name: "mcp-protocol-version", in: "header", schema: str }],
  responses: {
    200: {
      description: "JSON-RPC ответ",
      content: { "application/json": { schema: ref("McpResponse") } },
    },
    202: { description: "Уведомление принято без JSON-RPC ответа" },
    ...err(),
    429: { description: "Лимит запросов" },
    503: { description: "MCP выключен или конфигурация недоступна" },
  },
});
doc.paths["/api/mcp"] = {
  post: transport("MCP JSON transport"),
  get: {
    summary: "GET не поддерживается; используйте POST или SSE",
    security: [{ McpBearer: [] }],
    responses: { 405: { description: "Allow: POST" }, ...err() },
  },
};
doc.paths["/api/mcp/sse"] = {
  get: {
    summary: "Открыть MCP SSE-сеанс",
    security: [{ McpBearer: [] }],
    parameters: [
      {
        name: "Accept",
        in: "header",
        required: true,
        schema: { type: "string", enum: ["text/event-stream"] },
      },
    ],
    responses: {
      200: {
        description:
          "SSE endpoint/message; sessionId связан с пользователем и токеном",
        content: { "text/event-stream": { schema: str } },
      },
      406: { description: "Не запрошен SSE" },
      ...err(),
    },
  },
};
doc.paths["/api/mcp/messages"] = {
  post: transport("Отправить JSON-RPC в свой SSE-сеанс"),
};
doc.paths["/api/mcp/messages"].post.parameters.push({
  name: "sessionId",
  in: "query",
  required: true,
  schema: str,
});
delete doc.paths["/api/mcp/messages"].post.responses[200];
doc.paths["/api/identity/fsp-demo"] = {
  get: sessionGet(
    "Состояние локального демонстрационного ФСП",
    o({ enabled: bool, available: bool, linked: bool, events: arr(obj) }, [
      "enabled",
      "available",
      "linked",
      "events",
    ]),
  ),
};
doc.paths["/api/identity/fsp-demo/{operation}"] = {
  parameters: [
    {
      name: "operation",
      in: "path",
      required: true,
      schema: { type: "string", enum: ["start", "callback", "sync", "unlink"] },
    },
  ],
  post: op(
    "Начать, синхронизировать или отключить демопривязку",
    o({
      intent: { type: "string", enum: ["login", "link"] },
      role: { type: "string", enum: ["candidate", "employer"] },
    }),
    obj,
    "start требует intent; sync/unlink без полей. Только локальный изолированный demo scope. Обычные аккаунты не переводятся в демо.",
  ),
  get: {
    summary: "OIDC callback демонстрационного провайдера",
    parameters: [
      { name: "code", in: "query", schema: str },
      { name: "state", in: "query", schema: str },
      { name: "error", in: "query", schema: str },
    ],
    responses: {
      307: {
        description:
          "Переход в кабинет или login; PKCE/state/nonce, привязка к браузеру и однократное использование",
      },
      ...err(),
    },
  },
};
// Dynamic catalog route also supports company names, in addition to the documented concrete paths.
doc.paths["/api/catalog/{kind}"] = {
  get: {
    ...doc.paths["/api/catalog/candidates"].get,
    summary: "Каталог кандидатов, вакансий либо названий компаний",
    operationId: "get_api_catalog_kind",
    parameters: [
      {
        name: "kind",
        in: "path",
        required: true,
        schema: { type: "string", enum: ["candidates", "jobs", "companies"] },
      },
      ...(doc.paths["/api/catalog/candidates"].get.parameters || []),
    ],
  },
};
for (const item of Object.values(doc.paths))
  for (const [method, operation] of Object.entries(item))
    if (
      ["get", "post", "delete", "patch", "put"].includes(method) &&
      !operation.operationId
    )
      operation.operationId =
        method +
        "_" +
        operation.summary.replace(/[^a-z0-9]/gi, "_") +
        "_" +
        Object.keys(doc.paths).indexOf(
          Object.keys(doc.paths).find((p) => doc.paths[p] === item),
        );
const bytes = JSON.stringify(doc, null, 2) + "\n";
await writeFile("docs/api/openapi.json", bytes);
await writeFile("public/openapi.json", bytes);
console.log(Object.keys(doc.paths).length + " paths");
