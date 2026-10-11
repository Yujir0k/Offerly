CREATE TABLE IF NOT EXISTS email_change_flows (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_hash text NOT NULL, old_email text NOT NULL, new_email text NOT NULL,
 authorized_at timestamptz, expires_at timestamptz NOT NULL,
 used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_challenges ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'verify';
ALTER TABLE email_challenges ADD COLUMN IF NOT EXISTS flow_id text REFERENCES email_change_flows(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS email_change_user_session ON email_change_flows(user_id,session_hash);
CREATE INDEX IF NOT EXISTS email_challenge_flow ON email_challenges(flow_id,purpose);
