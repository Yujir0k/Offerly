import { randomUUID } from 'node:crypto';
import { random } from '../random.js';
import type { Grade, LabData, Plan, ToolMode, Variant } from '../domain.js';
import { makeQuestions, solve, validatePlan, type Family, type LabResult } from './core.js';
import { mlFamilies } from './ml.js';
import { engineeringFamilies } from './engineering.js';
import { extendedTheory } from './theory.js';

export const families: Family[] = [...mlFamilies, ...engineeringFamilies];
/** Returns metadata only; generators and answer plans never enter the public catalog. */
export function familyCatalog() {
  return families.map((family) => ({
    id: family.id,
    trackId: family.trackId,
    title: family.title,
    skills: family.skills,
    version: '2.1.0',
    status: 'technical' as const,
  }));
}
/** Resolves a supported, role-specific family. */
export function getFamily(id: string): Family {
  const family = families.find((item) => item.id === id);
  if (!family) throw new Error('Неизвестное семейство');
  return family;
}
/** Chooses a family by requirements and weights without an LLM. */
export function chooseFamily(
  trackId: string,
  required: string[] = [],
  weights: Record<string, number> = {},
  allowedIds?: string[],
): string {
  const available = families.filter(
    (family) =>
      family.trackId === trackId && (!allowedIds?.length || allowedIds.includes(family.id)),
  );
  if (!available.length) throw new Error('Нет семейства для выбранной специализации');
  return available
    .map((family) => ({
      family,
      score: family.skills.reduce(
        (sum, skill) => sum + (weights[skill] ?? 0) + (required.includes(skill) ? 10 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.family.id.localeCompare(b.family.id))[0]!.family.id;
}
/** Generates a complete specialized case and proves feasibility separately for each stage. */
export function generateSpecialized(
  trackId: string,
  grade: Grade,
  seed: number,
  mode: ToolMode,
  familyId?: string,
): Variant {
  const available = families.filter((family) => family.trackId === trackId);
  const family = familyId ? getFamily(familyId) : available[seed % available.length];
  if (!family || family.trackId !== trackId)
    throw new Error('Семейство не относится к выбранной специализации');
  const fixture = family.build(grade, seed);
  const main = solve(family, fixture, fixture.data);
  const changed = solve(family, fixture, fixture.changedData);
  const answers: Record<string, string> = {};
  const rng = random(seed + 311);
  const healthy = seed % 4 === 0;
  const proposed = healthy ? main.reference : main.mutants[seed % main.mutants.length]!;
  const theory = extendedTheory(family, fixture, random(seed + 719));
  return {
    id: randomUUID(),
    familyId: family.id,
    version: '2.1.0',
    seed,
    trackId,
    grade,
    title: family.title,
    status: 'technical',
    context:
      'Исследуйте данные, проверьте предложенный план и предъявите воспроизводимые доказательства. Можно принять корректный план или исправить ошибочный. Профессиональный уровень остаётся предварительным до человеческой калибровки.',
    questions: makeQuestions(theory, answers, rng),
    artifacts: [
      { name: 'contract.md', content: fixture.contract },
      { name: 'proposed-plan.json', content: JSON.stringify(proposed, null, 2) },
      { name: 'acceptance-rubric.md', content: fixture.rubric.join('\n') },
      {
        name: 'working-notes.md',
        content:
          'Данные и parameters доступны в лаборатории и скачиваемом JSON. Эксперимент выполняет алгоритм сценария, считает метрики и проверяет контракт. Приведите обоснование решения, ограничения и следующий шаг.',
      },
    ],
    rows: [],
    documents: [],
    queries: [],
    events: [],
    lab: {
      kind: family.id,
      controls: fixture.controls,
      data: fixture.data,
      change: fixture.change,
      measuredSkills: family.skills,
      rubric: fixture.rubric,
    },
    oracle: {
      answers,
      leakedFeature: '',
      validFeatures: [],
      requiredSplit: '',
      eventStrategy: '',
      retrievalPolicy: '',
      specialized: {
        referencePlans: [main.reference, changed.reference],
        mutants: [main.mutants, changed.mutants],
        changedData: fixture.changedData,
      },
    },
    stageModes: ['closed', mode, 'docs'],
    complexity: {
      steps: theory.length + fixture.controls.length + 2,
      defects: healthy
        ? 0
        : Object.values(family.run(fixture.data, proposed).checks).filter((check) => !check).length,
      distractors: fixture.controls.reduce(
        (sum, control) => sum + Math.max(0, control.options.length - 1),
        0,
      ),
      rows: fixture.data.rows.length,
    },
  };
}
/** Evaluates a finite, schema-checked plan against the actual data of the active stage. */
export function runSpecialized(variant: Variant, plan: Plan, stage: number): LabResult {
  if (!variant.lab || !variant.oracle.specialized || ![1, 2].includes(stage))
    throw new Error('Практический этап не открыт');
  validatePlan(variant.lab.controls, plan);
  const input: LabData = stage === 2 ? variant.oracle.specialized.changedData : variant.lab.data;
  const result = getFamily(variant.lab.kind).run(input, plan);
  if (
    !Object.keys(result.checks).length ||
    Object.values(result.metrics).some((metric) => !Number.isFinite(metric))
  )
    throw new Error('Ошибка проверяющей процедуры');
  return result;
}
