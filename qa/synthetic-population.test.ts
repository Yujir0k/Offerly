import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '../db';
import { demoTracks } from '../lib/demo-tracks';
import { profileCompletion } from '../lib/profile-completion';
import {
  installSyntheticPopulation,
  syntheticPopulation,
} from '../lib/synthetic-population';
import { publicSession } from '../vendor/fsp-assessment/dist/src/adaptive/engine.js';

test('720 distinct complete profiles cover every professional track and requested grade', () => {
  const rows = syntheticPopulation.profiles;
  assert.equal(rows.length, 720);
  assert.equal(new Set(rows.map((row) => row.key)).size, 720);
  assert.equal(new Set(rows.map((row) => row.profile.name)).size, 720);
  for (const track of demoTracks)
    for (const grade of ['Junior', 'Middle', 'Senior']) {
      const cohort = rows.filter(
        (row) => row.track === track.id && row.assessment.grade === grade,
      );
      assert.equal(cohort.length, 20);
      assert(
        cohort.filter((row) => row.assessment.passed).length >= 10,
        `${track.id}/${grade} has too few confirmed examples`,
      );
    }
  for (const row of rows) {
    assert(profileCompletion(row.profile).ready, row.key);
    assert.equal(row.profile.synthetic?.method, 'engine-simulation');
    assert.equal(
      row.assessment.passed,
      row.assessment.result.decision === 'CONFIRMED',
    );
    assert.equal(
      row.profile.grade,
      row.assessment.passed ? row.assessment.grade : null,
    );
    assert.deepEqual(row.profile.verified, []);
    assert(row.assessment.score >= 0 && row.assessment.score <= 100);
    if (row.assessment.passed) {
      assert.equal(row.profile.score, row.assessment.score);
      assert.equal(row.profile.assessmentEvidence?.dimensions.length, 4);
    } else {
      assert.equal(row.profile.score, 0);
      assert.equal(row.profile.assessmentEvidence, undefined);
    }
    assert(row.profile.email.endsWith('@example.test'));
    assert.equal(row.profile.phone, '');
    assert(
      row.profile.competitionResults?.every((event) => event.source === 'demo'),
    );
    for (const forbidden of [
      '"rubric"',
      '"accepted"',
      '"responseChecks"',
      '"groundTruth"',
      '"contributions"',
    ])
      assert(
        !JSON.stringify(row).includes(forbidden),
        `${row.key} leaks ${forbidden}`,
      );
  }
  assert(new Set(rows.map((row) => row.assessment.score)).size >= 15);
  assert(new Set(rows.map((row) => row.profile.city)).size >= 12);
  assert(
    rows.some((row) => row.assessment.passed) &&
      rows.some((row) => !row.assessment.passed),
  );
});

test('every published result matches a hashed completed snapshot from the unchanged engine', async () => {
  for (const row of syntheticPopulation.profiles) {
    const source = gunzipSync(
      await readFile(`.data/synthetic-candidates/snapshots/${row.key}.json.gz`),
    ).toString('utf8');
    assert.equal(
      createHash('sha256').update(source).digest('hex'),
      row.proof.snapshotHash,
    );
    const session = JSON.parse(source);
    assert.equal(session.state, 'completed');
    assert.equal(session.specialization, row.track);
    assert.equal(session.targetGrade, row.assessment.grade);
    assert(session.responses.length >= 8);
    assert.equal(session.responses.length, row.proof.steps);
    assert.deepEqual(
      publicSession(session, Date.parse(session.finishedAt)).result,
      row.assessment.result,
    );
    assert.equal(
      Math.round(session.result.band.estimatedScore * 100),
      row.assessment.score,
    );
  }
});

test('population is private, atomic, repeatable and preserves existing profiles', async () => {
  const pg = new PGlite();
  const wrap = (client: Pick<PGlite, 'query'>): Database => ({
    query: (sql, params = []) => client.query(sql, params),
    transaction: (operation) => pg.transaction((tx) => operation(wrap(tx))),
  });
  try {
    await pg.exec(await readFile('db/migrations/001_platform.sql', 'utf8'));
    await pg.exec(
      await readFile('db/migrations/004_demo_email_namespace.sql', 'utf8'),
    );
    for (const [id, demo, scope] of [
      ['demo-a', true, 'demo-a'],
      ['demo-b', true, 'demo-b'],
      ['ordinary', false, 'public'],
    ] as const) {
      await pg.query(
        'INSERT INTO users(id,email,name,scope,demo) VALUES($1,$2,$1,$3,$4)',
        [id, `${id}@example.test`, scope, demo],
      );
      await pg.query('INSERT INTO account_state(user_id) VALUES($1)', [id]);
    }
    await assert.rejects(
      installSyntheticPopulation(wrap(pg), 'ordinary'),
      /только/,
    );
    await assert.rejects(
      installSyntheticPopulation(wrap(pg), 'missing'),
      /только/,
    );
    assert.equal(
      (
        await pg.query<{ total: number }>(
          'SELECT count(*)::integer AS total FROM candidate_profiles',
        )
      ).rows[0].total,
      0,
    );
    const result = await pg.transaction((tx) =>
      installSyntheticPopulation(wrap(tx), 'demo-a'),
    );
    assert.equal(result.added, 720);
    const {
      rows: [existing],
    } = await pg.query<{ id: number }>(
      'SELECT id FROM candidate_profiles ORDER BY id LIMIT 1',
    );
    await pg.query(
      "UPDATE candidate_profiles SET payload=jsonb_set(payload,'{bio}',to_jsonb('Existing edited bio'::text)) WHERE id=$1",
      [existing.id],
    );
    assert.equal(
      (
        await pg.transaction((tx) =>
          installSyntheticPopulation(wrap(tx), 'demo-a'),
        )
      ).added,
      0,
    );
    assert.equal(
      (
        await pg.query<{ bio: string }>(
          "SELECT payload->>'bio' AS bio FROM candidate_profiles WHERE id=$1",
          [existing.id],
        )
      ).rows[0].bio,
      'Existing edited bio',
    );
    assert.equal(
      (
        await pg.transaction((tx) =>
          installSyntheticPopulation(wrap(tx), 'demo-b'),
        )
      ).added,
      720,
    );
    const { rows } = await pg.query<{ scope: string; count: number }>(
      'SELECT u.scope,count(*)::integer AS count FROM candidate_profiles p JOIN users u ON u.id=p.user_id GROUP BY u.scope ORDER BY u.scope',
    );
    assert.deepEqual(rows, [
      { scope: 'demo-a', count: 720 },
      { scope: 'demo-b', count: 720 },
    ]);
    assert.equal(
      (
        await pg.query<{ count: number }>(
          'SELECT count(*)::integer AS count FROM assessments',
        )
      ).rows[0].count,
      1440,
    );
    assert.equal(
      (
        await pg.query<{ count: number }>(
          'SELECT count(*)::integer AS count FROM users WHERE password_hash IS NOT NULL',
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await pg.close();
  }
});
