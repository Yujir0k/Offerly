-- Separate demo attempts from real qualification, including their active-attempt constraint.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE professional_assessment_records DROP CONSTRAINT professional_assessment_records_collection_check;
ALTER TABLE professional_assessment_records ADD CONSTRAINT professional_assessment_records_collection_check
 CHECK(collection IN ('adaptive-sessions','expert-sessions','item-exposures','question-reservations','public-session-views')) NOT VALID;
ALTER TABLE professional_assessment_records VALIDATE CONSTRAINT professional_assessment_records_collection_check;
CREATE UNIQUE INDEX IF NOT EXISTS professional_expert_active ON professional_assessment_records(user_id)
 WHERE collection='expert-sessions' AND body->>'state'='active';
