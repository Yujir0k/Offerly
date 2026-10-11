import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession,
  evaluateEvidence,
  chooseBoundary,
  publicSession,
} from '../src/adaptive/engine.js';
import { corePointBudget, difficultyPoints } from '../src/adaptive/scoring.js';
import { packs } from '../src/generative/packs.js';
import { dimensions, type AssessmentSession, type TargetGrade } from '../src/adaptive/model.js';

const start = Date.parse('2026-10-09T08:00:00Z');
const make = () => structuredClone(createSession('points', 'candidate', 'Middle', 17, start));

test('relative difficulty points remain monotone across overlapping grade bands', () => {
  const bands = [
    'junior_core',
    'junior_upper',
    'middle_lower',
    'middle_core',
    'middle_upper',
    'senior_lower',
    'senior_core',
  ] as const;
  for (const grade of ['Junior', 'Middle', 'Senior'] as const) {
    const weights = bands.map((band) => difficultyPoints(grade, band));
    assert.deepEqual(
      weights,
      [...weights].sort((a, b) => a - b),
    );
    assert.ok(weights.every((weight) => [1, 1.5, 2].includes(weight)));
  }
  assert.equal(difficultyPoints('Senior', 'middle_upper'), 1);
  assert.equal(difficultyPoints('Senior', 'senior_core'), 2);
  assert.equal(difficultyPoints('Middle', 'junior_upper'), 1);
});

function scoredPair(): AssessmentSession {
  const session = make();
  const first = session.items.find(
    (item) => item.variant.steps[0]!.rubric.dimension === 'diagnosis',
  )!;
  const second = session.boundaryPool.find(
    (item) => item.steps[0]!.rubric.dimension === 'diagnosis',
  )!;
  session.items = [first, { variant: second, stage: 'boundary' }];
  session.contributions = [first.variant, second].map((item, index) => {
    const step = item.steps[0]!;
    const option = step.options.find((entry) => step.rubric.scores[entry.id] === (index ? 0 : 1))!;
    session.responses.push({
      itemId: item.id,
      stepId: step.id,
      optionId: option.id,
      at: new Date(start).toISOString(),
      responseTimeMs: 0,
      contributions: [],
    });
    return {
      dimension: 'diagnosis',
      value: index ? 0 : 1,
      weight: 1,
      resultWeight: index ? 2 : 1,
      familyId: item.id,
      observation: `${item.id}/${step.id}`,
      source: 'answer',
    };
  });
  return session;
}

test('difficulty points affect earned score without inventing more independent information', () => {
  const session = scoredPair();
  const weighted = evaluateEvidence(session).dimensions[0]!;
  assert.equal(weighted.score, 1 / 3);
  assert.equal(weighted.effectiveEvidence, 2);
  session.config.scoringVersion = 'information-2';
  const historical = evaluateEvidence(session).dimensions[0]!;
  assert.equal(historical.score, 0.5);
  assert.equal(historical.margin, weighted.margin);
  session.config.scoringVersion = 'difficulty-3';
  session.contributions.push({ ...session.contributions[1]! });
  const correlated = evaluateEvidence(session).dimensions[0]!;
  assert.equal(correlated.score, weighted.score);
  assert.equal(correlated.effectiveEvidence, weighted.effectiveEvidence);
  for (const contribution of session.contributions) contribution.resultWeight! *= 7;
  assert.equal(evaluateEvidence(session).dimensions[0]!.score, weighted.score);
  assert.equal(evaluateEvidence(session).dimensions[0]!.margin, weighted.margin);
  for (const contribution of session.contributions) contribution.value = 1;
  assert.equal(evaluateEvidence(session).dimensions[0]!.score, 1);
});

test('generated forms have identical per-competency points and band budgets within each target', () => {
  for (const pack of packs.filter((entry) => entry.enabled)) {
    for (const grade of ['Junior', 'Middle', 'Senior'] as TargetGrade[]) {
      const signatures = new Set<string>();
      for (let seed = 1; seed <= 10; seed++) {
        const session = createSession(
          'budget',
          'candidate',
          grade,
          seed,
          start,
          undefined,
          undefined,
          { specialization: pack.id },
        );
        const bands: Record<string, number> = {};
        for (const { variant, stage } of session.items) {
          const band = variant.generated!.difficulty!.band;
          for (const step of variant.steps) {
            assert.equal(step.rubric.resultWeight, difficultyPoints(grade, band));
            const key = `${stage}/${band}/${step.rubric.dimension}`;
            bands[key] = (bands[key] ?? 0) + 1;
          }
        }
        signatures.add(JSON.stringify({ points: corePointBudget(session), bands }));
        assert.equal(session.config.hardCapMs, 20 * 60 * 1000);
      }
      assert.equal(signatures.size, 1, `${pack.id}/${grade}`);
    }
  }
});

test('boundary selection uses weighted reduction of decision uncertainty and respects used siblings', () => {
  const session = make();
  session.config.weights = {
    diagnosis: 0.97,
    correctness: 0.01,
    engineering_judgment: 0.01,
    adaptation: 0.01,
  };
  const selected = chooseBoundary(session)!;
  assert.equal(selected.steps[0]!.rubric.dimension, 'diagnosis');
  session.items.push({ variant: selected, stage: 'boundary' });
  const next = chooseBoundary(session);
  assert.ok(
    !next ||
      next.generated!.siblingGroup !== selected.generated!.siblingGroup ||
      next.steps[0]!.rubric.dimension !== selected.steps[0]!.rubric.dimension,
  );
  assert.ok(!next || next.id !== selected.id);
});

test('candidate sees difficulty weight without hidden rubrics or answer keys', () => {
  const session = make();
  const view = publicSession(session, start);
  assert.equal(
    view.current!.step.difficultyPoints,
    session.items[0]!.variant.steps[0]!.rubric.resultWeight,
  );
  assert.ok(!('rubric' in view.current!.step));
  assert.equal(session.config.maxBoundaryItems, 6);
  assert.deepEqual(Object.keys(corePointBudget(session)), [...dimensions]);
});
