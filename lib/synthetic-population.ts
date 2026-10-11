import { specialtyName } from "./assessment-tracks";
import type { Database } from '@/db';
import type { Profile } from './model';
import population from '../data/synthetic-candidates-v1.json';

export type SyntheticCandidate = {
  key: string;
  track: string;
  profile: Profile;
  assessment: {
    id: string;
    specialty: string;
    grade: string;
    passed: boolean;
    score: number;
    formal: boolean;
    result: {
      decision: string;
      dimensions: { dimension: string; label: string; description: string }[];
    };
    [key: string]: unknown;
  };
  proof: {
    snapshotHash: string;
    steps: number;
    coreCompleted: boolean;
    durationMs: number;
    generatorVersion: string;
  };
};

export const syntheticPopulation = population as unknown as {
  version: string;
  generatorVersion: string;
  profiles: SyntheticCandidate[];
};

/** Add the published synthetic cohort only to a private demo scope; preserve existing records. */
export async function installSyntheticPopulation(db: Database, scope: string) {
  const {
    rows: [owner],
  } = await db.query<{ demo: boolean }>(
    'SELECT u.demo FROM users u JOIN account_state a ON a.user_id=u.id WHERE u.id=$1 AND u.scope=$1 AND u.deleted_at IS NULL',
    [scope],
  );
  if (!owner?.demo)
    throw new Error('Синтетические профили разрешены только в приватном демо');
  if (syntheticPopulation.profiles.length !== 720)
    throw new Error('Неполный демонстрационный набор');
  let added = 0;
  for (const record of syntheticPopulation.profiles) {
    const uid = `${scope}:${syntheticPopulation.version}:${record.key}`;
    await db.query(
      'INSERT INTO users(id,email,name,scope,demo) VALUES($1,$2,$3,$4,true) ON CONFLICT(id) DO NOTHING',
      [
        uid,
        `${syntheticPopulation.version}-${record.key}@example.test`,
        record.profile.name,
        scope,
      ],
    );
    const {
      rows: [inserted],
    } = await db.query<{ id: number }>(
      'INSERT INTO candidate_profiles(user_id,specialty,grade,visible,consent,payload) VALUES($1,$2,$3,true,true,$4) ON CONFLICT(user_id) DO NOTHING RETURNING id',
      [
        uid,
        specialtyName(record.profile.specialty),
        record.profile.grade,
        JSON.stringify(record.profile),
      ],
    );
    if (!inserted) continue;
    const profile = { ...record.profile, specialty: specialtyName(record.profile.specialty), id: inserted.id };
    await db.query('UPDATE candidate_profiles SET payload=$2 WHERE id=$1', [
      inserted.id,
      JSON.stringify(profile),
    ]);
    await db.query(
      'INSERT INTO assessments(id,user_id,payload) VALUES($1,$2,$3)',
      [
        `${scope}:${record.assessment.id}`,
        uid,
        JSON.stringify({
          ...record.assessment,
          id: `${scope}:${record.assessment.id}`,
          synthetic: true,
          simulationProof: record.proof,
        }),
      ],
    );
    added++;
  }
  return {
    added,
    total: syntheticPopulation.profiles.length,
    version: syntheticPopulation.version,
  };
}

/** Upgrade existing private demos without replacing user edits or rebuilding the cohort. */
export async function ensureSyntheticPopulation(db: Database, scope: string) {
  const prefix = `${scope}:${syntheticPopulation.version}:`;
  const { rows: [count] } = await db.query<{ total: number }>(
    "SELECT count(*)::integer AS total FROM users WHERE scope=$1 AND left(id,length($2))=$2",
    [scope, prefix],
  );
  if (count.total >= syntheticPopulation.profiles.length) return;
  await db.transaction(async tx => {
    await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [scope]);
    await installSyntheticPopulation(tx, scope);
  });
}
