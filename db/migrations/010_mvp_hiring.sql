-- Additive migration. No users, attempts or frozen assessment configurations are replaced.
CREATE TABLE IF NOT EXISTS blocked_companies (
 candidate_id integer NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
 company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(candidate_id,company_id)
);
CREATE TABLE IF NOT EXISTS hiring_processes (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 candidate_id integer NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
 context_key text NOT NULL, title text NOT NULL,
 stage text NOT NULL DEFAULT 'saved' CHECK(stage IN ('saved','invited','talking','interview','offer','closed')),
 note text NOT NULL DEFAULT '', reminder_at timestamptz,
 revision integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,candidate_id,context_key)
);
CREATE TABLE IF NOT EXISTS interview_meetings (
 id text PRIMARY KEY, process_id text NOT NULL REFERENCES hiring_processes(id) ON DELETE CASCADE,
 slots jsonb NOT NULL, timezone text NOT NULL, duration integer NOT NULL CHECK(duration BETWEEN 15 AND 180),
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','confirmed','cancelled')),
 selected_at timestamptz, revision integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_meeting ON interview_meetings(process_id) WHERE status IN ('proposed','confirmed');
CREATE TABLE IF NOT EXISTS saved_searches (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('candidate','employer')), name text NOT NULL,
 filters jsonb NOT NULL, enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS search_seen (
 search_id text NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
 item_id text NOT NULL, seen_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(search_id,item_id)
);
CREATE TABLE IF NOT EXISTS company_tasks (
 id text PRIMARY KEY, process_id text NOT NULL REFERENCES hiring_processes(id) ON DELETE CASCADE,
 title text NOT NULL, questions jsonb NOT NULL, period_days integer NOT NULL CHECK(period_days BETWEEN 1 AND 90),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS company_task_answers (
 task_id text NOT NULL REFERENCES company_tasks(id) ON DELETE CASCADE,
 occurrence integer NOT NULL, answers jsonb NOT NULL, score integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(task_id,occurrence)
);
CREATE TABLE IF NOT EXISTS consent_events (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 version text NOT NULL, purpose text NOT NULL, granted boolean NOT NULL, context jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS processes_company ON hiring_processes(company_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS processes_candidate ON hiring_processes(candidate_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS searches_owner ON saved_searches(user_id,role);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE id='010_mvp_hiring') THEN
  INSERT INTO hiring_processes(id,company_id,candidate_id,context_key,title,stage)
  SELECT 'invite:'||i.id,i.company_id,i.candidate_id,CASE WHEN length(coalesce(i.payload->>'needId',''))>0 THEN 'need:'||(i.payload->>'needId') ELSE 'invitation:'||i.id END,coalesce(i.payload->>'title','Знакомство с командой'),CASE i.status WHEN 'accepted' THEN 'talking' WHEN 'declined' THEN 'closed' ELSE 'invited' END FROM invitations i ON CONFLICT DO NOTHING;
  INSERT INTO hiring_processes(id,company_id,candidate_id,context_key,title,stage)
  SELECT 'application:'||a.id,j.company_id,a.candidate_id,'job:'||j.id,coalesce(j.payload->>'title','Знакомство с командой'),'talking' FROM applications a JOIN jobs j ON j.id=a.job_id ON CONFLICT DO NOTHING;
  -- Legacy public labels only. Historical surveys/attempts remain byte-for-byte intact.
  UPDATE candidate_profiles SET specialty=CASE specialty WHEN 'QA' THEN 'QA / QA Automation' WHEN 'Data' THEN 'Data Engineering' WHEN 'Data Scientist' THEN 'Data Scientist / Applied ML' WHEN 'MLOps' THEN 'MLOps / ML Platform Engineer' WHEN 'GenAI' THEN 'GenAI / LLM Engineer' ELSE specialty END;
  UPDATE candidate_profiles SET payload=jsonb_set(payload,'{specialty}',to_jsonb(specialty));
  UPDATE jobs SET specialty=CASE specialty WHEN 'QA' THEN 'QA / QA Automation' WHEN 'Data' THEN 'Data Engineering' WHEN 'Data Scientist' THEN 'Data Scientist / Applied ML' WHEN 'MLOps' THEN 'MLOps / ML Platform Engineer' WHEN 'GenAI' THEN 'GenAI / LLM Engineer' ELSE specialty END;
  UPDATE jobs SET payload=jsonb_set(payload,'{specialty}',to_jsonb(specialty));
  UPDATE needs SET payload=jsonb_set(payload,'{specialty}',to_jsonb(CASE payload->>'specialty' WHEN 'QA' THEN 'QA / QA Automation' WHEN 'Data' THEN 'Data Engineering' WHEN 'Data Scientist' THEN 'Data Scientist / Applied ML' WHEN 'MLOps' THEN 'MLOps / ML Platform Engineer' WHEN 'GenAI' THEN 'GenAI / LLM Engineer' ELSE payload->>'specialty' END)) WHERE payload ? 'specialty';
 END IF;
END $$;
INSERT INTO schema_migrations(id) VALUES ('010_mvp_hiring') ON CONFLICT DO NOTHING;
