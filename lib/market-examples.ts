import type { Database } from "@/db";
import { initialState } from "./model";

/** Fixed synthetic market listings, independent of any visitor's company or publications. */
export async function ensureMarketExamples(db: Database, scope: string) {
  if (scope !== "public") return;
  const jobs = initialState()
    .jobs.filter((job) => !job.employerOwned)
    .slice(0, 12);
  const marker = "offerly-market-example-" + jobs.at(-1)?.id;
  if ((await db.query("SELECT id FROM jobs WHERE id=$1", [marker])).rows.length)
    return;
  const owner = "offerly-market-examples";
  await db.query(
    "INSERT INTO users(id,email,name,scope,demo) VALUES ($1,$2,$3,$4,true) ON CONFLICT(id) DO NOTHING",
    [owner, "market-examples@offerly.test", "Примеры рынка", scope],
  );
  for (const job of jobs) {
    const companyId = "offerly-market-company-" + job.id;
    await db.query(
      "INSERT INTO companies(id,owner_id,scope,payload) VALUES ($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
      [
        companyId,
        owner,
        scope,
        JSON.stringify({
          id: companyId,
          name: job.company,
          description: job.companyDescription || "Демонстрационная компания",
          email: "",
          website: "",
        }),
      ],
    );
    const value = {
      ...job,
      id: "offerly-market-example-" + job.id,
      companyId,
      status: "published",
      employerOwned: false,
      demo: true,
    };
    await db.query(
      "INSERT INTO jobs(id,company_id,status,specialty,grade,min_salary,max_salary,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING",
      [
        value.id,
        companyId,
        "published",
        job.specialty,
        job.grade,
        job.min,
        job.max,
        JSON.stringify(value),
      ],
    );
  }
}
