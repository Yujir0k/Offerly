import { randomUUID } from 'node:crypto';
import { random } from './random.js';
import type { Experiment, ExperimentInput, Variant } from './domain.js';
import { runSpecialized } from './families/registry.js';

function classification(
  variant: Variant,
  input: ExperimentInput,
): Omit<Experiment, 'id' | 'stage' | 'input' | 'at'> {
  const fields = Object.keys(variant.rows[0]?.values ?? {});
  const selected = input.features;
  if (
    !selected?.length ||
    selected.length > 3 ||
    new Set(selected).size !== selected.length ||
    selected.some((field) => !fields.includes(field))
  )
    throw new Error('Выберите от одного до трёх существующих признаков');
  if (!['random', 'time', 'group'].includes(input.split ?? ''))
    throw new Error('Неизвестное разбиение');
  const shuffled = [...variant.rows];
  if (input.split === 'random') {
    const rng = random(variant.seed + 77);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
  }
  const cut = Math.floor(shuffled.length * 0.75);
  const train =
    input.split === 'group' ? shuffled.filter((row) => row.group < 4) : shuffled.slice(0, cut);
  const test =
    input.split === 'group' ? shuffled.filter((row) => row.group >= 4) : shuffled.slice(cut);
  const means = selected.map(
    (field) => train.reduce((sum, row) => sum + row.values[field]!, 0) / train.length,
  );
  const deviations = selected.map(
    (field, index) =>
      Math.sqrt(
        train.reduce((sum, row) => sum + (row.values[field]! - means[index]!) ** 2, 0) /
          train.length,
      ) || 1,
  );
  const coefficients = selected.map(() => 0);
  let intercept = 0;
  for (let iteration = 0; iteration < 140; iteration++) {
    const gradient = selected.map(() => 0);
    let bias = 0;
    for (const row of train) {
      const values = selected.map(
        (field, index) => (row.values[field]! - means[index]!) / deviations[index]!,
      );
      const prediction =
        1 /
        (1 +
          Math.exp(
            -intercept -
              values.reduce((sum, value, index) => sum + value * coefficients[index]!, 0),
          ));
      const error = prediction - row.label;
      bias += error;
      values.forEach((value, index) => {
        gradient[index]! += value * error;
      });
    }
    intercept -= (0.18 * bias) / train.length;
    coefficients.forEach((value, index) => {
      coefficients[index] = value - 0.18 * (gradient[index]! / train.length + 0.002 * value);
    });
  }
  let correct = 0;
  let positiveCorrect = 0;
  let positive = 0;
  for (const row of test) {
    const value =
      intercept +
      selected.reduce(
        (sum, field, index) =>
          sum + ((row.values[field]! - means[index]!) / deviations[index]!) * coefficients[index]!,
        0,
      );
    const predicted = value >= 0 ? 1 : 0;
    if (row.label === 1) {
      positive++;
      if (predicted === 1) positiveCorrect++;
    }
    if (predicted === row.label) correct++;
  }
  return {
    metrics: {
      accuracy: correct / test.length,
      recall: positiveCorrect / (positive || 1),
      trainRows: train.length,
      testRows: test.length,
    },
    checks: {
      availableFeatures: !selected.includes(variant.oracle.leakedFeature),
      representativeSplit: input.split === variant.oracle.requiredSplit,
      reproducible: true,
    },
    explanation:
      'Логистическая регрессия действительно обучена на выбранных признаках. Высокая метрика не подтверждает доступность признаков при внедрении.',
  };
}

function retrieval(
  variant: Variant,
  input: ExperimentInput,
): Omit<Experiment, 'id' | 'stage' | 'input' | 'at'> {
  if (
    !['all', 'current', 'current-abstain'].includes(input.policy ?? '') ||
    !Number.isInteger(input.topK) ||
    input.topK! < 1 ||
    input.topK! > 5
  )
    throw new Error('Выберите политику и topK от 1 до 5');
  let correct = 0;
  let answeredKnown = 0;
  let refused = 0;
  for (const query of variant.queries) {
    const words = query.text.toLowerCase().match(/[а-яёa-z]+/g) ?? [];
    const ranked = variant.documents
      .filter((document) => input.policy === 'all' || document.current)
      .map((document, index) => {
        const tokens = new Set(document.text.toLowerCase().match(/[а-яёa-z]+/g) ?? []);
        return { document, index, score: words.filter((word) => tokens.has(word)).length };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, input.topK);
    const first = ranked[0];
    const answer =
      input.policy === 'current-abstain' && (!first || first.score === 0)
        ? null
        : (first?.document.id ?? null);
    if (query.expectedId !== null && answer !== null) answeredKnown++;
    if (query.expectedId === null && answer === null) refused++;
    if (answer === query.expectedId) correct++;
  }
  const known = variant.queries.filter((query) => query.expectedId !== null).length;
  const unknown = variant.queries.length - known;
  return {
    metrics: {
      accuracy: correct / variant.queries.length,
      coverage: answeredKnown / known,
      abstention: refused / unknown,
      retrievalUnits: input.topK! * variant.queries.length,
    },
    checks: {
      currentSources: input.policy !== 'all' && correct >= known,
      unknownHandled: refused === unknown,
      costControlled: input.topK! <= 3,
    },
    explanation:
      'Измерены совпадение актуального источника, покрытие и отказы. Это retrieval-симуляция, а не измерение качества генерации LLM.',
  };
}

function events(
  variant: Variant,
  input: ExperimentInput,
  stage: number,
): Omit<Experiment, 'id' | 'stage' | 'input' | 'at'> {
  if (!['arrival', 'dedupe', 'versioned'].includes(input.strategy ?? ''))
    throw new Error('Неизвестная стратегия');
  const stream =
    stage === 2 ? [...variant.events].reverse().concat(variant.events.slice(0, 5)) : variant.events;
  const state = new Map<string, { version: number; value: number }>();
  const seen = new Set<string>();
  let applied = 0;
  for (const event of stream) {
    if (input.strategy !== 'arrival' && seen.has(event.id)) continue;
    seen.add(event.id);
    if (input.strategy === 'versioned' && (state.get(event.entity)?.version ?? -1) >= event.version)
      continue;
    state.set(event.entity, event);
    applied++;
  }
  const expected = new Map<string, { version: number; value: number }>();
  for (const event of variant.events)
    if ((expected.get(event.entity)?.version ?? -1) < event.version)
      expected.set(event.entity, event);
  const correct = [...expected].filter(
    ([entity, event]) => state.get(entity)?.value === event.value,
  ).length;
  return {
    metrics: {
      correctObjects: correct,
      objects: expected.size,
      accuracy: correct / expected.size,
      appliedEvents: applied,
    },
    checks: {
      idempotent: input.strategy !== 'arrival',
      orderIndependent: input.strategy === 'versioned',
      latestState: correct === expected.size,
    },
    explanation:
      'Поток реально воспроизведён. На следующем этапе порядок событий меняется и добавляются повторы.',
  };
}

/** Runs a bounded deterministic experiment; arbitrary candidate code is never executed. */
export function runExperiment(variant: Variant, input: ExperimentInput, stage: number): Experiment {
  if (variant.lab) {
    if (!input.plan) throw new Error('Передайте план эксперимента');
    const output = runSpecialized(variant, input.plan, stage);
    return { id: randomUUID(), stage, input, ...output, at: new Date().toISOString() };
  }
  const changed =
    stage === 2 && variant.rows.length
      ? {
          ...variant,
          rows: variant.rows.map((row) => ({
            ...row,
            values: Object.fromEntries(
              Object.entries(row.values).map(([key, value]) => [
                key,
                key === variant.oracle.validFeatures[0] &&
                row.time >= Math.floor(variant.rows.length * 0.75)
                  ? value * 1.8 + 0.7
                  : value,
              ]),
            ),
          })),
        }
      : stage === 2 && variant.documents.length
        ? {
            ...variant,
            queries: [
              ...variant.queries,
              { text: 'Как устроено обслуживание спутников?', expectedId: null },
            ],
          }
        : variant;
  const output = changed.rows.length
    ? classification(changed, input)
    : changed.documents.length
      ? retrieval(changed, input)
      : events(changed, input, stage);
  return { id: randomUUID(), stage, input, ...output, at: new Date().toISOString() };
}
