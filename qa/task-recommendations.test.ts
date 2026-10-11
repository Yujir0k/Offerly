import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseTaskBrief,
  validateTaskBrief,
  emptyTaskBrief,
} from '../lib/task-brief';
import {
  comparableProfileKey,
  selectTaskRecommendations,
  strongDimensions,
  type RecommendationLane,
} from '../lib/task-recommendations';
import { initialState, type Profile } from '../lib/model';
import type { Ranking } from '../lib/employer-matching';

test('Russian brief extracts explicit requirements, budget, task and exact quotes', () => {
  const text =
    'Нужен Backend Middle на Python. Обязательно SQL, желательно Redis. Разбирать инциденты и находить причины ошибок. Удалённо, бюджет до 230 тыс. ₽ в месяц.';
  const parsed = parseTaskBrief(text);
  assert.deepEqual(parsed.requirements, {
    ...emptyTaskBrief,
    spec: 'Backend',
    grade: 'Middle',
    skills: ['Python', 'SQL'],
    desiredSkills: ['Redis'],
    salaryMax: '230000',
    formats: ['Удалённо'],
    task: 'operations',
  });
  assert(parsed.signals.every((signal) => text.includes(signal.quote)));
});
test('aliases and longest matches do not confuse JavaScript with Java or SQL Server with SQL', () => {
  const r = parseTaskBrief(
    'Frontend Senior. Обязательно JavaScript и Microsoft SQL Server. Желательно питон.',
  ).requirements;
  assert(r.skills.includes('JavaScript'));
  assert(!r.skills.includes('Java'));
  assert(!r.skills.includes('SQL'));
  assert.deepEqual(r.desiredSkills, ['Python']);
});
test('required list scope survives commas; optional and explicit negation do not become requirements', () => {
  const r = parseTaskBrief(
    'Backend Middle. Обязательно Python, SQL, желательно Redis. Без Java. TypeScript не обязателен.',
  ).requirements;
  assert.deepEqual(r.skills, ['Python', 'SQL']);
  assert.deepEqual(r.desiredSkills, ['Redis', 'TypeScript']);
});
test('multiple directions and grades require clarification, never infer a grade from years', () => {
  const r = parseTaskBrief(
    'Нужны Backend и Frontend. Junior или Senior. Опыт от 5 лет.',
  );
  assert.equal(r.requirements.spec, '');
  assert.equal(r.requirements.grade, '');
  assert(
    r.warnings.some((warning) => warning.includes('несколько направлений')),
  );
  assert.equal(
    parseTaskBrief('Нужен Backend. Опыт от 10 лет').requirements.grade,
    '',
  );
});
test('single technology direction is a hypothesis; incompatible technologies require clarification', () => {
  const r = parseTaskBrief('Нужен Middle на React для нового продукта.');
  assert.equal(r.requirements.spec, 'Frontend');
  assert(r.warnings.some((warning) => warning.includes('предположено')));
  assert.equal(
    parseTaskBrief('Нужен Middle, React и FastAPI').requirements.spec,
    '',
  );
});
test('budget handles ranges, grouping and mixed units; foreign and project money remain unset', () => {
  for (const phrase of [
    '180–230 тыс. рублей',
    'от 180 тыс. до 230 тыс. руб.',
    '180 тыс.–230000 руб.',
    '180 000–230 000 ₽',
  ]) {
    const r = parseTaskBrief(`Backend Middle. Бюджет ${phrase}`).requirements;
    assert.equal(r.salaryMin, '180000', phrase);
    assert.equal(r.salaryMax, '230000', phrase);
  }
  assert.equal(
    parseTaskBrief('Backend Middle. До 3000 USD').requirements.salaryMax,
    '',
  );
  assert.equal(
    parseTaskBrief('Backend Middle. До 200 тыс. за проект').requirements
      .salaryMax,
    '',
  );
  assert.equal(
    parseTaskBrief('Backend Middle. От 5 лет опыта').requirements.salaryMin,
    '',
  );
  assert.equal(
    parseTaskBrief('Backend Middle. Нагрузка до 10000 запросов в секунду')
      .requirements.salaryMax,
    '',
  );
});
test('formats use OR and negative office does not require office', () => {
  assert.deepEqual(
    parseTaskBrief('Frontend Middle, удалённо или гибрид. Без офиса.')
      .requirements.formats,
    ['Удалённо', 'Гибрид'],
  );
});
test('single-letter languages require case and a language context', () => {
  assert(
    parseTaskBrief('Backend Middle на C.').requirements.desiredSkills.includes('C'),
  );
  assert(
    parseTaskBrief(
      'Data Scientist Senior. Язык R.',
    ).requirements.desiredSkills.includes('R'),
  );
  assert(
    !parseTaskBrief(
      'Backend Middle. Вариант C для продукта.',
    ).requirements.desiredSkills.includes('C'),
  );
});
test('unknown technology remains editable and is accepted on confirmation', () => {
  const brief = validateTaskBrief({
    ...emptyTaskBrief,
    spec: 'Backend',
    grade: 'Middle',
    skills: ['OurInternalFramework'],
  });
  assert.deepEqual(brief.skills, ['OurInternalFramework']);
});
test('server rejects missing category, hostile structures, bad ranges and invented weights', () => {
  const good = { ...emptyTaskBrief, spec: 'Backend', grade: 'Middle' };
  for (const raw of [
    null,
    [],
    {},
    { ...good, spec: 'Wizard' },
    { ...good, spec: ['Backend'] },
    { ...good, sort: ['Тест + ФСП'] },
    { ...good, task: 'invented' },
    { ...good, skills: 'Python' },
    { ...good, salaryMin: '200000', salaryMax: '100000' },
    { ...good, salaryMax: '-1' },
    { ...good, formats: ['Teleport'] },
  ])
    assert.throws(() => validateTaskBrief(raw));
  const sanitized = validateTaskBrief({
    ...good,
    weights: { diagnosis: 999 },
    ids: [7],
  });
  assert(!('weights' in sanitized));
  assert(!('ids' in sanitized));
});
const ranking: Ranking = {
  policyVersion: 'employer-1',
  group: 0,
  mode: 'balanced',
  value: 80,
  test: 0.8,
  sport: 0,
  skills: 0,
  matched: [],
  verified: [],
  unknown: [],
  desiredMatched: [],
  events: [],
  reasons: [],
  questions: [],
};
function profile(id: number, patch: Partial<Profile> = {}): Profile {
  return {
    ...initialState().profile,
    id,
    specialty: 'Backend',
    grade: 'Middle',
    salaryMin: 150000,
    salaryMax: 250000,
    skills: ['Python'],
    verified: [],
    ranking: structuredClone(ranking),
    assessmentEvidence: {
      assessmentVersion: 'v1',
      scoringConfigVersion: 's1',
      dimensions: [
        {
          dimension: 'diagnosis',
          label: 'Сильная сторона',
          description: 'Frozen observation',
        },
      ],
    },
    ...patch,
  };
}
const brief = {
  ...emptyTaskBrief,
  spec: 'Backend',
  grade: 'Middle',
  skills: ['Python'],
  desiredSkills: ['SQL'],
  salaryMax: '200000',
};
test('one profile selected for several angles is merged, alternatives are unique', () => {
  const a = profile(1),
    b = profile(2),
    c = profile(3);
  const lanes: RecommendationLane[] = [
    { key: 'main', title: 'По запросу', items: [a, b, c] },
    { key: 'operations', title: 'Диагностика', items: [a, b] },
    { key: 'budget', title: 'Бюджет', items: [a] },
  ];
  const result = selectTaskRecommendations(lanes, brief);
  assert.deepEqual(
    result.map((item) => item.profile.id),
    [1, 2, 3],
  );
  assert.deepEqual(result[0].angles, ['По запросу', 'Диагностика', 'Бюджет']);
});
test('unconfirmed profile keeps visibility but cannot receive a test strength', () => {
  const p = profile(1, { grade: null });
  assert.deepEqual(strongDimensions(p), []);
  const result = selectTaskRecommendations(
    [
      { key: 'main', title: 'По запросу', items: [p] },
      { key: 'operations', title: 'Диагностика', items: [p] },
    ],
    brief,
  );
  assert.deepEqual(result[0].angles, ['По запросу']);
  assert(
    result[0].questions.some((question) => question.includes('не подтверждён')),
  );
});
test('explanations keep self-declared technologies, budget overlap and unknown skills honest', () => {
  const [result] = selectTaskRecommendations(
    [{ key: 'main', title: 'По запросу', items: [profile(1)] }],
    brief,
  );
  assert(
    result.questions.some((question) =>
      question.includes('отдельно не проверены'),
    ),
  );
  assert(
    result.questions.some((question) => question.includes('Верхняя граница')),
  );
  assert(
    result.questions.some((question) => question.includes('не доказательство')),
  );
});
test('irrelevant or claimed competition cannot grant a sport recommendation', () => {
  const p = profile(1);
  p.ranking!.events = [
    {
      id: 'x',
      title: 'Other',
      date: '2026-10-01',
      discipline: 'other',
      specialties: ['Frontend'],
      skills: [],
      result: 'winner',
      team: true,
      source: 'claimed',
      relevance: 1,
    },
  ];
  const result = selectTaskRecommendations(
    [
      { key: 'main', title: 'По запросу', items: [p] },
      { key: 'fsp', title: 'ФСП', items: [p] },
    ],
    brief,
  );
  assert.deepEqual(result[0].angles, ['По запросу']);
});
test('comparison key includes confirmation and both method versions', () => {
  const a = profile(1),
    b = profile(2, {
      assessmentEvidence: {
        assessmentVersion: 'v2',
        scoringConfigVersion: 's1',
        dimensions: [],
      },
    });
  assert.notEqual(comparableProfileKey(a), comparableProfileKey(b));
  assert.notEqual(
    comparableProfileKey(a),
    comparableProfileKey(profile(3, { grade: null })),
  );
});
test('relative competency explanations require equal method versions and observed sufficient result', () => {
  const a = profile(1),
    b = profile(2, {
      assessmentEvidence: {
        assessmentVersion: 'v1',
        scoringConfigVersion: 's1',
        dimensions: [
          {
            dimension: 'diagnosis',
            label: 'Соответствует',
            description: 'Observed',
          },
        ],
      },
    });
  const lanes: RecommendationLane[] = [
    { key: 'main', title: 'Main', items: [a, b] },
  ];
  assert(
    selectTaskRecommendations(lanes, brief)[0].reasons.some((reason) =>
      reason.includes('у кандидата #2'),
    ),
  );
  b.assessmentEvidence!.assessmentVersion = 'v2';
  assert(
    !selectTaskRecommendations(lanes, brief)[0].reasons.some((reason) =>
      reason.includes('у кандидата #2'),
    ),
  );
});
test('budget difference describes only the lower bound and names the reference, ties stay ties', () => {
  const a = profile(1),
    b = profile(2, { salaryMin: 120000 });
  const lanes: RecommendationLane[] = [
    { key: 'main', title: 'Main', items: [a, b] },
    { key: 'budget', title: 'Budget', items: [b] },
  ];
  assert(
    selectTaskRecommendations(lanes, brief)[1].reasons.some(
      (reason) => reason.includes('30') && reason.includes('#1'),
    ),
  );
  b.salaryMin = a.salaryMin;
  assert(
    !selectTaskRecommendations(lanes, brief)[1].reasons.some((reason) =>
      reason.includes('ниже'),
    ),
  );
});
