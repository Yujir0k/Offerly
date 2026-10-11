import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://localhost:5174';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
let checks = 0;
async function call(
  user,
  path,
  body,
  status = 200,
  origin = base,
  method = body === undefined ? 'GET' : 'POST',
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      Cookie: user.cookie || '',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    status,
    `${path}: ${JSON.stringify(data).slice(0, 400)}`,
  );
  for (const cookie of response.headers.getSetCookie())
    user.cookie = cookie.split(';')[0];
  checks++;
  return data;
}
const brief = {
  spec: 'Backend',
  grade: 'Middle',
  skills: [],
  desiredSkills: ['Python', 'SQL'],
  salaryMin: '',
  salaryMax: '',
  formats: [],
  task: 'operations',
  sort: 'Тест + ФСП',
};
const a = {},
  b = {};
a.state = await call(a, '/api/auth', { type: 'demo-login', role: 'employer' });
b.state = await call(b, '/api/auth', { type: 'demo-login', role: 'employer' });
await call({}, '/api/task-brief', { role: 'employer', text: 'Ищем Backend разработчика' }, 401);
await call(a, '/api/task-brief', { role: 'candidate', text: 'Ищем Backend разработчика' }, 400);
await call(a, '/api/task-brief', { role: 'employer', text: 'Коротко' }, 400);
await call(a, '/api/task-brief', { role: 'employer', text: 'Ищем Backend разработчика' }, 400, 'https://foreign.example.test');
const parsed = await call(a, '/api/task-brief', {
  role: 'employer', text: 'Ищем Backend Middle. Код на гошке. Обязательна реляционная база данных. Желательно кэширование. Переходим с пыхи на ноду.',
});
assert.deepEqual(parsed.requirements.skills, ['Go', 'PostgreSQL или MySQL', 'Node.js']);
assert.deepEqual(parsed.requirements.desiredSkills, ['Redis']);
const recommend = (user, requirements = brief, status = 200) =>
  call(
    user,
    '/api/recommendations',
    { role: 'employer', requirements },
    status,
  );
const first = await recommend(a);
const draftPath = '/api/drafts?key=task%3Aemployer-description-v1';
await call(
  a,
  draftPath,
  { value: { text: 'Backend Middle для поддержки', requirements: brief } },
  200,
  base,
  'PUT',
);
assert.deepEqual((await call(a, draftPath)).value.requirements, brief);
assert.equal((await call(b, draftPath)).value, null);
assert(first.total >= 20);
assert(first.recommendations.length >= 3 && first.recommendations.length <= 6);
assert.equal(
  new Set(first.recommendations.map((item) => item.profile.id)).size,
  first.recommendations.length,
);
assert(first.method.includes('Без') || first.method.includes('без LLM'));
assert(first.examined <= 120 && first.examined <= first.total);
for (const { profile, reasons, questions } of first.recommendations) {
  assert.equal(profile.specialty, 'Backend');
  assert.equal(profile.grade || profile.claimed, 'Middle');
  assert.equal(profile.email, '');
  assert.equal(profile.phone, '');
  assert(!profile.resumeKey && !profile.avatarKey);
  assert(reasons.length && questions.length);
  assert.equal(profile.ranking.policyVersion, 'employer-2');
  assert.deepEqual(Object.keys(profile.match_reasons).sort(), ['budget_fit', 'fsp_achievement', 'grade_status', 'stack_summary']);
}
const second = await recommend(b);
const alternatives = await recommend(a, { ...brief, skills: ['реляционка'] });
assert(alternatives.total > 0);
assert(alternatives.recommendations.every(({ profile }) => [...profile.skills, ...profile.verified].some((skill) => ['PostgreSQL', 'MySQL'].includes(skill))));
const own = new Set(first.recommendations.map((item) => item.profile.id));
assert(second.recommendations.every((item) => !own.has(item.profile.id)));
for (const spec of [
  'Frontend',
  'QA',
  'DevOps / SRE',
  'Android',
  'iOS',
  'Data Engineering',
  'ML Engineer',
  'Data Scientist',
  'MLOps',
  'GenAI',
  'Security Engineering / AppSec',
]) {
  const result = await recommend(a, { ...brief, spec });
  assert(result.total >= 20, spec);
  assert(result.recommendations.length >= 1);
  assert(
    result.recommendations.every((item) => item.profile.specialty === spec),
  );
}
for (const sort of ['По результату теста', 'По достижениям ФСП']) {
  const result = await recommend(a, { ...brief, sort });
  assert.equal(result.total, first.total);
  if (sort === 'По результату теста')
    assert(
      result.recommendations.every(
        (item) => !item.angles.includes('С релевантными соревнованиями'),
      ),
    );
}
const strict = await recommend(a, {
  ...brief,
  skills: ['Python'],
  salaryMax: '210000',
  formats: ['Удалённо'],
});
assert(
  strict.recommendations.every(
    (item) =>
      item.profile.skills.includes('Python') &&
      item.profile.salaryMin <= 210000 &&
      (item.profile.formats?.includes('Удалённо') ||
        item.profile.formats?.includes('Любой') ||
        item.profile.format === 'Удалённо'),
  ),
);
const empty = await recommend(a, {
  ...brief,
  skills: ['UnlistedCustomTechnology'],
});
assert.equal(empty.total, 0);
assert.deepEqual(empty.recommendations, []);
assert(
  empty.relaxations.some(
    (item) => item.skill === 'UnlistedCustomTechnology' && item.added > 0,
  ),
);
for (const requirements of [
  { ...brief, spec: 'Not a direction' },
  { ...brief, grade: 'Expert' },
  { ...brief, grades: ['Wizard'] },
  { ...brief, task: 'balanced', tasks: ['operations', 'unknown'] },
  { ...brief, salaryMin: '300000', salaryMax: '200000' },
  { ...brief, skills: ['x'.repeat(101)] },
  { ...brief, formats: ['Other'] },
])
  await recommend(a, requirements, 400);
await call(a, '/api/recommendations', null, 400);
await call(
  a,
  '/api/recommendations',
  { role: 'candidate', requirements: brief },
  400,
);
await call(
  a,
  '/api/recommendations',
  { role: 'employer', requirements: brief },
  400,
  'http://unrelated.example',
);
await call(
  {},
  '/api/recommendations',
  { role: 'employer', requirements: brief },
  401,
);
const saved = await call(a, '/api/action', {
  type: 'need',
  role: 'employer',
  title: 'QA подбор без LLM',
  description: 'Backend Middle, поддержка API',
  specialty: 'Backend',
  grade: 'Middle',
  skills: '',
  min: 1,
  max: 10000000,
  format: 'Любой',
  taskBrief: {
    ...brief,
    formats: ['Удалённо', 'Гибрид'],
    sort: 'По результату теста',
  },
});
const need = saved.needs.find((item) => item.title === 'QA подбор без LLM');
assert(need);
assert.equal(need.taskBrief.sort, 'По результату теста');
assert.deepEqual(need.taskBrief.formats, ['Удалённо', 'Гибрид']);
assert.equal(need.taskBrief.salaryMax, '');
const afterReload = await call(a, '/api/state?role=employer');
assert.deepEqual(
  afterReload.needs.find((item) => item.id === need.id).taskBrief,
  need.taskBrief,
);
await call(
  b,
  '/api/action',
  {
    type: 'need',
    role: 'employer',
    id: need.id,
    title: 'foreign',
    specialty: 'Backend',
    grade: 'Middle',
    min: 1,
    max: 10000000,
  },
  400,
);
await call(
  a,
  '/api/action',
  {
    type: 'need',
    role: 'employer',
    title: 'bad',
    specialty: 'Backend',
    grade: 'Middle',
    min: 1,
    max: 10000000,
    taskBrief: { ...brief, task: 'invented' },
  },
  400,
);
const ids = first.recommendations.slice(0, 2).map((item) => item.profile.id);
const compared = await call(
  a,
  `/api/catalog/candidates?${new URLSearchParams({ role: 'employer', filters: JSON.stringify({ ids, rankSpec: 'Backend', rankGrade: 'Middle', desiredSkills: ['Python', 'SQL'], task: 'operations' }) })}`,
);
assert.equal(compared.items.length, 2);
assert(
  compared.items.every((profile) =>
    profile.ranking.events
      .filter((event) => event.specialties.includes('Backend'))
      .every((event) => event.relevance === 1),
  ),
);
const foreign = await call(
  b,
  `/api/catalog/candidates?${new URLSearchParams({ role: 'employer', filters: JSON.stringify({ ids, rankSpec: 'Backend' }) })}`,
);
assert.equal(foreign.items.length, 0);
const multi = await recommend(a, {
  ...brief,
  grade: '',
  tasks: ['operations', 'product'],
  task: 'balanced',
});
assert.deepEqual(
  multi.groups.map((group) => group.grade),
  ['Junior', 'Middle', 'Senior'],
);
assert.equal(
  multi.total,
  multi.groups.reduce((sum, group) => sum + group.total, 0),
);
assert(multi.examined <= 360);
assert(multi.recommendations.length >= 3 && multi.recommendations.length <= 9);
for (const grade of ['Junior', 'Middle', 'Senior']) {
  assert(multi.groups.find((group) => group.grade === grade).total >= 20);
  assert(
    multi.recommendations.some(
      (item) => (item.profile.grade || item.profile.claimed) === grade,
    ),
  );
}
const subsetBrief = {
  ...brief,
  grade: '',
  grades: ['Middle', 'Senior'],
  task: 'balanced',
  tasks: ['operations', 'quality'],
};
const subset = await recommend(a, subsetBrief);
assert.deepEqual(
  subset.groups.map((group) => group.grade),
  ['Middle', 'Senior'],
);
assert(
  subset.recommendations.every((item) =>
    ['Middle', 'Senior'].includes(item.profile.grade || item.profile.claimed),
  ),
);
const subsetCatalog = await call(
  a,
  `/api/catalog/candidates?${new URLSearchParams({ role: 'employer', filters: JSON.stringify({ ...subsetBrief, includeUnconfirmed: true }) })}`,
);
assert.equal(subsetCatalog.total, subset.total);
assert(
  subsetCatalog.items.every((profile) =>
    ['Middle', 'Senior'].includes(profile.grade || profile.claimed),
  ),
);
const mixedIds = multi.recommendations
  .filter((item) => item.profile.grade)
  .filter(
    (item, index, all) =>
      all.findIndex((other) => other.profile.grade === item.profile.grade) ===
      index,
  )
  .slice(0, 2)
  .map((item) => item.profile.id);
const mixedComparison = await call(
  a,
  `/api/catalog/candidates?${new URLSearchParams({ role: 'employer', filters: JSON.stringify({ ids: mixedIds, rankSpec: 'Backend', task: 'balanced', tasks: ['operations', 'product'] }) })}`,
);
assert.equal(mixedComparison.items.length, 2);
assert(
  mixedComparison.items.every((profile) =>
    profile.ranking.reasons.some((reason) =>
      reason.includes('Для выбранных задач'),
    ),
  ),
);
const savedMulti = await call(a, '/api/action', {
  type: 'need',
  role: 'employer',
  title: 'QA несколько уровней и задач',
  description: 'Серверная часть, поддержка и новый продукт',
  specialty: 'Backend',
  grade: '',
  min: 1,
  max: 10000000,
  format: 'Любой',
  taskBrief: subsetBrief,
});
const multiNeed = savedMulti.needs.find(
  (need) => need.title === 'QA несколько уровней и задач',
);
assert.equal(multiNeed.grade, '');
assert.deepEqual(multiNeed.taskBrief.grades, ['Middle', 'Senior']);
assert.deepEqual(multiNeed.taskBrief.tasks, ['operations', 'quality']);
const savedMultiReload = await call(a, '/api/state?role=employer');
assert.deepEqual(
  savedMultiReload.needs.find((need) => need.id === multiNeed.id).taskBrief,
  multiNeed.taskBrief,
);
const savedAny = await call(a, '/api/action', {
  type: 'need',
  role: 'employer',
  title: 'QA любой уровень',
  specialty: 'Backend',
  grade: '',
  min: 1,
  max: 10000000,
  format: 'Любой',
  taskBrief: { ...brief, grade: '' },
});
assert.equal(
  savedAny.needs.find((need) => need.title === 'QA любой уровень').grade,
  '',
);
await writeFile(
  'qa/results/latest/task-recommendations-results.json',
  JSON.stringify(
    {
      checks,
      passed: true,
      categories: 12,
      scopesIsolated: true,
      persistedTaskBrief: true,
      noExternalLLM: true,
      comparisonContextPreserved: true,
      allLevelsSeparately: true,
      mixedTasksPersisted: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(`${checks} HTTP checks passed`);
