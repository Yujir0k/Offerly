-- Correct only the fixed synthetic examples. Never recategorize user publications.
UPDATE jobs j
SET specialty = mapping.specialty,
    payload = jsonb_set(j.payload, '{specialty}', to_jsonb(mapping.specialty))
FROM (VALUES
  ('job-ml', 'ML Engineer'),
  ('job-devops', 'DevOps / SRE'),
  ('job-mobile', 'Android'),
  ('job-mlops', 'MLOps / ML Platform Engineer')
) AS mapping(id, specialty)
WHERE j.id = 'offerly-market-example-' || mapping.id
  AND j.company_id = 'offerly-market-company-' || mapping.id
  AND j.payload->>'demo' = 'true';
