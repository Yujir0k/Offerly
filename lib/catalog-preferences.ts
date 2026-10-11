// The same preference predicate serves the overview preview, counts and “new” catalog.
export function dashboardJobPredicate(profile: string, candidate: string) {
  const p = `(${profile}::jsonb)`;
  return `j.specialty=${p}->>'specialty'
    AND NOT EXISTS(SELECT 1 FROM applications a WHERE a.job_id=j.id AND a.candidate_id=${candidate})
    AND (jsonb_array_length(coalesce(${p}->'formats','[]'))=0 OR ${p}->'formats' ? 'Любой' OR ${p}->'formats' ? (j.payload->>'format'))
    AND (jsonb_array_length(coalesce(${p}->'employmentTypes','[]'))=0 OR coalesce(j.payload->>'employment','')='' OR ${p}->'employmentTypes' ? (j.payload->>'employment'))
    AND (jsonb_array_length(coalesce(${p}->'preferredIndustries','[]'))=0 OR ${p}->'preferredIndustries' ? (j.payload->>'industry'))
    AND (NOT (${p}->>'salaryValid')::boolean OR (j.max_salary>=(${p}->>'salaryMin')::numeric AND j.min_salary<=(${p}->>'salaryMax')::numeric))`;
}
