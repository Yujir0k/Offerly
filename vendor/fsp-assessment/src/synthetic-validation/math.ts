import { createHash } from 'node:crypto';
import { random } from '../random.js';
export const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
export const variance = (values: number[]) =>
  mean(values.map((value) => (value - mean(values)) ** 2));
export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const logistic = (value: number) => 1 / (1 + Math.exp(-value));
export function seedOf(...values: unknown[]): number {
  return createHash('sha256').update(JSON.stringify(values)).digest().readUInt32LE();
}
export function seededNoise(seed: number, bound: number): number {
  return (random(seed)() * 2 - 1) * bound;
}
export function weightedChoice<T>(values: T[], weights: number[], seed: number): T {
  if (
    !values.length ||
    values.length !== weights.length ||
    weights.some((w) => !Number.isFinite(w) || w < 0)
  )
    throw new Error('Invalid sampling distribution');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return values[Math.floor(random(seed)() * values.length)]!;
  let draw = random(seed)() * sum;
  for (let index = 0; index < values.length; index++) {
    draw -= weights[index]!;
    if (draw <= 0) return values[index]!;
  }
  return values.at(-1)!;
}
export function correlation(pairs: [number, number][]): number | null {
  if (pairs.length < 3) return null;
  const x = mean(pairs.map((p) => p[0])),
    y = mean(pairs.map((p) => p[1]));
  const denominator = Math.sqrt(
    pairs.reduce((s, p) => s + (p[0] - x) ** 2, 0) * pairs.reduce((s, p) => s + (p[1] - y) ** 2, 0),
  );
  return denominator ? pairs.reduce((s, p) => s + (p[0] - x) * (p[1] - y), 0) / denominator : null;
}

/** Pure canonicalizer keeps the policy independent of production validator imports. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
