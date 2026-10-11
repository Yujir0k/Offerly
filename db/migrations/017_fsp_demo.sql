CREATE TABLE IF NOT EXISTS fsp_demo_flows (
 state_hash text PRIMARY KEY, browser_hash text NOT NULL, session_hash text,
 user_id text REFERENCES users(id) ON DELETE CASCADE,
 intent text NOT NULL CHECK(intent IN ('login','link')), role text NOT NULL,
 issuer text NOT NULL, redirect_uri text NOT NULL, verifier text NOT NULL, nonce text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS fsp_demo_links (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 issuer text NOT NULL, subject text NOT NULL, participant_id text NOT NULL,
 participant_name text NOT NULL, catalog_key text NOT NULL, linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fsp_demo_flows_expiry ON fsp_demo_flows(expires_at);
INSERT INTO schema_migrations(id) VALUES ('017_fsp_demo') ON CONFLICT DO NOTHING;
