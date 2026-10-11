import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gradeConfigs } from '../adaptive/config.js';
import { generatorVersion } from '../generative/generator.js';
import { getPack } from '../generative/packs.js';
import { syntheticPolicyVersion } from './model.js';
import { policyCoefficients } from './policy.js';
import { mean, correlation } from './math.js';
import type { BenchmarkOptions, TrackResult, CohortResult } from './runner.js';
import type { MetamorphicReport } from './metamorphic.js';

function csvValue(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function writeCsv(path: string, rows: object[], columns?: string[]): void {
  const keys = columns || [...new Set(rows.flatMap((row) => Object.keys(row)))];
  writeFileSync(
    path,
    [
      keys.join(','),
      ...rows.map((row) =>
        keys.map((key) => csvValue((row as Record<string, unknown>)[key])).join(','),
      ),
    ].join('\n') + '\n',
  );
}
export function verifyProductionBaseline(
  path = 'data/synthetic-validation/PRODUCTION_BASELINE.json',
) {
  const baseline = JSON.parse(readFileSync(path, 'utf8')) as {
    productionSourceHashes: Record<string, string>;
  };
  const changed = Object.entries(baseline.productionSourceHashes)
    .filter(
      ([path, hash]) => createHash('sha256').update(readFileSync(path)).digest('hex') !== hash,
    )
    .map(([path]) => path);
  return {
    filesChecked: Object.keys(baseline.productionSourceHashes).length,
    changed,
    unchanged: changed.length === 0,
  };
}

function normalizedDiagnostics(results: TrackResult[]) {
  return results
    .flatMap((r) => r.diagnostics)
    .map((row) => ({
      ...row,
      lowMeanContribution: row.lowMeanContribution ?? row.lowSuccessRate,
      mediumMeanContribution: row.mediumMeanContribution ?? row.mediumSuccessRate,
      highMeanContribution: row.highMeanContribution ?? row.highSuccessRate,
      lowSuccessRate: row.lowStrictSuccessRate,
      mediumSuccessRate: row.mediumStrictSuccessRate,
      highSuccessRate: row.highStrictSuccessRate,
    }));
}
function familyAssociations(results: TrackResult[], options: BenchmarkOptions) {
  const groups = new Map<
    string,
    {
      track: string;
      grade: string;
      profile: string;
      family: string;
      count: number;
      confirmed: number;
      boundary: number;
    }
  >();
  for (const result of results)
    for (const row of result.familyConditional) {
      const key = `${row.track}/${row.grade}/${row.profile}/${row.family}`;
      const group = groups.get(key) || {
        track: row.track,
        grade: row.grade,
        profile: row.profile,
        family: row.family,
        count: 0,
        confirmed: 0,
        boundary: 0,
      };
      group.count += row.exposedSessions;
      group.confirmed += Math.round(row.exposedSessions * row.conditionalConfirmationRate);
      group.boundary += row.boundaryUsage;
      groups.set(key, group);
    }
  return [...groups.values()].map((group) => {
    const cohort = results
      .find((r) => r.track === group.track)!
      .cohorts.find((c) => c.grade === group.grade && c.profile === group.profile)!;
    // Family rows are deduplicated from complete session paths, not summed model rows.
    if (group.count > cohort.sessions)
      throw new Error('Repeated family exposure invalidates conditional aggregation');
    const remaining = cohort.sessions - group.count;
    const unexposed =
      remaining > 0
        ? (Math.round(cohort.sessions * cohort.confirmationRate) - group.confirmed) / remaining
        : null;
    const exposed = group.confirmed / group.count;
    const difference = unexposed === null ? null : exposed - unexposed;
    return {
      track: group.track,
      grade: group.grade,
      profile: group.profile,
      family: group.family,
      exposedSessions: group.count,
      conditionalConfirmationRate: exposed,
      unexposedSessions: remaining,
      unexposedConfirmationRate: unexposed,
      associationDifference: difference,
      boundaryUsage: group.boundary,
      flags:
        group.count >= 20 &&
        difference !== null &&
        Math.abs(difference) > options.heuristicThresholds.peerDifficultyGap
          ? ['large-family-exposure-association']
          : [],
    };
  });
}

export function aggregateResults(
  results: TrackResult[],
  options: BenchmarkOptions,
  metamorphic: MetamorphicReport | null,
) {
  const cohorts = results.flatMap((r) => r.cohorts),
    diagnostics = normalizedDiagnostics(results),
    conditionals = results.flatMap((r) => r.modelConditional);
  const rates = (profile: string) =>
    Object.fromEntries(
      (['Junior', 'Middle', 'Senior'] as const).map((grade) => {
        const values = cohorts.filter((c) => c.profile === profile && c.grade === grade),
          count = values.reduce((s, c) => s + c.sessions, 0);
        return [
          grade,
          {
            sessions: count,
            confirmationRate: count
              ? values.reduce((s, c) => s + c.confirmationRate * c.sessions, 0) / count
              : null,
            boundaryRate: mean(values.map((c) => c.boundaryRate)),
            timeoutRate: mean(values.map((c) => c.timeoutRate)),
          },
        ];
      }),
    );
  const alarms: {
    track: string;
    profile: string;
    grade: string;
    alarm: string;
    observed: number;
    threshold: number | null;
    kind: string;
  }[] = [];
  for (const c of cohorts) {
    const add = (alarm: string, observed: number, threshold: number | null) =>
      alarms.push({
        track: c.track,
        profile: c.profile,
        grade: c.grade,
        alarm,
        observed,
        threshold,
        kind: 'heuristic validation threshold — not psychometric',
      });
    if (
      c.profile.startsWith('clear_') &&
      c.confirmationRate >= options.heuristicThresholds.unstableClearLower &&
      c.confirmationRate <= options.heuristicThresholds.unstableClearUpper
    )
      add(
        'unstable-clear-profile',
        c.confirmationRate,
        options.heuristicThresholds.unstableClearLower,
      );
    if (
      ['random_guesser', 'keyword_matcher', 'overengineer'].includes(c.profile) &&
      c.grade !== 'Junior' &&
      c.confirmationRate > options.heuristicThresholds.suspiciousAdversarialRate
    )
      add(
        'adversarial-confirmation',
        c.confirmationRate,
        options.heuristicThresholds.suspiciousAdversarialRate,
      );
    if (
      c.profile === 'clear_senior' &&
      c.grade === 'Middle' &&
      c.confirmationRate < options.heuristicThresholds.clearSeniorMiddleMinimum
    )
      add(
        'clear-senior-misses-middle',
        c.confirmationRate,
        options.heuristicThresholds.clearSeniorMiddleMinimum,
      );
    if (
      c.profile.startsWith('one_domain_specialist:') &&
      c.grade === 'Senior' &&
      c.confirmationRate > options.heuristicThresholds.narrowSpecialistSeniorRate
    )
      add(
        'narrow-specialist-confirms-senior',
        c.confirmationRate,
        options.heuristicThresholds.narrowSpecialistSeniorRate,
      );
    if (c.profile === 'memorizer') {
      const genuine = cohorts.find(
        (g) =>
          g.track === c.track &&
          g.grade === c.grade &&
          g.profile === (c.grade === 'Senior' ? 'clear_senior' : 'clear_middle'),
      )!;
      if (genuine.confirmationRate - c.confirmationRate < options.heuristicThresholds.memorizerGap)
        add(
          'memorizer-close-to-genuine',
          genuine.confirmationRate - c.confirmationRate,
          options.heuristicThresholds.memorizerGap,
        );
    }
    if (c.boundaryTargetingFailures)
      add('boundary-targeting-failure', c.boundaryTargetingFailures, 0);
  }
  const recovery = results.flatMap((r) => r.gradeRecovery),
    matrix: Record<string, Record<string, number>> = {};
  for (const row of recovery.filter((r) =>
    ['clear_junior', 'clear_middle', 'clear_senior'].includes(r.profile),
  )) {
    matrix[row.latentClass] ||= { NONE: 0, Junior: 0, Middle: 0, Senior: 0 };
    matrix[row.latentClass]![row.recoveredGrade]! += row.samples;
  }
  const totalRecovery = Object.values(matrix).reduce(
    (s, row) => s + Object.values(row).reduce((a, b) => a + b, 0),
    0,
  );
  const matchingRecovery = Object.entries(matrix).reduce(
    (s, [grade, row]) => s + (row[grade] || 0),
    0,
  );
  const exactViolations = metamorphic ? metamorphic.failures.length : null;
  const production = verifyProductionBaseline();
  return {
    label:
      'SIMULATION ONLY — accuracy relative to authored synthetic latent profiles, not real professional grades',
    phase: 'A — unchanged production baseline',
    benchmarkSeed: options.benchmarkSeed,
    syntheticPolicyVersion,
    generatorVersion,
    scoringVersion: 'information-2',
    gradeConfigurationVersions: Object.fromEntries(
      Object.entries(gradeConfigs).map(([grade, config]) => [grade, config.version]),
    ),
    blueprintVersions: Object.fromEntries(
      results.map((r) => [r.track, `${r.track}-generative-${getPack(r.track).version}`]),
    ),
    tracksTested: results.map((r) => r.track),
    targetGradesTested: ['Junior', 'Middle', 'Senior'],
    syntheticProfiles: results.map((r) => ({ track: r.track, profiles: r.profiles })),
    seedsPerProfileTargetTrack: options.seeds,
    itemSeedsPerSupportedModelGrade: options.itemSeeds,
    options,
    validationSourceHashes: Object.fromEntries(
      readdirSync('src/synthetic-validation')
        .filter((name) => name.endsWith('.ts'))
        .sort()
        .map((name) => [
          name,
          createHash('sha256')
            .update(readFileSync(`src/synthetic-validation/${name}`))
            .digest('hex'),
        ]),
    ),
    policyCoefficients,
    productionConfiguration: gradeConfigs,
    productionIntegrity: production,
    sessionsSimulated: results.reduce((s, r) => s + r.sessionsSimulated, 0),
    itemsAnswered: results.reduce((s, r) => s + r.itemsAnswered, 0),
    stepsAnswered: results.reduce((s, r) => s + r.answeredSteps, 0),
    generationFailures: results.flatMap((r) =>
      r.generationFailures.map((f) => ({ track: r.track, ...f })),
    ),
    simulationFailures: results.flatMap((r) =>
      r.simulationFailures.map((f) => ({ track: r.track, ...f })),
    ),
    confirmationRates: {
      clear_junior: rates('clear_junior'),
      clear_middle: rates('clear_middle'),
      clear_senior: rates('clear_senior'),
    },
    gradeRecovery: {
      label: 'SIMULATION ONLY',
      confusionMatrix: matrix,
      samples: totalRecovery,
      accuracyRelativeToSyntheticLatentProfiles: totalRecovery
        ? matchingRecovery / totalRecovery
        : null,
      borderlineResults: recovery.filter((r) => r.borderline),
    },
    monotonicityViolations: results.flatMap((r) => r.monotonicityViolations),
    gradeOrderingViolations: results.flatMap((r) => r.orderingViolations),
    boundaryRates: cohorts.map((c) => ({
      track: c.track,
      profile: c.profile,
      grade: c.grade,
      boundaryRate: c.boundaryRate,
      avgBoundaryItems: c.avgBoundaryItems,
      decisionChangeRate: c.boundaryDecisionChangeRate,
    })),
    boundaryConcentrationCorrelation: correlation(
      cohorts
        .filter(
          (c) =>
            !c.profile.includes(':') &&
            results.find((r) => r.track === c.track)!.profiles.find((p) => p.id === c.profile)!
              .order !== null,
        )
        .map((c) => [1 - Math.abs(c.confirmationRate - 0.5) * 2, c.boundaryRate]),
    ),
    randomGuesserResults: rates('random_guesser'),
    memorizerResults: rates('memorizer'),
    keywordMatcherResults: rates('keyword_matcher'),
    overengineerResults: rates('overengineer'),
    domainSpecialistResults: cohorts.filter((c) => c.profile.startsWith('one_domain_specialist:')),
    itemModelOutliers: diagnostics.filter((d) => d.flags.length),
    itemDiagnostics: diagnostics.length,
    itemDiagnosticTrials: diagnostics.length * options.itemSeeds * 3,
    itemDiagnosticForms: diagnostics.length * options.itemSeeds,
    productionChanges: [],
    productionBugsObserved: [],
    modelConditionalAssociations: conditionals.length,
    familyConditionalAssociations: familyAssociations(results, options).length,
    familyOutliers: familyAssociations(results, options).filter((row) => row.flags.length),
    lexicalCorrectnessCorrelations: results.map((r) => ({
      track: r.track,
      correlation: r.lexicalCorrectnessCorrelation,
    })),
    metamorphicFailures: exactViolations,
    metamorphic,
    seedInstability: {
      checks: results.reduce((s, r) => s + r.seedInstability.checks, 0),
      failures: results.reduce((s, r) => s + r.seedInstability.failures, 0),
    },
    engineeringAlarms: alarms,
    limitations: [
      'Synthetic personas and response-policy coefficients are authored assumptions; persona names do not calibrate abilities to product grades.',
      'No production cut/weights/grade profiles were tuned to simulation outcomes.',
      'Semantic oracle metadata and independent domain simulation are permitted in the simulator; therefore this does not model a real human reading natural language.',
      'Conditional model confirmation differences are exposure associations, not causal item effects; item selection and boundary are endogenous.',
      'Response times are simulated inputs, not human timing data.',
      'No fairness, wording naturalness, professional realism, empirical discrimination, IRT calibration or human grade accuracy is established.',
      'Finite seeds and mutation operators do not prove general cheating resistance.',
    ],
  };
}
function rate(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}
export function writeBenchmarkReport(
  results: TrackResult[],
  options: BenchmarkOptions,
  metamorphic: MetamorphicReport | null,
  reportPath?: string,
) {
  const summary = aggregateResults(results, options, metamorphic),
    out = options.output;
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/SUMMARY.json`, JSON.stringify(summary, null, 2) + '\n');
  const cohorts = results.flatMap((r) => r.cohorts),
    diagnostics = normalizedDiagnostics(results);
  writeCsv(
    `${out}/GRADE_CONFIRMATION_MATRIX.csv`,
    cohorts.map((c) => ({
      track: c.track,
      profile: c.profile,
      targetGrade: c.grade,
      sessions: c.sessions,
      confirmationRate: c.confirmationRate,
    })),
  );
  writeCsv(
    `${out}/GRADE_RECOVERY.csv`,
    results.flatMap((r) => r.gradeRecovery),
  );
  writeCsv(`${out}/PROFILE_RESULTS.csv`, cohorts);
  writeCsv(`${out}/ITEM_DIAGNOSTICS.csv`, diagnostics);
  writeCsv(
    `${out}/MODEL_CONDITIONAL_RESULTS.csv`,
    results.flatMap((r) => r.modelConditional),
  );
  writeCsv(`${out}/FAMILY_CONDITIONAL_RESULTS.csv`, familyAssociations(results, options));
  writeCsv(
    `${out}/BOUNDARY_BEHAVIOR.csv`,
    cohorts.map((c) => ({
      track: c.track,
      profile: c.profile,
      grade: c.grade,
      boundaryRate: c.boundaryRate,
      boundaryItemsUsed: c.boundaryItemsUsed,
      boundaryTargetDimensions: c.boundaryTargetDimensions,
      decisionChangeRateAfterBoundary: c.boundaryDecisionChangeRate,
      targetingFailures: c.boundaryTargetingFailures,
      avgCoreDurationMs: c.avgCoreDurationMs,
      avgBoundaryDurationMs: c.avgBoundaryDurationMs,
    })),
  );
  writeCsv(
    `${out}/VARIANT_STABILITY.csv`,
    cohorts.map((c) => ({
      track: c.track,
      profile: c.profile,
      grade: c.grade,
      sessions: c.sessions,
      confirmationRate: c.confirmationRate,
      decisionVariance: c.decisionVariance,
      scoreVariance: c.scoreVariance,
      dimensionVariance: c.dimensionVariance,
      variantStability: c.variantStability,
      timeoutRate: c.timeoutRate,
    })),
  );
  writeCsv(
    `${out}/DOMAIN_SPECIALIST_RESULTS.csv`,
    cohorts.filter((c) => c.profile.startsWith('one_domain_specialist:')),
  );
  writeCsv(
    `${out}/ADVERSARIAL_PROFILES.csv`,
    cohorts.filter(
      (c) =>
        results.find((r) => r.track === c.track)!.profiles.find((p) => p.id === c.profile)!
          .latentClass === 'adversarial',
    ),
  );
  writeCsv(`${out}/MONOTONICITY_VIOLATIONS.csv`, summary.monotonicityViolations, [
    'track',
    'grade',
    'weaker',
    'stronger',
    'difference',
  ]);
  writeCsv(`${out}/GRADE_ORDERING_VIOLATIONS.csv`, summary.gradeOrderingViolations, [
    'track',
    'profile',
    'lowerGrade',
    'higherGrade',
    'difference',
  ]);
  writeCsv(`${out}/MODEL_OUTLIERS.csv`, summary.itemModelOutliers);
  writeCsv(`${out}/ENGINEERING_ALARMS.csv`, summary.engineeringAlarms);
  if (metamorphic)
    writeFileSync(`${out}/METAMORPHIC_CHECKS.json`, JSON.stringify(metamorphic, null, 2) + '\n');
  const matrix = summary.gradeRecovery.confusionMatrix;
  const clearTable = Object.entries(summary.confirmationRates)
    .map(
      ([profile, grades]) =>
        `| ${profile} | ${rate(grades.Junior!.confirmationRate)} | ${rate(grades.Middle!.confirmationRate)} | ${rate(grades.Senior!.confirmationRate)} |`,
    )
    .join('\n');
  const recoveryTable = Object.entries(matrix)
    .map(
      ([latent, row]) =>
        `| ${latent} | ${row.NONE} | ${row.Junior} | ${row.Middle} | ${row.Senior} |`,
    )
    .join('\n');
  const table = (rows: CohortResult[]) =>
    rows
      .map(
        (c) =>
          `| ${c.profile} | ${c.grade} | ${c.sessions} | ${rate(c.confirmationRate)} | ${rate(c.boundaryRate)} | ${rate(c.timeoutRate)} | ${(c.avgDurationMs / 60000).toFixed(2)} |`,
      )
      .join('\n');
  const hardest = [...diagnostics]
      .sort((a, b) => a.highStrictSuccessRate - b.highStrictSuccessRate)
      .slice(0, 12),
    easiest = [...diagnostics]
      .sort((a, b) => b.lowStrictSuccessRate - a.lowStrictSuccessRate)
      .slice(0, 12);
  const itemTable = (rows: typeof diagnostics) =>
    rows
      .map(
        (d) =>
          `| ${d.track} | ${d.model} | ${d.grade} | ${d.band} | ${rate(d.lowStrictSuccessRate)} | ${rate(d.mediumStrictSuccessRate)} | ${rate(d.highStrictSuccessRate)} | ${d.syntheticStructuralDiscriminationProxy.toFixed(3)} | ${d.flags.join(', ')} |`,
      )
      .join('\n');
  const perTrack = results
    .map(
      (r) =>
        `## ${getPack(r.track).name} (${r.track})\n\n| Profile | Target | n | Confirmed | Boundary | Timeout | Minutes |\n|---|---|---:|---:|---:|---:|---:|\n${table(r.cohorts)}\n\nLexical overlap/correctness correlation: ${r.lexicalCorrectnessCorrelation?.toFixed(4) ?? 'undefined'}.\n`,
    )
    .join('\n');
  const adversarial = [
    'randomGuesserResults',
    'memorizerResults',
    'keywordMatcherResults',
    'overengineerResults',
  ] as const;
  const adversarialTable = adversarial
    .map(
      (key) =>
        `| ${key} | ${rate(summary[key].Junior!.confirmationRate)} | ${rate(summary[key].Middle!.confirmationRate)} | ${rate(summary[key].Senior!.confirmationRate)} |`,
    )
    .join('\n');
  const markdown = `# Synthetic Validation Report\n\n## Executive Summary\n\n**SIMULATION ONLY. Phase A — unchanged production baseline.**\n\nNamed latent-class agreement must be evaluated from this baseline: clear Junior confirms Junior in ${rate(summary.confirmationRates.clear_junior.Junior!.confirmationRate)} of the sampled runs; clear Middle confirms Middle in ${rate(summary.confirmationRates.clear_middle.Middle!.confirmationRate)}; clear Senior confirms Senior in ${rate(summary.confirmationRates.clear_senior.Senior!.confirmationRate)}. These are results of the frozen authored policy and current assessment together, not estimates of human accuracy. The simulator/persona mapping and compound response requirements require review before drawing a product-grade conclusion. No production scoring adjustment was made.\n\n${summary.sessionsSimulated.toLocaleString('en-US')} sessions, ${summary.itemsAnswered.toLocaleString('en-US')} completed items, ${summary.stepsAnswered.toLocaleString('en-US')} answered steps. ${results.length} tracks; Junior/Middle/Senior; ${options.seeds} seeds per profile × target × track. Every actual pack domain has a separate narrow specialist.\n\n- Monotonicity: ${summary.monotonicityViolations.length} observed adjacent-profile reversals. These are descriptive differences in finite samples, not statistical significance tests.\n- Target-grade ordering: ${summary.gradeOrderingViolations.length} observed reversals.\n- Clear profiles: see confirmation matrix below; persona names are hypotheses, not calibrated product-grade labels. Unexpected separation is retained.\n- Borderline personas: reported separately in GRADE_RECOVERY.csv, not counted as clear-class errors.\n- Seed stability: ${summary.seedInstability.failures}/${summary.seedInstability.checks} exact replay failures; generated-form decision variance remains visible in VARIANT_STABILITY.csv.\n- Boundary: correlation with observed cohort decision proximity = ${summary.boundaryConcentrationCorrelation?.toFixed(4) ?? 'undefined'}; targeting failures = ${cohorts.reduce((s, c) => s + c.boundaryTargetingFailures, 0)}. This correlation is descriptive.\n- Item diagnostics: ${diagnostics.length} supported model/grade rows; ${summary.itemModelOutliers.length} heuristic outlier rows.\n- Adversarial profiles and all specialists: rates below and per track. Low confirmation here is not proof against real cheating.\n- Metamorphic failures: ${summary.metamorphicFailures ?? 'not run'}; generation failures: ${summary.generationFailures.length}; simulation failures: ${summary.simulationFailures.length}.\n- Production integrity: ${summary.productionIntegrity.filesChecked} source files checked, ${summary.productionIntegrity.changed.length} changed. Production cut scores, weights, bands, grade profiles and scoring have not been tuned.\n- Real production bugs are asserted only for reproducible invariant failures; no adjustment is made merely to improve synthetic classification.\n\n## Target-grade confirmation matrix\n\n| Profile | Junior | Middle | Senior |\n|---|---:|---:|---:|\n${clearTable}\n\n## Grade recovery confusion matrix — SIMULATION ONLY\n\nHighest confirmed target across paired Junior/Middle/Senior sessions; NONE is kept explicitly.\n\n| Authored latent class | NONE | Junior | Middle | Senior |\n|---|---:|---:|---:|---:|\n${recoveryTable}\n\nAccuracy relative to predefined synthetic latent profiles: ${rate(summary.gradeRecovery.accuracyRelativeToSyntheticLatentProfiles)}. This is not accuracy for real specialists. Borderline personas are excluded from that calculation.\n\n## Adversarial baseline\n\n| Policy | Junior | Middle | Senior |\n|---|---:|---:|---:|\n${adversarialTable}\n\nONE_DOMAIN_SPECIALIST has one persona per real pack domain; full exposures, dimension coverage and rates are in DOMAIN_SPECIALIST_RESULTS.csv. Multidimensional diagnosis/judgment/adaptation profiles are listed in each track table.\n\n## Independent policy and non-circularity\n\nPolicy inputs are the candidate-visible step and an explicit allowlist: target competency dimension, difficulty dimensions, semantic intents, misconception classes, physical outcomes, evidence diagnostic properties and permitted plan values. Neither the profile latent class/order nor a full engine session is passed to policy. No production score, cut, uncertainty band, decision or weight enters its choices.\n\nLocal reliability is logistic(14 × (ability − challenge + bounded seeded noise)). Ability = 0.35 × local dimension + 0.35 × domain skill + 0.25 × relevant behaviour mean + 0.05 × consistency. Challenge = 0.24 + 0.045 × sum of six ordinal complexity increments + 0.08 for policy responsibility. Coefficients are authored validation-only assumptions, frozen before baseline.\n\nEvery alternative gets a probability weight: reliability × exp(12 × (semantic utility − 1)) + (1 − reliability) × misconception susceptibility. This is a mixture over all available actions, not a grade comparison or deterministic correct-answer threshold. Physical simulator checks and minimal-edit contracts describe plan semantics independently of production accepted-plan snapshots. Senior choices use actual action consequences, feasibility and declared priorities. Plans, causal choices and evidence selection can fail independently.\n\nEvidence opening is weighted by diagnostic value, discrimination and symptom preference. Falsification produces hypothesis revision telemetry. Weak adaptation retains previous decisions probabilistically. Keyword policy uses lexical overlap; overengineer uses semantic cost/complexity; random sampling ignores semantic fitness. Memorizer prefers recurring named techniques and retains plans after mutation.\n\nTime = base step time × complexity modifier × profile speed × bounded seeded variation. The engine enforces its original deadline. Timings are authored simulation inputs. Core and boundary duration are separated.\n\n## Paired seeds and engineering alarms\n\nAll personas see the same frozen generated form at one track/grade/seed and start with empty responses/evidence/contributions. Each uses deterministic keyed action draws. J/M/S recovery uses the same paired assessment seed. Full engine/API-level flow is exercised; no browser is used per synthetic session. Raw compact outcomes and action digests are in tracks/*/SESSION_RESULTS.jsonl.gz; replayable action traces for the first seed are in ACTION_TRACES.json.\n\n${summary.engineeringAlarms.length} heuristic alarms. Thresholds are configurable in CONFIG.json and are **heuristic validation thresholds**, not psychometric thresholds. Unfavourable rates, ordering reversals and hard/easy models remain in the baseline. Conditional final-confirmation differences are exposure associations, not causal item effects. Family exposure associations are separately reported in FAMILY_CONDITIONAL_RESULTS.csv; ${summary.familyOutliers.length} rows cross the configured heuristic gap.\n\n## Item diagnostics\n\nEach supported ItemModel/grade receives ${options.itemSeeds} distinct seeded forms and low/medium/high profiles, rotating measured dimensions. Success rates below are strict complete-item success; CSV also includes mean observed contribution values. SyntheticStructuralDiscriminationProxy = P(strict success | high) − P(strict success | low). It is not empirical psychometric discrimination.\n\nHardest rows by high-profile strict success:\n\n| Track | Model | Target | Band | Low | Medium | High | Proxy | Flags |\n|---|---|---|---|---:|---:|---:|---:|---|\n${itemTable(hardest)}\n\nEasiest rows by low-profile strict success:\n\n| Track | Model | Target | Band | Low | Medium | High | Proxy | Flags |\n|---|---|---|---|---:|---:|---:|---:|---|\n${itemTable(easiest)}\n\n## Metamorphic coverage\n\nIncidental checks: ${metamorphic?.incidentalMutationsChecked ?? 0}; preservation failures: ${metamorphic?.groundTruthPreservationFailures ?? 'not run'}. Causal checks: ${metamorphic?.causalMutationsChecked ?? 0}; expected-change failures: ${metamorphic?.expectedChangeFailures ?? 'not run'}. Constraint checks: ${metamorphic?.constraintMutationsChecked ?? 0}; strategy-change rate: ${rate(metamorphic?.strategyChangeRate ?? null)}. Option permutations: ${metamorphic?.optionOrderChecks ?? 0}/${metamorphic?.optionOrderFailures ?? 'not run'} failures; artifact permutations: ${metamorphic?.artifactOrderChecks ?? 0}/${metamorphic?.artifactOrderFailures ?? 'not run'} failures.\n\nMutation operators declare preserve/change/mayChange. Causal replacement uses another valid authored causal configuration. Priority changes require a competing feasible strategy; tighter cost budgets may preserve or change the optimum. Invalid budgets are rejected. Full-pipeline option/control and non-causal artifact permutations compare actions, scores and decisions. This is finite structural coverage, not exhaustive proof.\n\n${perTrack}\n## Limitations and unchanged unexpected results\n\n${summary.limitations.map((s) => `- ${s}`).join('\n')}\n\nThe policy can misrepresent an intended Junior/Middle/Senior ability distribution. Low recovery or a misplaced boundary pattern must first be investigated as an interaction between authored simulator assumptions and production behaviour. No cut-score lowering, reweighting or grade-profile adjustment is justified by this benchmark alone. Existing mass generation, grade-support audit, transfer checks, legacy validation and adaptive validation remain separate, preserved checks.\n\nVersion manifest: benchmark seed ${options.benchmarkSeed}; ${syntheticPolicyVersion}; ${generatorVersion}; scoring information-2. Machine-readable outputs and configuration are in ${out}.\n`;
  writeFileSync(`${out}/REPORT.md`, markdown);
  if (reportPath) {
    mkdirSync('docs', { recursive: true });
    writeFileSync(reportPath, markdown);
  }
  return summary;
}
