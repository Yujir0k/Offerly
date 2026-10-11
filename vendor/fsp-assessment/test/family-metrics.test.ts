import test from 'node:test';
import assert from 'node:assert/strict';
import { getFamily } from '../src/families/registry.js';
import type { LabData, LabRow, Plan } from '../src/domain.js';

const dataset = (rows: LabRow[], parameters: LabData['parameters'] = {}): LabData => ({
  rows,
  parameters,
});
const run = (id: string, input: LabData, plan: Plan) => getFamily(id).run(input, plan);
const close = (actual: number | undefined, expected: number) =>
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const pass = (checks: Record<string, boolean>) => assert.ok(Object.values(checks).every(Boolean));

test('DS profit matches independently calculated TP/FP utility', () => {
  const input = dataset(
    [
      { probability: 0.9, future: 1, label: 1 },
      { probability: 0.8, future: 0, label: 0 },
      { probability: 0.3, future: 1, label: 1 },
    ],
    { gain: 10, loss: 5, minProfit: 0, cutoff: 0 },
  );
  const result = run('ds-decision-cost', input, {
    score: 'probability',
    split: 'time',
    threshold: 0.4,
  });
  close(result.metrics.profit, 5);
  close(result.metrics.recall, 0.5);
  close(result.metrics.precision, 0.5);
  pass(result.checks);
  assert.equal(
    run('ds-decision-cost', input, { score: 'future', split: 'time', threshold: 0.4 }).checks
      .pointInTime,
    false,
  );
});
test('DS segment policy maximizes declared utility instead of average accuracy', () => {
  const input = dataset(
    [
      { segment: 0, probability: 0.6, label: 1 },
      { segment: 0, probability: 0.5, label: 0 },
      { segment: 1, probability: 0.3, label: 1 },
      { segment: 1, probability: 0.5, label: 0 },
    ],
    { gain0: 10, loss0: 20, gain1: 20, loss1: 1, minProfit: 29 },
  );
  const result = run('ds-segment-thresholds', input, {
    policy: 'segmented',
    threshold0: 0.6,
    threshold1: 0.2,
  });
  close(result.metrics.totalProfit, 29);
  pass(result.checks);
  assert.equal(
    run('ds-segment-thresholds', input, { policy: 'shared', threshold0: 0.6, threshold1: 0.2 })
      .checks.requiredUtility,
    false,
  );
});
test('serving parity checks numeric score and missing preprocessing', () => {
  const input = dataset([{ raw: 8 }, { raw: 14 }, { raw: null }], {
    trainMean: 10,
    trainScale: 2,
    median: 12,
    bias: -0.15,
  });
  const result = run('mle-serving-contract', input, {
    normalization: 'training',
    missing: 'median',
    version: 'pinned',
  });
  close(result.metrics.maxScoreError, 0);
  close(result.metrics.predictionMismatches, 0);
  pass(result.checks);
  assert.equal(
    run('mle-serving-contract', input, {
      normalization: 'batch',
      missing: 'median',
      version: 'pinned',
    }).checks.numericalParity,
    false,
  );
});
test('batch simulator includes actual queue wait and quantization error', () => {
  const input = dataset(
    [
      { arrival: 0, signal: 0.1 },
      { arrival: 0.1, signal: 0.3 },
      { arrival: 0.2, signal: 0.7 },
    ],
    { maxP95: 10, maxWork: 7, maxRmse: 0.006 },
  );
  const result = run('mle-batching-precision', input, { batch: 4, wait: 2, precision: 'int8' });
  close(result.metrics.p95, 3.04);
  close(result.metrics.workUnits, 5);
  pass(result.checks);
  assert.equal(
    run('mle-batching-precision', input, { batch: 4, wait: 2, precision: 'fp32' }).checks
      .resourceSla,
    false,
  );
});
test('canary catches a critical low-traffic segment hidden by the aggregate', () => {
  const input = dataset(
    [
      { requests: 1000, errors: 0, p95: 100 },
      { requests: 10, errors: 1, p95: 100 },
    ],
    { maxErrorRate: 0.03, maxP95: 180 },
  );
  const result = run('mlops-canary-rollback', input, {
    scope: 'segments',
    decision: 'rollback',
    pinned: 'yes',
  });
  close(result.metrics.worstSegmentErrorRate, 0.1);
  pass(result.checks);
  assert.equal(
    run('mlops-canary-rollback', input, { scope: 'segments', decision: 'continue', pinned: 'yes' })
      .checks.appropriateDecision,
    false,
  );
});
test('point-in-time join rejects future availability even with a high coverage', () => {
  const input = dataset(
    [
      { entity: 0, prediction: 100, featureTime: 80, recordedAt: 82, feature: 3 },
      { entity: 0, prediction: 100, featureTime: 105, recordedAt: 105, feature: 4 },
    ],
    { maxAge: 30, minCoverage: 1 },
  );
  const result = run('mlops-point-in-time', input, { join: 'asof', ttl: 30, missing: 'abstain' });
  close(result.metrics.coverage, 1);
  close(result.metrics.futureLeaks, 0);
  pass(result.checks);
  assert.equal(
    run('mlops-point-in-time', input, { join: 'latest', ttl: 30, missing: 'abstain' }).checks
      .temporalIntegrity,
    false,
  );
});
test('RAG ignores instructions even inside a trusted document', () => {
  const input = dataset(
    [
      {
        query: 0,
        document: 'verified',
        relevance: 0.8,
        current: true,
        trusted: true,
        injection: true,
      },
      {
        query: 0,
        document: 'old',
        relevance: 0.99,
        current: false,
        trusted: true,
        injection: false,
      },
    ],
    { queries: 1 },
  );
  const result = run('llm-retrieval-trust', input, {
    currentOnly: 'yes',
    trustedOnly: 'yes',
    instructions: 'data',
  });
  close(result.metrics.correctSources, 1);
  close(result.metrics.injectionExecutions, 0);
  pass(result.checks);
  close(
    run('llm-retrieval-trust', input, {
      currentOnly: 'yes',
      trustedOnly: 'yes',
      instructions: 'execute',
    }).metrics.injectionExecutions,
    1,
  );
});
test('grounding rejects unsupported confident claims and duplicate context cost', () => {
  const input = dataset(
    [
      { known: true, fact: 3, proposed: 3, cited: true, confidence: 0.8, contextTokens: 10 },
      { known: true, fact: 4, proposed: 5, cited: true, confidence: 0.9, contextTokens: 10 },
      { known: false, fact: null, proposed: 7, cited: false, confidence: 0.95, contextTokens: 10 },
    ],
    { maxTokens: 30 },
  );
  const result = run('llm-grounding-abstention', input, {
    acceptance: 'evidence',
    unknown: 'abstain',
    contextCopies: 1,
  });
  close(result.metrics.trueAccept, 1);
  close(result.metrics.correctRefusal, 2);
  close(result.metrics.tokenUnits, 30);
  pass(result.checks);
  assert.equal(
    run('llm-grounding-abstention', input, {
      acceptance: 'confidence',
      unknown: 'answer',
      contextCopies: 1,
    }).checks.factualAcceptance,
    false,
  );
});
test('classwise NMS preserves overlapping objects of different classes', () => {
  const rows: LabRow[] = [];
  for (const cls of [0, 1]) {
    const box = { image: 0, cls, x1: 0, y1: 0, x2: 20, y2: 20 };
    rows.push(
      { ...box, kind: 'truth', score: 1 },
      { ...box, kind: 'prediction', score: 0.9 },
      { ...box, x1: 1, x2: 21, kind: 'prediction', score: 0.8 },
    );
  }
  const input = dataset(rows, { matchIou: 0.5, minPrecision: 1, minRecall: 1 });
  const result = run('cv-detection-nms', input, {
    confidence: 0.5,
    nmsIou: 0.3,
    scope: 'classwise',
  });
  close(result.metrics.tp, 2);
  close(result.metrics.fp, 0);
  pass(result.checks);
  close(
    run('cv-detection-nms', input, { confidence: 0.5, nmsIou: 0.3, scope: 'global' }).metrics.fn,
    1,
  );
});
test('camera holdout exposes a perfectly misleading background shortcut', () => {
  const input = dataset(
    [
      { camera: 0, label: 0, foreground: 0, background: 0 },
      { camera: 0, label: 1, foreground: 1, background: 1 },
      { camera: 1, label: 0, foreground: 0, background: 1 },
      { camera: 1, label: 1, foreground: 1, background: 0 },
    ],
    { heldoutCamera: 1, minAccuracy: 1 },
  );
  const result = run('cv-camera-shortcut', input, {
    features: 'foreground',
    split: 'camera',
    augmentation: 'none',
  });
  close(result.metrics.accuracy, 1);
  pass(result.checks);
  close(
    run('cv-camera-shortcut', input, {
      features: 'background',
      split: 'camera',
      augmentation: 'none',
    }).metrics.accuracy,
    0,
  );
});
test('ranking recomputes ideal DCG among actually available items', () => {
  const input = dataset(
    [
      { query: 0, relevance: 3, score: 0.9, futureScore: 3, staleScore: 0, available: false },
      { query: 0, relevance: 2, score: 0.8, futureScore: 2, staleScore: 1, available: true },
      { query: 0, relevance: 0, score: 0.5, futureScore: 0, staleScore: 2, available: true },
    ],
    { k: 1, minNdcg: 1 },
  );
  const result = run('ranking-ndcg-availability', input, {
    score: 'score',
    availability: 'yes',
    grouping: 'query',
  });
  close(result.metrics.meanNdcg, 1);
  close(result.metrics.unavailableInTop, 0);
  pass(result.checks);
  assert.equal(
    run('ranking-ndcg-availability', input, {
      score: 'score',
      availability: 'no',
      grouping: 'query',
    }).checks.inventoryIntegrity,
    false,
  );
});
test('IPS corrects logging bias and clipping changes the estimate', () => {
  const rows: LabRow[] = [];
  for (let i = 0; i < 10; i++)
    rows.push(
      { chosen: i < 8, propensity: 0.8, reward: i < 8 ? 1 : 0 },
      { chosen: i < 2, propensity: 0.2, reward: i < 2 ? 0.2 : 0 },
    );
  const input = dataset(rows, { expected: 0.6, maxError: 1e-9 });
  const result = run('ranking-off-policy-ips', input, {
    estimator: 'ips',
    clip: 10,
    overlap: 'yes',
  });
  close(result.metrics.estimate, 0.6);
  close(result.metrics.effectiveSampleSize, 6.4);
  pass(result.checks);
  close(
    run('ranking-off-policy-ips', input, { estimator: 'naive', clip: 10, overlap: 'yes' }).metrics
      .estimate,
    0.84,
  );
  close(
    run('ranking-off-policy-ips', input, { estimator: 'ips', clip: 3, overlap: 'yes' }).metrics
      .estimate,
    0.56,
  );
});
test('paired ablation computes the specified mean and standard error', () => {
  const input = dataset([
    { baseline: 0.5, treatment: 0.52 },
    { baseline: 0.5, treatment: 0.53 },
    { baseline: 0.5, treatment: 0.54 },
  ]);
  const result = run('research-paired-ablation', input, {
    sample: 'all-paired',
    uncertainty: 'interval',
    claim: 'yes',
  });
  close(result.metrics.delta, 0.03);
  close(result.metrics.lower, 0.03 - (2.5 * 0.01) / Math.sqrt(3));
  pass(result.checks);
  assert.equal(
    run('research-paired-ablation', input, {
      sample: 'best',
      uncertainty: 'interval',
      claim: 'yes',
    }).checks.fullPairedSeries,
    false,
  );
});
test('research matched compute separates resource advantage from method effect', () => {
  const input = dataset(
    [
      { budget: 1, baseline: 0.5, proposed: 0.51 },
      { budget: 4, baseline: 0.7, proposed: 0.71 },
    ],
    { tolerance: 1e-9 },
  );
  const result = run('research-compute-parity', input, {
    comparison: 'matched',
    reportCompute: 'yes',
    claim: 'yes',
  });
  close(result.metrics.controlledEffect, 0.01);
  pass(result.checks);
  close(
    run('research-compute-parity', input, {
      comparison: 'confounded',
      reportCompute: 'yes',
      claim: 'yes',
    }).metrics.confoundingBias,
    0.2,
  );
});
test('payment engine preserves independent tenant balances on crash and replay', () => {
  const input = dataset([
    { tenant: 0, event: 0, amount: 100, failAfterWrite: true },
    { tenant: 0, event: 0, amount: 100, failAfterWrite: false },
    { tenant: 1, event: 0, amount: 200, failAfterWrite: false },
    { tenant: 1, event: 0, amount: 200, failAfterWrite: false },
  ]);
  const result = run('backend-payment-idempotency', input, {
    key: 'tenant-event',
    transaction: 'atomic',
    retry: 'same-id',
  });
  close(result.metrics.ledgerError, 0);
  pass(result.checks);
  close(
    run('backend-payment-idempotency', input, {
      key: 'event',
      transaction: 'atomic',
      retry: 'same-id',
    }).metrics.ledgerError,
    200,
  );
});
test('cache hit never authorizes a denied request or crosses tenants', () => {
  const input = dataset([
    { tenant: 0, resource: 'r', version: 1, value: 100, allowed: true },
    { tenant: 0, resource: 'r', version: 1, value: 100, allowed: false },
    { tenant: 1, resource: 'r', version: 1, value: 200, allowed: true },
  ]);
  const result = run('backend-cache-isolation', input, {
    key: 'tenant-resource',
    invalidation: 'version',
    auth: 'every-request',
  });
  close(result.metrics.unauthorizedResponses, 0);
  pass(result.checks);
  assert.ok(
    run('backend-cache-isolation', input, {
      key: 'resource',
      invalidation: 'version',
      auth: 'miss-only',
    }).metrics.unauthorizedResponses! > 0,
  );
});
test('frontend response race preserves both routes and ignores an obsolete response', () => {
  const input = dataset(
    [
      { request: 0, issued: 0, completed: 30, route: 'A' },
      { request: 1, issued: 10, completed: 11, route: 'A' },
      { request: 2, issued: 0, completed: 10, route: 'B' },
    ],
    { unmount: 100 },
  );
  const result = run('frontend-request-races', input, {
    responses: 'request-id',
    cleanup: 'yes',
    key: 'route-id',
  });
  close(result.metrics.staleWrites, 0);
  close(result.metrics.missingRoutes, 0);
  pass(result.checks);
  close(
    run('frontend-request-races', input, { responses: 'all', cleanup: 'yes', key: 'route-id' })
      .metrics.staleWrites,
    1,
  );
});
test('frontend does not discard a valid response because of a future unissued request', () => {
  const input = dataset(
    [
      { request: 0, issued: 0, completed: 5, route: 'A' },
      { request: 1, issued: 100, completed: 105, route: 'A' },
    ],
    { unmount: 20 },
  );
  const result = run('frontend-request-races', input, {
    responses: 'request-id',
    cleanup: 'yes',
    key: 'route-id',
  });
  close(result.metrics.renderedRoutes, 1);
  close(result.metrics.postUnmountWrites, 0);
  pass(result.checks);
});
test('list reconciliation keeps state attached to IDs rather than positions', () => {
  const input = dataset(
    [
      { id: 'a', state: 100, nextPosition: 1 },
      { id: 'b', state: 200, nextPosition: 0 },
    ],
    { maxRendered: 20 },
  );
  const result = run('frontend-list-reconciliation', input, {
    keys: 'id',
    window: 10,
    state: 'entity',
  });
  close(result.metrics.misassignedStates, 0);
  pass(result.checks);
  close(
    run('frontend-list-reconciliation', input, { keys: 'index', window: 10, state: 'position' })
      .metrics.misassignedStates,
    2,
  );
});
test('CDC sums exact decimal cents only once and quarantines invalid values', () => {
  const input = dataset([
    { id: 1, schema: 1, amount: 29, valid: true },
    { id: 2, schema: 2, amount: '0.29', valid: true },
    { id: 2, schema: 2, amount: '0.29', valid: true },
    { id: 3, schema: 2, amount: 'broken', valid: false },
  ]);
  const result = run('de-cdc-schema-money', input, {
    decoder: 'schema-cents',
    dedupe: 'yes',
    invalid: 'quarantine',
  });
  close(result.metrics.totalCents, 58);
  close(result.metrics.quarantined, 1);
  pass(result.checks);
  assert.equal(
    run('de-cdc-schema-money', input, { decoder: 'coerce', dedupe: 'yes', invalid: 'quarantine' })
      .checks.monetaryIntegrity,
    false,
  );
});
test('streaming corrects a historical event-time window rather than moving late events', () => {
  const input = dataset(
    [
      { id: 1, event: 11, arrival: 12, amount: 3 },
      { id: 0, event: 1, arrival: 15, amount: 2 },
    ],
    { windowMinutes: 10 },
  );
  const result = run('de-event-time-windows', input, {
    clock: 'event',
    lateness: 0,
    late: 'correct',
    dedupe: 'yes',
  });
  close(result.metrics.aggregateError, 0);
  pass(result.checks);
  close(
    run('de-event-time-windows', input, {
      clock: 'arrival',
      lateness: 0,
      late: 'correct',
      dedupe: 'yes',
    }).metrics.aggregateError,
    4,
  );
  close(
    run('de-event-time-windows', input, {
      clock: 'event',
      lateness: 0,
      late: 'drop',
      dedupe: 'yes',
    }).metrics.droppedEvents,
    1,
  );
});
test('QA portfolio kills four specific faults within cost six', () => {
  const input = dataset(
    [
      { mutation: 'duplicates', risk: 10, amount: 100 },
      { mutation: 'tenant', risk: 10, amount: 100 },
      { mutation: 'atomicity', risk: 8, amount: 100 },
      { mutation: 'negative', risk: 8, amount: 100 },
    ],
    { maxCost: 6, requiredRisk: 36 },
  );
  const tests = ['duplicates', 'tenants', 'crash', 'negative'];
  const result = run('qa-mutation-risk', input, { tests, oracle: 'invariants' });
  close(result.metrics.coveredRisk, 36);
  close(result.metrics.executionCost, 6);
  pass(result.checks);
  close(run('qa-mutation-risk', input, { tests, oracle: 'status' }).metrics.killedMutations, 0);
});
test('QA asynchronous fixture separates false failures from hidden product defects', () => {
  const input = dataset(
    [
      { initial: 0, completeAt: 40, defect: false },
      { initial: 1, completeAt: 50, defect: false },
      { initial: 0, completeAt: 20, defect: true },
    ],
    { deadline: 80 },
  );
  const result = run('qa-flaky-async-isolation', input, {
    wait: 'event',
    isolation: 'fresh',
    retries: 'diagnose',
  });
  close(result.metrics.falseFailures, 0);
  close(result.metrics.hiddenDefects, 0);
  pass(result.checks);
  close(
    run('qa-flaky-async-isolation', input, { wait: 'sleep', isolation: 'fresh', retries: 'mask' })
      .metrics.hiddenDefects,
    1,
  );
});
test('SRE short spike does not satisfy the stated two-window page rule', () => {
  const input = dataset(
    Array.from({ length: 60 }, (_, index) => ({ requests: 100, errors: index >= 55 ? 10 : 0 })),
    { slo: 0.99, fastWindow: 5, slowWindow: 60, fastThreshold: 5, slowThreshold: 3 },
  );
  const result = run('sre-multiwindow-burn', input, {
    aggregation: 'traffic',
    windows: 'both',
    decision: 'observe',
  });
  close(result.metrics.fastBurn, 10);
  close(result.metrics.slowBurn, 5 / 6);
  pass(result.checks);
  assert.equal(
    run('sre-multiwindow-burn', input, {
      aggregation: 'traffic',
      windows: 'both',
      decision: 'page',
    }).checks.appropriatePage,
    false,
  );
});
test('rolling capacity includes an overlapping failure and quota', () => {
  const input = dataset(
    [
      { unavailable: 0, failure: 0 },
      { unavailable: 1, failure: 1 },
    ],
    { load: 250, replicaCapacity: 50, clusterQuota: 10 },
  );
  const result = run('sre-rolling-capacity', input, {
    replicas: 6,
    maxUnavailable: 1,
    maxSurge: 1,
    rollback: 'yes',
  });
  close(result.metrics.minimumCapacity, 250);
  pass(result.checks);
  assert.equal(
    run('sre-rolling-capacity', input, {
      replicas: 4,
      maxUnavailable: 1,
      maxSurge: 1,
      rollback: 'yes',
    }).checks.enoughCapacity,
    false,
  );
});
test('Simpson counterexample reverses the naive A/B conclusion', () => {
  const input = dataset(
    [
      { variant: 'A', segment: 'desktop', visitors: 100, converted: 80 },
      { variant: 'A', segment: 'mobile', visitors: 900, converted: 90 },
      { variant: 'B', segment: 'desktop', visitors: 900, converted: 630 },
      { variant: 'B', segment: 'mobile', visitors: 100, converted: 5 },
    ],
    { desktopWeight: 0.5, mobileWeight: 0.5 },
  );
  const result = run('analytics-stratified-ab', input, {
    metric: 'standardized',
    unit: 'visitors',
    decision: 'worse',
  });
  close(result.metrics.standardizedLift, -0.075);
  pass(result.checks);
  assert.ok(
    run('analytics-stratified-ab', input, { metric: 'raw', unit: 'visitors', decision: 'better' })
      .metrics.estimatedLift! > 0,
  );
});
test('funnel avoids click fan-out and respects the seven-day cohort horizon', () => {
  const input = dataset(
    [
      { user: 0, order: 0, registered: 0, purchaseDay: 3, amount: 10 },
      { user: 0, order: 0, registered: 0, purchaseDay: 3, amount: 10 },
      { user: 1, order: 1, registered: 0, purchaseDay: 10, amount: 20 },
    ],
    { horizon: 7 },
  );
  const result = run('analytics-funnel-joins', input, {
    denominator: 'users',
    orders: 'distinct-orders',
    horizon: 7,
  });
  close(result.metrics.conversion, 0.5);
  close(result.metrics.revenue, 10);
  pass(result.checks);
  close(
    run('analytics-funnel-joins', input, { denominator: 'users', orders: 'sum-rows', horizon: 7 })
      .metrics.revenue,
    20,
  );
});
