import test from 'node:test';
import assert from 'node:assert/strict';
import { questionFingerprint } from '../src/generative/validators.js';
import { getPack } from '../src/generative/packs.js';
import { generateItem, generateBlueprint } from '../src/generative/generator.js';
import { AdaptiveService } from '../src/adaptive/service.js';
import { Store } from '../src/store.js';

test('whole cases can differ while their inspectable questions are identical', () => {
  const pack = getPack('frontend');
  const model = pack.itemModels.find((entry) => entry.id === 'fe_origin_boundary')!;
  const first = generateItem(pack, model, 'Junior', 'review', 'correctness', 1827800681);
  const second = generateItem(pack, model, 'Junior', 'review', 'correctness', 3380940602);
  assert.notEqual(first.generated.surfaceFingerprint, second.generated.surfaceFingerprint);
  for (const id of ['risk', 'fix']) {
    assert.equal(
      questionFingerprint(
        first,
        first.steps.find((step) => step.id === id)!,
        pack,
      ),
      questionFingerprint(
        second,
        second.steps.find((step) => step.id === id)!,
        pack,
      ),
    );
  }
});

test('a used question excludes a different full case carrying the same question', () => {
  const pack = getPack('frontend');
  const blueprint = generateBlueprint('Junior', 173, { specialization: pack.id });
  const used = blueprint.items.map((item) => questionFingerprint(item, item.steps[0]!, pack));
  const next = generateBlueprint('Junior', 173, {
    specialization: pack.id,
    excludedQuestionFingerprints: used,
  });
  for (const item of [...next.items, ...next.boundaryPool]) {
    for (const step of item.steps) assert.ok(!used.includes(questionFingerprint(item, step, pack)));
  }
});

test('active programs reserve questions across candidates and release unused reservations on completion', () => {
  const store = new Store(':memory:');
  const service = new AdaptiveService(store);
  const now = Date.parse('2026-10-09T08:00:00Z');
  try {
    const first = service.create('first', 'Junior', 'frontend', now);
    const second = service.create('second', 'Junior', 'frontend', now);
    const records = store.list<{ questions: string[]; specialization: string }>(
      'question-reservations',
    );
    assert.equal(records.length, 2);
    const previous = new Set(records[0]!.questions);
    assert.ok(records[1]!.questions.every((question) => !previous.has(question)));
    assert.ok(
      store
        .list<{ questionFingerprints: string[] }>('item-exposures')
        .every((record) => record.questionFingerprints.length > 0),
    );
    service.get(first.id, 'first', now + 1_200_001);
    assert.equal(store.list('question-reservations').length, 1);
    service.get(second.id, 'second', now + 1_200_001);
    assert.equal(store.list('question-reservations').length, 0);
  } finally {
    store.close();
  }
});

test('old exposure history is upgraded from original frozen content', () => {
  const store = new Store(':memory:');
  try {
    const service = new AdaptiveService(store);
    service.create('history-owner', 'Junior', 'backend', Date.parse('2026-10-09T08:00:00Z'));
    const record = service.exposureHistory()[0]!;
    const old = { ...record };
    delete old.questionFingerprints;
    store.db
      .prepare('UPDATE records SET body=? WHERE collection=?')
      .run(JSON.stringify(old), 'item-exposures');
    const upgraded = service.exposureHistory()[0]!;
    assert.deepEqual(upgraded.questionFingerprints, record.questionFingerprints);
  } finally {
    store.close();
  }
});
