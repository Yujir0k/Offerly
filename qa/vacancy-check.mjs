import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
const root = await mkdtemp(join(tmpdir(), "offerly-vacancies-check-"));
try {
  for (const name of ["model", "vacancy-search", "job-applications"])
    await build({
      entryPoints: [`lib/${name}.ts`],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: join(root, `${name}.mjs`),
    });
  const { initialState, normalizeState } = await import(
    join(root, "model.mjs")
  );
  const {
    searchVacancies,
    emptyVacancyFilters,
    vacancySalaryError,
    vacancyMatch,
  } = await import(join(root, "vacancy-search.mjs"));
  const { employerApplications, applicationProfileError } = await import(
    join(root, "job-applications.mjs")
  );
  const s = initialState(),
    filter = (extra) =>
      searchVacancies(
        s.jobs,
        { ...emptyVacancyFilters, ...extra },
        s.profile,
        s.favoriteJobs,
      );
  assert.equal(s.jobs.length, 16);
  assert.equal(new Set(s.jobs.map((j) => j.company)).size, 8);
  const selectedIndustries = ["Финтех", "Образование"];
  const industryJobs = filter({ industries: selectedIndustries });
  assert.equal(industryJobs.length, 4);
  assert(industryJobs.every((job) => selectedIndustries.includes(job.industry)));
  assert.equal(new Set(industryJobs.map((job) => job.industry)).size, 2);
  assert.equal(filter({ industries: ["Несуществующая сфера"] }).length, 0);
  assert(
    s.jobs.every(
      (j) =>
        j.min <= j.max && j.logo && j.requirements.length && j.benefits.length,
    ),
  );
  assert(
    filter({ query: "React" }).every((j) =>
      `${j.title} ${j.description} ${j.skills.join(" ")}`.includes("React"),
    ),
  );
  assert(
    filter({ specialty: "QA", grade: "Junior" }).every(
      (j) => j.specialty === "QA" && j.grade === "Junior",
    ),
  );
  assert(
    filter({ skills: ["Python", "SQL"] }).every(
      (j) => j.skills.includes("Python") && j.skills.includes("SQL"),
    ),
  );
  assert(
    filter({ salaryMin: "250000", salaryMax: "300000" }).every(
      (j) => j.max >= 250000 && j.min <= 300000,
    ),
  );
  assert(vacancySalaryError({ salaryMin: "300000", salaryMax: "200000" }));
  assert(vacancySalaryError({ salaryMin: "-1", salaryMax: "" }));
  assert(vacancySalaryError({ salaryMin: "NaN", salaryMax: "" }));
  assert.equal(filter({ salaryMin: "300000", salaryMax: "200000" }).length, 16);
  assert(
    filter({ location: "Москва", format: "Гибрид" }).every(
      (j) => j.city === "Москва" && j.format === "Гибрид",
    ),
  );
  assert(filter({ experience: "none" }).every((j) => !j.experienceMin));
  assert(
    filter({ company: "Команда Орион", excludeCompany: true }).every(
      (j) => j.company !== "Команда Орион",
    ),
  );
  const high = filter({ sort: "salary-desc" });
  assert(high.every((j, i) => !i || high[i - 1].max >= j.max));
  const low = filter({ sort: "salary-asc" });
  assert(low.every((j, i) => !i || low[i - 1].min <= j.min));
  assert.equal(filter({ query: "nonexistent-vacancy-xyz" }).length, 0);
  s.favoriteJobs = ["job-backend"];
  assert.deepEqual(
    filter({ favoritesOnly: true }).map((j) => j.id),
    ["job-backend"],
  );
  s.profile.verified = [];
  assert.equal(vacancyMatch(s.jobs[0], s.profile).matched.length, 0);
  const again = normalizeState(normalizeState(s));
  assert.equal(again.jobs.length, 16);
  again.jobs.push({
    ...again.jobs[0],
    id: "custom",
    title: "Своя вакансия",
    employerOwned: true,
    company: "Своя компания",
  });
  again.applications = [
    { jobId: "job-backend", status: "Отправлен", createdAt: "" },
    { jobId: "job-go", status: "Отправлен", createdAt: "" },
    { jobId: "custom", status: "Отправлен", createdAt: "" },
  ];
  assert.deepEqual(
    employerApplications(again).map((a) => a.jobId),
    ["job-backend", "custom"],
  );
  again.company.name = "Вектор Финтех";
  assert.deepEqual(
    employerApplications(again).map((a) => a.jobId),
    ["job-backend", "custom"],
  );
  assert(applicationProfileError({ ...s.profile, name: "", email: "" }));
  console.log(
    "PASS: 16 vacancies, 8 logos; combined filters; salary edges; sort; favorites; empty results; migration; verified-only matching; employer ownership.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
