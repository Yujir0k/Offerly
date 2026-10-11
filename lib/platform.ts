import { ensureSyntheticPopulation } from "./synthetic-population";
import { ensureConversation } from "./conversations";
import { recordConsent } from "./consent";
import { ensureMarketExamples } from "./market-examples";
import { ensureShowcaseCatalog } from "./showcase-catalog";
import { showcaseEnabled } from "./showcase-policy";
import { dashboardJobPredicate } from "./catalog-preferences";
import { salaryRangeError } from "./salary-range";
import { query, getDb, type Database } from "@/db";
import {
  initialState,
  normalizeState,
  type State,
  type Profile,
  type CompanyProfile,
  type Job,
} from "./model";
import { withPersonalName } from "./personal-name";
import { profileInitials } from "./profile-identity";
import { enqueueInvitationMail, kickInvitationMail } from "./invitation-mail";
export type Account = {
  id: string;
  email: string;
  name: string;
  scope: string;
  demo: boolean;
  verified_at: string | null;
  deleted_at: string | null;
};
const baseline = new WeakMap<
  State,
  {
    state: State;
    account: Account;
    membership: string;
    raw: Record<string, Map<string | number, unknown>>;
  }
>();
const json = (v: unknown) =>
  JSON.stringify(v, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
const changed = (a: unknown, b: unknown) => json(a) !== json(b);
export function emptyProfile(name: string, email: string): Profile {
  return {
    ...initialState().profile,
    ...withPersonalName({ name }),
    initials: profileInitials({ ...initialState().profile, name }),
    id: 0,
    avatarKey: undefined,
    resumeKey: undefined,
    headline: "",
    phone: "",
    email,
    grade: null,
    claimed: "Junior",
    verified: [],
    score: 0,
    skills: [],
    city: "",
    country: "",
    region: "",
    preferredLocations: [],
    format: "",
    formats: [],
    employment: "",
    employmentTypes: [],
    availability: "",
    availabilities: [],
    experience: 0,
    bio: "",
    fsp: null,
    achievements: [],
    visible: true,
    consent: true,
    lastGradeChange: null,
    industry: "",
    roles: [],
    softSkills: [],
    languages: [],
    education: "",
    notes: "",
    links: [],
    workHistory: [],
    projects: "",
    salaryMin: 0,
    salaryMax: 0,
    jobStatus: "open",
  };
}
export async function createAccount(
  db: Database,
  account: Account,
  passwordHash: string | null,
  companyName = "",
) {
  await db.query(
    "INSERT INTO users(id,email,name,scope,demo,password_hash) VALUES ($1,$2,$3,$4,$5,$6)",
    [
      account.id,
      account.email,
      account.name,
      account.scope,
      account.demo,
      passwordHash,
    ],
  );
  const profile = emptyProfile(account.name, account.email);
  const {
    rows: [row],
  } = await db.query(
    "INSERT INTO candidate_profiles(user_id,payload,visible,consent) VALUES ($1,$2,true,true) RETURNING id",
    [account.id, json(profile)],
  );
  profile.id = row.id;
  await db.query("UPDATE candidate_profiles SET payload=$2 WHERE user_id=$1", [
    account.id,
    json(profile),
  ]);
  const company: CompanyProfile = {
    id: crypto.randomUUID(),
    name: companyName,
    description: "",
    email: account.email,
    website: "",
    contactName: account.name,
  };
  await db.query(
    "INSERT INTO companies(id,owner_id,scope,payload) VALUES ($1,$2,$3,$4)",
    [company.id, account.id, account.scope, json(company)],
  );
  await db.query(
    "INSERT INTO company_memberships(company_id,user_id,role) VALUES ($1,$2,'owner')",
    [company.id, account.id],
  );
  await db.query("INSERT INTO account_state(user_id,payload) VALUES ($1,$2)", [
    account.id,
    json({
      onboarded: true,
      notifications: true,
      journey: "profile",
      taskAnswer: "",
      role: "candidate",
    }),
  ]);
}
export async function loadPlatform(
  account: Account,
  targets: {
    jobId?: string;
    candidateId?: number;
    candidateIds?: number[];
    allOwnedJobs?: boolean;
    /** Read-only catalogue: exclude dashboard previews and history, keep fresh permissions. */
    catalogOnly?: boolean;
  } = {},
): Promise<State> {
  const db = await getDb();
  if (account.demo && account.scope === account.id)
    await ensureSyntheticPopulation(db, account.scope);
  await ensureMarketExamples(db, account.scope);
  await ensureShowcaseCatalog(db, account.scope);
  const {
    rows: [own],
  } = await db.query(
    "SELECT p.*,a.version,a.payload AS preferences FROM candidate_profiles p JOIN account_state a ON a.user_id=p.user_id WHERE p.user_id=$1",
    [account.id],
  );
  if (!own) throw new Error("AUTH");
  const {
    rows: [member],
  } = await db.query(
    "SELECT c.payload,m.role FROM company_memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,c.id LIMIT 1",
    [account.id],
  );
  if (!member) throw new Error("Нет доступа к компании");
  const company = member.payload as CompanyProfile;
  const publicFixtures = showcaseEnabled();
  const realJobs = (alias: string) =>
    publicFixtures
      ? "true"
      : `coalesce((${alias}.payload->>'demo')::boolean,false)=false`;
  const realProfiles = (alias: string) =>
    publicFixtures
      ? "true"
      : `coalesce((${alias}.payload->>'demonstration')::boolean,false)=false`;
  // The workspace carries a small preview and records linked to this account.
  // Search pages use SQL filters and LIMIT in /api/catalog; they never download the market.
  const { rows: profiles } = targets.catalogOnly ? {rows: []} : await db.query(
    `SELECT p.payload FROM candidate_profiles p JOIN users u ON p.user_id=u.id WHERE u.scope=$1 AND u.deleted_at IS NULL AND ${realProfiles("p")} AND p.user_id<>$2 AND (
      p.id IN (SELECT cp.id FROM candidate_profiles cp JOIN users cu ON cu.id=cp.user_id WHERE cu.scope=$1 AND cu.deleted_at IS NULL AND ${realProfiles("cp")} AND cp.visible AND cp.consent ORDER BY cp.id LIMIT 20)
      OR p.id=$3 OR p.id=ANY($5::integer[]) OR EXISTS(SELECT 1 FROM invitations i WHERE i.company_id=$4 AND i.candidate_id=p.id))`,
    [account.scope, account.id, targets.candidateId || null, company.id, targets.candidateIds || []],
  );
  const { rows: blockedRows } = await db.query(
    "SELECT candidate_id FROM blocked_companies WHERE company_id=$1",
    [company.id],
  );
  const blockedCandidateIds = blockedRows.map((r) => r.candidate_id);
  const preferences = JSON.stringify({
    ...own.payload,
    salaryValid: !salaryRangeError(
      own.payload.salaryMin,
      own.payload.salaryMax,
    ),
  });
  const preferred = dashboardJobPredicate("$6", "$3");
  const { rows: jobs } = await db.query(
    `SELECT j.payload FROM jobs j JOIN companies c ON j.company_id=c.id JOIN users u ON c.owner_id=u.id WHERE c.scope=$1 AND u.deleted_at IS NULL AND ${realJobs("j")} AND (j.status='published' OR j.company_id=$2 OR EXISTS(SELECT 1 FROM applications a WHERE a.job_id=j.id AND a.candidate_id=$3)) AND (
      j.id IN (SELECT sj.id FROM jobs sj JOIN companies sc ON sc.id=sj.company_id JOIN users su ON su.id=sc.owner_id WHERE sc.scope=$1 AND su.deleted_at IS NULL AND ${realJobs("sj")} AND sj.status='published' ORDER BY coalesce(sj.payload->>'publishedAt','1970-01-01') DESC,sj.id LIMIT 20)
      OR j.id IN (SELECT id FROM jobs WHERE company_id=$2 AND ${realJobs("jobs")} ORDER BY id LIMIT 20)
      OR j.id IN (SELECT dj.id FROM jobs dj JOIN companies dc ON dc.id=dj.company_id JOIN users du ON du.id=dc.owner_id WHERE dc.scope=$1 AND du.deleted_at IS NULL AND ${realJobs("dj")} AND dj.status='published' AND ${preferred.replaceAll("j.", "dj.")} ORDER BY coalesce(dj.payload->>'publishedAt','1970-01-01') DESC,dj.id LIMIT 20)
      OR j.id=$4 OR ($5 AND j.company_id=$2) OR EXISTS(SELECT 1 FROM applications a WHERE a.job_id=j.id AND (a.candidate_id=$3 OR j.company_id=$2)))`,
    [
      account.scope,
      company.id,
      own.id,
      targets.jobId || null,
      !!targets.allOwnedJobs,
      preferences,
    ],
  );
  const { rows: companies } = targets.catalogOnly ? {rows: []} : await db.query(
    `SELECT c.payload FROM companies c JOIN users u ON c.owner_id=u.id WHERE c.scope=$1 AND u.deleted_at IS NULL AND (c.id=$2 OR c.id=ANY($3::text[]) OR EXISTS(SELECT 1 FROM invitations i WHERE i.company_id=c.id AND i.candidate_id=$4))`,
    [account.scope, company.id, jobs.map((r) => r.payload.companyId), own.id],
  );
  const {
    rows: [catalogStats],
  } = targets.catalogOnly ? {rows: [{}]} : await db.query(
    `SELECT count(*) FILTER(WHERE j.status='published')::integer AS market,
    count(*) FILTER(WHERE j.company_id=$2 AND j.status='published')::integer AS published,
    count(*) FILTER(WHERE j.company_id=$2 AND j.status='draft')::integer AS draft,
    count(*) FILTER(WHERE j.company_id=$2 AND j.status='archived')::integer AS archived
    FROM jobs j JOIN companies c ON c.id=j.company_id JOIN users u ON u.id=c.owner_id WHERE c.scope=$1 AND u.deleted_at IS NULL AND ${realJobs("j")}`,
    [account.scope, company.id],
  );
  const {
    rows: [opportunities],
  } = targets.catalogOnly ? {rows: [{}]} : await db.query(
    `SELECT count(*)::integer AS opportunities, count(*) FILTER(WHERE (j.payload->>'publishedAt')::timestamptz BETWEEN now()-interval '7 days' AND now())::integer AS recent FROM jobs j JOIN companies c ON c.id=j.company_id JOIN users u ON u.id=c.owner_id WHERE c.scope=$1 AND u.deleted_at IS NULL AND ${realJobs("j")} AND j.status='published' AND ${dashboardJobPredicate("$2", "$3")}`,
    [account.scope, preferences, own.id],
  );
  Object.assign(catalogStats, opportunities);
  const { rows: invitations } = await db.query(
    "SELECT payload FROM invitations WHERE company_id=$1 OR candidate_id=$2",
    [company.id, own.id],
  );
  const { rows: applications } = await db.query(
    "SELECT a.payload FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.company_id=$1 OR a.candidate_id=$2",
    [company.id, own.id],
  );
  const list = async (table: string, field: string, value: unknown) =>
    (
      await db.query(`SELECT payload FROM ${table} WHERE ${field}=$1`, [value])
    ).rows.map((r) => r.payload);
  const saved = (
    await db.query(
      "SELECT candidate_id FROM saved_candidates WHERE user_id=$1",
      [account.id],
    )
  ).rows.map((r) => r.candidate_id);
  const favorites = (
    await db.query("SELECT job_id FROM favorite_jobs WHERE user_id=$1", [
      account.id,
    ])
  ).rows.map((r) => r.job_id);
  const s = normalizeState({
    ...initialState(),
    ...own.preferences,
    version: own.version,
    catalogStats,
    blockedCandidateIds,
    profile: { ...own.payload, id: own.id },
    company,
    candidates: profiles.map((r) => r.payload),
    companies: companies.map((r) => r.payload),
    jobs: jobs.map((r) => ({
      ...r.payload,
      employerOwned: r.payload.companyId === company.id,
    })),
    invitations: invitations.map((r) => r.payload),
    applications: applications.map((r) => r.payload),
    needs: await list("needs", "company_id", company.id),
    attempts: (targets.catalogOnly ? [] : await list("assessments", "user_id", account.id)).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    surveys: (targets.catalogOnly ? [] : await list("surveys", "user_id", account.id)).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    saved,
    favoriteJobs: favorites,
    auth: { demo: account.demo, userId: account.id },
    settings: { ...own.preferences.settings, email: account.email },
    accountDeletedAt: account.deleted_at || undefined,
    emailVerification: {
      email: account.email,
      status: account.verified_at ? "verified" : "unverified",
    },
  } as State);
  // No persistence baseline: this context is deliberately read-only and cannot be saved.
  if (targets.catalogOnly) return s;
  const raw: Record<string, Map<string | number, unknown>> = {
    candidate_profiles: new Map([[own.id, own.payload]]),
    companies: new Map([[company.id, company]]),
  };
  for (const [table, rows] of Object.entries({
    jobs,
    invitations,
    applications,
  }))
    raw[table] = new Map(rows.map((r) => [r.payload.id, r.payload]));
  for (const [table, key] of [
    ["needs", "needs"],
    ["assessments", "attempts"],
    ["surveys", "surveys"],
  ] as const)
    raw[table] = new Map(s[key].map((v) => [v.id, v]));
  for (const values of Object.values(raw))
    for (const [id, value] of values) values.set(id, structuredClone(value));
  baseline.set(s, {
    state: structuredClone(s),
    account,
    membership: member.role,
    raw,
  });
  return s;
}
async function replace(
  db: Database,
  table: string,
  id: string | number,
  old: unknown,
  value: unknown,
  extra: Record<string, unknown> = {},
) {
  const entries = Object.entries(extra),
    columns = entries.map(([key]) => key),
    values = entries.map(([, v]) => v);
  if (!old) {
    await db.query(
      `INSERT INTO ${table}(id,payload${columns.length ? "," + columns.join(",") : ""}) VALUES ($1,$2${values.map((_, i) => ",$" + (i + 3)).join("")})`,
      [id, json(value), ...values],
    );
  } else {
    const r = await db.query(
      `UPDATE ${table} SET payload=$2${columns.map((key, i) => `,${key}=$${i + 4}`).join("")} WHERE id=$1 AND payload=$3::jsonb RETURNING id`,
      [id, json(value), json(old), ...values],
    );
    if (!r.rows.length) throw new Error("CONFLICT");
  }
}
/** Persist only changed owned entities. Never replace another account's lists or stale records. */
export async function savePlatform(owner: string, s: State) {
  const context = baseline.get(s);
  if (!context || context.account.id !== owner) throw new Error("AUTH");
  const { state: old, account, membership } = context;
  const persist = (
    db: Database,
    table: string,
    id: string | number,
    previous: unknown,
    value: unknown,
    extra: Record<string, unknown> = {},
  ) =>
    replace(
      db,
      table,
      id,
      previous ? context.raw[table]?.get(id) || previous : undefined,
      value,
      extra,
    );
  const canEdit = membership === "owner" || membership === "recruiter";
  if (s.company.id !== old.company.id || s.profile.id !== old.profile.id)
    throw new Error("Недопустимый владелец");
  await (
    await getDb()
  ).transaction(async (db) => {
    const preferences = {
      settings: s.settings,
      onboarded: s.onboarded,
      notifications: s.notifications,
      taskAnswer: s.taskAnswer,
      journey: s.journey,
      role: s.role,
    };
    const guard = await db.query(
      "UPDATE account_state SET version=version+1,payload=$3 WHERE user_id=$1 AND version=$2 RETURNING version",
      [owner, old.version, json(preferences)],
    );
    if (!guard.rows.length) throw new Error("CONFLICT");
    if (account.deleted_at && !s.accountDeletedAt)
      throw new Error("Аккаунт удалён");
    if (s.accountDeletedAt) {
      if (membership !== "owner")
        throw new Error("Удаление общего аккаунта компании недоступно");
      await db.query('DELETE FROM mcp_employer_tokens WHERE user_id=$1 OR company_id=$2', [owner, s.company.id]);
      await db.query('DELETE FROM mcp_invitation_drafts WHERE user_id=$1 OR company_id=$2 OR candidate_id=$3', [owner, s.company.id, s.profile.id]);
      await db.query(
        "DELETE FROM conversations WHERE candidate_id=$1 OR company_id=$2",
        [s.profile.id, s.company.id],
      );
      await db.query(
        "DELETE FROM invitations WHERE candidate_id=$1 OR company_id=$2",
        [s.profile.id, s.company.id],
      );
      await db.query(
        "DELETE FROM applications WHERE candidate_id=$1 OR job_id IN (SELECT id FROM jobs WHERE company_id=$2)",
        [s.profile.id, s.company.id],
      );
      await db.query(
        "DELETE FROM hiring_processes WHERE candidate_id=$1 OR company_id=$2",
        [s.profile.id, s.company.id],
      );
      await db.query(
        "DELETE FROM blocked_companies WHERE candidate_id=$1 OR company_id=$2",
        [s.profile.id, s.company.id],
      );
      for (const table of ["needs", "jobs"])
        await db.query(`DELETE FROM ${table} WHERE company_id=$1`, [
          s.company.id,
        ]);
      for (const table of [
        "surveys",
        "assessments",
        "professional_assessment_records",
        "saved_candidates",
        "favorite_jobs",
        "drafts",
        "sessions",
        "email_challenges",
        "email_change_flows",
        "external_identities",
        "oidc_flows",
        "password_reset_flows",
        "saved_searches",
        "consent_events",
      ])
        await db.query(`DELETE FROM ${table} WHERE user_id=$1`, [owner]);
      await db.query(
        "UPDATE users SET deleted_at=now(),password_hash=NULL,name=$2,email=$3 WHERE id=$1",
        [owner, "Удалённый аккаунт", `deleted-${owner}@invalid.example`],
      );
    }
    if (changed(s.profile, old.profile)) {
      if (!s.accountDeletedAt && s.profile.consent !== old.profile.consent)
        await recordConsent(db, owner, "profile-matching", s.profile.consent);
      if (!s.accountDeletedAt && s.profile.visible !== old.profile.visible)
        await recordConsent(db, owner, "profile-visibility", s.profile.visible);
      // A private PDF cannot be made public merely by setting an arbitrary key.
      for (const field of ["resumeKey", "avatarKey"] as const)
        if (s.profile[field] && !s.profile[field]!.startsWith(`${field === "resumeKey" ? "resumes" : "avatars"}/${owner}/`))
          throw new Error("Файл другого пользователя");
      await persist(
        db,
        "candidate_profiles",
        s.profile.id,
        old.profile,
        s.profile,
        {
          specialty: s.profile.specialty,
          grade: s.profile.grade,
          visible: s.profile.visible,
          consent: s.profile.consent,
        },
      );
    }
    if (changed(s.company, old.company)) {
      if (!canEdit) throw new Error("Недостаточно прав для изменения компании");
      await persist(db, "companies", s.company.id, old.company, s.company);
    }
    if (!s.accountDeletedAt) {
      for (const removed of old.needs.filter(n => !s.needs.some(current => current.id === n.id))) {
        if (!canEdit) throw new Error('Недостаточно прав');
        await db.query('DELETE FROM needs WHERE id=$1 AND company_id=$2', [removed.id, s.company.id]);
      }
      for (const [table, listKey, ownerColumn, ownerValue] of [
        ["jobs", "jobs", "company_id", s.company.id],
        ["needs", "needs", "company_id", s.company.id],
        ["assessments", "attempts", "user_id", owner],
        ["surveys", "surveys", "user_id", owner],
      ] as const) {
        for (const value of s[listKey]) {
          const previous = old[listKey].find(
            (v) => v.id === value.id,
          );
          if (!changed(value, previous)) continue;
          if ((table === "jobs" || table === "needs") && !canEdit)
            throw new Error("Недостаточно прав");
          if (table === "jobs" && (value as Job).companyId !== s.company.id)
            throw new Error("Вакансия другой компании");
          const extra: Record<string, unknown> = { [ownerColumn]: ownerValue };
          if (table === "jobs")
            Object.assign(extra, {
              status: (value as Job).status || "published",
              specialty: (value as Job).specialty,
              grade: (value as Job).grade,
              min_salary: (value as Job).min,
              max_salary: (value as Job).max,
            });
          await persist(db, table, value.id, previous, value, extra);
        }
      }
      for (const value of s.invitations) {
        const previous = old.invitations.find((v) => v.id === value.id);
        if (!changed(value, previous)) continue;
        if (value.companyId === s.company.id && canEdit) {
          if (previous) {
            if (!["sent", "viewed"].includes(previous.status)) throw new Error("Приглашение уже завершено");
            const allowed = new Set(["title", "description", "min", "max", "contact", "format", "city", "grade", "skills", "status", "readAt", "updatedAt", "cancelledAt"]);
            if ([...new Set([...Object.keys(value), ...Object.keys(previous)])].some(k =>
              !allowed.has(k) && changed(value[k as keyof typeof value], previous[k as keyof typeof previous])))
              throw new Error("Нельзя изменять получателя или источник приглашения");
            if (!["sent", "cancelled"].includes(value.status) || !value.updatedAt ||
                (value.status === "sent" && value.readAt) ||
                (value.status === "cancelled" && !value.cancelledAt))
              throw new Error("Недопустимое изменение приглашения");
          }
          await db.query(
            "SELECT id FROM candidate_profiles WHERE id=$1 FOR UPDATE",
            [value.candidateId],
          );
          const target = await db.query(
            "SELECT p.id FROM candidate_profiles p JOIN users u ON p.user_id=u.id WHERE p.id=$1 AND u.scope=$2 AND u.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM blocked_companies bc WHERE bc.candidate_id=p.id AND bc.company_id=$3)",
            [value.candidateId, account.scope, s.company.id],
          );
          if (!target.rows.length) throw new Error("Кандидат недоступен");
        } else if (previous && value.candidateId === s.profile.id) {
          const onlyStatus = {
            ...previous,
            status: value.status,
            readAt: value.readAt,
            respondedAt: value.respondedAt,
            declineReason: value.declineReason,
          };
          if (changed(value, onlyStatus))
            throw new Error("Нельзя изменять предложение работодателя");
        } else throw new Error("Приглашение другого аккаунта");
        await persist(db, "invitations", value.id, previous, value, {
          company_id: value.companyId,
          candidate_id: value.candidateId,
          status: value.status,
          min_salary: value.min,
          max_salary: value.max,
        });
        if (!previous && value.status === "sent") await enqueueInvitationMail(db, value);
        if (
          value.candidateId === s.profile.id &&
          value.status === "accepted" &&
          previous?.status !== "accepted"
        )
          await recordConsent(db, owner, "company-contacts", true, {
            companyId: value.companyId,
            invitationId: value.id,
          });
        if (value.status === "accepted")
          await ensureConversation(db, value.companyId!, value.candidateId);
        const contextKey = value.needId
          ? "need:" + value.needId
          : "invitation:" + value.id;
        await db.query(
          `INSERT INTO hiring_processes(id,company_id,candidate_id,context_key,title,stage) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(company_id,candidate_id,context_key) DO UPDATE SET title=excluded.title,stage=CASE WHEN hiring_processes.stage IN ('saved','invited') OR (hiring_processes.stage='closed' AND excluded.stage='invited') THEN excluded.stage ELSE hiring_processes.stage END,updated_at=clock_timestamp()`,
          [
            crypto.randomUUID(),
            value.companyId,
            value.candidateId,
            contextKey,
            value.title,
            value.status === "accepted"
              ? "talking"
              : ["declined", "cancelled"].includes(value.status)
                ? "closed"
                : "invited",
          ],
        );
      }
      for (const value of s.applications) {
        const previous = old.applications.find((v) => v.id === value.id);
        if (!changed(value, previous)) continue;
        const job = s.jobs.find((j) => j.id === value.jobId);
        if (!previous) {
          if (
            value.candidateId !== s.profile.id ||
            !job ||
            job.status !== "published"
          )
            throw new Error("Отклик недоступен");
        } else {
          if (
            job?.companyId !== s.company.id ||
            !canEdit ||
            changed(value, {
              ...previous,
              status: value.status,
              updatedAt: value.updatedAt,
            })
          )
            throw new Error("Отклик другой компании");
        }
        await persist(db, "applications", value.id!, previous, value, {
          job_id: value.jobId,
          candidate_id: value.candidateId,
          status: value.status,
        });
        if (!previous && job)
          await recordConsent(db, owner, "company-contacts", true, {
            companyId: job.companyId,
            applicationId: value.id,
          });
        if (!previous && job)
          await ensureConversation(db, job.companyId!, value.candidateId!);
        if (!previous && job)
          await db.query(
            `INSERT INTO hiring_processes(id,company_id,candidate_id,context_key,title,stage) VALUES($1,$2,$3,$4,$5,'talking') ON CONFLICT(company_id,candidate_id,context_key) DO NOTHING`,
            [
              crypto.randomUUID(),
              job.companyId,
              value.candidateId,
              "job:" + job.id,
              job.title,
            ],
          );
      }
      for (const [table, column, key] of [
        ["saved_candidates", "candidate_id", "saved"],
        ["favorite_jobs", "job_id", "favoriteJobs"],
      ] as const) {
        if (!changed(s[key], old[key])) continue;
        for (const id of old[key])
          if (!(s[key] as (string | number)[]).includes(id))
            await db.query(
              `DELETE FROM ${table} WHERE user_id=$1 AND ${column}=$2`,
              [owner, id],
            );
        for (const id of s[key]) {
          if ((old[key] as (string | number)[]).includes(id)) continue;
          const valid =
            table === "saved_candidates"
              ? await db.query(
                  "SELECT p.id FROM candidate_profiles p JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND u.scope=$2 AND u.deleted_at IS NULL AND p.visible AND p.consent AND NOT EXISTS(SELECT 1 FROM blocked_companies bc WHERE bc.candidate_id=p.id AND bc.company_id=$3)",
                  [id, account.scope, s.company.id],
                )
              : await db.query(
                  "SELECT j.id FROM jobs j JOIN companies c ON c.id=j.company_id JOIN users u ON u.id=c.owner_id WHERE j.id=$1 AND c.scope=$2 AND u.deleted_at IS NULL AND j.status='published'",
                  [id, account.scope],
                );
          if (!valid.rows.length)
            throw new Error(
              table === "saved_candidates"
                ? "Кандидат недоступен"
                : "Вакансия недоступна",
            );
          await db.query(
            `INSERT INTO ${table}(user_id,${column}) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [owner, id],
          );
        }
      }
    }
  });
  s.version = old.version + 1;
  for (const [table, key] of [
    ["candidate_profiles", "profile"],
    ["companies", "company"],
    ["jobs", "jobs"],
    ["invitations", "invitations"],
    ["applications", "applications"],
    ["needs", "needs"],
    ["assessments", "attempts"],
    ["surveys", "surveys"],
  ] as const) {
    const values = Array.isArray(s[key]) ? s[key] : [s[key]];
    context.raw[table] = new Map(values.map((v) => [v.id, v]));
  }
  baseline.set(s, { ...context, state: structuredClone(s) });
  // Dispatch after commit only. SMTP latency/failure must not undo an invitation or hold its HTTP response.
  kickInvitationMail();
}
export async function accountById(id: string) {
  return (
    (
      await query<Account>(
        "SELECT id,email,name,scope,demo,verified_at,deleted_at FROM users WHERE id=$1 AND deleted_at IS NULL",
        [id],
      )
    ).rows[0] || null
  );
}

export function inheritPlatformContext(copy: State, source: State) {
  const context = baseline.get(source);
  if (context) baseline.set(copy, context);
}
