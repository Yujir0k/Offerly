import { createSession } from '../adaptive/engine.js';
import { generateItem } from '../generative/generator.js';
import {
  buildWorld,
  buildIntents,
  deriveGroundTruth,
  evaluateIntent,
} from '../generative/world.js';
import { packs } from '../generative/packs.js';
import { canonical } from '../generative/validators.js';
import { strategyDecision } from '../generative/qualitative-runtime.js';
import type { ItemModel, SpecializationPack, WorldState } from '../generative/model.js';
import { prepareMetadata, simulateSession } from './runtime.js';
import { profilesForPack } from './profiles.js';
import { seedOf } from './math.js';

export type ExpectedGroundTruthEffect = 'preserve' | 'change' | 'mayChange';
export interface MutationOperator {
  id: string;
  category: 'incidental' | 'causal' | 'constraint';
  expectedGroundTruthEffect: ExpectedGroundTruthEffect;
  apply: (world: WorldState) => WorldState;
}
export function semanticGroundTruth(model: ItemModel, world: WorldState): unknown {
  const truth = deriveGroundTruth(model, world);
  return {
    hazard: truth.hazard,
    invariant: truth.violatedInvariant,
    requirements: [...truth.requirements].sort(),
    causalChain: truth.causalChain,
    diagnostic: truth.bestDiagnosticArtifact,
    falsifier: truth.falsifyingObservation,
  };
}
export function applyMutation(
  model: ItemModel,
  world: WorldState,
  operator: MutationOperator,
): WorldState {
  const next = operator.apply(structuredClone(world));
  if (
    next.modelId !== world.modelId ||
    next.specialization !== world.specialization ||
    next.grade !== world.grade
  )
    throw new Error('Mutation cannot change model, specialization or target grade');
  if (next.work?.policy) {
    const p = next.work.policy;
    for (const value of [p.maxCost, p.maxDelay, p.maxInterruption, p.maxResidualRisk])
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid constraint mutation');
    strategyDecision(next.work);
  }
  deriveGroundTruth(model, next);
  return next;
}
export function incidentalMutation(): MutationOperator {
  return {
    id: 'rename-visible-incidental-fields',
    category: 'incidental',
    expectedGroundTruthEffect: 'preserve',
    apply: (world) => {
      Object.assign(world.incidentals, {
        service: 'Synthetic service renamed',
        entity: 'renamed entity',
        table: 'renamed_table',
        endpoint: '/renamed/endpoint',
        operationId: 'renamed-observation',
        timestamp: '2030-01-01T00:00:00.000Z',
        wording: (world.incidentals.wording + 1) % 3,
      });
      return world;
    },
  };
}
export function causalMutation(
  pack: SpecializationPack,
  model: ItemModel,
  world: WorldState,
  seed: number,
): MutationOperator {
  const before = deriveGroundTruth(model, world).hazard;
  let replacement: WorldState | undefined;
  for (let offset = 1; offset <= 64; offset++) {
    const candidate = buildWorld(pack, model, world.grade, seed + offset, world.work!.band);
    if (deriveGroundTruth(model, candidate).hazard !== before) {
      replacement = candidate;
      break;
    }
  }
  if (!replacement) throw new Error('No distinct authored causal state available');
  return {
    id: 'replace-authored-causal-radicals',
    category: 'causal',
    expectedGroundTruthEffect: 'change',
    apply: (input) => {
      input.radicals.failure = structuredClone(replacement!.radicals.failure);
      input.radicals.interactingFailures = replacement!.radicals.interactingFailures;
      input.mutation = 'Replaced physical causal radicals; work profile and policy preserved.';
      return input;
    },
  };
}
export function priorityMutation(world: WorldState): MutationOperator {
  if (!world.work?.policy) throw new Error('Priority mutation needs a strategy policy');
  const before = strategyDecision(world.work).best.archetypeId;
  const priority = (['cost', 'delay', 'residualRisk'] as const).find(
    (priority) =>
      strategyDecision({ ...world.work!, policy: { ...world.work!.policy!, priority } }).best
        .archetypeId !== before,
  );
  if (!priority) throw new Error('No constraint-sensitive competing strategy');
  return {
    id: 'change-declared-priority',
    category: 'constraint',
    expectedGroundTruthEffect: 'change',
    apply: (input) => {
      input.work!.policy!.priority = priority;
      input.work!.changed = true;
      return input;
    },
  };
}
export interface MetamorphicReport {
  seed: number;
  samplesPerModelGrade: number;
  incidentalMutationsChecked: number;
  groundTruthPreservationFailures: number;
  causalMutationsChecked: number;
  expectedChangeFailures: number;
  constraintMutationsChecked: number;
  strategyChanges: number;
  strategyChangeRate: number;
  optionOrderChecks: number;
  optionOrderFailures: number;
  artifactOrderChecks: number;
  artifactOrderFailures: number;
  invalidMutationsRejected: number;
  failures: { track: string; model: string; grade: string; operator: string; message: string }[];
  modelCoverage: Record<string, number>;
  label: string;
}
export function runMetamorphic(seed = 48121, samplesPerModelGrade = 3): MetamorphicReport {
  const report: MetamorphicReport = {
    seed,
    samplesPerModelGrade,
    incidentalMutationsChecked: 0,
    groundTruthPreservationFailures: 0,
    causalMutationsChecked: 0,
    expectedChangeFailures: 0,
    constraintMutationsChecked: 0,
    strategyChanges: 0,
    strategyChangeRate: 0,
    optionOrderChecks: 0,
    optionOrderFailures: 0,
    artifactOrderChecks: 0,
    artifactOrderFailures: 0,
    invalidMutationsRejected: 0,
    failures: [],
    modelCoverage: {},
    label: 'STRUCTURAL METAMORPHIC VALIDATION — not human validity',
  };
  const templates = new Map<string, ReturnType<typeof createSession>>();
  const templateFor = (pack: SpecializationPack, grade: WorldState['grade']) => {
    const key = `${pack.id}/${grade}`;
    if (!templates.has(key))
      templates.set(
        key,
        createSession(
          'metamorphic',
          'metamorphic',
          grade,
          seed,
          1791432000000,
          undefined,
          undefined,
          { specialization: pack.id },
        ),
      );
    return templates.get(key)!;
  };
  for (const pack of packs.filter((p) => p.enabled))
    for (const model of pack.itemModels)
      for (const grade of model.supportedGrades!)
        for (let sample = 0; sample < samplesPerModelGrade; sample++) {
          const leaf = seedOf(seed, pack.id, model.id, grade, sample),
            world = buildWorld(pack, model, grade, leaf),
            before = canonical(semanticGroundTruth(model, world));
          const check = (operator: MutationOperator) => {
            const next = applyMutation(model, world, operator),
              after = canonical(semanticGroundTruth(model, next));
            if (operator.category === 'incidental') {
              report.incidentalMutationsChecked++;
              const intents = (w: WorldState) =>
                buildIntents(model, w, 'remediation', leaf)
                  .map((i) => ({
                    id: i.id,
                    score: evaluateIntent(i, w, deriveGroundTruth(model, w)),
                    guarantees: i.guarantees,
                  }))
                  .sort((a, b) => a.id.localeCompare(b.id));
              if (before !== after || canonical(intents(world)) !== canonical(intents(next))) {
                report.groundTruthPreservationFailures++;
                throw new Error('Incidental mutation changed semantic truth or scoring intent');
              }
            } else if (operator.category === 'causal') {
              report.causalMutationsChecked++;
              if (before === after) {
                report.expectedChangeFailures++;
                throw new Error('Expected causal truth change did not occur');
              }
            } else {
              report.constraintMutationsChecked++;
              report.strategyChanges += Number(
                strategyDecision(world.work!).best.archetypeId !==
                  strategyDecision(next.work!).best.archetypeId,
              );
              if (operator.expectedGroundTruthEffect === 'change' && before === after) {
                report.expectedChangeFailures++;
                throw new Error('Expected constraint strategy change did not occur');
              }
            }
          };
          const operators = [
            incidentalMutation(),
            causalMutation(pack, model, world, leaf),
            ...(world.work!.policy ? [priorityMutation(world)] : []),
          ];
          for (const operator of operators)
            try {
              check(operator);
            } catch (error) {
              report.failures.push({
                track: pack.id,
                model: model.id,
                grade,
                operator: operator.id,
                message: String(error),
              });
            }
          // Budget change is allowed to preserve the optimum; reject infeasible states explicitly.
          if (world.work!.policy) {
            const outcomes = strategyDecision(world.work!).feasible;
            const min = Math.min(...outcomes.map((o) => o.cost));
            const op: MutationOperator = {
              id: 'tighten-cost-budget',
              category: 'constraint',
              expectedGroundTruthEffect: 'mayChange',
              apply: (input) => {
                input.work!.policy!.maxCost = min;
                return input;
              },
            };
            try {
              check(op);
            } catch (error) {
              report.failures.push({
                track: pack.id,
                model: model.id,
                grade,
                operator: op.id,
                message: String(error),
              });
            }
            try {
              applyMutation(model, world, {
                id: 'invalid-negative-budget',
                category: 'constraint',
                expectedGroundTruthEffect: 'mayChange',
                apply: (input) => {
                  input.work!.policy!.maxCost = -1;
                  return input;
                },
              });
              report.failures.push({
                track: pack.id,
                model: model.id,
                grade,
                operator: 'invalid-negative-budget',
                message: 'Invalid mutation accepted',
              });
            } catch {
              report.invalidMutationsRejected++;
            }
          }
          const item = generateItem(pack, model, grade, 'anchors', 'engineering_judgment', leaf);
          const gt = canonical(item.generated.groundTruth);
          const template = {
            ...templateFor(pack, grade),
            items: [{ variant: item, stage: item.stage }],
            boundaryPool: [],
          };
          const profile = profilesForPack(pack).find((p) => p.id === 'clear_senior')!;
          const baseline = simulateSession(template, profile, seed);
          const optionPermuted = structuredClone(item);
          optionPermuted.steps.forEach((step) => {
            step.options.reverse();
            step.responseTask?.controls.reverse();
            step.responseTask?.controls.forEach((control) => control.options.reverse());
          });
          const optionResult = simulateSession(
            { ...template, items: [{ variant: optionPermuted, stage: optionPermuted.stage }] },
            profile,
            seed,
          );
          report.optionOrderChecks++;
          if (
            canonical(optionResult) !== canonical(baseline) ||
            canonical(optionPermuted.generated.difficulty) !== canonical(item.generated.difficulty)
          ) {
            report.optionOrderFailures++;
            report.failures.push({
              track: pack.id,
              model: model.id,
              grade,
              operator: 'option-permutation',
              message: 'Semantic actions, score, difficulty or decision changed',
            });
          }
          const permuted = structuredClone(item);
          permuted.artifacts.reverse();
          Object.values(permuted.generated.stepArtifacts).forEach((a) => a.reverse());
          report.artifactOrderChecks++;
          const artifactResult = simulateSession(
            { ...template, items: [{ variant: permuted, stage: permuted.stage }] },
            profile,
            seed,
          );
          if (
            canonical(deriveGroundTruth(model, permuted.generated.worldState)) !== gt ||
            canonical(artifactResult) !== canonical(baseline)
          ) {
            report.artifactOrderFailures++;
            report.failures.push({
              track: pack.id,
              model: model.id,
              grade,
              operator: 'artifact-permutation',
              message: 'GroundTruth changed',
            });
          }
          report.modelCoverage[`${pack.id}/${model.id}/${grade}`] =
            (report.modelCoverage[`${pack.id}/${model.id}/${grade}`] || 0) + 1;
        }
  // Full pipeline invariance covers answers, plans, evidence, score and final decision.
  for (const pack of packs.filter((p) => p.enabled))
    for (const grade of ['Junior', 'Middle', 'Senior'] as const) {
      const template = templateFor(pack, grade);
      const profile = profilesForPack(pack).find((p) => p.id === 'clear_senior')!;
      const baseline = simulateSession(template, profile, seed, prepareMetadata(template));
      for (const category of ['option', 'artifact'] as const) {
        const permuted = structuredClone(template);
        for (const item of [...permuted.items.map((i) => i.variant), ...permuted.boundaryPool])
          if (category === 'option') {
            item.steps.forEach((step) => {
              step.options.reverse();
              step.responseTask?.controls.reverse();
              step.responseTask?.controls.forEach((c) => c.options.reverse());
            });
          } else {
            item.artifacts.reverse();
            Object.values(item.generated!.stepArtifacts).forEach((a) => a.reverse());
          }
        const result = simulateSession(permuted, profile, seed, prepareMetadata(permuted));
        if (category === 'option') report.optionOrderChecks++;
        else report.artifactOrderChecks++;
        if (
          result.confirmed !== baseline.confirmed ||
          result.score !== baseline.score ||
          canonical(result.dimensionScores) !== canonical(baseline.dimensionScores) ||
          result.actionDigest !== baseline.actionDigest
        ) {
          if (category === 'option') report.optionOrderFailures++;
          else report.artifactOrderFailures++;
          report.failures.push({
            track: pack.id,
            model: 'full-blueprint',
            grade,
            operator: `${category}-permutation`,
            message: 'Actions, score or decision changed',
          });
        }
      }
    }
  report.strategyChangeRate = report.constraintMutationsChecked
    ? report.strategyChanges / report.constraintMutationsChecked
    : 0;
  return report;
}
