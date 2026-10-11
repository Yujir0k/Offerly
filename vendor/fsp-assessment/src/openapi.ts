type Schema = Record<string, unknown>;
const text: Schema = { type: 'string' };
const strings: Schema = { type: 'array', items: text };
const number: Schema = { type: 'integer' };
const grade: Schema = { type: 'string', enum: ['Junior', 'Middle', 'Senior'] };
const mode: Schema = { type: 'string', enum: ['closed', 'docs', 'hint', 'local', 'extended'] };
function request(properties: Record<string, Schema>, required = Object.keys(properties)): Schema {
  return { type: 'object', properties, required };
}
/** OpenAPI contract for the versioned local prototype API. */
export function openapi() {
  const paths: Record<string, Record<string, unknown>> = {};
  const add = (
    path: string,
    method: string,
    summary: string,
    schema?: Schema,
    anonymous = false,
  ) => {
    const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: text,
    }));
    if (method !== 'get')
      parameters.push({
        name: 'X-Platform-Request',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['1'] },
      });
    paths[path] ??= {};
    paths[path]![method] = {
      summary,
      operationId: `${method}_${path.replace(/[^a-z0-9]/gi, '_')}`,
      security: anonymous ? [] : [{ cookieAuth: [] }],
      ...(parameters.length ? { parameters } : {}),
      ...(schema
        ? { requestBody: { required: true, content: { 'application/json': { schema } } } }
        : {}),
      responses: Object.fromEntries(
        [
          ['200', 'Успешный результат'],
          ['201', 'Создано'],
          ['400', 'Ошибка входных данных'],
          ['401', 'Требуется вход'],
          ['403', 'Доступ запрещён'],
          ['404', 'Не найдено'],
          ['409', 'Недопустимое состояние'],
          ['429', 'Превышен лимит'],
          ['503', 'Интеграция не подключена'],
        ].map(([code, description]) => [
          code,
          {
            description,
            content: {
              'application/json': {
                schema: code!.startsWith('2')
                  ? { type: ['object', 'array'] }
                  : { $ref: '#/components/schemas/Error' },
              },
            },
          },
        ]),
      ),
    };
  };
  add('/api/health', 'get', 'Проверка доступности', undefined, true);
  add('/api/catalog', 'get', 'Каталог ролей, навыков, грейдов и профилей ИИ', undefined, true);
  add('/api/adaptive-sessions', 'get', 'История подтверждения заявленного уровня');
  add('/api/generative-packs', 'get', 'Опубликованные специализации генеративной проверки');
  add('/api/admin/generative-status', 'get', 'Evaluator: модели, exposure и pre-generated pool');
  add('/api/admin/adaptive-sessions', 'get', 'Evaluator: список проверок');
  add(
    '/api/admin/adaptive-sessions/{id}/export',
    'get',
    'Только evaluator: выгрузка данных для экспертного пилота',
  );
  add(
    '/api/admin/adaptive-sessions/{id}',
    'get',
    'Evaluator: raw evidence, formal world, ground truth и версии',
  );
  add(
    '/api/adaptive-sessions',
    'post',
    'Начать multistage assessment с общим лимитом 20 минут',
    request({ specialization: text, targetGrade: grade }),
  );
  add('/api/adaptive-sessions/{id}', 'get', 'Текущий шаг без рубрики и серверный результат');
  add(
    '/api/adaptive-sessions/{id}/answer',
    'post',
    'Зафиксировать ответ и выбрать следующий шаг',
    request({ itemId: text, stepId: text, optionId: text }),
  );
  add(
    '/api/adaptive-sessions/{id}/evidence',
    'post',
    'Открыть источник evidence и сохранить порядок',
    request({ itemId: text, stepId: text, artifactId: text }),
  );
  add('/api/adaptive-sessions/{id}/telemetry', 'get', 'Собственная техническая telemetry сессии');
  add('/api/admin/adaptive-telemetry', 'get', 'Техническая telemetry для внутренней валидации');
  add('/api/sessions', 'get', 'Программы сессий текущего кандидата');
  add(
    '/api/sessions',
    'post',
    'Начать полную программу или отдельную сессию компании',
    request({ trackId: text, grade, toolMode: mode, needId: text }, []),
  );
  add('/api/sessions/{id}', 'get', 'Сессия с принадлежащими кандидату кейсами и результатами');
  add('/api/sessions/{id}/archive', 'post', 'Отложить всю незавершённую сессию', request({}));
  add(
    '/api/sessions/{id}/resume',
    'post',
    'Возобновить сессию с сохранённым прогрессом',
    request({}),
  );
  add(
    '/api/auth/register',
    'post',
    'Регистрация с согласием; dev verification без доставки email',
    request({
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 10 },
      name: text,
      role: { enum: ['candidate', 'employer'] },
      consent: { const: true },
    }),
    true,
  );
  add(
    '/api/auth/login',
    'post',
    'Вход после подтверждения email',
    request({ email: text, password: text }),
    true,
  );
  add('/api/auth/verify', 'get', 'Одноразовое подтверждение email', undefined, true);
  paths['/api/auth/verify']!['get'] = {
    ...(paths['/api/auth/verify']!['get'] as object),
    parameters: [{ name: 'token', in: 'query', required: true, schema: text }],
    responses: {
      '303': { description: 'Адрес подтверждён; переход в кабинет' },
      '400': { description: 'Ссылка недействительна' },
    },
  };
  add('/api/auth/me', 'get', 'Текущий пользователь');
  add('/api/auth/logout', 'post', 'Завершение сессии', request({}));
  add(
    '/api/profile',
    'patch',
    'Профиль, контакты, согласие, стек и неподтверждённый ID ФСП',
    request({
      name: text,
      contacts: text,
      consent: { type: 'boolean' },
      stack: strings,
      fspId: text,
    }),
  );
  add('/api/needs', 'get', 'Потребности работодателя или опубликованный список');
  add(
    '/api/needs',
    'post',
    'Структурированная потребность: приоритеты выбирают семейство без ИИ',
    request(
      {
        title: text,
        trackId: text,
        grade,
        stack: strings,
        required: strings,
        weights: {
          type: 'object',
          additionalProperties: { type: 'integer', minimum: 0, maximum: 10 },
        },
        toolMode: mode,
        familyIds: strings,
        salaryMin: number,
        salaryMax: number,
        description: text,
      },
      [
        'title',
        'trackId',
        'grade',
        'stack',
        'required',
        'weights',
        'toolMode',
        'salaryMin',
        'salaryMax',
        'description',
      ],
    ),
  );
  add('/api/assessments', 'get', 'Собственные испытания');
  add(
    '/api/assessments',
    'post',
    'Первичное или дополнительное испытание выбранного семейства',
    request({ trackId: text, grade, toolMode: mode, needId: text, familyId: text }, []),
  );
  add('/api/assessments/{id}', 'get', 'Испытание без скрытого oracle');
  add(
    '/api/assessments/{id}/archive',
    'post',
    'Отложить незавершённую попытку без удаления данных',
    request({}),
  );
  add('/api/assessments/{id}/resume', 'post', 'Восстановить попытку из архива', request({}));
  add(
    '/api/assessments/{id}/answers',
    'post',
    'Ответы теоретического этапа',
    request({ answers: { type: 'object', additionalProperties: text } }),
  );
  add(
    '/api/assessments/{id}/advance',
    'post',
    'Последовательный переход к следующему этапу',
    request({}),
  );
  add(
    '/api/assessments/{id}/experiments',
    'post',
    'Эксперимент: plan должен соответствовать controls текущего семейства',
    request(
      {
        plan: {
          type: 'object',
          additionalProperties: {
            oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'array', items: text }],
          },
        },
        features: strings,
        split: { enum: ['random', 'time', 'group'] },
        strategy: { enum: ['arrival', 'dedupe', 'versioned'] },
        policy: { enum: ['all', 'current', 'current-abstain'] },
        topK: { type: 'integer', minimum: 1, maximum: 5 },
      },
      [],
    ),
  );
  add(
    '/api/assessments/{id}/assistant',
    'post',
    'Помощь по профилю инструментов текущего этапа',
    request({ question: { type: 'string', maxLength: 3000 } }),
  );
  add(
    '/api/assessments/{id}/submit',
    'post',
    'Сдача работы и предварительная оценка',
    request({ recommendation: text }),
  );
  add('/api/cases', 'get', 'Доступные особые кейсы');
  add(
    '/api/cases',
    'post',
    'Черновик корпоративного семейства',
    request({
      title: text,
      trackId: text,
      skills: strings,
      context: text,
      deliverable: text,
      constraints: text,
      materials: { type: 'array', items: request({ name: text, content: text }) },
      questions: {
        type: 'array',
        items: request({ prompt: text, options: strings, correct: number, skill: text }),
      },
      variations: strings,
      rubric: text,
      mode,
    }),
  );
  add('/api/cases/{id}/publish', 'post', 'Публикация экспериментального кейса', request({}));
  add('/api/cases/{id}/variant', 'get', 'Параметризованный собственный вариант');
  add(
    '/api/cases/{id}/submit',
    'post',
    'Сдача на экспертную проверку без изменения грейда',
    request({
      variantId: text,
      answers: { type: 'object', additionalProperties: text },
      recommendation: text,
    }),
  );
  add(
    '/api/cases/{id}/assistant',
    'post',
    'Помощник особого кейса по заданному режиму',
    request({ variantId: text, question: text }),
  );
  add('/api/case-submissions', 'get', 'Доступные результаты особых кейсов');
  add('/api/candidates', 'get', 'Объяснимый подбор; контакты скрыты до принятия приглашения');
  paths['/api/candidates']!['get'] = {
    ...(paths['/api/candidates']!['get'] as object),
    parameters: [{ name: 'needId', in: 'query', required: false, schema: text }],
  };
  add('/api/invitations', 'get', 'Собственные приглашения');
  add(
    '/api/invitations',
    'post',
    'Пригласить кандидата с зарплатным диапазоном',
    request({ candidateId: text, description: text, salaryMin: number, salaryMax: number }),
  );
  add(
    '/api/invitations/{id}',
    'patch',
    'Решение кандидата',
    request({ status: { enum: ['viewed', 'accepted', 'declined'] } }),
  );
  add('/api/admin/validation', 'get', 'Техническая валидация');
  add('/api/admin/reviews', 'get', 'Экспертная очередь');
  add(
    '/api/admin/reviews',
    'post',
    'Экспертная проверка открытого ответа',
    request({
      assessmentId: text,
      decision: { enum: ['approved', 'needs_revision'] },
      notes: text,
    }),
  );
  add('/api/admin/case-submissions', 'get', 'Очередь особых кейсов');
  add(
    '/api/admin/case-submissions',
    'post',
    'Проверка особого кейса',
    request({
      submissionId: text,
      decision: { enum: ['approved', 'needs_revision'] },
      notes: text,
    }),
  );
  add('/api/admin/observations', 'get', 'Описательный отчёт человеческого пилота');
  add(
    '/api/admin/observations',
    'post',
    'Записать независимое наблюдение',
    request({
      participant: text,
      familyId: text,
      variantId: text,
      expertGrade: number,
      predictedGrade: number,
      score: number,
      seconds: number,
      condition: { enum: ['standard', 'exposed', 'ai-only'] },
    }),
  );
  return {
    openapi: '3.1.0',
    info: {
      title: 'Практика · Assessment API',
      version: '0.1.0',
      description:
        'Локальная оценочная платформа. Все грейды предварительные. Мутации требуют X-Platform-Request: 1. Live LLM выключена по умолчанию.',
    },
    servers: [{ url: '/' }],
    paths,
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'sid' } },
      schemas: { Error: { type: 'object', properties: { error: text }, required: ['error'] } },
    },
  };
}
