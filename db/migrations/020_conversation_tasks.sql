-- Add optional tasks without replacing existing bigint messages, receipts or dialogue IDs.
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS task jsonb;
INSERT INTO schema_migrations(id) VALUES ('020_conversation_tasks') ON CONFLICT DO NOTHING;
