import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession,
  chooseBoundary,
  verifiedDeficit,
  verificationNeeded,
  evaluateEvidence,
  answer,
  publicSession,
  expireSession,
} from '../src/adaptive/engine.js';
import { reproduceGeneratedItem } from '../src/generative/generator.js';

test('reserve supplies six distinct family/competency probes while excluding all core families', () => {
  for (const specialization of ['backend', 'frontend', 'security-appsec']) {
    for (const grade of ['Junior', 'Middle', 'Senior'] as const) {
      const session = createSession(
        'reserve',
        'candidate',
        grade,
        17,
        undefined,
        undefined,
        undefined,
        { specialization },
      );
      const pairs = new Set<string>();
      for (let index = 0; index < session.config.maxBoundaryItems; index++) {
        const item = chooseBoundary(session);
        assert.ok(item, `${specialization}/${grade}/${index}`);
        assert.ok(
          !session.items.some(
            (entry) =>
              !entry.variant.generated!.coreProbe &&
              entry.stage !== 'boundary' &&
              entry.variant.generated!.siblingGroup === item.generated!.siblingGroup,
          ),
        );
        const key = `${item.generated!.siblingGroup}/${item.steps[0]!.rubric.dimension}`;
        assert.ok(!pairs.has(key));
        pairs.add(key);
        session.items.push({ variant: item, stage: 'boundary' });
      }
      assert.equal(pairs.size + (grade === 'Senior' ? 1 : 0), 6);
    }
  }
});

test('Senior has a separate mandatory ownership case with ordinary core information weight', () => {
  const session = createSession('senior-probe', 'candidate', 'Senior', 17);
  const probe = session.items.find((entry) => entry.variant.generated!.coreProbe)!;
  assert.equal(session.items.length, 7);
  assert.equal(session.config.maxBoundaryItems, 5);
  assert.equal(probe.stage, 'review');
  assert.equal(probe.variant.generated!.difficulty!.band, 'senior_core');
  assert.equal(probe.variant.steps[0]!.rubric.dimension, 'engineering_judgment');
  assert.equal(probe.variant.steps[0]!.rubric.informationWeight, 1);
  assert.ok(probe.variant.generated!.worldState.work!.consequences.length > 1);
  assert.ok(
    !session.items.some(
      (entry) =>
        entry !== probe &&
        entry.variant.generated!.siblingGroup === probe.variant.generated!.siblingGroup,
    ),
  );
  const regenerated = reproduceGeneratedItem({
    ...probe.variant,
    generated: probe.variant.generated!,
    topology: probe.variant.topology!,
  });
  assert.equal(regenerated.generated.coreProbe, true);
  assert.equal(regenerated.steps[0]!.rubric.informationWeight, 1);
  assert.equal(
    regenerated.generated.surfaceFingerprint,
    probe.variant.generated!.surfaceFingerprint,
  );
});

test('incomplete or uncertain evidence does not imply a lower assessed grade', () => {
  const current = createSession('uncertainty', 'candidate', 'Senior', 17);
  const historical = structuredClone(current);
  historical.config.enhancements!.honestRecommendation = false;
  expireSession(current, Date.parse(current.deadlineAt));
  expireSession(historical, Date.parse(historical.deadlineAt));
  assert.equal(current.result!.assessmentStatus, 'insufficient-evidence');
  assert.equal(current.result!.recommendation, null);
  assert.equal(historical.result!.recommendation, 'Middle');
  assert.equal(current.result!.decision, historical.result!.decision);
});

test('diagnostic knowledge and execution are scored separately without forgiving an invalid plan', () => {
  const template = structuredClone(createSession('components', 'candidate', 'Middle', 17));
  const item = template.items[0]!.variant;
  const step = item.steps[0]!;
  assert.equal(step.rubric.dimension, 'diagnosis');
  const correct = step.options.find((entry) => step.rubric.scores[entry.id] === 1)!;
  const expected = item.generated!.responseChecks![step.id]!.accepted[0]!;
  const incorrect = { ...expected };
  const control = step.responseTask!.controls.find(
    (entry) =>
      entry.type === 'select' &&
      entry.options.some((option) => option.value !== expected[entry.id]),
  )!;
  incorrect[control.id] = control.options.find(
    (option) => option.value !== expected[control.id],
  )!.value;
  const historical = structuredClone(template);
  delete historical.config.enhancements;
  historical.config.scoringVersion = 'difficulty-3';
  answer(
    historical,
    item.id,
    step.id,
    correct.id,
    Date.parse(historical.startedAt) + 1000,
    incorrect,
  );
  assert.equal(historical.responses[0]!.contributions[0]!.value, 0);
  assert.equal(historical.responses[0]!.contributions.length, 1);
  answer(template, item.id, step.id, correct.id, Date.parse(template.startedAt) + 1000, incorrect);
  const components = template.responses[0]!.contributions;
  assert.equal(components.find((entry) => entry.source === 'answer')!.value, 1);
  assert.equal(components.find((entry) => entry.source === 'execution')!.value, 0);
  assert.equal(components.find((entry) => entry.source === 'execution')!.dimension, 'correctness');
  assert.doesNotMatch(
    JSON.stringify(publicSession(template)),
    /executionDimension|responseChecks|"rubric"/,
  );
});

test('one weak case requires independent verification; only repeated resolved deficits reject', () => {
  const session = structuredClone(createSession('deficit', 'candidate', 'Middle', 17));
  const selected = session.items.filter((item) =>
    item.variant.steps.some((step) => step.rubric.dimension === 'adaptation'),
  );
  assert.equal(selected.length, 2);
  for (const [index, item] of selected.entries()) {
    const step = item.variant.steps.find((step) => step.rubric.dimension === 'adaptation')!;
    const option = step.options[0]!;
    const contribution = {
      dimension: 'adaptation' as const,
      value: index,
      weight: 1,
      resultWeight: 1,
      familyId: item.variant.id,
      observation: `${item.variant.id}/${step.id}`,
      source: 'answer' as const,
    };
    session.contributions.push(contribution);
    session.responses.push({
      itemId: item.variant.id,
      stepId: step.id,
      optionId: option.id,
      at: session.startedAt,
      responseTimeMs: 0,
      contributions: [contribution],
    });
  }
  assert.ok(verificationNeeded(session).some((entry) => entry.dimension === 'adaptation'));
  assert.equal(verifiedDeficit(session), undefined);
  session.contributions[1]!.value = 0;
  assert.equal(verifiedDeficit(session)!.dimension, 'adaptation');
  session.contributions[1]!.familyId = session.contributions[0]!.familyId;
  session.contributions[1]!.observation = session.contributions[0]!.observation;
  assert.equal(
    evaluateEvidence(session).dimensions.find((entry) => entry.dimension === 'adaptation')!
      .coverage,
    1,
  );
  assert.equal(verifiedDeficit(session), undefined);
});
