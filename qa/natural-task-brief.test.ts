import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseTaskBrief,
  validateTaskBrief,
  taskBriefGrades,
  taskBriefTasks,
} from '../lib/task-brief';
import { matchingContext } from '../lib/employer-matching';

const deliveryTask = `Мы делаем сервис для небольших служб доставки и ищем разработчика, который поможет привести в порядок серверную часть. Сейчас при большом количестве заказов иногда теряются обновления статусов, а интеграции с партнёрами сложно поддерживать. Хотим сначала разобраться с этими проблемами, а затем добавить автоматическое распределение заказов между курьерами.
Основной код написан на Go, данные храним в PostgreSQL, для очередей используем RabbitMQ. Важнее умение разобраться в чужом коде и объяснить своё решение, чем знание всех наших инструментов. Опыт с платежами или логистикой будет плюсом. Если человек участвовал в соревнованиях, интересно посмотреть, что именно он делал в команде.
Работать можно удалённо, но нужно несколько часов пересечения с командой по московскому времени. Рассчитываем на 200–260 тысяч рублей в месяц. Ищем человека, которому можно постепенно доверить отдельную часть продукта без постоянного контроля.`;

test('delivery brief recognizes the new hard code-language policy, mixed tasks and all levels', () => {
  const parsed = parseTaskBrief(deliveryTask);
  const brief = validateTaskBrief(parsed.requirements);
  assert.equal(brief.spec, 'Backend');
  assert.equal(brief.grade, '');
  assert.deepEqual(taskBriefGrades(brief), ['Junior', 'Middle', 'Senior']);
  assert.deepEqual(brief.skills, ['Go']);
  assert.deepEqual(brief.desiredSkills, ['PostgreSQL', 'RabbitMQ']);
  assert.deepEqual(taskBriefTasks(brief), ['operations', 'product']);
  assert.equal(brief.salaryMin, '200000');
  assert.equal(brief.salaryMax, '260000');
  assert.deepEqual(brief.formats, ['Удалённо']);
  assert.equal(
    parsed.signals.every((signal) => deliveryTask.includes(signal.quote)),
    true,
  );
  assert.equal(
    parsed.signals.some((signal) => signal.field === 'Обязательная технология' && signal.value === 'Go'),
    true,
  );
});

test('working role descriptions handle Russian cases and avoid a legacy Data overlap', () => {
  for (const [text, spec] of [
    ['Ищем разработчика серверной логики', 'Backend'],
    ['Помочь с серверной частью', 'Backend'],
    ['Доработать API сервиса', 'Backend'],
    ['Разработчик клиентской части', 'Frontend'],
    ['Инженера по тестированию сервиса', 'QA / QA Automation'],
    ['Data Scientist для моделей прогнозирования', 'Data Scientist / Applied ML'],
    ['Data Engineering для хранилища', 'Data Engineering'],
  ])
    assert.equal(parseTaskBrief(text).requirements.spec, spec, text);
});

test('current project stack and generic mentions never become hard requirements', () => {
  for (const text of [
    'Наш стек: Python, SQL и Redis.',
    'Сервис работает на Python. Используем SQL и Redis.',
  ]) {
    const brief = parseTaskBrief(`Серверная часть. ${text}`).requirements;
    assert.deepEqual(brief.skills, [], text);
    assert.deepEqual(brief.desiredSkills, ['Python', 'SQL', 'Redis'], text);
  }
});

test('explicit mandatory requirements survive a description of the current stack', () => {
  const brief = parseTaskBrief(
    'Сервис написан на Python и SQL. Обязательно знание Go. Redis не обязателен. Без Java.',
  ).requirements;
  assert.deepEqual(brief.skills, ['Go']);
  assert.deepEqual(brief.desiredSkills, ['Python', 'SQL', 'Redis']);
});

test('ordinary tasks are combined; repetitions cannot increase a priority', () => {
  const text =
    'Сервис падает, теряются сообщения. Надо добавить новую функцию и покрыть тестами.';
  const a = parseTaskBrief(text).requirements;
  const b = parseTaskBrief(
    `${text} Сервис падает, падает, падает.`,
  ).requirements;
  assert.deepEqual(taskBriefTasks(a), ['operations', 'product', 'quality']);
  assert.deepEqual(matchingContext(a).weights, matchingContext(b).weights);
});

test('negated directions and tasks do not silently add priorities', () => {
  const brief = parseTaskBrief(
    'Нужен Backend. Не требуется Frontend. Не хотим добавлять интеграции. Не нужна диагностика. Нужна надёжность.',
  ).requirements;
  assert.equal(brief.spec, 'Backend');
  assert.deepEqual(taskBriefTasks(brief), ['quality']);
});

test('knowledge explicitly not required is ignored, optional knowledge stays a preference', () => {
  const brief = parseTaskBrief(
    'Серверная часть. Не требуется знание Java. Не нужен опыт работы с Redis. SQL не обязателен. Обязательно Python.',
  ).requirements;
  assert.deepEqual(brief.skills, ['Python']);
  assert.deepEqual(brief.desiredSkills, ['SQL']);
});

test('missing level is allowed; explicit alternatives remain restricted and autonomy is not a grade', () => {
  const brief = parseTaskBrief(
    'Нужен Backend, Middle или Senior. Junior не нужен.',
  ).requirements;
  assert.equal(brief.grade, '');
  assert.deepEqual(taskBriefGrades(validateTaskBrief(brief)), [
    'Middle',
    'Senior',
  ]);
  assert.deepEqual(
    taskBriefGrades(
      validateTaskBrief(
        parseTaskBrief(
          'Нужен Backend, опыт 10 лет, самостоятельный специалист.',
        ).requirements,
      ),
    ),
    ['Junior', 'Middle', 'Senior'],
  );
});

test('new groups reject hostile structures, conflicting levels/tasks and invented client weights', () => {
  const good = validateTaskBrief(parseTaskBrief(deliveryTask).requirements);
  for (const patch of [
    { grades: ['Wizard'] },
    { grades: 'Senior' },
    { grades: ['Junior', 'Middle', 'Senior', 'Junior'] },
    { grade: 'Middle', grades: ['Senior'] },
    { tasks: ['mixed'] },
    { tasks: 'quality' },
    { tasks: [['operations']] },
    { task: 'product', tasks: ['operations', 'product'] },
  ])
    assert.throws(() => validateTaskBrief({ ...good, ...patch }));
  const context = matchingContext({ ...good, weights: { diagnosis: 10000 } });
  assert.deepEqual(context.weights, {
    diagnosis: 2,
    correctness: 2,
    engineering_judgment: 2,
    adaptation: 2,
  });
  assert.equal(context.task, 'mixed');
});
