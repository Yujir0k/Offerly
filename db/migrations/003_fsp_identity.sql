CREATE UNIQUE INDEX IF NOT EXISTS identity_account_issuer ON external_identities(user_id,issuer);
ALTER TABLE external_identities ADD COLUMN IF NOT EXISTS linked_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS oidc_flows (
 state_hash text PRIMARY KEY,
 browser_hash text NOT NULL,
 session_hash text,
 user_id text REFERENCES users(id) ON DELETE CASCADE,
 intent text NOT NULL CHECK (intent IN ('login','register','link')),
 role text NOT NULL CHECK (role IN ('candidate','employer')),
 consent boolean NOT NULL DEFAULT false,
 issuer text NOT NULL,
 redirect_uri text NOT NULL,
 verifier text NOT NULL,
 nonce text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oidc_flows_expiry ON oidc_flows(expires_at);
CREATE INDEX IF NOT EXISTS oidc_flows_user ON oidc_flows(user_id);
