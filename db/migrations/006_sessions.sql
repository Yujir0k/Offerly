ALTER TABLE sessions ADD COLUMN IF NOT EXISTS id text NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_name text NOT NULL DEFAULT 'Неизвестное устройство';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_type text NOT NULL DEFAULT 'desktop';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
UPDATE sessions SET last_seen_at=created_at WHERE last_seen_at IS NULL;
ALTER TABLE sessions ALTER COLUMN last_seen_at SET DEFAULT now();
ALTER TABLE sessions ALTER COLUMN last_seen_at SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_public_id ON sessions(id);
INSERT INTO schema_migrations(id) VALUES ('006_sessions') ON CONFLICT DO NOTHING;
