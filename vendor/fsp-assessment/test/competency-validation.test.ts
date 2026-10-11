import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packs } from '../src/generative/packs.js';
import { createSession, publicSession } from '../src/adaptive/engine.js';
import {
  professionalRubric,
  capabilityMapping,
  competencyMetadata,
  prepareCompetencyMetadata,
} from '../src/synthetic-validation/competency/rubrics.js';
import {
  competencyPersonas,
  blindPersona,
} from '../src/synthetic-validation/competency/personas.js';
import {
  competencyPolicy,
  mixtureWeights,
  type CompetencyMemory,
} from '../src/synthetic-validation/competency/policy.js';
import { runCompetencySession } from '../src/synthetic-validation/competency/runtime.js';
import { baselineIntegrity } from '../src/synthetic-validation/decomposition-runner.js';
import { verifyProductionBaseline } from '../src/synthetic-validation/report.js';
import { canonical } from '../src/synthetic-validation/math.js';
import {
  verifyAssessmentRevision,
  revisedProductionFiles,
} from '../src/synthetic-validation/revision.js';
const start = Date.parse('2026-10-08T08:00:00Z');
const make = (track: string, grade: 'Junior' | 'Middle' | 'Senior') =>
  createSession('test', 'candidate', grade, 17, start, undefined, undefined, {
    specialization: track,
  });
const memory = (): CompetencyMemory => ({
  hypothesis: null,
  hypothesisRevisions: 0,
  opened: [],
  previousPlan: null,
  previousArchetype: null,
  comprehension: {},
});
test('all 12 professions have distinct 18-capability standards, complete anchors and sources', () => {
  const scope = new Set<string>();
  for (const pack of packs.filter((p) => p.enabled)) {
    const r = professionalRubric(pack.id);
    scope.add(r.roleScope);
    assert.equal(r.capabilities.length, 18);
    assert.equal(new Set(r.capabilities.map((c) => c.id)).size, 18);
    assert.equal(r.capabilities.filter((c) => c.middleTier === 'core').length, 12);
    for (const c of r.capabilities) {
      assert.ok(c.sourceBasis.length >= 2);
      assert.ok(c.commonFailureModes.length);
      for (const g of ['Junior', 'Middle', 'Senior'] as const)
        for (const a of ['weak', 'borderline', 'clear'] as const)
          assert.ok(c.behaviouralAnchors[g][a].length > 30);
    }
  }
  assert.equal(scope.size, 12);
});
test('all 184 ItemModels have disjoint resolvable required/supporting/optional capability mapping', () => {
  let n = 0;
  for (const pack of packs.filter((p) => p.enabled)) {
    const ids = new Set(professionalRubric(pack.id).capabilities.map((c) => c.id));
    for (const m of pack.itemModels) {
      const c = capabilityMapping(pack.id, m.id);
      n++;
      assert.ok(c.requiredCapabilities.length);
      const all = [
        ...c.requiredCapabilities,
        ...c.supportingCapabilities,
        ...c.optionalCapabilities,
      ];
      assert.equal(new Set(all).size, all.length);
      assert.ok(all.every((id) => ids.has(id)));
    }
  }
  assert.equal(n, 184);
  assert.equal(
    capabilityMapping('backend', 'transaction_event_gap').requiredCapabilities.length,
    3,
  );
});
test('clear Middle mastery is 83.3% stable core, with explicit unstable strategy rather than scalar ability', () => {
  for (const pack of packs.filter((p) => p.enabled)) {
    const p = competencyPersonas(pack.id);
    assert.equal(p.length, 22);
    const m = p.find((p) => p.id === 'clear_middle')!;
    const core = professionalRubric(pack.id).capabilities.filter((c) => c.middleTier === 'core');
    assert.equal(core.filter((c) => m.mastery[c.id]!.integrated === 'stable').length, 10);
    assert.ok(Object.values(m.mastery).every((v) => v.strategic === 'weak'));
    assert.equal('ability' in m, false);
  }
});
test('projection discards grade, band, score, cut, requirements and latent identity', () => {
  const template = make('backend', 'Senior'),
    item = template.items[0]!.variant,
    step = item.steps[0]!;
  const m = competencyMetadata(item, step);
  for (const key of ['grade', 'targetGrade', 'band', 'cut', 'scores', 'requirements', 'accepted'])
    assert.equal(key in m, false);
  const changed = { ...item, targetGrade: 'Junior' as const };
  assert.deepEqual(competencyMetadata(changed, step), m);
  const p = blindPersona(competencyPersonas('backend')[0]!);
  assert.equal('latentClass' in p, false);
  assert.equal('order' in p, false);
});
test('task demand follows actual source integration and strategy structure', () => {
  for (const g of ['Junior', 'Middle', 'Senior'] as const) {
    const s = make('data-scientist', g),
      cache = prepareCompetencyMetadata(s);
    for (const m of cache.values()) {
      if (m.alternatives.some((a) => a.archetype)) assert.equal(m.facet, 'strategic');
      if (m.facet === 'bounded') assert.deepEqual(m.demandBasis, ['bounded-local-contract']);
    }
  }
});
test('normalized components retain mixture mass regardless of distractor cardinality', () => {
  for (const count of [2, 20, 200]) {
    const coherent = [1, ...Array(count - 1).fill(0)],
      errors = Array(count).fill(1);
    const weights = mixtureWeights(0.8, coherent, errors);
    assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    assert.ok(Math.abs(weights[0]! - 0.8 - 0.2 / count) < 1e-12);
  }
});
test('ordinary policy couples intent with execution strategy and reuses comprehension across steps', () => {
  for (const pack of packs.filter((p) => p.enabled)) {
    const s = make(pack.id, 'Senior'),
      cache = prepareCompetencyMetadata(s),
      p = blindPersona(competencyPersonas(pack.id).find((p) => p.id === 'clear_senior')!);
    for (const item of s.items)
      for (const step of item.variant.steps) {
        const m = cache.get(`${item.variant.id}/${step.id}`)!;
        if (!step.responseTask?.controls.some((c) => c.id === 'strategy')) continue;
        const visible = { ...publicSession(s, start).current!.step, ...step };
        const mem = memory();
        const a = competencyPolicy(p, visible, m, mem, 19, 31);
        const chosen = m.alternatives.find((x) => x.id === a.optionId)!;
        assert.equal(a.execution?.strategy, chosen.executionStrategy);
        const b = competencyPolicy(p, visible, m, mem, 23, 31);
        assert.deepEqual(
          a.capabilityEvents.map((e) => e.understood),
          b.capabilityEvents.map((e) => e.understood),
        );
        assert.ok(canonical(a.execution).length > 2);
      }
  }
});
test('Oracle and perfect answers run real unchanged engine and preserve plans/evidence', () => {
  for (const pack of packs.filter((p) => p.enabled))
    for (const grade of ['Junior', 'Middle', 'Senior'] as const) {
      const s = make(pack.id, grade),
        p = competencyPersonas(pack.id)[0]!,
        cache = prepareCompetencyMetadata(s);
      for (const mode of ['oracle_candidate', 'perfect_answers_perfect_evidence'] as const) {
        const r = runCompetencySession(s, p, 48121, mode, cache);
        assert.equal(r.confirmed, 1);
        assert.equal(r.executionMismatches, 0);
        assert.equal(r.lostEvidenceValue, 0);
      }
    }
});
test('new simulation replays exactly and records dimensions, margins and capability evidence', () => {
  const s = make('backend', 'Middle'),
    p = competencyPersonas('backend')[4]!;
  const a = runCompetencySession(s, p, 48121, 'full_synthetic'),
    b = runCompetencySession(s, p, 48121, 'full_synthetic');
  assert.deepEqual(a, b);
  assert.ok(a.demonstrations.length);
  assert.equal(a.dimensions.length, 4);
  assert.equal(a.distanceToCut, a.lower - a.cut);
  assert.ok(a.items.every((i) => i.model));
});
test('old baseline stays preserved and successor production is registered; policy imports no scoring', () => {
  assert.ok(baselineIntegrity().unchanged);
  assert.deepEqual(
    [...verifyProductionBaseline().changed].sort(),
    [...revisedProductionFiles].sort(),
  );
  assert.ok(verifyAssessmentRevision().unchanged);
  const code = readFileSync('src/synthetic-validation/competency/policy.ts', 'utf8');
  assert.doesNotMatch(
    code,
    /cutScore|gradeConfigs|rubric\.scores|responseChecks|targetGrade|reasoningGrade|localSuccessProbability\(/,
  );
});

test('v2.1 integration uncertainty does not override mastered bounded Junior capabilities', async () => {
  const { competencyPersonas: profiles, blindPersona: blind } =
    await import('../src/synthetic-validation/competency/personas-v21.js');
  const { competencyPolicy: policy } =
    await import('../src/synthetic-validation/competency/policy-v21.js');
  const s = make('backend', 'Junior'),
    item = s.items[0]!.variant,
    step = item.steps[0]!,
    m = competencyMetadata(item, step),
    visible = publicSession(s, start).current!.step;
  const borderline = blind(profiles('backend').find((p) => p.id === 'junior_middle_borderline')!);
  const senior = blind(profiles('backend').find((p) => p.id === 'clear_senior')!);
  assert.equal(m.facet, 'bounded');
  const a = policy(borderline, visible, m, memory(), 19, 31),
    b = policy(senior, visible, m, memory(), 19, 31);
  assert.ok(a.capabilityEvents.every((e) => e.mastery === 'stable'));
  assert.deepEqual(a, b);
  const integration = { ...m, facet: 'integrated' as const };
  assert.ok(
    policy(borderline, visible, integration, memory(), 19, 31).capabilityEvents.every(
      (e) => e.mastery === 'inconsistent',
    ),
  );
});

test('benchmark dispatches scoped v2.1 policy and counts unique boundary exposure sessions', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { gunzipSync } = await import('node:zlib');
  const { runCompetencyTrack } = await import('../src/synthetic-validation/competency/runner.js');
  const output = mkdtempSync(join(tmpdir(), 'competency-dispatch-'));
  try {
    const r = await runCompetencyTrack('backend', {
      version: '2.1.0',
      seeds: 1,
      benchmarkSeed: 48121,
      workers: 1,
      tracks: ['backend'],
      output,
    });
    const traces = JSON.parse(
      gunzipSync(
        readFileSync(join(output, 'tracks/backend/FIRST_SEED_DEMONSTRATIONS.json.gz')),
      ).toString(),
    ) as {
      grade: string;
      profile: string;
      demonstrations: { facet: string; dimension: string; mastery: string }[];
    }[];
    const j = traces.find((t) => t.grade === 'Junior' && t.profile === 'junior_middle_borderline')!;
    assert.ok(
      j.demonstrations
        .filter((d) => d.facet === 'bounded' && d.dimension === 'diagnosis')
        .every((d) => d.mastery === 'stable'),
    );
    for (const c of r.exposure as { boundarySessions: number; boundaryItems: number }[]) {
      assert.ok(c.boundarySessions <= 1);
      assert.ok(c.boundarySessions <= c.boundaryItems);
    }
    assert.equal(r.sessions, 66);
    assert.equal(r.replayFailures, 0);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
