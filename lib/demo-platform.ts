import { initialState, normalizeState } from "./model";
import { setSession } from "./auth";
import { createAccount, type Account } from "./platform";
import { installSyntheticPopulation } from "./synthetic-population";
import { getDb } from "@/db";
export async function seedDemo(account: Account, seed = initialState()) {
  seed = normalizeState(seed);
  const id = account.id;
  await (
    await getDb()
  ).transaction(async (db) => {
    await createAccount(db, account, null, seed.company.name);
    const {
      rows: [own],
    } = await db.query("SELECT id FROM candidate_profiles WHERE user_id=$1", [
      id,
    ]);
    const remap = new Map<number, number>([[seed.profile.id, own.id]]);
    const profile = { ...seed.profile, id: own.id };
    await db.query(
      "UPDATE candidate_profiles SET payload=$2,specialty=$3,grade=$4,visible=$5,consent=$6 WHERE user_id=$1",
      [
        id,
        JSON.stringify(profile),
        profile.specialty,
        profile.grade,
        profile.visible,
        profile.consent,
      ],
    );
    for (const p of seed.candidates) {
      const uid = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,email,name,scope,demo) VALUES ($1,$2,$3,$4,true)",
        [uid, `demo-${uid}@example.test`, p.name, id],
      );
      const {
        rows: [r],
      } = await db.query(
        "INSERT INTO candidate_profiles(user_id,payload,specialty,grade,visible,consent) VALUES ($1,$2,$3,$4,true,true) RETURNING id",
        [uid, JSON.stringify(p), p.specialty, p.grade],
      );
      remap.set(p.id, r.id);
      await db.query("UPDATE candidate_profiles SET payload=$2 WHERE id=$1", [
        r.id,
        JSON.stringify({ ...p, id: r.id }),
      ]);
    }
    const {
      rows: [companyRow],
    } = await db.query(
      "SELECT company_id FROM company_memberships WHERE user_id=$1",
      [id],
    );
    const company = { ...seed.company, id: companyRow.company_id };
    await db.query("UPDATE companies SET payload=$2 WHERE id=$1", [
      company.id,
      JSON.stringify(company),
    ]);
    const others = new Map<string, string>();
    for (const j of seed.jobs) {
      let companyId = company.id;
      if (!j.employerOwned && j.companyId !== seed.company.id) {
        companyId = others.get(j.company) || crypto.randomUUID();
        if (!others.has(j.company)) {
          others.set(j.company, companyId);
          await db.query(
            "INSERT INTO companies(id,owner_id,scope,payload) VALUES ($1,$2,$3,$4)",
            [
              companyId,
              id,
              id,
              JSON.stringify({
                id: companyId,
                name: j.company,
                description:
                  j.companyDescription || "Демонстрационная компания",
                email: "demo@example.test",
                website: "",
              }),
            ],
          );
        }
      }
      const job = {
        ...j,
        companyId,
        employerOwned: companyId === company.id,
        status: j.status || "published",
        id: id + "-" + j.id,
      };
      await db.query(
        "INSERT INTO jobs(id,company_id,status,specialty,grade,min_salary,max_salary,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          job.id,
          companyId,
          job.status,
          j.specialty,
          j.grade,
          j.min,
          j.max,
          JSON.stringify(job),
        ],
      );
    }
    for (const n of seed.needs)
      await db.query(
        "INSERT INTO needs(id,company_id,payload) VALUES ($1,$2,$3)",
        [
          id + "-" + n.id,
          company.id,
          JSON.stringify({ ...n, id: id + "-" + n.id }),
        ],
      );
    // Incoming invitations need a distinct synthetic employer. The candidate's
    // own company cannot start a conversation with its owner.
    let incomingCompanyId = company.id;
    if (seed.invitations.some(i => i.candidateId === seed.profile.id)) {
      const employerId = crypto.randomUUID();
      incomingCompanyId = crypto.randomUUID();
      const name = seed.invitations.find(i => i.candidateId === seed.profile.id)!.company;
      await db.query("INSERT INTO users(id,email,name,scope,demo) VALUES($1,$2,$3,$4,true)",
        [employerId, `demo-${employerId}@example.test`, name, id]);
      await db.query("INSERT INTO companies(id,owner_id,scope,payload) VALUES($1,$2,$3,$4)",
        [incomingCompanyId, employerId, id, JSON.stringify({id: incomingCompanyId,
          name, description: "Демонстрационная команда", email: "team@example.test", website: ""})]);
      await db.query("INSERT INTO company_memberships(company_id,user_id,role) VALUES($1,$2,'owner')",
        [incomingCompanyId, employerId]);
    }
    for (const i of seed.invitations) {
      const value = {
        ...i,
        id: crypto.randomUUID(),
        companyId: i.candidateId === seed.profile.id ? incomingCompanyId : company.id,
        candidateId: remap.get(i.candidateId),
      };
      await db.query(
        "INSERT INTO invitations(id,company_id,candidate_id,status,min_salary,max_salary,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          value.id,
          company.id,
          value.candidateId,
          value.status,
          value.min,
          value.max,
          JSON.stringify(value),
        ],
      );
    }
    for (const a of seed.attempts || [])
      await db.query(
        "INSERT INTO assessments(id,user_id,payload) VALUES ($1,$2,$3)",
        [id + "-" + a.id, id, JSON.stringify({ ...a, id: id + "-" + a.id })],
      );
    for (const v of seed.surveys || [])
      await db.query(
        "INSERT INTO surveys(id,user_id,payload) VALUES ($1,$2,$3)",
        [id + "-" + v.id, id, JSON.stringify({ ...v, id: id + "-" + v.id })],
      );
    for (const a of seed.applications || []) {
      const value = {
        ...a,
        id: crypto.randomUUID(),
        candidateId: remap.get(a.candidateId || seed.profile.id) || own.id,
        jobId: id + "-" + a.jobId,
      };
      await db.query(
        "INSERT INTO applications(id,job_id,candidate_id,status,payload) VALUES ($1,$2,$3,$4,$5)",
        [
          value.id,
          value.jobId,
          value.candidateId,
          value.status,
          JSON.stringify(value),
        ],
      );
    }
    for (const j of seed.favoriteJobs || [])
      if (seed.jobs.some((job) => job.id === j))
        await db.query(
          "INSERT INTO favorite_jobs(user_id,job_id) VALUES ($1,$2)",
          [id, id + "-" + j],
        );
    for (const p of seed.saved || [])
      if (remap.has(p))
        await db.query(
          "INSERT INTO saved_candidates(user_id,candidate_id) VALUES ($1,$2)",
          [id, remap.get(p)],
        );
    await db.query("UPDATE account_state SET payload=$2 WHERE user_id=$1", [
      id,
      JSON.stringify({
        onboarded: seed.onboarded,
        notifications: true,
        journey: seed.journey,
        taskAnswer: "",
        role: "candidate",
      }),
    ]);
    await installSyntheticPopulation(db, id);
  });
  return account;
}

export async function createDemo() {
  const id = crypto.randomUUID(),
    seed = initialState();
  const account: Account = {
    id,
    name: seed.profile.name,
    email: `demo-${id}@example.test`,
    scope: id,
    demo: true,
    verified_at: null,
    deleted_at: null,
  };
  await seedDemo(account, seed);
  await setSession(account);
  return account;
}
