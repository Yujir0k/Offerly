-- Preserve employer-2 results; skip unused empty-array queries and balanced-task dimensions.
CREATE OR REPLACE FUNCTION offerly_candidate_rank(p jsonb, c jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
 skill text; event jsonb; dimension jsonb; weight numeric; level numeric;
 matched jsonb := '[]'; verified jsonb := '[]'; unknown jsonb := '[]'; events jsonb := '[]'; desired_matched jsonb := '[]';
 skill_score numeric := 0; test_score numeric := 0; sport_score numeric := 0;
 competency_sum numeric := 0; competency_weight numeric := 0; relevance numeric; result_weight numeric;
 target text := coalesce(nullif(c->>'specialty','Все'),'');
 target_grade text := coalesce(nullif(c->>'grade','Все'),'');
 confirmed boolean := coalesce(p->>'grade','')<>'';
 rank_group integer; mode text := coalesce(c->>'mode','balanced');
BEGIN
 rank_group := CASE WHEN NOT confirmed THEN 2
   WHEN (target<>'' AND p->>'specialty'<>target) OR (target_grade<>'' AND p->>'grade'<>target_grade) THEN 1 ELSE 0 END;
 IF jsonb_array_length(coalesce(c->'skills','[]'))>0 THEN
 FOR skill IN SELECT jsonb_array_elements_text(coalesce(c->'skills','[]')) LOOP
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p->'verified','[]')) v WHERE offerly_skill_matches(v,skill,c)) THEN
     verified := verified || jsonb_build_array(skill); matched := matched || jsonb_build_array(skill);
   ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p->'skills','[]')) v WHERE offerly_skill_matches(v,skill,c)) THEN
     matched := matched || jsonb_build_array(skill);
   ELSE unknown := unknown || jsonb_build_array(skill); END IF;
 END LOOP;
 END IF;
 IF jsonb_array_length(coalesce(c->'desiredSkills','[]'))>0 THEN
 FOR skill IN SELECT jsonb_array_elements_text(coalesce(c->'desiredSkills','[]')) LOOP
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p->'verified','[]')||coalesce(p->'skills','[]')) v WHERE offerly_skill_matches(v,skill,c)) THEN
     desired_matched := desired_matched || jsonb_build_array(skill);
   END IF;
 END LOOP;
 END IF;
 IF jsonb_array_length(coalesce(c->'skills','[]'))+jsonb_array_length(coalesce(c->'desiredSkills','[]'))>0 THEN
   skill_score := (jsonb_array_length(matched)+jsonb_array_length(verified)*0.25+jsonb_array_length(desired_matched)*0.5)/(jsonb_array_length(coalesce(c->'skills','[]'))*1.25+jsonb_array_length(coalesce(c->'desiredSkills','[]'))*0.5);
 END IF;
 IF confirmed THEN
   test_score := greatest(0,least(100,coalesce((p->>'score')::numeric,0)))/100;
   IF coalesce(c->>'task','balanced')<>'balanced' THEN
   FOR dimension IN SELECT value FROM jsonb_array_elements(coalesce(p->'assessmentEvidence'->'dimensions','[]')) LOOP
     weight := coalesce((c->'weights'->>(dimension->>'dimension'))::numeric,1);
     level := CASE dimension->>'label' WHEN 'Сильная сторона' THEN 1 WHEN 'Соответствует' THEN 0.7 ELSE 0 END;
     competency_sum := competency_sum+weight*level; competency_weight := competency_weight+weight;
   END LOOP;
   IF competency_weight>0 AND coalesce(c->>'task','balanced')<>'balanced' THEN
     test_score := competency_sum/competency_weight;
   END IF;
   END IF;
 END IF;
 IF coalesce(p->>'fsp','')<>'' AND jsonb_array_length(coalesce(p->'competitionResults','[]'))>0 THEN
   FOR event IN SELECT DISTINCT ON(value->>'id') value FROM jsonb_array_elements(coalesce(p->'competitionResults','[]')) ORDER BY value->>'id',value->>'source' DESC LOOP
     IF coalesce(event->>'id','')='' THEN CONTINUE; END IF;
     IF event->>'source' NOT IN ('verified','demo') OR event->>'source' IS NULL THEN CONTINUE; END IF;
     relevance := CASE WHEN target='' THEN 0.5 WHEN coalesce(event->'specialties','[]') ? target THEN 1 ELSE 0 END;
     IF jsonb_array_length(coalesce(c->'skills','[]'))+jsonb_array_length(coalesce(c->'desiredSkills','[]'))>0 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(event->'skills','[]')) es
       JOIN jsonb_array_elements_text(coalesce(c->'skills','[]')||coalesce(c->'desiredSkills','[]')) ns
       ON offerly_skill_matches(es,ns,c)) THEN relevance := greatest(relevance,0.75); END IF;
     result_weight := CASE event->>'result' WHEN 'winner' THEN 1 WHEN 'prize' THEN 0.8 ELSE 0.4 END;
     sport_score := sport_score+relevance*result_weight;
     events := events || jsonb_build_array(event || jsonb_build_object('relevance',relevance));
   END LOOP;
 END IF;
 sport_score := least(1,sport_score/2);
 RETURN jsonb_build_object('policyVersion','employer-2','group',rank_group,
   'mode',mode,'test',test_score,'sport',sport_score,'skills',skill_score,
   'matched',matched,'verified',verified,'unknown',unknown,'desiredMatched',desired_matched,'events',events,
   'value',CASE mode WHEN 'test' THEN test_score*100 WHEN 'fsp' THEN sport_score*100
     ELSE test_score*50+skill_score*25+sport_score*25 END);
END
$$;


-- Stored generated fields are refreshed atomically on every profile update.
-- Keep large resume/project text out of per-row filtering and ranking; the full
-- original profile is still selected for the page and redacted by clientState.
CREATE OR REPLACE FUNCTION offerly_catalog_payload(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(p)
 WHERE key=ANY(ARRAY['jobStatus','name','email','skills','roles','city','salaryMin','salaryMax',
  'demonstration','claimed','headline','verified','region','preferredLocations','formats','format',
  'experience','specialty','grade','score','fsp','competitionResults','assessmentEvidence'])
$$;
CREATE OR REPLACE FUNCTION offerly_candidate_searchable(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(p->>'jobStatus','open')<>'paused'
 AND length(btrim(coalesce(p->>'name','')))>=2
 AND coalesce(p->>'email','') ~ '^\S+@\S+\.\S+$'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p->'skills','[]')) v WHERE length(btrim(v))>0)
 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p->'roles','[]')) v WHERE length(btrim(v))>0)
 AND length(btrim(coalesce(p->>'city','')))>0
 AND (p->>'salaryMin')::numeric BETWEEN 1 AND 10000000 AND (p->>'salaryMax')::numeric BETWEEN (p->>'salaryMin')::numeric AND 10000000 AND (p->>'salaryMin')::numeric=trunc((p->>'salaryMin')::numeric) AND (p->>'salaryMax')::numeric=trunc((p->>'salaryMax')::numeric)
$$;
ALTER TABLE candidate_profiles
 ADD COLUMN IF NOT EXISTS catalog_payload jsonb GENERATED ALWAYS AS (offerly_catalog_payload(payload)) STORED,
 ADD COLUMN IF NOT EXISTS catalog_eligible boolean GENERATED ALWAYS AS (visible AND consent AND offerly_candidate_searchable(payload)) STORED;
CREATE INDEX IF NOT EXISTS profiles_searchable ON candidate_profiles(specialty,grade,user_id,id) WHERE catalog_eligible;

INSERT INTO schema_migrations(id) VALUES ('023_matching_performance') ON CONFLICT DO NOTHING;
