import type { ArtifactType, CompetencyDomain, ItemModel } from './model.js';
import type { TargetGrade } from '../adaptive/model.js';

const domains: Record<string, CompetencyDomain> = {
  request_validation: 'api',
  api_backward_compatibility: 'api',
  api_contract_evolution: 'api',
  query_pagination: 'data',
  transaction_constraints: 'data',
  db_lost_update: 'data',
  cache_inconsistency: 'data',
  transaction_event_gap: 'data',
  request_resource_lifecycle: 'performance',
  connection_pool_starvation: 'performance',
  frontend_performance_regression: 'performance',
  unnecessary_rerender: 'performance',
  resource_throttling: 'performance',
  capacity_issue: 'performance',
  partial_dependency_failure: 'observability',
  partial_zone_failure: 'observability',
  zero_downtime_migration: 'deployment',
  schema_rollout: 'deployment',
  bad_rollout: 'deployment',
  hydration_mismatch: 'deployment',
  accessibility_interaction: 'judgment',
};
const advanced = new Set([
  'unknown_external_outcome',
  'queue_duplicate_delivery',
  'transaction_event_gap',
  'zero_downtime_migration',
  'schema_rollout',
  'retry_storm',
  'stale_distributed_lock',
]);

/** Declare content boundaries and evidence sources once, independently of candidate layout. */
export function applyContentPolicy(model: ItemModel): ItemModel {
  const primary = domains[model.id] || 'reliability';
  const evidence = [...new Set(model.cases.map((c) => c.diagnostic))] as ArtifactType[];
  const sources: ArtifactType[] =
    model.specialization === 'frontend'
      ? ['architecture', 'code', 'network', 'browser_state', ...evidence]
      : [
          'architecture',
          'code',
          ...evidence,
          ...(primary === 'performance' ? (['metrics', 'trace'] as const) : []),
        ];
  const gradeRange: TargetGrade[] =
    model.specialization === 'backend' && advanced.has(model.id)
      ? ['Middle', 'Senior']
      : model.topology[0] === 'Controller'
        ? ['Junior', 'Middle']
        : ['Junior', 'Middle', 'Senior'];
  return {
    ...model,
    version: '3.0.0',
    gradeRange,
    competencyDomain: primary,
    competencyDomains: [
      ...new Set([
        primary,
        ...(primary === 'performance' ? (['observability'] as const) : []),
        'judgment' as const,
      ]),
    ],
    availableArtifacts: [...new Set(sources)],
    worldStateSchema: 'world-state-3',
    boundarySuitability: true,
    informationWeight: 2.5,
    itemTypes: [
      'diagnosis',
      'interpretation',
      'remediation',
      'adaptation',
      'falsification',
      'negative_guarantee',
      'critical_assumption',
    ],
  };
}

/** A Backend program must cover ordinary product engineering, not only distributed failures. */
export const backendDomainCounts: Record<TargetGrade, Record<string, number>> = {
  Junior: { api: 2, data: 2, performance: 1, observability: 1 },
  Middle: { api: 1, data: 1, performance: 1, reliability: 1, deployment: 1, observability: 1 },
  Senior: { api: 1, data: 1, performance: 1, reliability: 1, deployment: 1, observability: 1 },
};
/** Every candidate receives the same domain proportions for their claimed Backend grade. */
export function validateDomainCoverage(models: ItemModel[], grade: TargetGrade): boolean {
  const expected = backendDomainCounts[grade];
  const counts = Object.fromEntries(
    Object.keys(expected).map((domain) => [
      domain,
      models.filter((model) => model.competencyDomain === domain).length,
    ]),
  );
  if (
    models.length !== 6 ||
    Object.entries(expected).some(([domain, count]) => counts[domain] !== count)
  )
    return false;
  const covered = new Set(models.flatMap((m) => m.competencyDomains || []));
  const required: CompetencyDomain[] =
    grade === 'Junior'
      ? ['api', 'data', 'performance']
      : ['api', 'data', 'performance', 'reliability', 'deployment'];
  const distributed = models.filter(
    (m) => advanced.has(m.id) && !['zero_downtime_migration', 'schema_rollout'].includes(m.id),
  );
  return (
    required.every((domain) => covered.has(domain)) &&
    distributed.length <= 2 &&
    (grade !== 'Junior' || models.filter((m) => m.topology[0] === 'Controller').length >= 3)
  );
}
