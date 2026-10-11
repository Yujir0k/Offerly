import { readFileSync } from 'node:fs';
import { generateItem, generatorVersion } from './generator.js';
import { getPack, getItemModel } from './packs.js';
import { validateGeneratedItem } from './validators.js';
import type { GeneratedItem } from './model.js';
import type { TargetGrade } from '../adaptive/model.js';
import { defaultBand, reasoningGrade } from './difficulty.js';

const fallbackCache = new Map<string, GeneratedItem[]>();
// Runtime memory policy only: original seed, generation, validation and scoring stay unchanged.
// Holding pools for all 36 track/grade pairs exceeded a 1 GiB production heap.
const maxFallbackCacheKeys = 2;
export function fallbackCacheSize(): number { return fallbackCache.size; }
/** Create validated snapshots before they can be used as a generation fallback. */
export function validatedFallbackPool(packId: string, grade: TargetGrade): GeneratedItem[] {
  const key = `${packId}:${grade}:${generatorVersion}`;
  const cached = fallbackCache.get(key);
  if (cached) {
    fallbackCache.delete(key);
    fallbackCache.set(key, cached);
    return cached;
  }
  const pack = getPack(packId);
  const items: GeneratedItem[] = [];
  let seed = 18181;
  for (const model of pack.itemModels)
    if (!model.gradeRange || model.gradeRange.includes(grade))
      for (const stage of model.stages) {
        if (
          (pack.stageRequirements?.[stage] || []).some(
            (capability) => !model.capabilities?.includes(capability),
          )
        )
          continue;
        const ds =
          stage === 'incident'
            ? (['diagnosis'] as const)
            : stage === 'review'
              ? (['correctness'] as const)
              : model.measuredDimensions;
        for (const dimension of ds)
          for (const band of stage === 'anchors'
            ? [
                ...new Set(
                  pack.assessmentRecipes?.[grade]?.anchorBands || [defaultBand(grade, stage)],
                ),
              ]
            : stage === 'boundary'
              ? pack.assessmentRecipes?.[grade]?.boundaryBands || [defaultBand(grade, stage)]
              : [defaultBand(grade, stage)])
            if (!model.gradeConfigurations || model.gradeRange?.includes(reasoningGrade(band)))
              for (let i = 0; i < 2; i++) {
                try {
                  items.push(
                    generateItem(
                      pack,
                      model,
                      grade,
                      stage,
                      dimension,
                      seed++,
                      'fallback',
                      undefined,
                      band,
                    ),
                  );
                } catch {
                  /* An invalid generated candidate is never published. */
                }
              }
      }
  fallbackCache.set(key, items);
  while (fallbackCache.size > maxFallbackCacheKeys) fallbackCache.delete(fallbackCache.keys().next().value!);
  return items;
}
/** Read a trusted local pool, checking every snapshot before admitting it to runtime. */
export function loadGeneratedPool(path: string): GeneratedItem[] {
  const body = JSON.parse(readFileSync(path, 'utf8')) as
    { items?: GeneratedItem[] } | GeneratedItem[];
  const items = Array.isArray(body) ? body : body.items;
  if (!items) throw new Error('Pool должен содержать items');
  for (const item of items) {
    const pack = getPack(item.specialization);
    if (
      item.generated?.generatorVersion !== generatorVersion ||
      item.generated.packVersion !== pack.version
    )
      throw new Error('Pool version несовместим с runtime');
    const issues = validateGeneratedItem(
      item,
      getItemModel(pack.id, item.generated.itemModelId),
      pack,
    );
    if (issues.length)
      throw new Error(`Невалидный pool item: ${issues.map((i) => i.gate).join(', ')}`);
  }
  return items;
}
