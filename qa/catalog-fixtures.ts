// Run only with TEST_FIXTURE_DB pointing at a stopped, isolated PGlite QA database.
import { PGlite } from "@electric-sql/pglite";
import { readFile, writeFile } from "node:fs/promises";
import { searchVacancies, emptyVacancyFilters } from "../lib/vacancy-search";
import { searchCandidates } from "../lib/candidate-search";
import { profileCompletion } from "../lib/profile-completion";
import type { Profile, Job } from "../lib/model";
const dir = process.env.TEST_FIXTURE_DB;
if (!dir || !dir.includes("/work/portable-offerly/.data/"))
  throw new Error("Explicit isolated QA database required");
const file = "/tmp/offerly-session-catalog-qa.json";
const ctx = JSON.parse(await readFile(file, "utf8"));
const a = ctx.users[0],
  marker = ctx.marker;
const pg = new PGlite(dir);
await pg.waitReady;
const jobs: Job[] = [],
  profiles: Profile[] = [];
await pg.transaction(async (db) => {
  for (let i = 0; i < 2000; i++) {
    const job: Job = {
      id: `${marker}-job-${String(i).padStart(5, "0")}`,
      companyId: a.state.company.id,
      company: "Проверочная компания",
      title: `${marker} Разработчик ${i}`,
      description: "Продуктовая команда",
      specialty: i % 2 ? "Frontend" : "Backend",
      grade: i % 3 ? "Middle" : "Senior",
      min: 100000 + i * 100,
      max: 200000 + i * 100,
      skills: i % 2 ? ["React", "SQL"] : ["Python", "SQL"],
      format: i % 3 ? "Удалённо" : "Офис",
      city: i % 2 ? "Москва" : "Санкт-Петербург",
      region: "Россия",
      employment: i % 2 ? "Полная занятость" : "Частичная занятость",
      industry: i % 2 ? "Финтех" : "Образование",
      experienceMin: i % 4,
      experienceMax: (i % 4) + 3,
      status: "published",
      publishedAt: new Date(Date.now() - i * 60000).toISOString(),
      logo: "",
      mediaKeys: [],
      requirements: [],
      benefits: [],
    };
    jobs.push(job);
    await db.query(
      "INSERT INTO jobs(id,company_id,status,specialty,grade,min_salary,max_salary,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        job.id,
        job.companyId,
        job.status,
        job.specialty,
        job.grade,
        job.min,
        job.max,
        JSON.stringify(job),
      ],
    );
    const uid = crypto.randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,scope) VALUES($1,$2,$3,$4)",
      [uid, `${marker}-${i}@example.test`, "Синтетический Кандидат", "public"],
    );
    const p = {
      ...a.state.profile,
      name: `Кандидат ${i}`,
      email: `${marker}-${i}@example.test`,
      phone: "+7 (999) 123-45-67",
      headline: marker,
      specialty: i % 2 ? "Frontend" : "Backend",
      grade: i % 3 ? "Middle" : "Senior",
      skills: ["Python", "SQL"],
      roles: ["Разработчик"],
      verified: i % 2 ? ["React", "SQL"] : ["Python", "SQL"],
      city: i % 2 ? "Москва" : "Санкт-Петербург",
      preferredLocations: ["Казань"],
      salaryMin: 100000 + i * 100,
      salaryMax: 200000 + i * 100,
      experience: i % 12,
      formats: i % 4 === 0 ? ["Любой"] : i % 3 ? ["Удалённо"] : ["Офис"],
      format: "Удалённо",
      visible: true,
      consent: true,
      jobStatus: i % 11 === 0 ? "paused" : "open",
      score: i % 101,
      fsp: i % 5 === 0 ? `FSP-${i}` : null,
      achievements: i % 5 === 0 ? ["Хакатон"] : [],
      resumeKey: "private-resume",
      avatarKey: "private-avatar",
    } as Profile;
    if (i % 13 === 0) p.roles = [];
    const {
      rows: [row],
    } = await db.query<{ id: number }>(
      "INSERT INTO candidate_profiles(user_id,specialty,grade,visible,consent,payload) VALUES($1,$2,$3,true,true,$4) RETURNING id",
      [uid, p.specialty, p.grade, JSON.stringify(p)],
    );
    p.id = row.id;
    await db.query("UPDATE candidate_profiles SET payload=$2 WHERE id=$1", [
      p.id,
      JSON.stringify(p),
    ]);
    profiles.push(p);
  }
  const privateJob = { ...jobs[0], id: `${marker}-draft`, status: "draft" };
  ctx.privateJob = privateJob.id;
  await db.query(
    "INSERT INTO jobs(id,company_id,status,specialty,grade,min_salary,max_salary,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      privateJob.id,
      privateJob.companyId,
      privateJob.status,
      privateJob.specialty,
      privateJob.grade,
      privateJob.min,
      privateJob.max,
      JSON.stringify(privateJob),
    ],
  );
  const owner = crypto.randomUUID(),
    company = crypto.randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,scope,demo) VALUES($1,$2,$3,$4,true)",
    [
      owner,
      `${marker}-private@example.test`,
      "Закрытое демо",
      `demo:${marker}`,
    ],
  );
  await db.query(
    "INSERT INTO companies(id,owner_id,scope,payload) VALUES($1,$2,$3,$4)",
    [
      company,
      owner,
      `demo:${marker}`,
      JSON.stringify({ ...a.state.company, id: company }),
    ],
  );
  const privateScopeJob = {
    ...jobs[0],
    id: `${marker}-other-scope`,
    companyId: company,
  };
  ctx.otherScopeJob = privateScopeJob.id;
  await db.query(
    "INSERT INTO jobs(id,company_id,status,specialty,grade,min_salary,max_salary,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      privateScopeJob.id,
      company,
      privateScopeJob.status,
      privateScopeJob.specialty,
      privateScopeJob.grade,
      privateScopeJob.min,
      privateScopeJob.max,
      JSON.stringify(privateScopeJob),
    ],
  );
  await db.query(
    "UPDATE account_state SET payload=jsonb_set(payload,'{onboarded}','true') WHERE user_id=$1",
    [a.state.auth.userId],
  );
});
ctx.expected = { jobs: [], candidates: [] };
for (const filters of [
  { sort: "date" },
  { sort: "salary-desc" },
  { sort: "salary-asc" },
  { sort: "match" },
  { specialty: "Backend", grade: "Middle" },
  { skills: ["Python", "SQL"] },
  { industries: ["Финтех"] },
  { salaryMin: "230000", salaryMax: "240000" },
  { location: "Москва" },
  { employment: "Частичная занятость" },
  { format: "Офис" },
  { experience: "none" },
  { experience: "1-3" },
  { experience: "3-6" },
  { experience: "6+" },
  { companies: ["Проверочная компания"] },
  { companies: ["Проверочная компания"], excludeCompany: true },
  { query: "missing" },
]) {
  const f = {
    ...emptyVacancyFilters,
    ...filters,
    query: filters.query ? marker + " " + filters.query : marker,
  };
  const rows = searchVacancies(jobs, f, a.state.profile, []);
  ctx.expected.jobs.push({
    filters: filters.query ? { ...filters, query: undefined } : filters,
    total: rows.length,
    ids: rows.slice(0, 20).map((j) => j.id),
  });
}
// The missing-text case is checked separately by the HTTP suite; preserve the common marker there.
ctx.expected.jobs.pop();
for (const filters of [
  {},
  { sort: "По результату теста" },
  { spec: "Backend", grade: "Middle" },
  { skills: ["Python", "SQL"] },
  { location: "Казань" },
  { formats: ["Офис"] },
  { salaryMin: "230000", salaryMax: "240000" },
  { experienceMin: "3", experienceMax: "5" },
  { fsp: true },
  { spec: "Frontend", skills: ["React"], formats: ["Удалённо"], fsp: true },
]) {
  const f = {
    spec: "Все",
    grade: "Все",
    query: marker,
    fsp: false,
    savedOnly: false,
    sort: "По соответствию",
    ...filters,
  };
  const n = {
    id: "",
    title: "",
    specialty: f.spec,
    grade: f.grade,
    skills: ("skills" in f ? f.skills : []) || [],
    description: "",
    min: 180000,
    max: 230000,
    format: "Удалённо",
  };
  const rows = searchCandidates(
    profiles.filter(
      (p) => p.jobStatus !== "paused" && profileCompletion(p).ready,
    ),
    f,
    [],
    n,
  );
  ctx.expected.candidates.push({
    filters,
    total: rows.length,
    ids: rows.slice(0, 20).map((p) => p.id),
  });
}
await writeFile(file, JSON.stringify(ctx), { mode: 0o600 });
await pg.close();
console.log(
  "Prepared 2,000 jobs and 2,000 synthetic candidates with filter/rank references",
);
