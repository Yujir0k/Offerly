import { specialtyName } from "./assessment-tracks";
import { showcaseEnabled } from "./showcase-policy";
import { dashboardJobPredicate } from './catalog-preferences';
import { salaryRangeError } from './salary-range';
import { getDb } from '@/db';
import type { Account } from './platform';
import type { State, Role, Job, Profile } from './model';
import { clientState } from './store';
import { candidateFilterError } from './candidate-search';
import { vacancySalaryError } from './vacancy-search';
import { matchingContext, explainRanking, matchReasons } from './employer-matching';
import { canonicalSkillName } from './skills-ontology';
import { grades } from './model';
import { candidateOrderSql } from './candidate-order';
const key = (v: string) =>
  canonicalSkillName(v).trim().toLowerCase().replace(/ё/g, 'е');
const norm = (expr: string) => `replace(lower(coalesce(${expr},'')),'ё','е')`;
const text = (v: unknown) =>
  typeof v === 'string' ? v.trim().slice(0, 200) : '';
const array = (v: unknown) =>
  Array.isArray(v)
    ? v
        .slice(0, 30)
        .filter((x) => typeof x === 'string')
        .map(text)
    : [];
class Filter {
  values: unknown[] = [];
  clauses: string[] = [];
  bind(value: unknown) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
  add(sql: string) {
    this.clauses.push(sql);
  }
  includes(expr: string, value: unknown) {
    const v = text(value);
    if (v)
      this.add(
        `position(${this.bind(v.toLowerCase().replace(/ё/g, 'е'))} in ${norm(expr)})>0`,
      );
  }
  eq(expr: string, value: unknown) {
    const v = text(value);
    if (v && v !== 'Все') this.add(`${expr}=${this.bind(v)}`);
  }
  get where() {
    return this.clauses.join(' AND ') || 'true';
  }
}
// Mirrors the seven required profile fields; no incomplete or paused profile enters search.
export const eligibleCandidate = `p.catalog_eligible`;
function skillsSql(column: string, selected: string[], q: Filter) {
  if (!selected.length) return;
  const values = selected.map(key);
  q.add(
    `NOT EXISTS (SELECT 1 FROM unnest(${q.bind(values)}::text[]) selected WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(${column},'[]')) skill WHERE ${norm('skill')}=selected))`,
  );
}
export async function searchCatalog(
  account: Account,
  s: State,
  kind: 'jobs' | 'candidates',
  raw: Record<string, unknown>,
  role: Role,
  pageValue: unknown,
  scopeValue: unknown,
  options: { mode?: 'demo'; unseenSearchId?: string; countOnly?: boolean } = {},
): Promise<{
  items: (Job | Profile | undefined)[];
  total: number;
  page: number;
  pageSize: number;
  relaxations: { skill: string; total: number; added: number }[];
}> {
  const db = await getDb(),
    q = new Filter();
  const page = Math.max(
    1,
    Math.min(100000, Math.floor(Number(pageValue) || 1)),
  );
  const size = 20;
  let from: string, order: string, select: string;
  let rankFrom = '';
  let context: ReturnType<typeof matchingContext> | undefined;
  q.eq('u.scope', account.scope);
  q.add('u.deleted_at IS NULL');
  if (options.unseenSearchId)
    q.add(`NOT EXISTS(SELECT 1 FROM search_seen ss WHERE ss.search_id=${q.bind(options.unseenSearchId)} AND ss.item_id=${kind === 'jobs' ? 'j.id' : 'p.id::text'})`);
  if (kind === "jobs") {
    const f = raw;
    const error = vacancySalaryError({
      salaryMin: text(f.salaryMin),
      salaryMax: text(f.salaryMax),
    });
    if (error) throw new Error(error);
    from =
      "jobs j JOIN companies c ON c.id=j.company_id JOIN users u ON u.id=c.owner_id";
    select = "j.payload";
    if (!showcaseEnabled())
      q.add("coalesce((j.payload->>'demo')::boolean,false)=false");
    if (
      role === "employer" &&
      ["published", "draft", "archived"].includes(text(scopeValue))
    ) {
      q.eq("j.company_id", s.company.id);
      q.eq("j.status", scopeValue);
    } else if (f.applicationsOnly === true) {
      q.add(
        `EXISTS(SELECT 1 FROM applications a WHERE a.job_id=j.id AND a.candidate_id=${q.bind(s.profile.id)})`,
      );
      q.add("j.status IN ('published','archived')");
    } else q.add("j.status='published'");
    const haystack =
      "concat_ws(' ',j.payload->>'title',j.payload->>'company',j.payload->>'description',j.payload->>'city',j.specialty,j.payload->'skills')";
    for (const term of text(f.query).split(/\s+/).filter(Boolean))
      q.includes(haystack, term);
    q.eq("j.specialty", specialtyName(text(f.specialty)));
    q.eq("j.grade", f.grade);
    const sectors = array(f.industries);
    if (sectors.length)
      q.add(`j.payload->>'industry'=ANY(${q.bind(sectors)}::text[])`);
    skillsSql("j.payload->'skills'", array(f.skills), q);
    if (text(f.salaryMin))
      q.add(`j.max_salary>=${q.bind(Number(f.salaryMin))}`);
    if (text(f.salaryMax))
      q.add(`j.min_salary<=${q.bind(Number(f.salaryMax))}`);
    q.includes(
      "concat_ws(' ',j.payload->>'city',j.payload->>'region')",
      f.location,
    );
    q.eq("j.payload->>'employment'", f.employment);
    q.eq("j.payload->>'format'", f.format);
    const min = "coalesce((j.payload->>'experienceMin')::numeric,0)",
      max = "coalesce((j.payload->>'experienceMax')::numeric,1000)";
    if (f.experience === "none") q.add(`${min}=0`);
    if (f.experience === "1-3") q.add(`${min}<=3 AND ${max}>=1`);
    if (f.experience === "3-6") q.add(`${min}<=6 AND ${max}>=3`);
    if (f.experience === "6+") q.add(`${max}>=6`);
    const companies = array(f.companies).length
      ? array(f.companies)
      : text(f.company)
        ? [text(f.company)]
        : [];
    if (companies.length)
      q.add(
        `${f.excludeCompany === true ? "NOT " : ""}(${norm("j.payload->>'company'")}=ANY(${q.bind(companies.map((v) => v.toLowerCase().replace(/ё/g, "е")))}::text[]))`,
      );
    if (f.favoritesOnly === true)
      q.add(
        `EXISTS(SELECT 1 FROM favorite_jobs fav WHERE fav.job_id=j.id AND fav.user_id=${q.bind(account.id)})`,
      );
    if (f.recentOnly === true) {
      const profile = q.bind(
        JSON.stringify({
          ...s.profile,
          salaryValid: !salaryRangeError(
            s.profile.salaryMin,
            s.profile.salaryMax,
          ),
        }),
      );
      q.add(dashboardJobPredicate(profile, q.bind(s.profile.id)));
      q.add(
        `coalesce(j.payload->>'publishedAt','1970-01-01')<=${q.bind(new Date().toISOString())}`,
      );
      q.add(
        `coalesce(j.payload->>'publishedAt','1970-01-01')>=${q.bind(new Date(Date.now() - 7 * 86400000).toISOString())}`,
      );
    }
    const date = "coalesce(j.payload->>'publishedAt','1970-01-01') DESC,j.id";
    if (f.sort === "salary-desc") order = `j.max_salary DESC,${date}`;
    else if (f.sort === "salary-asc") order = `j.min_salary,${date}`;
    else if (f.sort === "date") order = date;
    else {
      const matched = `(SELECT count(*)::numeric FROM jsonb_array_elements_text(coalesce(j.payload->'skills','[]')) skill WHERE ${norm("skill")}=ANY(${q.bind(s.profile.verified.map(key))}::text[]))`;
      order = `((CASE WHEN j.specialty=${q.bind(s.profile.specialty)} THEN 40 ELSE 0 END)+(CASE WHEN j.grade=${q.bind(s.profile.grade || "")} THEN 20 ELSE 0 END)+coalesce(${matched}/nullif(jsonb_array_length(coalesce(j.payload->'skills','[]')),0)*40,0)) DESC,${date}`;
    }
  } else {
    if (role !== 'employer') throw new Error('Доступно только работодателю');
    const f = raw;
    const error = candidateFilterError({
      spec: '',
      grade: '',
      query: '',
      fsp: false,
      savedOnly: false,
      sort: '',
      salaryMin: text(f.salaryMin),
      salaryMax: text(f.salaryMax),
      experienceMin: text(f.experienceMin),
      experienceMax: text(f.experienceMax),
    });
    if (error) throw new Error(error);
    from = 'candidate_profiles p JOIN users u ON u.id=p.user_id';
    select = 'p.payload';
    if (!showcaseEnabled()) q.add("coalesce((p.payload->>'demonstration')::boolean,false)=false");
    q.add(`NOT EXISTS(SELECT 1 FROM blocked_companies bc WHERE bc.candidate_id=p.id AND bc.company_id=${q.bind(s.company.id)})`);
    q.add(eligibleCandidate);
    // Trusted service argument, never a browser/agent supplied filter. Applied before COUNT/LIMIT.
    if (options.mode === 'demo') q.add('u.demo=true');
    q.add(`p.id<>${q.bind(s.profile.id)}`);
    q.eq('p.specialty', specialtyName(text(f.spec)));
    const selectedGrades = array(f.grades).filter((grade) => grades.includes(grade));
    if (selectedGrades.length) {
      q.add(f.includeUnconfirmed === true
        ? `(p.grade=ANY(${q.bind(selectedGrades)}::text[]) OR (p.grade IS NULL AND p.payload->>'claimed'=ANY(${q.bind(selectedGrades)}::text[])))`
        : `p.grade=ANY(${q.bind(selectedGrades)}::text[])`);
    } else if (f.grade && f.grade !== 'Все') {
      if (f.includeUnconfirmed === true)
        q.add(
          `(p.grade=${q.bind(text(f.grade))} OR (p.grade IS NULL AND p.payload->>'claimed'=${q.bind(text(f.grade))}))`,
        );
      else q.eq('p.grade', f.grade);
    }
    if (f.confirmation === 'confirmed') q.add('p.grade IS NOT NULL');
    if (f.confirmation === 'unconfirmed') q.add('p.grade IS NULL');
    if (Array.isArray(f.ids))
      q.add(`p.id=ANY(${q.bind(f.ids.slice(0, 4).map(Number))}::integer[])`);
    if (/^\d+$/.test(text(f.query))) {
      if (Number(f.query) <= 2147483647)
        q.add(`p.id=${q.bind(Number(f.query))}`);
      else q.add('false');
    } else {
      for (const term of text(f.query).split(/\s+/).filter(Boolean))
        q.includes(
          "concat_ws(' ',p.id,p.specialty,p.payload->>'headline',p.payload->'roles',p.payload->'verified',p.payload->'skills',p.payload->>'city')",
          key(term),
        );
    }
    const selected = array(f.skills).length
      ? array(f.skills)
      : text(f.stack).split(',').filter(Boolean);
    context = matchingContext(
      { ...f, spec: text(f.rankSpec) || f.spec, grade: text(f.rankGrade) || f.grade },
      s.needs.find((n) => n.id === text(f.needId)) ||
        s.jobs.find(
          (j) => j.id === text(f.needId) && j.companyId === s.company.id,
        ),
    );
    if (selected.length) {
      const source =
        f.skillSource === 'verified'
          ? "coalesce(p.payload->'verified','[]')"
          : "(coalesce(p.payload->'verified','[]')||coalesce(p.payload->'skills','[]'))";
      const skillContext = q.bind(JSON.stringify({ aliases: context.aliases, alternatives: context.alternatives }));
      q.add(
        `NOT EXISTS(SELECT 1 FROM unnest(${q.bind(selected.map(key))}::text[]) wanted WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(${source}) skill WHERE offerly_skill_matches(skill,wanted,${skillContext}::jsonb)))`,
      );
    }
    q.includes(
      "concat_ws(' ',p.payload->>'city',p.payload->>'region',p.payload->'preferredLocations')",
      f.location,
    );
    const formats = array(f.formats);
    if (formats.length)
      q.add(
        `(coalesce(p.payload->'formats','[]') ? 'Любой' OR coalesce(p.payload->'formats','[]') ?| ${q.bind(formats)}::text[] OR (jsonb_array_length(coalesce(p.payload->'formats','[]'))=0 AND p.payload->>'format'=ANY(${q.bind(formats)}::text[])))`,
      );
    if (text(f.salaryMin))
      q.add(
        `(p.payload->>'salaryMax')::numeric>=${q.bind(Number(f.salaryMin))}`,
      );
    if (text(f.salaryMax))
      q.add(
        `(p.payload->>'salaryMin')::numeric<=${q.bind(Number(f.salaryMax))}`,
      );
    if (text(f.experienceMin))
      q.add(
        `(p.payload->>'experience')::numeric>=${q.bind(Number(f.experienceMin))}`,
      );
    if (text(f.experienceMax))
      q.add(
        `(p.payload->>'experience')::numeric<=${q.bind(Number(f.experienceMax))}`,
      );
    if (f.fsp === true || f.relevantFsp === true || text(f.discipline)) {
      const sportContext = q.bind(JSON.stringify(context));
      q.add(
        `EXISTS(SELECT 1 FROM jsonb_array_elements(offerly_candidate_rank(p.payload,${sportContext}::jsonb)->'events') e WHERE ${f.relevantFsp === true ? "(e->>'relevance')::numeric>0" : 'true'} ${text(f.discipline) ? `AND e->>'discipline'=${q.bind(text(f.discipline))}` : ''})`,
      );
    }
    if (text(f.testMin)) {
      const min = Number(f.testMin);
      if (!Number.isFinite(min) || min < 0 || min > 100)
        throw new Error('Результат теста должен быть от 0 до 100');
      q.add(
        `p.grade IS NOT NULL AND coalesce((p.payload->>'score')::numeric,0)>=${q.bind(min)}`,
      );
    }
    if (f.savedOnly === true)
      q.add(
        `EXISTS(SELECT 1 FROM saved_candidates saved WHERE saved.candidate_id=p.id AND saved.user_id=${q.bind(account.id)})`,
      );
    const rankingContext = q.bind(JSON.stringify(context));
    rankFrom = ` CROSS JOIN LATERAL (SELECT offerly_candidate_rank(p.payload,${rankingContext}::jsonb) AS metrics) r`;
    select = 'p.payload,r.metrics AS ranking';
    order = candidateOrderSql(f.sort, context.mode).replaceAll('p.payload', 'p.catalog_payload');
    q.clauses = q.clauses.map((clause) => clause.replaceAll('p.payload', 'p.catalog_payload'));
    rankFrom = rankFrom.replaceAll('p.payload', 'p.catalog_payload');
  }
  // Bindings used only by ORDER BY are harmless for the count query when supplied via a CTE.
  // Count before rank bindings to avoid untyped extra parameters in PostgreSQL.
  const used = Math.max(
    0,
    ...[...q.where.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
  );
  const {
    rows: [count],
  } = await db.query(
    `SELECT count(*)::integer AS total FROM ${from} WHERE ${q.where}`,
    q.values.slice(0, used),
  );
  const total = Number(count.total),
    actualPage = Math.min(page, Math.max(1, Math.ceil(total / size)));
  if (options.countOnly) return { items: [], total, page: actualPage, pageSize: size, relaxations: [] };
  const { rows } = await db.query(
    `SELECT ${select} FROM ${from}${rankFrom} WHERE ${q.where} ORDER BY ${order} LIMIT ${q.bind(size)} OFFSET ${q.bind((actualPage - 1) * size)}`,
    q.values,
  );
  const local = {
    ...s,
    jobs:
      kind === 'jobs'
        ? rows.map((r) => ({
            ...r.payload,
            employerOwned: r.payload.companyId === s.company.id,
          }))
        : s.jobs,
    candidates:
      kind === 'candidates'
        ? rows.map((r) => ({
            ...r.payload,
            ranking: explainRanking(r.payload, r.ranking, context!),
            match_reasons: matchReasons(r.payload, r.ranking, context!),
          }))
        : [],
  };
  // clientState includes the account's own candidate; remove it unless it belongs to this page.
  const safe = clientState(local, role);
  const byId = new Map(safe.candidates.map((p) => [p.id, p]));
  const relaxations: { skill: string; total: number; added: number }[] = [];
  if (
    kind === 'candidates' &&
    raw.suggestRelaxations === true &&
    total < 10 &&
    !raw.ids
  ) {
    for (const skill of (context?.skills || []).slice(0, 3)) {
      const relaxed = await searchCatalog(
        account,
        s,
        kind,
        {
          ...raw,
          skills: context!.skills.filter((v) => v !== skill),
          stack: '',
          suggestRelaxations: false,
        },
        role,
        1,
        scopeValue,
        options,
      );
      if (relaxed.total > total)
        relaxations.push({
          skill,
          total: relaxed.total,
          added: relaxed.total - total,
        });
    }
  }
  return {
    relaxations,
    items:
      kind === 'jobs'
        ? local.jobs
        : rows.map((r) => byId.get(r.payload.id)).filter(Boolean),
    total,
    page: actualPage,
    pageSize: size,
  };
}
