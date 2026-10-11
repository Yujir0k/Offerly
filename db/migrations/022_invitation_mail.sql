CREATE TABLE IF NOT EXISTS invitation_mail_outbox (
 invitation_id text PRIMARY KEY REFERENCES invitations(id) ON DELETE CASCADE,
 recipient_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','skipped','failed')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_id text, lease_until timestamptz,
 sent_at timestamptz, last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitation_mail_due ON invitation_mail_outbox(next_attempt_at)
 WHERE status IN ('pending','processing');
INSERT INTO schema_migrations(id) VALUES ('022_invitation_mail') ON CONFLICT DO NOTHING;
