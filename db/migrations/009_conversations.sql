CREATE TABLE IF NOT EXISTS conversations (
 id text PRIMARY KEY,
 company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 candidate_id integer NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,candidate_id)
);
CREATE TABLE IF NOT EXISTS conversation_messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 sender_id text NOT NULL REFERENCES users(id),
 client_id text NOT NULL,
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,sender_id,client_id)
);
CREATE INDEX IF NOT EXISTS conversation_messages_page ON conversation_messages(conversation_id,id DESC);
CREATE INDEX IF NOT EXISTS conversations_candidate ON conversations(candidate_id,updated_at DESC,id);
CREATE INDEX IF NOT EXISTS conversations_company ON conversations(company_id,updated_at DESC,id);
CREATE TABLE IF NOT EXISTS conversation_reads (
 conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 last_message_id bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(conversation_id,user_id)
);
INSERT INTO schema_migrations(id) VALUES ('009_conversations') ON CONFLICT DO NOTHING;
