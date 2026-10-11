import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/adaptive/engine.js';
import { packs, getPack } from '../src/generative/packs.js';
import { profilesForPack } from '../src/synthetic-validation/profiles.js';
import { prepareMetadata, simulateSession } from '../src/synthetic-validation/runtime.js';
import { baselineIntegrity } from '../src/synthetic-validation/decomposition-runner.js';
import {
  auditSemanticOracle,
  frozenOracleAnswer,
  maximumEvidenceValue,
  planAccepted,
  runDiagnosticSession,
  semanticOracleAnswer,
  type OracleAudit,
} from '../src/synthetic-validation/decomposition.js';
const start = Date.parse('2026-10-08T08:00:00Z');
const make = (track: string, grade: 'Junior' | 'Middle' | 'Senior', seed = 17) =>
  createSession('diagnostic', 'synthetic-benchmark', grade, seed, start, undefined, undefined, {
    specialization: track,
  });
test('full-synthetic diagnostic branch reproduces the blind runtime, including action digest and boundary', () => {
  for (const pack of packs.filter((p) => p.enabled)) {
    const template = make(pack.id, 'Senior'),
      profile = profilesForPack(pack).find((p) => p.id === 'clear_senior')!,
      cache = prepareMetadata(template);
    const a = simulateSession(template, profile, 48121, cache),
      b = runDiagnosticSession(template, profile, 48121, 'full_synthetic', cache);
    assert.equal(b.actionDigest, a.actionDigest);
    assert.equal(b.score, a.score);
    assert.equal(b.confirmed, a.confirmed);
    assert.equal(b.boundaryCount, a.boundaryCount);
    assert.equal(b.durationMs, a.durationMs);
    assert.deepEqual(
      b.dimensions.map((d) => d.score),
      a.dimensionScores,
    );
  }
});
test('frozen Oracle confirms all twelve tracks and all target grades through actual engine', () => {
  for (const pack of packs.filter((p) => p.enabled))
    for (const grade of ['Junior', 'Middle', 'Senior'] as const) {
      const template = make(pack.id, grade),
        profile = profilesForPack(pack).find((p) => p.id === 'clear_senior')!,
        result = runDiagnosticSession(template, profile, 48121, 'oracle_candidate');
      assert.equal(result.confirmed, 1);
      assert.equal(result.fullAnswerSteps, result.answerSteps);
      assert.equal(result.executionMismatches, 0);
      assert.equal(result.positiveOptionRejectedByPlan, 0);
      assert.equal(result.lostEvidenceValue, 0);
      assert.ok(result.distanceToCut > 0);
    }
});
test('semantic metadata oracle agrees with frozen option and execution contracts in every track', () => {
  for (const pack of packs.filter((p) => p.enabled)) {
    const template = make(pack.id, 'Senior'),
      cache = prepareMetadata(template),
      audit: OracleAudit = {
        stepsChecked: 0,
        semanticOptionMismatches: 0,
        semanticPlanMismatches: 0,
        examples: [],
        singleSourceEvidenceChecks: 0,
        singleSourceMaximumValues: {},
      };
    auditSemanticOracle(template, cache, audit);
    assert.equal(audit.semanticOptionMismatches, 0);
    assert.equal(audit.semanticPlanMismatches, 0);
    for (const item of template.items)
      for (const step of item.variant.steps)
        if (!step.exploration) {
          const choice = semanticOracleAnswer(step, cache.get(`${item.variant.id}/${step.id}`)!);
          assert.equal(step.rubric.scores[choice.optionId], 1);
          assert.ok(planAccepted(item.variant, step, choice.execution));
        }
  }
});
test('perfect-answer interventions preserve synthetic timing and do not force evidence score to one', () => {
  const pack = getPack('frontend'),
    template = make(pack.id, 'Junior'),
    profile = profilesForPack(pack).find((p) => p.id === 'clear_junior')!;
  const baseline = runDiagnosticSession(template, profile, 48121, 'full_synthetic'),
    perfect = runDiagnosticSession(template, profile, 48121, 'perfect_answers_perfect_evidence');
  assert.equal(perfect.fullAnswerSteps, perfect.answerSteps);
  assert.equal(perfect.evidenceValueSum, 0.6 * perfect.evidenceSteps);
  assert.equal(perfect.maxEvidenceValueSum, perfect.evidenceValueSum);
  assert.ok(perfect.durationMs > 100000);
  assert.ok(baseline.durationMs > 100000);
});
test('current Junior recipes have no scored exploration; evidence is not a zero-quality observation', () => {
  for (const pack of packs.filter((p) => p.enabled)) {
    const template = make(pack.id, 'Junior');
    assert.ok(
      template.items.every((item) => item.variant.steps.every((step) => !step.exploration)),
    );
    const profile = profilesForPack(pack).find((p) => p.id === 'clear_junior')!;
    const result = runDiagnosticSession(template, profile, 48121, 'full_synthetic');
    assert.equal(result.evidenceSteps, 0);
    assert.equal(result.evidenceValueSum, 0);
    assert.equal(result.maxEvidenceValueSum, 0);
  }
});
test('current two-source exploration maximum remains one without score substitution', () => {
  const template = make('frontend', 'Middle');
  const item = template.items.find((i) => i.stage === 'incident')!.variant;
  const step = item.steps.find((s) => s.exploration)!;
  assert.equal(step.requiredEvidenceSources, 2);
  assert.equal(
    maximumEvidenceValue(
      item,
      step,
      item.artifacts.filter((a) => a.type !== 'topology').map((a) => a.id),
    ),
    1,
  );
  assert.equal(frozenOracleAnswer(item, step).optionId, 'continue');
});
test('failed clear diagnostic exposes actual engine reasons, dimension evidence and distance to cut', () => {
  const template = make('backend', 'Senior'),
    profile = profilesForPack(getPack('backend')).find((p) => p.id === 'clear_junior')!,
    result = runDiagnosticSession(template, profile, 48121, 'full_synthetic');
  assert.equal(result.confirmed, 0);
  assert.ok(result.failureReasons.includes('entire-decision-band-below-cut'));
  assert.equal(result.distanceToCut, result.lower - result.cut);
  assert.equal(result.estimatedDistanceToCut, result.score - result.cut);
  assert.equal(result.dimensions.length, 4);
  assert.ok(result.dimensions.every((d) => d.coverage > 0 && d.effectiveEvidence > 0));
});
test('original 396k-session baseline remains byte-for-byte unchanged', () => {
  assert.ok(baselineIntegrity().unchanged);
});
