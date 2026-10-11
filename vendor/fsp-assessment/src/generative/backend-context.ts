import { select } from '../families/core.js';
import { random } from '../random.js';
import type { TargetGrade } from '../adaptive/model.js';
import type { FormalCase, ItemModel, WorldState } from './model.js';
import * as legacy from './legacy-world.js';
import * as rendering from './legacy-render.js';
import { humanObservation, humanReasoning } from './narrative.js';

interface OperationContext {
  caseId: string;
  healthy: boolean;
}
const grades: TargetGrade[] = ['Junior', 'Middle', 'Senior'];
const contexts = (world: WorldState): OperationContext[] =>
  JSON.parse(String(world.radicals.failure.operationContexts));
const eligible = (model: ItemModel, grade: TargetGrade) =>
  model.cases.filter(
    (entry) => grades.indexOf(entry.minimumGrade || 'Junior') <= grades.indexOf(grade),
  );
function primary(world: WorldState): WorldState {
  const copy = structuredClone(world);
  delete copy.radicals.failure.operationContexts;
  return copy;
}
function addContexts(model: ItemModel, world: WorldState, seed: number): WorldState {
  const rng = random(seed ^ 0x49ace);
  const choices = eligible(model, world.grade);
  const operations = Array.from(
    { length: world.grade === 'Junior' ? 1 + ((seed >>> 4) % 2) : 2 + ((seed >>> 4) % 2) },
    () => ({
      caseId: choices[Math.floor(rng() * choices.length)]!.id,
      healthy: rng() < 0.4,
    }),
  );
  const primaryCase = model.cases.find((entry) => entry.predicate(world.radicals.failure))!;
  operations[0] = { caseId: primaryCase.id, healthy: false };
  world.radicals.interactingFailures = operations.filter((entry) => !entry.healthy).length;
  world.radicals.failure.operationContexts = JSON.stringify(operations);
  return world;
}

/** Add independent operational contexts whose repairs depend on actual authored Backend facts. */
export function withBackendContexts(model: ItemModel): ItemModel {
  const lookup = (entry: OperationContext): FormalCase =>
    model.cases.find((candidate) => candidate.id === entry.caseId)!;
  return {
    ...model,
    version: '5.0.0',
    availableArtifacts: [...new Set([...(model.availableArtifacts || []), 'table' as const])],
    code: (world) => model.code(primary(world)),
    runtime: {
      createWorld: (pack, current, grade, seed) =>
        addContexts(current, legacy.buildWorld(pack, current, grade, seed), seed),
      mutateWorld: (current, world, seed) =>
        addContexts(current, legacy.mutateWorld(current, primary(world), seed), seed),
      deriveTruth: (current, world) => legacy.deriveGroundTruth(current, primary(world)),
      createIntents: (current, world, kind, seed) =>
        legacy.buildIntents(current, primary(world), kind, seed),
      topology: legacy.worldTopology,
      semanticState(world) {
        return {
          primary: primary(world).radicals,
          operations: contexts(world).map((entry) => ({
            healthy: entry.healthy,
            facts: lookup(entry).facts,
          })),
          grade: world.grade,
        };
      },
      responseTask(current, world) {
        const operations = contexts(world);
        return {
          task: {
            title: 'План для независимых операций',
            instructions:
              'В таблице «Независимые операции» приведены отдельные контексты. Для каждого выберите локальное исправление по его наблюдениям. Для операции, выполняющей контракт, сохраните поведение. Единое исправление для всех операций может нарушить работающий контракт.',
            controls: operations.map((_entry, index) =>
              select(`operation${index + 1}`, `Операция ${index + 1}`, [
                ['keep', 'Сохранить текущее поведение'],
                ...eligible(current, world.grade).map((entry): [string, string] => [
                  entry.id,
                  humanReasoning(entry.repair),
                ]),
              ]),
            ),
          },
          accepted: [
            Object.fromEntries(
              operations.map((entry, index) => [
                `operation${index + 1}`,
                entry.healthy ? 'keep' : entry.caseId,
              ]),
            ),
          ],
        };
      },
      createArtifacts(current, world, truth) {
        const original = rendering.generateArtifacts(current, primary(world), truth);
        const existing = original.find((artifact) => artifact.type === 'table');
        const primaryRows = existing
          ? (JSON.parse(existing.content) as { name: string; value: unknown }[])
          : [];
        return [
          ...original.filter((artifact) => artifact.type !== 'table'),
          {
            id: 'table',
            type: 'table' as const,
            label: 'Независимые операции',
            content: JSON.stringify({
              records: [
                ...contexts(world).map((entry, index) => ({
                  operation: index + 1,
                  observation: entry.healthy
                    ? 'Проверка подтвердила выполнение указанного контракта; повторный прогон сохраняет результат.'
                    : humanObservation(lookup(entry)),
                  contract: humanReasoning(lookup(entry).invariant),
                })),
                ...primaryRows.map((row) => ({
                  operation: 'Основной вопрос',
                  observation: `${row.name}: ${String(row.value)}`,
                  contract: 'Условия основного сценария',
                })),
              ],
            }),
            usefulness: Math.max(existing?.usefulness || 0, 0.9),
          },
        ];
      },
      renderScenario(current, world, truth) {
        const rendered = rendering.renderContext(current, primary(world), truth);
        const instruction =
          'Основной вопрос относится к описанной операции. Дополнительно составьте план для независимых операций из отдельной таблицы.';
        rendered.scenario.constraints.push(instruction);
        rendered.text += `\n\n${instruction}`;
        return rendered;
      },
    },
  };
}
