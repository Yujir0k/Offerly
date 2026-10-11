import { parseRequestJson } from "@/lib/request-security";
import { workspace, errorResponse, clientState } from "@/lib/store";
import { searchCatalog } from "@/lib/catalog";
import { currentAccount } from "@/lib/auth";
import { query } from "@/db";
import { showcaseEnabled } from "@/lib/showcase-policy";
export async function GET(
  request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  try {
    const { kind } = await context.params;
    const fixtures = showcaseEnabled();
    if (kind === "companies") {
      const account = await currentAccount();
      if (!account) throw new Error("AUTH");
      const term = (new URL(request.url).searchParams.get("query") || "")
        .trim()
        .slice(0, 100)
        .toLowerCase();
      const { rows } = await query(
        "SELECT DISTINCT j.payload->>'company' AS name FROM jobs j JOIN companies c ON c.id=j.company_id JOIN users u ON u.id=c.owner_id WHERE c.scope=$1 AND u.deleted_at IS NULL AND j.status='published' AND ($3 OR coalesce((j.payload->>'demo')::boolean,false)=false) AND position($2 in lower(j.payload->>'company'))>0 ORDER BY name LIMIT 50",
        [account.scope, term, fixtures],
      );
      return Response.json(
        { items: rows.map((r) => r.name) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (kind !== "jobs" && kind !== "candidates")
      return Response.json({ error: "Каталог не найден" }, { status: 404 });
    const url = new URL(request.url),
      params = url.searchParams;
    if (url.search.length > 10000) throw new Error("Слишком большой запрос");
    const { account, state } = await workspace({catalogOnly: true});
    const role = params.get("role") === "employer" ? "employer" : "candidate";
    const jobId = params.get("job");
    if (kind === "jobs" && jobId) {
      const {
        rows: [row],
      } = await query(
        "SELECT j.payload,c.payload AS company,(SELECT count(*) FROM jobs cj WHERE cj.company_id=c.id AND cj.status='published' AND ($6 OR coalesce((cj.payload->>'demo')::boolean,false)=false)) AS company_job_count FROM jobs j JOIN companies c ON c.id=j.company_id JOIN users u ON u.id=c.owner_id WHERE j.id=$1 AND c.scope=$2 AND u.deleted_at IS NULL AND ($6 OR coalesce((j.payload->>'demo')::boolean,false)=false) AND (j.status='published' OR (j.company_id=$3 AND $4='employer') OR EXISTS(SELECT 1 FROM applications a WHERE a.job_id=j.id AND a.candidate_id=$5))",
        [
          jobId,
          account.scope,
          state.company.id,
          role,
          state.profile.id,
          fixtures,
        ],
      );
      if (!row)
        return Response.json({ error: "Вакансия недоступна" }, { status: 404 });
      return Response.json(
        {
          job: {
            ...row.payload,
            employerOwned: row.payload.companyId === state.company.id,
          },
          company: row.company,
          companyJobCount: Number(row.company_job_count),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const filters = parseRequestJson(params.get("filters") || "{}");
    if (!filters || Array.isArray(filters) || typeof filters !== "object")
      throw new Error("Проверьте фильтры поиска");
    return Response.json(
      await searchCatalog(
        account,
        state,
        kind,
        filters,
        role,
        params.get("page"),
        params.get("scope"),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
