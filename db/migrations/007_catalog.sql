CREATE INDEX IF NOT EXISTS jobs_salary_max ON jobs(max_salary DESC,id) WHERE status='published';
CREATE INDEX IF NOT EXISTS jobs_salary_min ON jobs(min_salary,id) WHERE status='published';
CREATE INDEX IF NOT EXISTS jobs_published_date ON jobs((coalesce(payload->>'publishedAt','1970-01-01')) DESC,id) WHERE status='published';
CREATE INDEX IF NOT EXISTS profiles_score ON candidate_profiles(((payload->>'score')::numeric) DESC,id) WHERE visible AND consent;
CREATE INDEX IF NOT EXISTS applications_job ON applications(job_id);
CREATE INDEX IF NOT EXISTS profiles_user_active ON candidate_profiles(user_id,id) WHERE visible AND consent;
INSERT INTO schema_migrations(id) VALUES ('007_catalog') ON CONFLICT DO NOTHING;
