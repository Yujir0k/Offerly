CREATE INDEX IF NOT EXISTS users_scope_active ON users(scope) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS companies_scope ON companies(scope);
CREATE INDEX IF NOT EXISTS memberships_user ON company_memberships(user_id);
CREATE INDEX IF NOT EXISTS needs_company ON needs(company_id);
CREATE INDEX IF NOT EXISTS jobs_company ON jobs(company_id);
CREATE INDEX IF NOT EXISTS invitations_company ON invitations(company_id);
CREATE INDEX IF NOT EXISTS challenges_user_created ON email_challenges(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
