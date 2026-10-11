import { generateVariant } from './generator.js';
import { families } from './families/registry.js';
import { runExperiment } from './simulator.js';
import { grades, type ExperimentInput, type Variant } from './domain.js';

/** Oracle baseline for technical QA only; never used as human or independent expert labels. */
export function oracleInput(variant: Variant, stage = 1): ExperimentInput {
  if (variant.oracle.specialized)
    return { plan: variant.oracle.specialized.referencePlans[stage === 2 ? 1 : 0] };
  return variant.rows.length
    ? { features: [variant.oracle.validFeatures[0]!], split: variant.oracle.requiredSplit }
    : variant.documents.length
      ? { policy: 'current-abstain', topK: 2 }
      : { strategy: 'versioned' };
}
/** Checks every issued variant, both stage oracles and fault sensitivity before publication. */
export function preflight(variant: Variant): void {
  for (const question of variant.questions)
    if (!question.options.some((option) => option.id === variant.oracle.answers[question.id]))
      throw new Error('Вариант отклонён: неполный эталон');
  for (const stage of [1, 2]) {
    if (
      !Object.values(runExperiment(variant, oracleInput(variant, stage), stage).checks).every(
        Boolean,
      )
    )
      throw new Error('Вариант отклонён: эталон не выполняет требования');
    if (variant.oracle.specialized)
      for (const plan of variant.oracle.specialized.mutants[stage === 2 ? 1 : 0])
        if (Object.values(runExperiment(variant, { plan }, stage).checks).every(Boolean))
          throw new Error('Вариант отклонён: ошибочный план принят');
  }
}
/** Tests each distinct professional family across grades, seeds and both actual data conditions. */
export function validateTechnical(seeds = 32) {
  const reports: {
    trackId: string;
    familyId: string;
    title: string;
    variants: number;
    acceptedOracle: number;
    rejectedFaults: number;
    changedReferencePlans: number;
    distinctReferencePlans: number;
    distinctQuestionSets: number;
    skills: string[];
  }[] = [];
  const failures: string[] = [];
  for (const family of families) {
    let acceptedOracle = 0;
    let rejectedFaults = 0;
    let variants = 0;
    let changedReferencePlans = 0;
    const referenceSignatures = new Set<string>();
    const questionSignatures = new Set<string>();
    for (const grade of grades)
      for (let seed = 1; seed <= seeds; seed++) {
        try {
          const variant = generateVariant(family.trackId, grade, seed, 'local', family.id);
          variants++;
          referenceSignatures.add(JSON.stringify(variant.oracle.specialized!.referencePlans[0]));
          questionSignatures.add(
            JSON.stringify(
              variant.questions
                .map((question) => ({
                  prompt: question.prompt,
                  scenario: question.scenario,
                  options: question.options.map((option) => option.text).sort(),
                }))
                .sort((a, b) => a.prompt.localeCompare(b.prompt)),
            ),
          );
          if (
            JSON.stringify(variant.oracle.specialized!.referencePlans[0]) !==
            JSON.stringify(variant.oracle.specialized!.referencePlans[1])
          )
            changedReferencePlans++;
          for (const stage of [1, 2]) {
            const result = runExperiment(variant, oracleInput(variant, stage), stage);
            if (Object.values(result.checks).every(Boolean)) acceptedOracle++;
            else failures.push(`${family.id}/${grade}/${seed}/${stage}: oracle failed`);
            for (const plan of variant.oracle.specialized!.mutants[stage === 2 ? 1 : 0]) {
              if (!Object.values(runExperiment(variant, { plan }, stage).checks).every(Boolean))
                rejectedFaults++;
              else failures.push(`${family.id}/${grade}/${seed}/${stage}: fault accepted`);
            }
          }
        } catch (error) {
          failures.push(
            `${family.id}/${grade}/${seed}: ${error instanceof Error ? error.message : 'generation failed'}`,
          );
        }
      }
    reports.push({
      trackId: family.trackId,
      familyId: family.id,
      title: family.title,
      variants,
      acceptedOracle,
      rejectedFaults,
      changedReferencePlans,
      distinctReferencePlans: referenceSignatures.size,
      distinctQuestionSets: questionSignatures.size,
      skills: family.skills,
    });
  }
  return {
    type: 'technical-only',
    generatedAt: new Date().toISOString(),
    passed: failures.length === 0,
    variants: reports.reduce((sum, report) => sum + report.variants, 0),
    transitions: reports.reduce((sum, report) => sum + report.acceptedOracle, 0),
    faultyStrategiesRejected: reports.reduce((sum, report) => sum + report.rejectedFaults, 0),
    families: reports,
    failures,
    humanCalibration: 'not_performed',
    reuseRisk: reports
      .filter((report) => report.distinctReferencePlans <= 1)
      .map((report) => report.familyId),
    warning:
      '26 отдельных семейств с проверкой данных, эталонов и контрпримеров. Техническая проверка не доказывает равенство сложности, дискриминативность или соответствие экспертному профессиональному грейду.',
  };
}
