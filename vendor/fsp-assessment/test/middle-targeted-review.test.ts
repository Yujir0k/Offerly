import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/adaptive/engine.js';
import { prepareMetadata } from '../src/synthetic-validation/runtime.js';
import { competencyMetadata } from '../src/synthetic-validation/competency/rubrics.js';
import { scopedMetadata } from '../src/synthetic-validation/targeted/scope-metadata.js';
import { packs } from '../src/generative/packs.js';
import { runReviewedSession } from '../src/synthetic-validation/targeted/runtime.js';
import { removeItems } from '../src/synthetic-validation/targeted/counterfactual.js';
import { runCompetencySession } from '../src/synthetic-validation/competency/runtime-v21.js';
import { competencyPersonas } from '../src/synthetic-validation/competency/personas-v21.js';
import { verifyV21 } from '../src/synthetic-validation/competency/freeze-v21.js';
import {
  verifyAssessmentRevision,
  revisionManifestPath,
} from '../src/synthetic-validation/revision.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const start = Date.parse('2026-10-08T08:00:00Z');
// Scope tests assert contracts, not desired confirmation rates.
test('scope correction distinguishes handoff application from ownership and preserves alternatives/plans', () => {
  let handoffs = 0,
    ownership = 0;
  for (const pack of packs.filter((p) => p.enabled))
    for (const grade of ['Middle', 'Senior'] as const) {
      const s = createSession('s', 'candidate', grade, 17, start, undefined, undefined, {
        specialization: pack.id,
      });
      const cache = prepareMetadata(s);
      for (const { variant: v } of s.items)
        for (const st of v.steps) {
          const raw = cache.get(`${v.id}/${st.id}`)!,
            before = competencyMetadata(v, st, raw),
            after = scopedMetadata(v, st, raw),
            w = v.generated!.stepWorlds[st.id]!.work!;
          assert.deepEqual(after.alternatives, before.alternatives);
          assert.deepEqual(after.controls, before.controls);
          assert.deepEqual(after.jointPlans, before.jointPlans);
          assert.deepEqual(after.requiredCapabilities, before.requiredCapabilities);
          if (before.facet !== 'strategic') assert.equal(after.facet, before.facet);
          else if (w.consequences.length === 1 && w.consequences[0] === w.handoff) {
            handoffs++;
            assert.equal(after.facet, 'integrated');
          } else {
            ownership++;
            assert.equal(after.facet, 'strategic');
          }
          assert.deepEqual(scopedMetadata({ ...v, targetGrade: 'Junior' }, st, raw), after);
        }
    }
  assert.ok(handoffs >= 12);
  assert.ok(ownership >= 12);
});
test('capture is an observer; fixed-response item removal does not mutate the engine session', () => {
  const s = createSession('s', 'candidate', 'Middle', 17, start, undefined, undefined, {
      specialization: 'backend',
    }),
    p = competencyPersonas('backend').find((p) => p.id === 'clear_middle')!;
  const capture: { session?: typeof s; boundaries: [] } = { boundaries: [] };
  const a = runReviewedSession(s, p, 48121, 'full_synthetic', undefined, capture),
    b = runCompetencySession(s, p, 48121, 'full_synthetic');
  assert.deepEqual(a, b);
  const before = structuredClone(capture.session!);
  const cf = removeItems(capture.session!, [s.items[3]!.variant.id]);
  assert.deepEqual(capture.session, before);
  assert.equal(cf.dimensions.length, 4);
  assert.ok(Number.isFinite(cf.band.lowerBound));
});
test('v2.1 mastery and priors stay frozen while successor metadata has registered historical snapshots', () => {
  const successors = [
    'src/synthetic-validation/competency/rubrics.ts',
    'src/synthetic-validation/metadata.ts',
  ];
  assert.deepEqual(verifyV21().changed.sort(), [...successors].sort());
  assert.ok(verifyAssessmentRevision().unchanged);
  const original = JSON.parse(
    readFileSync('data/competency-rubrics/PRE_RUN_LOCK_V21.json', 'utf8'),
  ) as { sha256: Record<string, string> };
  const current = JSON.parse(readFileSync(revisionManifestPath, 'utf8')) as {
    sources: Record<string, string>;
    historicalSources: Record<string, string>;
  };
  for (const file of successors) {
    assert.ok(current.sources[file]);
    const snapshot = 'data/assessment-revisions/discrimination-study/original-v21-sources/' + file;
    assert.equal(
      createHash('sha256').update(readFileSync(snapshot)).digest('hex'),
      original.sha256[file],
    );
  }
});

test('independent ownership stays strategic at the same Middle grade even with a single consequence', () => {
  const s = createSession('s', 'candidate', 'Middle', 17, start, undefined, undefined, {
      specialization: 'backend',
    }),
    item = s.items[3]!.variant,
    step = item.steps[0]!,
    raw = prepareMetadata(s).get(`${item.id}/${step.id}`)!;
  assert.equal(scopedMetadata(item, step, raw).facet, 'integrated');
  const owned = structuredClone(item);
  owned.generated!.stepWorlds[step.id]!.work!.consequences = [
    'Independent ownership of rollback compatibility and residual system exposure',
  ];
  assert.equal(owned.targetGrade, 'Middle');
  assert.equal(scopedMetadata(owned, step, raw).facet, 'strategic');
});
test('AFTER boundary observer reproduces scoped executor without changing its result', async () => {
  const { runScopedSession } =
    await import('../src/synthetic-validation/targeted/scoped-runtime.js');
  const { runReviewedSession: review } =
    await import('../src/synthetic-validation/targeted/runtime-after-review.js');
  const s = createSession('s', 'candidate', 'Middle', 17, start, undefined, undefined, {
      specialization: 'backend',
    }),
    p = competencyPersonas('backend').find((p) => p.id === 'clear_middle')!;
  const capture: { session?: typeof s; boundaries: [] } = { boundaries: [] };
  assert.deepEqual(
    review(s, p, 48121, 'full_synthetic', undefined, capture),
    runScopedSession(s, p, 48121, 'full_synthetic'),
  );
  assert.ok(capture.session!.result);
});
