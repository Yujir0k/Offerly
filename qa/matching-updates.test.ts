import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  parseTaskBrief,
  validateTaskBrief,
  emptyTaskBrief,
} from '../lib/task-brief';
import {
  canonicalSkillName,
  matchesSkill,
  skillAlternatives,
} from '../lib/skills-ontology';
import {
  matchingContext,
  matchReasons,
  type Ranking,
} from '../lib/employer-matching';
import {
  initialState,
  type Invitation,
  type Need,
  type Profile,
} from '../lib/model';
import { invitationSource, invitationWaitingDays } from '../lib/invitations';

const db = new PGlite();
await db.exec(await readFile('db/migrations/001_platform.sql', 'utf8'));
await db.exec(
  await readFile('db/migrations/015_employer_matching.sql', 'utf8'),
);
await db.exec(await readFile('db/migrations/018_matching_policy.sql', 'utf8'));
const base: Profile = {
  ...initialState().profile,
  grade: 'Middle',
  claimed: 'Middle',
  score: 80,
  specialty: 'Backend',
  skills: ['Go', 'MySQL', 'Kafka'],
  verified: [],
  fsp: null,
  competitionResults: [],
};
const event = {
  id: 'matching-cup',
  title: 'Кубок разработки',
  date: '2026-10-01',
  discipline: 'Продуктовая разработка',
  specialties: ['Backend'],
  skills: ['Go'],
  source: 'verified' as const,
  result: 'winner' as const,
  team: true,
};
async function rank(
  profile = base,
  context = matchingContext({ spec: 'Backend' }),
) {
  const { rows } = await db.query<{ rank: Ranking }>(
    'SELECT offerly_candidate_rank($1::jsonb,$2::jsonb) AS rank',
    [JSON.stringify(profile), JSON.stringify(context)],
  );
  return rows[0].rank;
}

test('all requested hard contexts are recognized, without leaking into a new clause', () => {
  for (const text of [
    'код на Go',
    'код написан на Go',
    'пишем на Go',
    'разрабатываем на Go',
    'основной стек Go',
    'ищем Go-разработчика',
    'знание Go',
    'обязательно Go',
  ])
    assert.deepEqual(
      parseTaskBrief(`Backend. ${text}`).requirements.skills,
      ['Go'],
      text,
    );
  const result = parseTaskBrief(
    'Backend. Код на Go, используем Redis.',
  ).requirements;
  assert.deepEqual(result.skills, ['Go']);
  assert.deepEqual(result.desiredSkills, ['Redis']);
  assert.deepEqual(
    parseTaskBrief('Backend. Основной стек Node.js, PostgreSQL и Redis.').requirements.skills,
    ['Node.js', 'PostgreSQL', 'Redis'],
  );
});
test('optional contexts override implied hardness and knowledge cues', () => {
  for (const text of [
    'Go будет плюсом',
    'желательно знание Go',
    'Go пригодится',
    'опыт с Go приветствуется',
    'интересно посмотреть Go',
    'если умеет Go',
    'знание Go будет плюсом',
    'код на Go, желательно Redis',
  ]) {
    const result = parseTaskBrief(`Backend. ${text}`).requirements;
    if (text.startsWith('код')) assert.deepEqual(result.skills, ['Go']);
    else {
      assert.deepEqual(result.skills, [], text);
      assert.deepEqual(result.desiredSkills, ['Go'], text);
    }
  }
});
test('migration sources and explicit exclusions are not requirements or preferences', () => {
  for (const text of ['переходим с PHP на Go', 'мигрируем с Node.js на Go']) {
    const result = parseTaskBrief(`Backend. ${text}`).requirements;
    assert.deepEqual(result.skills, ['Go'], text);
    assert.deepEqual(result.desiredSkills, [], text);
  }
  const result = parseTaskBrief(
    'Backend. Без Redis. Уходим с PHP. Отказываемся от Java.',
  ).requirements;
  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.desiredSkills, []);
});
test('ontology normalizes colloquial names and expands local specialization edges', () => {
  for (const [alias, value] of [
    ['го', 'Go'],
    ['гошка', 'Go'],
    ['постгрес', 'PostgreSQL'],
    ['пыха', 'PHP'],
    ['нода', 'Node.js'],
  ])
    assert.equal(canonicalSkillName(alias), value);
  assert.deepEqual(
    parseTaskBrief(
      'Backend. Обязательно гошка и постгрес. Желательно пыха и нода.',
    ).requirements.skills,
    ['Go', 'PostgreSQL'],
  );
  assert.deepEqual(skillAlternatives('реляционка'), ['PostgreSQL', 'MySQL']);
  assert.deepEqual(skillAlternatives('очереди сообщений'), [
    'RabbitMQ',
    'Kafka',
  ]);
  assert.deepEqual(skillAlternatives('кэширование'), ['Redis']);
  assert.deepEqual(skillAlternatives('контейнеризация'), ['Docker']);
  const brief = validateTaskBrief(
    parseTaskBrief(
      'Backend. Обязательно реляционная база данных и брокеры сообщений. Желательно кэш и контейнеры.',
    ).requirements,
  );
  assert.deepEqual(brief.skills, [
    'PostgreSQL или MySQL',
    'RabbitMQ или Kafka',
  ]);
  assert.deepEqual(brief.desiredSkills, ['Redis', 'Docker']);
  assert(matchesSkill('реляционка', ['MySQL']));
  assert(!matchesSkill('реляционка', ['MongoDB']));
});
test('actual SQL and explanations treat an ontology category as OR, not AND', async () => {
  const context = matchingContext({
    skills: ['реляционка', 'брокеры'],
    desiredSkills: ['кэш'],
  });
  const result = await rank(base, context);
  assert.deepEqual(result.matched, [
    'PostgreSQL или MySQL',
    'RabbitMQ или Kafka',
  ]);
  assert.deepEqual(result.unknown, []);
  assert.equal(result.skills, 2 / 3);
  const { rows } = await db.query<{ ok: boolean }>(
    'SELECT offerly_skill_matches($1,$2,$3::jsonb) AS ok',
    ['MySQL', 'PostgreSQL или MySQL', JSON.stringify(context)],
  );
  assert.equal(rows[0].ok, true);
  assert(matchReasons(base, result, context).stack_summary.includes('2 из 2'));
});
test('winner and prize add exactly 12.5 and 10 points; full FSP component is capped at 25', async () => {
  const ordinary = await rank(base);
  const winner = await rank({
    ...base,
    fsp: 'verified-id',
    competitionResults: [event],
  } as typeof base);
  const prize = await rank({
    ...base,
    fsp: 'verified-id',
    competitionResults: [{ ...event, result: 'prize' }],
  } as typeof base);
  assert.equal(ordinary.policyVersion, 'employer-2');
  assert.equal(ordinary.value, 40);
  assert.equal(winner.value - ordinary.value, 12.5);
  assert.equal(prize.value - ordinary.value, 10);
  assert(winner.value > (await rank({ ...base, score: 95 })).value);
  const two = await rank({
    ...base,
    fsp: 'verified-id',
    competitionResults: [
      event,
      { ...event, id: 'cup-2' },
      { ...event, id: 'cup-3' },
    ],
  } as typeof base);
  assert.equal(two.value - ordinary.value, 25);
});
test('match reasons distinguish unconfirmed grade, missing FSP and partial budget overlap', async () => {
  const context = matchingContext({
    salaryMin: '200000',
    salaryMax: '260000',
    spec: 'Backend',
  });
  const profile = {
    ...base,
    grade: null,
    salaryMin: 210000,
    salaryMax: 300000,
  };
  const result = await rank(profile as typeof base, context);
  const reasons = matchReasons(profile, result, context);
  assert.equal(reasons.fsp_achievement, null);
  assert(reasons.grade_status.includes('не подтверждён'));
  assert(reasons.budget_fit.includes('частично'));
  assert(!reasons.budget_fit.includes('полностью'));
  assert(
    matchReasons(
      { ...profile, salaryMax: 240000 },
      result,
      context,
    ).budget_fit.includes('полностью'),
  );
  assert(
    matchReasons(
      { ...profile, salaryMin: 100000, salaryMax: 150000 },
      result,
      context,
    ).budget_fit.includes('не пересекаются'),
  );
});
test('FSP explanation identifies the actual discipline and demo source, with no fictitious test-mode bonus', async () => {
  const profile = {
    ...base,
    fsp: 'id',
    competitionResults: [{ ...event, source: 'demo' }],
  } as typeof base;
  const context = matchingContext({
    spec: 'Backend',
    sort: 'По результату теста',
  });
  const reasons = matchReasons(profile, await rank(profile, context), context);
  assert(reasons.fsp_achievement?.includes('Продуктовая разработка'));
  assert(reasons.fsp_achievement?.includes('демонстрационные'));
  assert(reasons.fsp_achievement?.includes('не влияет'));
});
test('invitation snapshot survives source edits and omits an unspecified budget', () => {
  const brief = {
    ...emptyTaskBrief,
    spec: 'Backend',
    grades: ['Middle', 'Senior'],
  };
  const need: Need = {
    id: 'need-1',
    title: 'API команды',
    specialty: 'Backend',
    grade: '',
    skills: ['Go'],
    description: '',
    min: 1,
    max: 10000000,
    format: 'Любой',
    taskBrief: brief,
  };
  const source = invitationSource(need);
  need.title = 'Изменённая задача';
  need.skills.push('PHP');
  brief.grades.push('Junior');
  assert.equal(source.title, 'API команды');
  assert.deepEqual(source.skills, ['Go']);
  assert.deepEqual(source.grades, ['Middle', 'Senior']);
  assert.equal(source.salaryMin, undefined);
  assert.equal(source.salaryMax, undefined);
});
test('pending duration counts full elapsed days, clamps future dates and stops after a response', () => {
  const invitation = {
    status: 'sent',
    createdAt: '2026-10-01T10:00:00Z',
  } as Invitation;
  assert.equal(
    invitationWaitingDays(invitation, Date.parse('2026-10-04T09:59:00Z')),
    2,
  );
  assert.equal(
    invitationWaitingDays(invitation, Date.parse('2026-09-30T10:00:00Z')),
    0,
  );
  assert.equal(
    invitationWaitingDays(
      { ...invitation, status: 'viewed' },
      Date.parse('2026-10-04T10:00:00Z'),
    ),
    3,
  );
  assert.equal(
    invitationWaitingDays({ ...invitation, status: 'accepted' }),
    null,
  );
  assert.equal(
    invitationWaitingDays({ ...invitation, status: 'declined' }),
    null,
  );
});
