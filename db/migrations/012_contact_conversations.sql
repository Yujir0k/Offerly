-- Preserve existing conversations; make earlier contact exchanges available in Messages.
INSERT INTO conversations(id,company_id,candidate_id)
SELECT 'exchange-' || md5(shared.company_id || ':' || shared.candidate_id::text),
       shared.company_id,shared.candidate_id
FROM (
  SELECT company_id,candidate_id FROM invitations WHERE status='accepted'
  UNION
  SELECT j.company_id,a.candidate_id FROM applications a JOIN jobs j ON j.id=a.job_id
) shared
JOIN companies co ON co.id=shared.company_id
JOIN candidate_profiles p ON p.id=shared.candidate_id
JOIN users candidate ON candidate.id=p.user_id
JOIN users employer ON employer.id=co.owner_id
WHERE candidate.deleted_at IS NULL AND employer.deleted_at IS NULL
  AND candidate.scope=co.scope AND employer.scope=co.scope
  AND candidate.id<>employer.id
ON CONFLICT(company_id,candidate_id) DO NOTHING;
INSERT INTO schema_migrations(id) VALUES ('012_contact_conversations') ON CONFLICT DO NOTHING;
