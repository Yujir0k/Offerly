import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateBlueprint, generateItem, type GenerationAudit } from './generator.js';
import { getPack } from './packs.js';
import type { ExposureRecord, GeneratedItem } from './model.js';
import type { TargetGrade } from '../adaptive/model.js';
import { questionFingerprint } from './validators.js';

/** Synthetic issuance ledger for structural generator validation, not a human pilot. */
export function observeGeneratedItems(
  items: GeneratedItem[],
  exposure: ExposureRecord[],
  sessionId: string,
  userId: string,
): void {
  for (const item of items)
    exposure.push({
      specialization: item.specialization,
      targetGrade: item.targetGrade,
      itemModelId: item.generated.itemModelId,
      siblingGroup: item.generated.siblingGroup,
      itemModelExposureCount:
        1 + exposure.filter((e) => e.itemModelId === item.generated.itemModelId).length,
      familyExposureCount:
        1 + exposure.filter((e) => e.siblingGroup === item.generated.siblingGroup).length,
      variantExposureCount:
        1 +
        exposure.filter((e) => e.surfaceFingerprint === item.generated.surfaceFingerprint).length,
      semanticFingerprint: item.generated.semanticFingerprint,
      surfaceFingerprint: item.generated.surfaceFingerprint,
      questionFingerprints: item.steps.map((step) =>
        questionFingerprint(item, step, getPack(item.specialization)),
      ),
      userId,
      sessionId,
      lastUsedAt: new Date(
        Date.parse('2026-10-06T08:00:00Z') + exposure.length * 1000,
      ).toISOString(),
    });
}
function distribution(values: string[]) {
  return Object.fromEntries(
    [...new Set(values)].sort().map((key) => [key, values.filter((v) => v === key).length]),
  );
}
/** Exercise whole blueprints with persistent exposure, plus optional generated-pool batches. */
export function massGenerate(
  packId: string,
  grade: TargetGrade,
  sessionCount = 100,
  itemCount = 0,
  seed = 1,
) {
  const pack = getPack(packId);
  const exposure: ExposureRecord[] = [];
  const items: GeneratedItem[] = [];
  const audit: GenerationAudit = {
    candidates: 0,
    passed: 0,
    rejected: 0,
    issuesByGate: {},
    exposureRejected: 0,
    blueprintRejected: 0,
  };
  const eligibleModels = pack.itemModels.filter(
    (model) => !model.gradeRange || model.gradeRange.includes(grade),
  );
  const boundaryDimensions: string[] = [];
  const sessions: {
    seed: number;
    models: string[];
    radicals: unknown[];
    fingerprints: string[];
    domains: string[];
  }[] = [];
  const failures: string[] = [];
  let duplicateRegenerations = 0;
  for (let i = 0; i < sessionCount; i++) {
    try {
      const blueprint = generateBlueprint(grade, seed + i, {
        specialization: packId,
        userId: `simulation-user-${i % 20}`,
        exposure,
        audit,
      });
      items.push(...blueprint.items);
      sessions.push({
        seed: seed + i,
        models: blueprint.items.map((v) => v.generated.itemModelId),
        radicals: blueprint.items.map((v) => v.generated.worldState.radicals),
        fingerprints: blueprint.items.map((v) => v.generated.semanticFingerprint),
        domains: [
          ...new Set(
            blueprint.items.flatMap(
              (i) =>
                pack.itemModels.find((m) => m.id === i.generated.itemModelId)!.competencyDomains ||
                [],
            ),
          ),
        ],
      });
      boundaryDimensions.push(...blueprint.boundaryPool.map((i) => i.steps[0]!.rubric.dimension));
      observeGeneratedItems(blueprint.items, exposure, `sim-${i}`, `simulation-user-${i % 20}`);
    } catch (e) {
      failures.push(String(e));
    }
  }
  let nextSeed = seed + 100000;
  while (items.length < itemCount) {
    const index = items.length;
    const model = eligibleModels[index % eligibleModels.length]!;
    const stage = model.stages[Math.floor(index / eligibleModels.length) % model.stages.length]!;
    const dimension =
      stage === 'incident'
        ? 'diagnosis'
        : stage === 'review'
          ? 'correctness'
          : model.measuredDimensions[Math.floor(index / 3) % model.measuredDimensions.length]!;
    try {
      const generated = generateItem(
        pack,
        model,
        grade,
        stage,
        dimension,
        nextSeed++,
        'on-demand',
        audit,
      );
      if (
        items.some((i) => i.generated.surfaceFingerprint === generated.generated.surfaceFingerprint)
      ) {
        duplicateRegenerations++;
        if (duplicateRegenerations > itemCount + 100) break;
      } else items.push(generated);
    } catch (e) {
      failures.push(String(e));
      if (failures.length > 100) break;
    }
  }
  const surface = new Set(items.map((i) => i.generated.surfaceFingerprint));
  const semantic = new Set(items.map((i) => i.generated.semanticFingerprint));
  const lengths = items.flatMap((i) => i.steps.flatMap((s) => s.options.map((o) => o.text.length)));
  const gradeIndex = ['Junior', 'Middle', 'Senior'].indexOf(grade);
  const radicalConfigurations = eligibleModels.reduce(
    (sum, m) =>
      sum +
      m.cases.filter(
        (c) =>
          ['Junior', 'Middle', 'Senior'].indexOf(c.minimumGrade || 'Junior') <= gradeIndex &&
          ['Junior', 'Middle', 'Senior'].indexOf(c.maximumGrade || 'Senior') >= gradeIndex,
      ).length *
        pack.worldBounds[grade].workers.length *
        (grade === 'Senior' ? 4 : 1),
    0,
  );
  return {
    items,
    sessions,
    report: {
      label: 'DETERMINISTIC GENERATOR VALIDATION / SIMULATION — no human calibration',
      pack: packId,
      grade,
      requestedSessions: sessionCount,
      generatedSessions: sessions.length,
      generated: items.length,
      validationPassed: items.length,
      validationFailed: failures.length,
      audit,
      failures,
      duplicateRate: items.length ? 1 - surface.size / items.length : 0,
      duplicateRegenerations,
      semanticReuseRate: items.length ? 1 - semantic.size / items.length : 0,
      itemModelDistribution: distribution(items.map((i) => i.generated.itemModelId)),
      difficultyDistribution: distribution(items.map((i) => i.difficultyBand)),
      domainCoverage: distribution(
        items.flatMap(
          (i) =>
            pack.itemModels.find((m) => m.id === i.generated.itemModelId)!.competencyDomains || [],
        ),
      ),
      sessionDomainCoverage: distribution(sessions.flatMap((s) => s.domains)),
      boundaryPoolDimensionDistribution: distribution(boundaryDimensions),
      boundaryItemDistribution: distribution(
        items.filter((i) => i.stage === 'boundary').map((i) => i.steps[0]!.rubric.dimension),
      ),
      optionLengthDistribution: distribution(
        lengths.map((length) =>
          length < 50
            ? '<50'
            : length < 100
              ? '50-99'
              : length < 150
                ? '100-149'
                : length < 200
                  ? '150-199'
                  : '200+',
        ),
      ),
      dimensionDistribution: distribution(
        items.flatMap((i) => i.steps.map((s) => s.rubric.dimension)),
      ),
      averageOptionLength: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0,
      exposureDistribution: distribution(exposure.map((e) => e.itemModelId)),
      capacity: {
        radicalConfigurations,
        visibleIncidentalCombinations: 4 * 6 * 4 * 3,
        seededSimulatorModels: eligibleModels.filter((model) =>
          model.capabilities?.includes('executable-work-sample'),
        ).length,
        semanticCapacityStatus: pack.presentation ? 'not-enumerated' : 'categorical-estimate',
        note: pack.presentation
          ? 'Categorical case counts only. Seeded numerical simulator states are not enumerated; incidental combinations are a legacy estimate and do not measure this pack capacity. Use observed semantic reuse, not the product of these counts, to assess variation.'
          : 'Configured formal states and visible names/wording; excludes nonce IDs and timestamps. Product is an upper bound on combinations, not proof of equally difficult or unique rendered questions.',
      },
    },
  };
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
/** Static evaluator preview; answer metadata is explicit and never served to candidates. */
export function writePreview(path: string, items: GeneratedItem[], sample = 50): void {
  mkdirSync(dirname(path), { recursive: true });
  const cards = items
    .slice(0, sample)
    .map(
      (i, index) =>
        `<article><h2>${index + 1}. ${escape(i.generated.itemModelId)} · ${i.targetGrade} · ${i.stage}</h2><p>${escape(i.generated.groundTruth.hazard)}</p>${i.steps
          .filter((s) => !s.exploration)
          .map(
            (s) =>
              `<h3>${escape(s.prompt)}</h3><pre>${escape(s.context)}</pre><ol>${s.options.map((o) => `<li class="${s.rubric.scores[o.id] === 1 ? 'best' : ''}">${escape(o.text)} <small>rubric: ${s.rubric.scores[o.id]}</small></li>`).join('')}</ol>`,
          )
          .join(
            '',
          )}<details><summary>WorldState / artifacts</summary><pre>${escape(JSON.stringify({ world: i.generated.worldState, artifacts: i.artifacts }, null, 2))}</pre></details></article>`,
    )
    .join('');
  writeFileSync(
    path,
    `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Generated items — evaluator preview</title><style>body{font:16px system-ui;background:#f6f4fb;color:#252136;max-width:1100px;margin:40px auto;padding:20px}article{background:white;padding:28px;border-radius:16px;margin-bottom:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}li{padding:12px;margin:10px 0;border:1px solid #ddd}.best{background:#e9f5eb}small{color:#675}</style><h1>Evaluator preview — simulation</h1><p>Авторские модели; качество для людей требует экспертного review и пилота. Подсветка ответов только в этом evaluator artifact.</p>${cards}</html>`,
  );
}
