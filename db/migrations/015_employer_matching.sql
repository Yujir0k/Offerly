-- A single server policy supplies both ordering and explanations.
CREATE OR REPLACE FUNCTION offerly_skill_key(value text, context jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(context->'aliases'->>replace(lower(btrim(value)),'ё','е'),replace(lower(btrim(value)),'ё','е'))
$$;

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
 FOR skill IN SELECT jsonb_array_elements_text(coalesce(c->'skills','[]')) LOOP
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p->'verified','[]')) v WHERE offerly_skill_key(v,c)=offerly_skill_key(skill,c)) THEN
     verified := verified || jsonb_build_array(skill); matched := matched || jsonb_build_array(skill);
   ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p->'skills','[]')) v WHERE offerly_skill_key(v,c)=offerly_skill_key(skill,c)) THEN
     matched := matched || jsonb_build_array(skill);
   ELSE unknown := unknown || jsonb_build_array(skill); END IF;
 END LOOP;
 FOR skill IN SELECT jsonb_array_elements_text(coalesce(c->'desiredSkills','[]')) LOOP
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p->'verified','[]')||coalesce(p->'skills','[]')) v WHERE offerly_skill_key(v,c)=offerly_skill_key(skill,c)) THEN
     desired_matched := desired_matched || jsonb_build_array(skill);
   END IF;
 END LOOP;
 IF jsonb_array_length(coalesce(c->'skills','[]'))+jsonb_array_length(coalesce(c->'desiredSkills','[]'))>0 THEN
   skill_score := (jsonb_array_length(matched)+jsonb_array_length(verified)*0.25+jsonb_array_length(desired_matched)*0.5)/(jsonb_array_length(coalesce(c->'skills','[]'))*1.25+jsonb_array_length(coalesce(c->'desiredSkills','[]'))*0.5);
 END IF;
 IF confirmed THEN
   test_score := greatest(0,least(100,coalesce((p->>'score')::numeric,0)))/100;
   FOR dimension IN SELECT value FROM jsonb_array_elements(coalesce(p->'assessmentEvidence'->'dimensions','[]')) LOOP
     weight := coalesce((c->'weights'->>(dimension->>'dimension'))::numeric,1);
     level := CASE dimension->>'label' WHEN 'Сильная сторона' THEN 1 WHEN 'Соответствует' THEN 0.7 ELSE 0 END;
     competency_sum := competency_sum+weight*level; competency_weight := competency_weight+weight;
   END LOOP;
   IF competency_weight>0 AND coalesce(c->>'task','balanced')<>'balanced' THEN
     test_score := competency_sum/competency_weight;
   END IF;
 END IF;
 IF coalesce(p->>'fsp','')<>'' THEN
   FOR event IN SELECT DISTINCT ON(value->>'id') value FROM jsonb_array_elements(coalesce(p->'competitionResults','[]')) ORDER BY value->>'id',value->>'source' DESC LOOP
     IF coalesce(event->>'id','')='' THEN CONTINUE; END IF;
     IF event->>'source' NOT IN ('verified','demo') OR event->>'source' IS NULL THEN CONTINUE; END IF;
     relevance := CASE WHEN target='' THEN 0.5 WHEN coalesce(event->'specialties','[]') ? target THEN 1 ELSE 0 END;
     IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(event->'skills','[]')) es
       JOIN jsonb_array_elements_text(coalesce(c->'skills','[]')||coalesce(c->'desiredSkills','[]')) ns
       ON offerly_skill_key(es,c)=offerly_skill_key(ns,c)) THEN relevance := greatest(relevance,0.75); END IF;
     result_weight := CASE event->>'result' WHEN 'winner' THEN 1 WHEN 'prize' THEN 0.8 ELSE 0.4 END;
     sport_score := sport_score+relevance*result_weight;
     events := events || jsonb_build_array(event || jsonb_build_object('relevance',relevance));
   END LOOP;
 END IF;
 sport_score := least(1,sport_score/2);
 RETURN jsonb_build_object('policyVersion','employer-1','group',rank_group,
   'mode',mode,'test',test_score,'sport',sport_score,'skills',skill_score,
   'matched',matched,'verified',verified,'unknown',unknown,'desiredMatched',desired_matched,'events',events,
   'value',CASE mode WHEN 'test' THEN test_score*100 WHEN 'fsp' THEN sport_score*100
     ELSE test_score*60+skill_score*25+sport_score*15 END);
END
$$;

-- Only copy the already public, frozen result of the currently confirmed category.
WITH latest AS (
 SELECT DISTINCT ON (a.user_id) a.user_id,a.payload FROM assessments a
 JOIN candidate_profiles p ON p.user_id=a.user_id
 WHERE a.payload->>'passed'='true' AND a.payload->>'formal'='true'
 AND a.payload->>'specialty'=p.specialty AND a.payload->>'grade'=p.grade
 ORDER BY a.user_id,a.payload->>'completedAt' DESC,a.id DESC
)
UPDATE candidate_profiles p SET payload=jsonb_set(p.payload,'{assessmentEvidence}',jsonb_build_object(
 'confirmedAt',l.payload->>'completedAt','assessmentVersion',l.payload->>'assessmentVersion',
 'scoringConfigVersion',l.payload->>'scoringConfigVersion','dimensions',l.payload->'result'->'dimensions'))
FROM latest l WHERE l.user_id=p.user_id AND NOT p.payload ? 'assessmentEvidence';
INSERT INTO schema_migrations(id) VALUES ('015_employer_matching') ON CONFLICT DO NOTHING;
