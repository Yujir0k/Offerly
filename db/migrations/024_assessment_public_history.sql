-- Compact, server-generated public projections of completed sessions only.
-- Original private programs and frozen score snapshots remain unchanged.
ALTER TABLE professional_assessment_records
 DROP CONSTRAINT IF EXISTS professional_assessment_records_collection_check;
ALTER TABLE professional_assessment_records
 ADD CONSTRAINT professional_assessment_records_collection_check
 CHECK(collection IN ('adaptive-sessions','item-exposures','question-reservations','public-session-views'));
