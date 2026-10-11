-- Upgrade only explicitly synthetic demo accounts. Never infer real achievements.
UPDATE candidate_profiles p SET payload=jsonb_set(p.payload,'{competitionResults}',jsonb_build_array(jsonb_build_object(
 'id','demo-event-'||p.id,'title',p.payload->'achievements'->>0,'date','2025-11-01',
 'discipline',CASE WHEN p.id%2=1 THEN 'Продуктовая разработка' ELSE 'Алгоритмическое программирование' END,
 'specialties',jsonb_build_array(p.specialty),'skills',coalesce(p.payload->'skills','[]'::jsonb),
 'result',CASE WHEN p.id%2=1 THEN 'prize' ELSE 'participation' END,'team',true,'source','demo'
))) FROM users u WHERE u.id=p.user_id AND u.demo=true
 AND coalesce(p.payload->>'fsp','')<>''
 AND jsonb_array_length(coalesce(p.payload->'achievements','[]'::jsonb))>0
 AND jsonb_array_length(coalesce(p.payload->'competitionResults','[]'::jsonb))=0;
INSERT INTO schema_migrations(id) VALUES ('016_demo_competitions') ON CONFLICT DO NOTHING;
