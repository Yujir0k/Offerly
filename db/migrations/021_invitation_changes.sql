ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_status_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_status_check CHECK(status IN ('sent','viewed','accepted','declined','cancelled'));
INSERT INTO schema_migrations(id) VALUES ('021_invitation_changes') ON CONFLICT DO NOTHING;
