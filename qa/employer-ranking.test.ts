import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { initialState, type Profile } from '../lib/model';
import {
  categoryLabel,
  explainRanking,
  explainComparison,
  matchingContext,
  type Ranking,
} from '../lib/employer-matching';

const db = new PGlite();
await db.exec(await readFile('db/migrations/001_platform.sql', 'utf8'));
await db.exec(
  await readFile('db/migrations/015_employer_matching.sql', 'utf8'),
);
await db.exec(await readFile('db/migrations/018_matching_policy.sql', 'utf8'));
const oldRank = (await db.query<{ ddl: string }>(
  "SELECT pg_get_functiondef('offerly_candidate_rank(jsonb,jsonb)'::regprocedure) AS ddl",
)).rows[0].ddl;
await db.exec(oldRank.replace('offerly_candidate_rank(', 'original_candidate_rank('));
await db.exec(await readFile('db/migrations/023_matching_performance.sql', 'utf8'));
const baseline = {
  ...initialState().profile,
  specialty: 'Backend',
  grade: 'Middle',
  score: 80,
  verified: [],
  skills: ['Python', 'SQL'],
  fsp: null,
  achievements: [],
  competitionResults: [],
};
const context = matchingContext({
  spec: 'Backend',
  grade: 'Middle',
  skills: ['Python'],
});
async function rank(profile: Profile = baseline, ctx = context) {
  const { rows } = await db.query<{ rank: Ranking }>(
    'SELECT offerly_candidate_rank($1::jsonb,$2::jsonb) AS rank',
    [JSON.stringify(profile), JSON.stringify(ctx)],
  );
  return rows[0].rank;
}
const event = {
  id: 'event-1',
  title: 'Кубок разработки',
  date: '2026-10-01',
  discipline: 'Продуктовая разработка',
  specialties: ['Backend'],
  skills: ['Python'],
  source: 'verified',
  result: 'prize',
  team: true,
};

test('compact generated ranking input preserves the complete employer-2 result across modes and task weights', async () => {
  for (const grade of [null, 'Junior', 'Middle'])
    for (const task of ['balanced', 'operations', 'product', 'quality'])
      for (const mode of ['balanced', 'test', 'fsp']) {
        const profile = { ...baseline, grade, fsp: 'qa',
          bio: 'A long resume section '.repeat(1000),
          competitionResults: [event, { ...event, id: 'claimed', source: 'claimed' }],
          assessmentEvidence: { dimensions: [
            { dimension: 'diagnosis', label: 'Соответствует' },
            { dimension: 'adaptation', label: 'Сильная сторона' },
          ] },
        };
        const ctx = matchingContext({ task, mode, skills: ['Python', 'Redis'], desiredSkills: ['SQL'], spec: 'Backend', grade: 'Middle' });
        const { rows: [r] } = await db.query<{ old: Ranking; optimized: Ranking }>(
          'SELECT original_candidate_rank($1::jsonb,$2::jsonb) AS old,offerly_candidate_rank(offerly_catalog_payload($1::jsonb),$2::jsonb) AS optimized',
          [JSON.stringify(profile), JSON.stringify(ctx)],
        );
        assert.deepEqual(r.optimized, r.old);
      }
});

test('self-declared technologies are discoverable but never labelled verified', async () => {
  const r = await rank();
  assert.deepEqual(r.matched, ['Python']);
  assert.deepEqual(r.verified, []);
  const explanation = explainRanking(baseline, r, context);
  assert(
    explanation.reasons.some((reason) =>
      reason.includes('отдельно не проверены'),
    ),
  );
});
test('aliases use the same canonical key as search filters', async () => {
  const r = await rank({ ...baseline, skills: ['питон'] });
  assert.deepEqual(r.matched, ['Python']);
});
test('unknown technology is an unanswered question, not a negative skill judgement', async () => {
  const r = await rank(baseline, matchingContext({ skills: ['Redis'] }));
  assert.deepEqual(r.unknown, ['Redis']);
});
test('FSP ID and legacy unstructured strings cannot invent a competition bonus', async () => {
  assert.equal(
    (await rank({ ...baseline, fsp: '123', achievements: ['Победа'] })).sport,
    0,
  );
});
test('claimed results cannot affect the sport ranking', async () => {
  assert.equal(
    (
      await rank({
        ...baseline,
        fsp: '123',
        competitionResults: [{ ...event, source: 'claimed' }] as never,
      })
    ).sport,
    0,
  );
});
test('competition relevance changes with the need, not with an invented prestige of the discipline', async () => {
  const p = { ...baseline, fsp: '123', competitionResults: [event] as never };
  assert(
    (await rank(p)).sport >
      (await rank(p, matchingContext({ spec: 'Frontend', skills: ['React'] })))
        .sport,
  );
  assert.equal(
    (await rank(p)).sport,
    (
      await rank({
        ...p,
        competitionResults: [
          { ...event, discipline: 'Другой формат соревнования' },
        ] as never,
      })
    ).sport,
  );
});
test('unrelated competition adds no bonus in a specific vacancy', async () => {
  assert.equal(
    (
      await rank({
        ...baseline,
        fsp: '123',
        competitionResults: [
          { ...event, specialties: ['Frontend'], skills: ['React'] },
        ] as never,
      })
    ).sport,
    0,
  );
});
test('prize and participation are distinct; duplicate event cannot inflate result', async () => {
  const prize = {
    ...baseline,
    fsp: '123',
    competitionResults: [event] as never,
  };
  assert(
    (await rank(prize)).sport >
      (
        await rank({
          ...prize,
          competitionResults: [{ ...event, result: 'participation' }] as never,
        })
      ).sport,
  );
  assert.equal(
    (await rank(prize)).sport,
    (await rank({ ...prize, competitionResults: [event, event] as never }))
      .sport,
  );
});
test('test-only order is invariant to achievements and stack', async () => {
  const ctx = matchingContext({ sort: 'По результату теста', spec: 'Backend' });
  assert.equal(
    (await rank(baseline, ctx)).value,
    (
      await rank(
        {
          ...baseline,
          fsp: '123',
          competitionResults: [event] as never,
          skills: [],
        },
        ctx,
      )
    ).value,
  );
});
test('FSP-only order is invariant to test score', async () => {
  const ctx = matchingContext({ sort: 'По достижениям ФСП', spec: 'Backend' });
  const p = { ...baseline, fsp: '123', competitionResults: [event] as never };
  assert.equal(
    (await rank(p, ctx)).value,
    (await rank({ ...p, score: 99 }, ctx)).value,
  );
});
test('changing the tasks can reverse two candidates in the same category', async () => {
  const evidence = (diagnosis: string, adaptation: string) => ({
    dimensions: [
      { dimension: 'diagnosis', label: diagnosis, description: '' },
      { dimension: 'adaptation', label: adaptation, description: '' },
    ],
  });
  const a = {
    ...baseline,
    assessmentEvidence: evidence('Сильная сторона', 'Соответствует'),
  };
  const b = {
    ...baseline,
    assessmentEvidence: evidence('Соответствует', 'Сильная сторона'),
  };
  assert(
    (await rank(a, matchingContext({ task: 'operations' }))).test >
      (await rank(b, matchingContext({ task: 'operations' }))).test,
  );
  assert(
    (await rank(a, matchingContext({ task: 'product' }))).test <
      (await rank(b, matchingContext({ task: 'product' }))).test,
  );
});
test('desired skills help ranking but never become required matches', async () => {
  const ctx = matchingContext({ desiredSkills: ['SQL'] });
  const r = await rank(baseline, ctx);
  assert.deepEqual(r.matched, []);
  assert.deepEqual(r.desiredMatched, ['SQL']);
  assert(r.skills > 0);
});
test('unconfirmed candidates remain marked and below confirmed candidates', async () => {
  const p = { ...baseline, grade: null, claimed: 'Middle', score: 100 };
  const r = await rank(p);
  assert.equal(r.group, 2);
  assert.equal(r.test, 0);
  assert(categoryLabel(p).includes('не подтверждён'));
});
test('ranking is bounded and cannot change grade or frozen evidence', async () => {
  const before = JSON.stringify(baseline);
  const r = await rank();
  assert(r.value >= 0 && r.value <= 100);
  assert.equal(JSON.stringify(baseline), before);
});
test('comparison explains only metrics used by the selected mode and preserves tradeoffs', async () => {
  const evidence = {
    assessmentVersion: 'formal-7',
    scoringConfigVersion: 'config-1',
    dimensions: [],
  };
  const a = {
    ...baseline,
    id: 1,
    assessmentEvidence: evidence,
    ranking: await rank(
      baseline,
      matchingContext({ sort: 'По результату теста' }),
    ),
  };
  const b = {
    ...a,
    id: 2,
    ranking: { ...a.ranking, value: 70, test: 0.7, sport: 1 },
  };
  const text = explainComparison([a, b], 'По результату теста').join(' ');
  assert(text.includes('#1 выше #2'));
  assert(text.includes('испытания'));
  assert(!text.includes('соревнований'));
  const balanced = explainComparison(
    [{ ...a, ranking: { ...a.ranking, mode: 'balanced' } }, b],
    'Тест + ФСП',
  ).join(' ');
  assert(balanced.includes('соревнований ниже'));
});
test('comparison does not invent a leader on ties or compare different versions', async () => {
  const a = {
    ...baseline,
    id: 1,
    assessmentEvidence: { assessmentVersion: 'v1', dimensions: [] },
    ranking: await rank(),
  };
  assert(
    explainComparison([a, { ...a, id: 2 }], 'Тест + ФСП')[0].includes('равны'),
  );
  assert(
    explainComparison(
      [
        a,
        {
          ...a,
          id: 2,
          assessmentEvidence: { assessmentVersion: 'v2', dimensions: [] },
        },
      ],
      'Тест + ФСП',
    )[0].includes('несопоставимы'),
  );
  assert(
    explainComparison(
      [a, { ...a, id: 2, grade: null }],
      'Тест + ФСП',
    )[0].includes('несопоставимы'),
  );
});
test('legacy demo upgrade never invents results for real users and is idempotent', async () => {
  const profile = { ...baseline, fsp: '123', achievements: ['Кубок'] };
  for (const [id, demo] of [
    ['demo-fixture', true],
    ['real-fixture', false],
  ] as const) {
    await db.query(
      'INSERT INTO users(id,email,name,demo) VALUES($1,$2,$1,$3)',
      [id, `${id}@example.test`, demo],
    );
    await db.query(
      'INSERT INTO candidate_profiles(user_id,specialty,grade,payload) VALUES($1,$2,$3,$4)',
      [id, profile.specialty, profile.grade, JSON.stringify(profile)],
    );
  }
  const sql = await readFile('db/migrations/016_demo_competitions.sql', 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  const { rows } = await db.query<{ user_id: string; payload: Profile }>(
    'SELECT user_id,payload FROM candidate_profiles',
  );
  const demo = rows.find((r) => r.user_id === 'demo-fixture')!.payload;
  const real = rows.find((r) => r.user_id === 'real-fixture')!.payload;
  assert.equal(demo.competitionResults?.length, 1);
  assert.equal(demo.competitionResults?.[0].source, 'demo');
  assert.deepEqual(real, profile);
  assert.equal(demo.grade, profile.grade);
});
test.after(async () => {
  await db.close();
});

test('mixed tasks affect the real SQL score through bounded averaged weights', async () => {
  const p = {
    ...baseline,
    score: 0,
    assessmentEvidence: {
      dimensions: [
        { dimension: 'diagnosis', label: 'Сильная сторона', description: '' },
        { dimension: 'adaptation', label: 'Соответствует', description: '' },
      ],
    },
  };
  const operations = await rank(p, matchingContext({ task: 'operations' }));
  const product = await rank(p, matchingContext({ task: 'product' }));
  const mixedContext = matchingContext({
    task: 'balanced',
    tasks: ['operations', 'product'],
  });
  const mixed = await rank(p, mixedContext);
  assert.equal(mixed.test > product.test && mixed.test < operations.test, true);
  const duplicate = await rank(
    p,
    matchingContext({ tasks: ['operations', 'product', 'operations'] }),
  );
  assert.equal(mixed.test, duplicate.test);
  const explanation = explainRanking(p, mixed, mixedContext);
  assert.equal(
    explanation.reasons.some((reason) =>
      reason.includes('Для выбранных задач'),
    ),
    true,
  );
});
