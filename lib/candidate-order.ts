/** Static SQL ordering shared by the paginated catalog and its regression checks. */
export function candidateOrderSql(sort: unknown, mode: string): string {
  const category = `(r.metrics->>'group')::integer,p.specialty,p.grade NULLS LAST`;
  // Explicit sorts apply to the entire filtered result before pagination. Grouping
  // by specialty/version first would put e.g. Android 81 ahead of Backend 100.
  if (sort === 'По результату теста')
    return `CASE WHEN p.grade IS NOT NULL THEN coalesce((p.payload->>'score')::numeric,0) END DESC NULLS LAST,${category},p.id`;
  if (sort === 'По достижениям ФСП')
    return `(r.metrics->>'sport')::numeric DESC,${category},p.id`;
  if (sort === 'По дате подтверждения')
    return `coalesce(p.payload->'assessmentEvidence'->>'confirmedAt','') DESC,${category},p.id`;
  if (sort === 'По зарплате')
    return `(p.payload->>'salaryMin')::numeric,${category},p.id`;
  const version = `coalesce(p.payload->'assessmentEvidence'->>'assessmentVersion','legacy'),coalesce(p.payload->'assessmentEvidence'->>'scoringConfigVersion','legacy')`;
  return `${category},${mode === 'fsp' ? '' : `${version},`}(r.metrics->>'value')::numeric DESC,p.id`;
}
