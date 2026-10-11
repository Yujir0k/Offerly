-- Additive: existing assessments, accounts and profiles are retained.
CREATE TABLE IF NOT EXISTS professional_assessment_locks (
 id text PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS professional_assessment_records (
 scope text NOT NULL,
 collection text NOT NULL CHECK(collection IN ('adaptive-sessions','item-exposures','question-reservations')),
 id text NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 body jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(scope,collection,id)
);
CREATE INDEX IF NOT EXISTS professional_assessment_owner ON professional_assessment_records(user_id,collection);
CREATE INDEX IF NOT EXISTS professional_assessment_track ON professional_assessment_records(scope,collection,(body->>'specialization'),(body->>'targetGrade'));
CREATE UNIQUE INDEX IF NOT EXISTS professional_assessment_active ON professional_assessment_records(user_id) WHERE collection='adaptive-sessions' AND body->>'state'='active';
INSERT INTO schema_migrations(id) VALUES ('008_professional_assessment') ON CONFLICT DO NOTHING;
