import type { Grade, LabControl, LabData, LabRow, Plan, Question } from '../domain.js';
export interface LabResult {
  metrics: Record<string, number>;
  checks: Record<string, boolean>;
  explanation: string;
  trace?: string[];
}
export interface Theory {
  prompt: string;
  scenario?: string;
  options: string[];
  correct: number;
  skill: string;
}
export interface Fixture {
  data: LabData;
  changedData: LabData;
  controls: LabControl[];
  theory: Theory[];
  contract: string;
  change: string;
  rubric: string[];
}
export interface Family {
  id: string;
  trackId: string;
  title: string;
  skills: string[];
  build: (grade: Grade, seed: number) => Fixture;
  run: (data: LabData, plan: Plan) => LabResult;
}

/** Constructs a constrained option control with a deliberately neutral initial value. */
export function select(
  id: string,
  label: string,
  values: [string, string][],
  help = '',
): LabControl {
  return {
    id,
    label,
    help,
    type: 'select',
    options: values.map(([value, text]) => ({ value, label: text })),
    values: [],
    initial: values[0]![0],
  };
}
/** Constructs a numeric control over a bounded, explicitly enumerated search space. */
export function numeric(id: string, label: string, values: number[], help = ''): LabControl {
  return { id, label, help, type: 'number', options: [], values, initial: values[0]! };
}
/** Builds a multi-select decision with bounded combinatorial complexity. */
export function multi(
  id: string,
  label: string,
  values: [string, string][],
  help = '',
): LabControl {
  return { ...select(id, label, values, help), type: 'multiselect', initial: [] };
}
/** Reads a finite numeric fixture value and rejects malformed data. */
export function num(row: LabRow | LabData['parameters'], key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Нет числового поля ${key}`);
  return value;
}
/** Reads an enumerated plan decision. */
export function choice(plan: Plan, key: string): string {
  const value = plan[key];
  if (typeof value !== 'string') throw new Error(`Выберите ${key}`);
  return value;
}
/** Reads a bounded numeric plan decision. */
export function value(plan: Plan, key: string): number {
  const item = plan[key];
  if (typeof item !== 'number' || !Number.isFinite(item)) throw new Error(`Задайте ${key}`);
  return item;
}
/** Computes an arithmetic mean for a nonempty sample. */
export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : 0;
}
/** Computes an empirical nearest-rank quantile. */
export function quantile(values: number[], q: number): number {
  return [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(q * values.length) - 1)] ?? 0;
}
/** Maps the requested grade to controlled scenario complexity. */
export function level(grade: Grade): number {
  return grade === 'Junior' ? 1 : grade === 'Middle' ? 2 : 3;
}
/** Validates every plan field against the actual case schema before evaluating it. */
export function validatePlan(controls: LabControl[], plan: Plan): void {
  if (Object.keys(plan).some((key) => !controls.some((control) => control.id === key)))
    throw new Error('План содержит неизвестные параметры');
  for (const control of controls) {
    const item = plan[control.id];
    if (control.type === 'number') {
      if (typeof item !== 'number' || !control.values.includes(item))
        throw new Error(`Недопустимое значение: ${control.label}`);
    } else if (control.type === 'select') {
      if (typeof item !== 'string' || !control.options.some((option) => option.value === item))
        throw new Error(`Выберите: ${control.label}`);
    } else if (
      !Array.isArray(item) ||
      item.length !== new Set(item).size ||
      item.some((entry) => !control.options.some((option) => option.value === entry))
    )
      throw new Error(`Неверный набор: ${control.label}`);
  }
}
function alternatives(control: LabControl): (string | number | string[])[] {
  if (control.type === 'number') return control.values;
  if (control.type === 'select') return control.options.map((option) => option.value);
  if (control.options.length > 6) throw new Error('Слишком много многозначных решений');
  return Array.from({ length: 2 ** control.options.length }, (_, mask) =>
    control.options.filter((_option, index) => mask & (1 << index)).map((option) => option.value),
  );
}
/** Enumerates the finite plan space to prove that generated constraints have a feasible solution. */
export function solve(
  family: Family,
  fixture: Fixture,
  data: LabData,
): { reference: Plan; mutants: Plan[]; feasible: number } {
  let plans: Plan[] = [{}];
  for (const control of fixture.controls) {
    plans = plans.flatMap((plan) =>
      alternatives(control).map((item) => ({ ...plan, [control.id]: item })),
    );
    if (plans.length > 4096) throw new Error('Пространство планов превышает лимит');
  }
  let reference: Plan | undefined;
  const rejected: Plan[] = [];
  let feasible = 0;
  for (const plan of plans) {
    const result = family.run(data, plan);
    if (
      !Object.keys(result.checks).length ||
      Object.values(result.metrics).some((metric) => !Number.isFinite(metric))
    )
      throw new Error(`${family.id}: некорректная проверка`);
    if (Object.values(result.checks).every(Boolean)) {
      reference ??= plan;
      feasible++;
    } else if (rejected.length < 10) rejected.push(plan);
  }
  if (!reference || !rejected.length)
    throw new Error(`${family.id}: нет допустимых или ошибочных решений`);
  // Single-decision counterexamples expose specific faults rather than only a universally bad plan.
  const mutants: Plan[] = [];
  for (const control of fixture.controls)
    for (const alternative of alternatives(control)) {
      const mutant = { ...reference, [control.id]: alternative };
      if (!Object.values(family.run(data, mutant).checks).every(Boolean) && mutants.length < 8)
        mutants.push(mutant);
    }
  return { reference, mutants: mutants.length ? mutants : rejected.slice(0, 3), feasible };
}
/** Builds theory questions while preserving their independently authored correct answers. */
export function makeQuestions(
  theory: Theory[],
  answers: Record<string, string>,
  rng: () => number,
): Question[] {
  return theory.map((item, index) => {
    const id = `q${index + 1}`;
    const options = item.options.map((text, option) => ({
      text,
      correct: option === item.correct,
    }));
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [options[i], options[j]] = [options[j]!, options[i]!];
    }
    answers[id] = String(options.findIndex((option) => option.correct));
    return {
      id,
      prompt: item.prompt,
      ...(item.scenario ? { scenario: item.scenario } : {}),
      skill: item.skill,
      points: 20 / theory.length,
      options: options.map((option, position) => ({ id: String(position), text: option.text })),
    };
  });
}
