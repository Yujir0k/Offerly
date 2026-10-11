CREATE TABLE IF NOT EXISTS mcp_employer_tokens (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, encrypted_token text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcp_invitation_drafts (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 candidate_id integer NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
 request_key text NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','deleted')),
 invitation_id text REFERENCES invitations(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_key)
);
CREATE INDEX IF NOT EXISTS mcp_drafts_owner ON mcp_invitation_drafts(user_id,status,created_at DESC);
INSERT INTO schema_migrations(id) VALUES ('019_employer_mcp') ON CONFLICT DO NOTHING;
