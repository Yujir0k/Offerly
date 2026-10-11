CREATE TABLE IF NOT EXISTS password_reset_flows (
 id text PRIMARY KEY, user_id text REFERENCES users(id) ON DELETE CASCADE,
 email text NOT NULL, credential_hash text,
 binding_hash text NOT NULL, code_hash text NOT NULL,
 attempts integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL,
 grant_hash text, authorized_at timestamptz, used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE password_reset_flows ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
ALTER TABLE password_reset_flows ADD COLUMN IF NOT EXISTS credential_hash text;
CREATE INDEX IF NOT EXISTS resets_user ON password_reset_flows(user_id);
INSERT INTO schema_migrations(id) VALUES ('011_password_recovery') ON CONFLICT DO NOTHING;
