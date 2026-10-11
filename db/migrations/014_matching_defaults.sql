-- Product default requested by the owner. Never undo a recorded withdrawal.
ALTER TABLE candidate_profiles ALTER COLUMN visible SET DEFAULT true;
ALTER TABLE candidate_profiles ALTER COLUMN consent SET DEFAULT true;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE id='014_matching_defaults') THEN
  WITH defaults AS (
   SELECT p.user_id,
    NOT p.consent AND NOT EXISTS (
     SELECT 1 FROM consent_events e WHERE e.user_id=p.user_id
     AND e.purpose='profile-matching' AND NOT e.granted
    ) AS enable_matching,
    NOT p.visible AND NOT EXISTS (
     SELECT 1 FROM consent_events e WHERE e.user_id=p.user_id
     AND e.purpose IN ('profile-visibility','profile-matching') AND NOT e.granted
    ) AND CASE WHEN jsonb_typeof(a.payload->'settings')='object'
      THEN (a.payload->'settings') - 'email' ELSE '{}'::jsonb END='{}'::jsonb AS enable_visibility
   FROM candidate_profiles p JOIN users u ON u.id=p.user_id
   JOIN account_state a ON a.user_id=p.user_id
   WHERE u.deleted_at IS NULL AND a.payload->>'role'='candidate'
  ), updated AS (
   UPDATE candidate_profiles p SET
    consent=p.consent OR d.enable_matching,
    visible=p.visible OR d.enable_visibility,
    payload=p.payload || jsonb_build_object(
     'consent',p.consent OR d.enable_matching,'visible',p.visible OR d.enable_visibility)
   FROM defaults d WHERE d.user_id=p.user_id AND (d.enable_matching OR d.enable_visibility)
   RETURNING p.user_id,d.enable_matching,d.enable_visibility
  )
  UPDATE drafts dr SET payload=CASE
   WHEN dr.id=dr.user_id||':setup' THEN jsonb_set(dr.payload,'{profile}',
    (dr.payload->'profile') || CASE WHEN u.enable_matching THEN '{"consent":true}'::jsonb ELSE '{}'::jsonb END
    || CASE WHEN u.enable_visibility THEN '{"visible":true}'::jsonb ELSE '{}'::jsonb END)
   ELSE dr.payload || CASE WHEN u.enable_matching THEN '{"consent":true}'::jsonb ELSE '{}'::jsonb END
    || CASE WHEN u.enable_visibility THEN '{"visible":true}'::jsonb ELSE '{}'::jsonb END
   END
  FROM updated u WHERE u.user_id=dr.user_id AND (
   dr.id=dr.user_id||':profile' OR (dr.id=dr.user_id||':setup' AND jsonb_typeof(dr.payload->'profile')='object'));
  INSERT INTO schema_migrations(id) VALUES ('014_matching_defaults');
 END IF;
END $$;
