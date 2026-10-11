-- A private demo profile must not reserve its owner's address for real signup.
-- Authentication always selects non-demo users; identities are still bound by user ID.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_public_email ON users(email) WHERE NOT demo;
