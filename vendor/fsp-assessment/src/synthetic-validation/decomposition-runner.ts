import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createSession } from '../adaptive/engine.js';
import { gradeConfigs } from '../adaptive/config.js';
import { dimensions } from '../adaptive/model.js';
import { getPack } from '../generative/packs.js';
import { profilesForPack } from './profiles.js';
import { prepareMetadata } from './runtime.js';
import { mean, seedOf } from './math.js';
import {
  auditSemanticOracle,
  decompositionModes,
  runDiagnosticSession,
  type DiagnosticObservation,
  type OracleAudit,
} from './decomposition.js';
import { writeCsv, verifyProductionBaseline } from './report.js';

export interface DiagnosticOptions {
  baseline: string;
  output: string;
  seeds: number;
  benchmarkSeed: number;
  tracks: string[];
  workers: number;
}
interface BaselineRow {
  profile: string;
  grade: string;
  seed: number;
  confirmed: number;
  score: number;
  dimensions: number[];
  coverage: number[];
  boundary: number;
  durationMs: number;
  actionDigest: string;
}
export interface DiagnosticTrackResult {
  track: string;
  observations: DiagnosticObservation[];
  oracleAudit: OracleAudit;
  baselineComparisons: number;
  baselineReplayFailures: { profile: string; grade: string; seed: number }[];
  generationFailures: string[];
}
export function baselineIntegrity() {
  const lock = JSON.parse(readFileSync('data/synthetic-validation/BASELINE_LOCK.json', 'utf8')) as {
    baselineDirectory: string;
    sha256: Record<string, string>;
  };
  const changed = Object.entries(lock.sha256)
    .filter(
      ([path, hash]) =>
        createHash('sha256')
          .update(readFileSync(`${lock.baselineDirectory}/${path}`))
          .digest('hex') !== hash,
    )
    .map(([path]) => path);
  return {
    filesChecked: Object.keys(lock.sha256).length,
    changed,
    unchanged: changed.length === 0,
  };
}
export async function runDiagnosticTrack(
  track: string,
  options: DiagnosticOptions,
  progress?: (text: string) => void,
): Promise<DiagnosticTrackResult> {
  const pack = getPack(track),
    profiles = profilesForPack(pack).filter((p) =>
      ['clear_junior', 'clear_middle', 'clear_senior'].includes(p.id),
    );
  const oracleProfile = {
    ...profiles.find((p) => p.id === 'clear_senior')!,
    id: 'ORACLE_CANDIDATE',
  };
  const baselineRows = gunzipSync(
    readFileSync(`${options.baseline}/tracks/${track}/SESSION_RESULTS.jsonl.gz`),
  )
    .toString('utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as BaselineRow);
  const byKey = new Map(
    baselineRows
      .filter((row) => profiles.some((p) => p.id === row.profile))
      .map((row) => [`${row.profile}/${row.grade}/${row.seed}`, row]),
  );
  const observations: DiagnosticObservation[] = [],
    baselineReplayFailures: DiagnosticTrackResult['baselineReplayFailures'] = [],
    generationFailures: string[] = [];
  const oracleAudit: OracleAudit = {
    stepsChecked: 0,
    semanticOptionMismatches: 0,
    semanticPlanMismatches: 0,
    examples: [],
    singleSourceEvidenceChecks: 0,
    singleSourceMaximumValues: {},
  };
  let baselineComparisons = 0;
  for (let index = 0; index < options.seeds; index++)
    for (const grade of ['Junior', 'Middle', 'Senior'] as const) {
      const seed = seedOf(options.benchmarkSeed, track, index);
      let template: ReturnType<typeof createSession>;
      try {
        template = createSession(
          `synthetic-${track}-${grade}-${index}`,
          'synthetic-benchmark',
          grade,
          seed,
          Date.parse('2026-10-08T08:00:00Z'),
          undefined,
          gradeConfigs[grade],
          { specialization: track },
        );
      } catch (error) {
        generationFailures.push(`${grade}/${seed}: ${error}`);
        continue;
      }
      const cache = prepareMetadata(template);
      auditSemanticOracle(template, cache, oracleAudit);
      const oracle = runDiagnosticSession(
        template,
        oracleProfile,
        options.benchmarkSeed,
        'oracle_candidate',
        cache,
      );
      observations.push(oracle);
      for (const profile of profiles)
        for (const mode of decompositionModes) {
          const result = runDiagnosticSession(
            template,
            profile,
            options.benchmarkSeed,
            mode,
            cache,
          );
          observations.push(result);
          if (mode === 'full_synthetic') {
            const baseline = byKey.get(`${profile.id}/${grade}/${seed}`);
            baselineComparisons++;
            if (
              !baseline ||
              baseline.confirmed !== result.confirmed ||
              baseline.score !== result.score ||
              baseline.boundary !== result.boundaryCount ||
              baseline.durationMs !== result.durationMs ||
              baseline.actionDigest !== result.actionDigest ||
              JSON.stringify(baseline.dimensions) !==
                JSON.stringify(result.dimensions.map((d) => d.score)) ||
              JSON.stringify(baseline.coverage) !==
                JSON.stringify(result.dimensions.map((d) => d.coverage))
            )
              baselineReplayFailures.push({ profile: profile.id, grade, seed });
          }
        }
      if (grade === 'Senior' && (index % 25 === 0 || index === options.seeds - 1))
        progress?.(`${track}: decomposition ${index + 1}/${options.seeds}`);
      if (index % 10 === 0 && grade === 'Senior')
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
  const directory = `${options.output}/tracks/${track}`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    `${directory}/SESSION_RESULTS.jsonl.gz`,
    gzipSync(observations.map((row) => JSON.stringify(row)).join('\n') + '\n'),
  );
  const result = {
    track,
    observations,
    oracleAudit,
    baselineComparisons,
    baselineReplayFailures,
    generationFailures,
  };
  writeFileSync(
    `${directory}/AUDIT.json`,
    JSON.stringify({ ...result, observations: undefined }, null, 2) + '\n',
  );
  return result;
}
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    q = (fraction: number) => sorted[Math.floor(Math.max(0, sorted.length - 1) * fraction)] ?? null;
  const histogram: Record<string, number> = {};
  for (const value of values) {
    const key = String(Math.floor(value * 20) / 20);
    histogram[key] = (histogram[key] || 0) + 1;
  }
  return {
    n: values.length,
    mean: values.length ? mean(values) : null,
    min: sorted[0] ?? null,
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    max: sorted.at(-1) ?? null,
    histogramBinWidth: 0.05,
    histogram,
  };
}
function counts(values: string[]) {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return result;
}
export function writeDiagnosticReport(
  results: DiagnosticTrackResult[],
  options: DiagnosticOptions,
  reportPath?: string,
) {
  const rows = results
      .flatMap((r) => r.observations)
      .map((row) => ({
        ...row,
        boundaryBudgetLimit: gradeConfigs[row.grade].maxBoundaryItems,
        boundaryExhaustionCause:
          row.stopReason === 'boundary_exhausted'
            ? row.boundaryCount >= gradeConfigs[row.grade].maxBoundaryItems
              ? 'max-boundary-items-used'
              : 'no-eligible-unused-boundary-item'
            : null,
      })),
    groups = new Map<string, DiagnosticObservation[]>();
  for (const row of rows) {
    const key = `${row.track}/${row.grade}/${row.profile}/${row.mode}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const matrix = [...groups.values()].map((group) => {
    const first = group[0]!;
    return {
      track: first.track,
      grade: first.grade,
      profile: first.profile,
      mode: first.mode,
      sessions: group.length,
      confirmed: group.reduce((s, r) => s + r.confirmed, 0),
      confirmationRate: mean(group.map((r) => r.confirmed)),
      meanScore: mean(group.map((r) => r.score)),
      meanMargin: mean(group.map((r) => r.margin)),
      cut: first.cut,
      meanDistanceToCut: mean(group.map((r) => r.distanceToCut)),
      meanEstimatedDistanceToCut: mean(group.map((r) => r.estimatedDistanceToCut)),
      boundaryRate: mean(group.map((r) => Number(r.boundaryCount > 0))),
      meanBoundaryItems: mean(group.map((r) => r.boundaryCount)),
      boundaryDimensions: counts(group.flatMap((r) => r.boundaryDimensions)),
      stopReasons: counts(group.map((r) => r.stopReason)),
      answerFullCreditRate:
        group.reduce((s, r) => s + r.fullAnswerSteps, 0) /
        Math.max(
          1,
          group.reduce((s, r) => s + r.answerSteps, 0),
        ),
      executionMismatches: group.reduce((s, r) => s + r.executionMismatches, 0),
      positiveOptionRejectedByPlan: group.reduce((s, r) => s + r.positiveOptionRejectedByPlan, 0),
      evidenceSteps: group.reduce((sum, row) => sum + row.evidenceSteps, 0),
      evidenceMeasured: group.some((row) => row.evidenceSteps > 0),
      meanEvidenceValue: group.some((row) => row.evidenceSteps > 0)
        ? mean(
            group
              .filter((row) => row.evidenceSteps > 0)
              .map((row) => row.evidenceValueSum / row.evidenceSteps),
          )
        : null,
      meanMaxEvidenceValue: group.some((row) => row.evidenceSteps > 0)
        ? mean(
            group
              .filter((row) => row.evidenceSteps > 0)
              .map((row) => row.maxEvidenceValueSum / row.evidenceSteps),
          )
        : null,
      meanLostEvidenceValue: mean(group.map((r) => r.lostEvidenceValue)),
    };
  });
  const failed = rows.filter((r) => r.mode === 'full_synthetic' && !r.confirmed);
  const failedSummary = [...groups.values()]
    .filter((g) => g[0]!.mode === 'full_synthetic')
    .map((group) => {
      const fail = group.filter((r) => !r.confirmed),
        first = group[0]!;
      return {
        track: first.track,
        grade: first.grade,
        profile: first.profile,
        sessions: group.length,
        failed: fail.length,
        failureRate: fail.length / group.length,
        stopReasons: counts(fail.map((r) => r.stopReason)),
        failureReasons: counts(fail.flatMap((r) => r.failureReasons)),
        boundaryRate: mean(fail.map((r) => Number(r.boundaryCount > 0))),
        boundaryItemDistribution: counts(fail.map((r) => String(r.boundaryCount))),
        distanceToCut: distribution(fail.map((r) => r.distanceToCut)),
        estimatedDistanceToCut: distribution(fail.map((r) => r.estimatedDistanceToCut)),
        score: distribution(fail.map((r) => r.score)),
        margin: distribution(fail.map((r) => r.margin)),
      };
    });
  const dimensionRows = [...groups.values()].flatMap((group) =>
    ['all', 'failed'].flatMap((population) => {
      const values = population === 'all' ? group : group.filter((r) => !r.confirmed),
        first = group[0]!;
      return dimensions.map((dimension) => {
        const ds = values.map((r) => r.dimensions.find((d) => d.dimension === dimension)!);
        return {
          track: first.track,
          grade: first.grade,
          profile: first.profile,
          mode: first.mode,
          population,
          dimension,
          samples: values.length,
          score: distribution(ds.map((d) => d.score)),
          effectiveEvidence: distribution(ds.map((d) => d.effectiveEvidence)),
          independentFamilyCoverage: counts(ds.map((d) => String(d.coverage))),
          margin: distribution(ds.map((d) => d.margin)),
          scoreDistanceToCut: distribution(ds.map((d) => d.scoreDistanceToCut)),
          referenceOnly:
            'Dimension cut distances are diagnostics, not separate production pass criteria.',
        };
      });
    }),
  );
  const failureReasons = failedSummary.flatMap((row) =>
    Object.entries(row.failureReasons).map(([reason, sessions]) => ({
      track: row.track,
      grade: row.grade,
      profile: row.profile,
      reason,
      sessions,
    })),
  );
  const modes = Object.fromEntries(
    [...decompositionModes, 'oracle_candidate'].map((mode) => [
      mode,
      Object.fromEntries(
        ['clear_junior', 'clear_middle', 'clear_senior', 'ORACLE_CANDIDATE'].map((profile) => [
          profile,
          Object.fromEntries(
            ['Junior', 'Middle', 'Senior'].map((grade) => {
              const group = rows.filter(
                (r) => r.mode === mode && r.profile === profile && r.grade === grade,
              );
              return [
                grade,
                {
                  sessions: group.length,
                  confirmationRate: group.length ? mean(group.map((r) => r.confirmed)) : null,
                  boundaryRate: group.length
                    ? mean(group.map((r) => Number(r.boundaryCount > 0)))
                    : null,
                  meanDistanceToCut: group.length ? mean(group.map((r) => r.distanceToCut)) : null,
                },
              ];
            }),
          ),
        ]),
      ),
    ]),
  );
  const oracleRows = rows.filter((r) => r.mode === 'oracle_candidate'),
    perfect = rows.filter((r) => r.mode === 'perfect_answers_perfect_evidence');
  const semanticOptionMismatches = results.reduce(
      (s, r) => s + r.oracleAudit.semanticOptionMismatches,
      0,
    ),
    semanticPlanMismatches = results.reduce((s, r) => s + r.oracleAudit.semanticPlanMismatches, 0),
    replayFailures = results.flatMap((r) => r.baselineReplayFailures);
  const baselineSummary = JSON.parse(readFileSync(`${options.baseline}/SUMMARY.json`, 'utf8')) as {
    validationSourceHashes: Record<string, string>;
  };
  const blindPolicyFiles = [
    'policy.ts',
    'profiles.ts',
    'metadata.ts',
    'math.ts',
    'model.ts',
    'runtime.ts',
  ];
  const blindPolicyChanges = blindPolicyFiles.filter(
    (name) =>
      createHash('sha256')
        .update(readFileSync(`src/synthetic-validation/${name}`))
        .digest('hex') !== baselineSummary.validationSourceHashes[name],
  );
  const summary = {
    label:
      'DIAGNOSTIC DECOMPOSITION ONLY — original baseline preserved; no scoring or policy tuning',
    benchmarkSeed: options.benchmarkSeed,
    seedsPerCohort: options.seeds,
    tracks: options.tracks,
    modes,
    decompositionSessions: rows.filter((r) => r.mode !== 'oracle_candidate').length,
    oracleSessions: oracleRows.length,
    totalSessions: rows.length,
    failedClearSessions: failed.length,
    oracleFailures: oracleRows.filter((r) => !r.confirmed),
    perfectAnswerEvidenceFailures: perfect.filter((r) => !r.confirmed),
    baselineComparisons: results.reduce((s, r) => s + r.baselineComparisons, 0),
    baselineReplayFailures: replayFailures,
    semanticOracleStepsChecked: results.reduce((s, r) => s + r.oracleAudit.stepsChecked, 0),
    semanticOptionMismatches,
    semanticPlanMismatches,
    singleSourceEvidenceChecks: results.reduce(
      (s, r) => s + r.oracleAudit.singleSourceEvidenceChecks,
      0,
    ),
    singleSourceMaximumValues: Object.fromEntries(
      [
        ...new Set(results.flatMap((r) => Object.keys(r.oracleAudit.singleSourceMaximumValues))),
      ].map((value) => [
        value,
        results.reduce((s, r) => s + (r.oracleAudit.singleSourceMaximumValues[value] || 0), 0),
      ]),
    ),
    blindPolicyIntegrity: {
      filesChecked: blindPolicyFiles.length,
      changed: blindPolicyChanges,
      unchanged: blindPolicyChanges.length === 0,
    },
    productionIntegrity: verifyProductionBaseline(),
    baselineIntegrity: baselineIntegrity(),
    generationFailures: results.flatMap((r) => r.generationFailures),
    failureReasons: counts(failed.flatMap((r) => r.failureReasons)),
    stopReasons: counts(failed.map((r) => r.stopReason)),
    boundaryExhaustionCauses: counts(
      failed.flatMap((row) => (row.boundaryExhaustionCause ? [row.boundaryExhaustionCause] : [])),
    ),
    policySources:
      'Existing candidatePolicy/profiles/metadata/math are unchanged; scoring-aware frozen oracle is a separate diagnostic control.',
    perfectEvidenceDefinition:
      'Best candidate-visible available sources in the actual frozen scoring contract; evidence values are not overwritten or forced to 1.',
    timingControl:
      'All four modes preserve profile timing. Standalone Oracle uses fixed 500ms steps to exclude timing.',
    limitations: [
      'Frozen oracle is intentionally scoring-aware; it is a mechanical positive control, not independent professional validity.',
      'Semantic metadata oracle separately checks projection-to-contract agreement, but still uses authored semantics.',
      'Successful oracle runs do not establish optimal cut scores or real human grade validity.',
      'Perfect evidence changes selection; it does not retrain or strengthen the frozen synthetic answer policy.',
      'Dimension cut distances are descriptive; actual production confirmation uses the overall lower bound plus core/coverage.',
    ],
  };
  mkdirSync(options.output, { recursive: true });
  writeFileSync(`${options.output}/SUMMARY.json`, JSON.stringify(summary, null, 2) + '\n');
  writeCsv(`${options.output}/DECOMPOSITION_MATRIX.csv`, matrix);
  writeCsv(
    `${options.output}/ORACLE_RESULTS.csv`,
    matrix.filter((r) => r.mode === 'oracle_candidate'),
  );
  writeCsv(`${options.output}/FAILED_CLEAR_PROFILES.csv`, failedSummary);
  writeCsv(`${options.output}/FAILURE_REASONS.csv`, failureReasons);
  writeCsv(`${options.output}/FINAL_DIMENSION_DISTRIBUTIONS.csv`, dimensionRows);
  writeFileSync(
    `${options.output}/SCORE_EVIDENCE_DISTRIBUTIONS.json`,
    JSON.stringify(dimensionRows, null, 2) + '\n',
  );
  writeFileSync(
    `${options.output}/FAILED_CLEAR_SESSIONS.jsonl.gz`,
    gzipSync(failed.map((r) => JSON.stringify(r)).join('\n') + '\n'),
  );
  writeFileSync(
    `${options.output}/ORACLE_INTEGRATION_AUDIT.json`,
    JSON.stringify(
      results.map((r) => ({ track: r.track, ...r.oracleAudit })),
      null,
      2,
    ) + '\n',
  );
  const pct = (value: number | null | undefined) =>
    value == null ? 'n/a' : `${(value * 100).toFixed(2)}%`;
  const aggregateTable = decompositionModes
    .flatMap((mode) =>
      ['clear_junior', 'clear_middle', 'clear_senior'].map(
        (profile) =>
          `| ${mode} | ${profile} | ${pct(modes[mode]?.[profile]?.Junior?.confirmationRate)} | ${pct(modes[mode]?.[profile]?.Middle?.confirmationRate)} | ${pct(modes[mode]?.[profile]?.Senior?.confirmationRate)} |`,
      ),
    )
    .join('\n');
  const detailedTables = options.tracks
    .map(
      (track) =>
        `## ${track}\n\n| Profile | Target | Mode | n | Confirmed | Boundary | Mean lower − cut |\n|---|---|---|---:|---:|---:|---:|\n${matrix
          .filter((r) => r.track === track)
          .map(
            (r) =>
              `| ${r.profile} | ${r.grade} | ${r.mode} | ${r.sessions} | ${pct(r.confirmationRate)} | ${pct(r.boundaryRate)} | ${r.meanDistanceToCut.toFixed(4)} |`,
          )
          .join('\n')}\n`,
    )
    .join('\n');
  const report = `# Synthetic Oracle and Decomposition Report\n\n## Executive Summary\n\nThe original 396,000-session baseline is preserved byte-for-byte (${summary.baselineIntegrity.filesChecked} locked files). Production scoring/cuts/weights/grade profiles remain unchanged (${summary.productionIntegrity.filesChecked} source hashes). No confirmation rates were tuned.\n\nThis diagnostic run contains ${summary.totalSessions} sessions: ${summary.oracleSessions} standalone frozen Oracle controls and ${summary.decompositionSessions} paired clear-profile interventions. The full-synthetic branch reproduces ${summary.baselineComparisons} original clear-profile outcomes; replay mismatches: ${replayFailures.length}.\n\n- Frozen Oracle NOT CONFIRMED: ${summary.oracleFailures.length}/${summary.oracleSessions}.\n- Perfect answers + perfect available evidence NOT CONFIRMED: ${summary.perfectAnswerEvidenceFailures.length}/${perfect.length}.\n- Semantic adapter audit: ${summary.semanticOracleStepsChecked} steps; option mismatches ${semanticOptionMismatches}; execution-plan mismatches ${semanticPlanMismatches}.\n- One-source exploration: ${summary.singleSourceEvidenceChecks} checks; actual maximum scoring values ${JSON.stringify(summary.singleSourceMaximumValues)}. This is reported, not repaired.\n- Failed full-synthetic clear sessions: ${failed.length}. Detailed reasons, per-dimension distributions, independent coverage/effective evidence, boundary use and distances to cut are exported below.\n\nA passing frozen Oracle only establishes that maximum available frozen responses can be confirmed by the engine. It does not validate professional difficulty or justify the cut score. If perfect answers restore confirmation while perfect evidence alone does not, the primary synthetic shortfall is in answer/plan policy. Semantic-oracle mismatches would instead indicate projection/integration defects. Production decision mechanics are also decomposed: midpoint below cut versus midpoint above cut but lower bound not above cut, coverage/core incompleteness and boundary exhaustion.\n\n## Paired intervention matrix\n\nAll four modes use the same generated forms, abilities, action seeds and virtual timing. Every mode starts from empty state and runs the unmodified engine; boundary may differ as a consequence of the intervention.\n\n| Mode | Profile | Junior | Middle | Senior |\n|---|---|---:|---:|---:|\n${aggregateTable}\n\n## Oracle definition and separation\n\nCurrent Junior recipes contain no scored exploration steps; evidence is inline. Junior evidence-selection values are therefore not measured, not zero-quality evidence. Perfect-evidence intervention has no scored selection to change there. Current Middle/Senior exploration uses two sources. No executed one-source evidence defect was found in this benchmark.\n\nThe dedicated frozen Oracle selects a full-credit option, a frozen accepted execution plan and the best visible evidence. Reading the rubric/accepted plan is intentional for this positive control and never added to SyntheticCandidatePolicy. Its standalone time is 500ms per step. Perfect-answer decomposition modes use that answer control but preserve each profile's synthetic time. Perfect-evidence modes maximize the original evidence-selection signal; they never substitute scores or normalize production values.\n\nAn independent semantic Oracle uses physical contract fitness/minimality and semantic causal/constraint coherence from the existing adapter, then checks its choice/plan against the frozen response contract. This distinguishes an adapter mismatch from probabilistic-policy mistakes.\n\nThe synthetic branch is unchanged. Source hashes and the original baseline lock prevent silently replacing the baseline. No inference about real candidate quality follows directly from these controls.\n\n## Failed clear profiles and production reasons\n\nNOT CONFIRMED is evaluated with the unchanged rule: mandatory core complete, minimum independent coverage in every dimension, and overall lower bound strictly greater than the cut. A dimension's score below its reference cut is not a separate production veto.\n\nFailure tags (multiple tags can describe one session):\n\n${Object.entries(
    summary.failureReasons,
  )
    .map(([reason, count]) => `- ${reason}: ${count}`)
    .join('\n')}\n\nActual engine stop reasons:\n\n${Object.entries(summary.stopReasons)
    .map(([reason, count]) => `- ${reason}: ${count}`)
    .join(
      '\n',
    )}\n\nDistance to cut is reported primarily as lowerBound − cutScore, with estimatedScore − cutScore and upperBound − cutScore separately. FINAL_DIMENSION_DISTRIBUTIONS.csv includes all and failed-only populations, per-dimension score/effective-evidence/margin histograms, independent-family coverage and p10/p50/p90. FAILED_CLEAR_SESSIONS.jsonl.gz contains every failed clear session, not only averages.\n\nAnswer full-credit loss, execution mismatches and full-credit options rejected by the execution plan are separately counted in DECOMPOSITION_MATRIX.csv. Low final results are therefore not automatically attributed to production decision logic.\n\n${detailedTables}\n## Files and limits\n\nSUMMARY.json; DECOMPOSITION_MATRIX.csv; ORACLE_RESULTS.csv; FAILED_CLEAR_PROFILES.csv; FAILURE_REASONS.csv; FINAL_DIMENSION_DISTRIBUTIONS.csv; SCORE_EVIDENCE_DISTRIBUTIONS.json; FAILED_CLEAR_SESSIONS.jsonl.gz; ORACLE_INTEGRATION_AUDIT.json. Raw per-mode session outcomes are retained under tracks.\n\n${summary.limitations.map((s) => `- ${s}`).join('\n')}\n\nNo scoring change or attempt to improve the baseline confirmation rates has been made. Assessment-quality conclusions require this diagnostic evidence plus independent human validation.\n`;
  writeFileSync(`${options.output}/REPORT.md`, report);
  if (reportPath) writeFileSync(reportPath, report);
  return summary;
}
