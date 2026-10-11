import { getDb, type Database } from "@/db";
import { loadPlatform, type Account } from "./platform";
import { clientState } from "./store";
import { searchCatalog, eligibleCandidate } from "./catalog";
import { validTimeZone } from "./account-settings";
import { recommendSpecialties } from "./assessment-tracks";
import type { Role } from "./model";

export class HiringError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const stages = {
  saved: "Сохранён",
  invited: "Приглашён",
  talking: "В общении",
  interview: "Интервью",
  offer: "Оффер",
  closed: "Завершён",
};
export const consentVersion = "2026-10-10-v1";
const text = (v: unknown, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const iso = (v: any) => {
  if (!v) return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) throw new HiringError("Некорректная дата");
  return d.toISOString();
};
export async function companyMembership(
  db: Database,
  a: Account,
  write = false,
) {
  const {
    rows: [r],
  } = await db.query(
    `SELECT c.id,m.role FROM companies c JOIN company_memberships m ON m.company_id=c.id JOIN users u ON u.id=c.owner_id WHERE m.user_id=$1 AND c.scope=$2 AND u.deleted_at IS NULL ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,c.id LIMIT 1`,
    [a.id, a.scope],
  );
  if (!r || (write && !["owner", "recruiter"].includes(r.role)))
    throw new HiringError("Недостаточно прав компании", 403);
  return r.id as string;
}
export async function blocked(
  db: Database,
  candidate: number,
  company: string,
) {
  return !!(
    await db.query(
      "SELECT 1 FROM blocked_companies WHERE candidate_id=$1 AND company_id=$2",
      [candidate, company],
    )
  ).rows.length;
}
async function ownProfile(db: Database, a: Account) {
  const {
    rows: [p],
  } = await db.query("SELECT id FROM candidate_profiles WHERE user_id=$1", [
    a.id,
  ]);
  if (!p) throw new HiringError("Профиль недоступен", 404);
  return p.id as number;
}
async function processAccess(
  db: Database,
  a: Account,
  role: Role,
  id: string,
  write = false,
  lock = false,
) {
  if (lock) {
    const prior = await processAccess(db, a, role, id, write, false);
    await db.query("SELECT id FROM candidate_profiles WHERE id=$1 FOR UPDATE", [
      prior.candidate_id,
    ]);
  }
  const {
    rows: [p],
  } = await db.query(
    `SELECT h.*,p.user_id,c.payload->>'name' AS company_name FROM hiring_processes h JOIN candidate_profiles p ON p.id=h.candidate_id JOIN companies c ON c.id=h.company_id JOIN users u ON u.id=p.user_id JOIN users owner ON owner.id=c.owner_id WHERE h.id=$1 AND u.scope=$2 AND c.scope=$2 AND u.deleted_at IS NULL AND owner.deleted_at IS NULL ${lock ? "FOR UPDATE OF h" : ""}`,
    [id, a.scope],
  );
  if (
    !p ||
    (role === "candidate"
      ? p.user_id !== a.id
      : p.company_id !== (await companyMembership(db, a, write)))
  )
    throw new HiringError("Процесс недоступен", 404);
  if (role === "candidate" && !(await linked(db, p)))
    throw new HiringError("Процесс недоступен", 404);
  return p;
}
async function linked(db: Database, p: any) {
  return !!(
    await db.query(
      `SELECT 1 FROM invitations WHERE company_id=$1 AND candidate_id=$2 AND status='accepted' UNION ALL SELECT 1 FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.company_id=$1 AND a.candidate_id=$2 LIMIT 1`,
      [p.company_id, p.candidate_id],
    )
  ).rows.length;
}
function publicMeeting(m: any) {
  return {
    id: m.id,
    processId: m.process_id,
    slots: m.slots,
    timeZone: m.timezone,
    duration: m.duration,
    status: m.status,
    selectedAt: iso(m.selected_at),
    revision: m.revision,
  };
}
function publicProcess(p: any, role: Role) {
  return {
    id: p.id,
    candidateId: p.candidate_id,
    companyId: p.company_id,
    title: p.title,
    company: p.company_name,
    ...(role === "employer"
      ? { stage: p.stage, note: p.note, reminderAt: iso(p.reminder_at) }
      : {}),
    revision: p.revision,
    updatedAt: iso(p.updated_at),
  };
}
export async function hiringOperation(
  a: Account,
  role: Role,
  b: Record<string, any>,
) {
  const db = await getDb();
  const type = text(b.type);
  if (type === "companies") {
    if (role !== "candidate") throw new HiringError("Доступно соискателю", 403);
    const p = await ownProfile(db, a);
    const { rows } = await db.query(
      `SELECT c.id,c.payload->>'name' AS name,(bc.company_id IS NOT NULL) AS blocked FROM companies c JOIN users u ON u.id=c.owner_id LEFT JOIN blocked_companies bc ON bc.company_id=c.id AND bc.candidate_id=$3 WHERE c.scope=$1 AND u.deleted_at IS NULL AND c.owner_id<>$2 AND length(c.payload->>'name')>0 AND (bc.company_id IS NOT NULL OR position(lower($4) in lower(c.payload->>'name'))>0) ORDER BY blocked DESC,name,c.id LIMIT 30`,
      [a.scope, a.id, p, text(b.query, 100)],
    );
    return { items: rows };
  }
  if (type === "block") {
    if (role !== "candidate") throw new HiringError("Доступно соискателю", 403);
    const p = await ownProfile(db, a),
      id = text(b.companyId);
    const {
      rows: [c],
    } = await db.query(
      "SELECT c.id FROM companies c JOIN users u ON u.id=c.owner_id WHERE c.id=$1 AND c.scope=$2 AND u.deleted_at IS NULL AND c.owner_id<>$3",
      [id, a.scope, a.id],
    );
    if (!c) throw new HiringError("Компания недоступна", 404);
    await db.transaction(async (tx) => {
      await tx.query(
        "SELECT id FROM candidate_profiles WHERE id=$1 FOR UPDATE",
        [p],
      );
      if (b.blocked === true)
        await tx.query(
          "INSERT INTO blocked_companies(candidate_id,company_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [p, id],
        );
      else if (b.blocked === false)
        await tx.query(
          "DELETE FROM blocked_companies WHERE candidate_id=$1 AND company_id=$2",
          [p, id],
        );
      else throw new HiringError("Укажите действие");
    });
    return { ok: true };
  }
  if (type === "compare") {
    if (role !== "employer")
      throw new HiringError("Доступно работодателю", 403);
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(Number))] : [];
    if (
      ids.length < 2 ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 1 || id > 2147483647)
    )
      throw new HiringError("Выберите не менее двух кандидатов");
    const s = await loadPlatform(a, { candidateIds: ids });
    const available = new Map(clientState(s, role).candidates.map(p => [p.id, p]));
    const profiles = ids.map(id => {
      const p = available.get(id);
      if (!p) throw new HiringError("Один из кандидатов больше недоступен", 404);
      return p;
    });
    return { items: profiles };
  }
  if (type === "recommend")
    return {
      items: recommendSpecialties(
        text(b.description, 6000),
        Array.isArray(b.skills) ? b.skills : [],
      ),
    };
  if (type === "reminders") {
    if (role !== "employer") return { count: 0 };
    const company = await companyMembership(db, a);
    const {
      rows: [r],
    } = await db.query(
      "SELECT count(*)::integer AS count FROM hiring_processes WHERE company_id=$1 AND reminder_at<=now()",
      [company],
    );
    return r;
  }
  if (type === "processes") {
    const company = role === "employer" ? await companyMembership(db, a) : null;
    let cursor: { at: string; id: string } | null = null;
    if (b.before) {
      try {
        cursor = JSON.parse(String(b.before));
        if (!cursor || !cursor.id || !iso(cursor.at)) throw Error();
      } catch {
        throw new HiringError("Некорректная страница");
      }
    }
    const { rows } = await db.query(
      `SELECT h.*,c.payload->>'name' AS company_name FROM hiring_processes h JOIN candidate_profiles p ON p.id=h.candidate_id JOIN companies c ON c.id=h.company_id JOIN users u ON u.id=p.user_id JOIN users owner ON owner.id=c.owner_id WHERE c.scope=$1 AND u.deleted_at IS NULL AND owner.deleted_at IS NULL AND ${role === "employer" ? "h.company_id=$2" : "p.user_id=$2 AND (EXISTS(SELECT 1 FROM invitations i WHERE i.company_id=h.company_id AND i.candidate_id=h.candidate_id AND i.status='accepted') OR EXISTS(SELECT 1 FROM applications ap JOIN jobs j ON j.id=ap.job_id WHERE j.company_id=h.company_id AND ap.candidate_id=h.candidate_id))"} AND ($3::timestamptz IS NULL OR (h.updated_at,h.id)<($3::timestamptz,$4::text)) ORDER BY h.updated_at DESC,h.id DESC LIMIT 51`,
      [a.scope, company || a.id, cursor?.at || null, cursor?.id || null],
    );
    const items = [];
    for (const p of rows.slice(0, 50)) {
      const { rows: meetings } = await db.query(
        "SELECT * FROM interview_meetings WHERE process_id=$1 ORDER BY created_at DESC LIMIT 10",
        [p.id],
      );
      const { rows: tasks } = await db.query(
        "SELECT * FROM company_tasks WHERE process_id=$1 ORDER BY created_at DESC LIMIT 20",
        [p.id],
      );
      const safeTasks = [];
      for (const task of tasks) {
        const { rows: answers } = await db.query(
          "SELECT occurrence,score,created_at FROM company_task_answers WHERE task_id=$1 ORDER BY occurrence DESC LIMIT 20",
          [task.id],
        );
        const occurrence = Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(task.created_at).getTime()) /
              (task.period_days * 86400000),
          ),
        );
        safeTasks.push({
          id: task.id,
          title: task.title,
          periodDays: task.period_days,
          active: task.active,
          occurrence,
          dueAt: new Date(
            new Date(task.created_at).getTime() +
              (occurrence + 1) * task.period_days * 86400000,
          ).toISOString(),
          questions: task.questions.map((q: any) => ({
            id: q.id,
            prompt: q.prompt,
            options: q.options,
          })),
          history: answers.map((v) => ({
            ...v,
            created_at: iso(v.created_at),
          })),
          answered: answers.some((v) => v.occurrence === occurrence),
        });
      }
      const {
        rows: [chat],
      } = await db.query(
        `SELECT id AS "invitationId",NULL::text AS "applicationId" FROM invitations WHERE company_id=$1 AND candidate_id=$2 AND status='accepted' UNION ALL SELECT NULL::text,a.id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.company_id=$1 AND a.candidate_id=$2 LIMIT 1`,
        [p.company_id, p.candidate_id],
      );
      items.push({
        ...publicProcess(p, role),
        chat,
        meetings: meetings.map(publicMeeting),
        tasks: safeTasks,
      });
    }
    return {
      items,
      nextBefore:
        rows.length > 50
          ? JSON.stringify({ at: iso(rows[49].updated_at), id: rows[49].id })
          : null,
    };
  }
  if (type === "process-create") {
    if (role !== "employer")
      throw new HiringError("Доступно работодателю", 403);
    return db.transaction(async (tx) => {
      const company = await companyMembership(tx, a, true),
        candidate = Number(b.candidateId);
      if (
        !Number.isSafeInteger(candidate) ||
        candidate < 1 ||
        candidate > 2147483647
      )
        throw new HiringError("Некорректный кандидат");
      const {
        rows: [p],
      } = await tx.query(
        `SELECT p.id FROM candidate_profiles p JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND u.scope=$2 AND u.deleted_at IS NULL AND ${eligibleCandidate} AND p.user_id<>$3 AND NOT EXISTS(SELECT 1 FROM blocked_companies bc WHERE bc.candidate_id=p.id AND bc.company_id=$4) FOR UPDATE OF p`,
        [candidate, a.scope, a.id, company],
      );
      if (!p) throw new HiringError("Кандидат недоступен", 404);
      let context = "general",
        title = "Знакомство с командой";
      if (b.needId) {
        const {
          rows: [n],
        } = await tx.query(
          "SELECT payload FROM needs WHERE id=$1 AND company_id=$2",
          [text(b.needId), company],
        );
        if (!n) throw new HiringError("Подборка недоступна", 404);
        context = "need:" + text(b.needId);
        title = n.payload.title;
      } else if (b.jobId) {
        const {
          rows: [j],
        } = await tx.query(
          "SELECT payload FROM jobs WHERE id=$1 AND company_id=$2",
          [text(b.jobId), company],
        );
        if (!j) throw new HiringError("Вакансия недоступна", 404);
        context = "job:" + text(b.jobId);
        title = j.payload.title;
      }
      const {
        rows: [r],
      } = await tx.query(
        `INSERT INTO hiring_processes(id,company_id,candidate_id,context_key,title) VALUES($1,$2,$3,$4,$5) ON CONFLICT(company_id,candidate_id,context_key) DO UPDATE SET title=excluded.title RETURNING id`,
        [crypto.randomUUID(), company, candidate, context, title],
      );
      return r;
    });
  }
  if (type === "process-update") {
    if (role !== "employer")
      throw new HiringError("Доступно работодателю", 403);
    return db.transaction(async (tx) => {
      const p = await processAccess(tx, a, role, text(b.id), true, true);
      if (p.revision !== b.revision)
        throw new HiringError(
          "Процесс изменён в другой вкладке. Обновите его.",
          409,
        );
      if (!Object.hasOwn(stages, b.stage))
        throw new HiringError("Выберите этап");
      if (
        b.note !== undefined &&
        (typeof b.note !== "string" || b.note.length > 4000)
      )
        throw new HiringError("Заметка до 4000 символов");
      const reminder = b.reminderAt ? new Date(b.reminderAt) : null;
      if (
        reminder &&
        (!Number.isFinite(reminder.getTime()) ||
          reminder.getTime() < Date.now())
      )
        throw new HiringError("Укажите будущее время напоминания");
      await tx.query(
        "UPDATE hiring_processes SET stage=$2,note=$3,reminder_at=$4,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
        [p.id, b.stage, text(b.note, 4000), reminder?.toISOString() || null],
      );
      return { ok: true };
    });
  }
  if (type === "meeting-propose") {
    if (role !== "employer")
      throw new HiringError("Предложить встречу может компания", 403);
    return db.transaction(async (tx) => {
      const p = await processAccess(tx, a, role, text(b.processId), true, true);
      if (
        !(await linked(tx, p)) ||
        (await blocked(tx, p.candidate_id, p.company_id))
      )
        throw new HiringError("Сначала дождитесь согласия на общение", 403);
      const slots = Array.isArray(b.slots)
        ? [
            ...new Set<string>(
              b.slots.map((v: any) => {
                if (typeof v !== "string" || !v)
                  throw new HiringError("Некорректное время встречи");
                return iso(v)!;
              }),
            ),
          ]
        : [];
      if (
        !slots.length ||
        slots.length > 3 ||
        slots.some(
          (v) =>
            Date.parse(v) < Date.now() + 60000 ||
            Date.parse(v) > Date.now() + 90 * 86400000,
        ) ||
        !validTimeZone(text(b.timeZone)) ||
        !Number.isInteger(b.duration) ||
        b.duration < 15 ||
        b.duration > 180
      )
        throw new HiringError(
          "Выберите 1–3 будущих времени, часовой пояс и длительность 15–180 минут",
        );
      await tx.query(
        "UPDATE interview_meetings SET status='cancelled',revision=revision+1,updated_at=now() WHERE process_id=$1 AND status<>'cancelled'",
        [p.id],
      );
      const id = crypto.randomUUID();
      await tx.query(
        "INSERT INTO interview_meetings(id,process_id,slots,timezone,duration) VALUES($1,$2,$3,$4,$5)",
        [id, p.id, JSON.stringify(slots), b.timeZone, b.duration],
      );
      return { id };
    });
  }
  if (
    type === "meeting-confirm" ||
    type === "meeting-cancel" ||
    type === "meeting-ics"
  ) {
    return db.transaction(async (tx) => {
      const {
        rows: [initial],
      } = await tx.query(
        "SELECT process_id FROM interview_meetings WHERE id=$1",
        [text(b.id)],
      );
      if (!initial) throw new HiringError("Встреча недоступна", 404);
      const p = await processAccess(
        tx,
        a,
        role,
        initial.process_id,
        type !== "meeting-ics",
        true,
      );
      const {
        rows: [m],
      } = await tx.query(
        "SELECT * FROM interview_meetings WHERE id=$1 FOR UPDATE",
        [text(b.id)],
      );
      if (!m) throw new HiringError("Встреча недоступна", 404);
      if (type === "meeting-ics") {
        if (m.status !== "confirmed")
          throw new HiringError("Встреча ещё не подтверждена");
        const stamp = (v: any) =>
          new Date(v)
            .toISOString()
            .replace(/[-:]/g, "")
            .replace(/\.\d{3}/, "");
        const esc = (v: string) =>
          v
            .replace(/\\/g, "\\\\")
            .replace(/\r?\n/g, "\\n")
            .replace(/[,;]/g, "\\$&");
        return {
          ics: [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Offerly//Interview//RU",
            "BEGIN:VEVENT",
            `UID:${m.id}@offerly.local`,
            `SEQUENCE:${m.revision}`,
            `DTSTAMP:${stamp(new Date())}`,
            `DTSTART:${stamp(m.selected_at)}`,
            `DTEND:${stamp(new Date(m.selected_at).getTime() + m.duration * 60000)}`,
            `SUMMARY:${esc(p.title)}`,
            `DESCRIPTION:${esc("Встреча в Офферли. Детали обсудите в чате.")}`,
            "END:VEVENT",
            "END:VCALENDAR",
            "",
          ]
            .map((line) => {
              let out = "",
                bytes = 0;
              for (const char of line) {
                const size = Buffer.byteLength(char);
                if (bytes + size > 75) {
                  out += "\r\n ";
                  bytes = 1;
                }
                out += char;
                bytes += size;
              }
              return out;
            })
            .join("\r\n"),
        };
      }
      if (m.revision !== b.revision || m.status === "cancelled")
        throw new HiringError("Встреча уже изменена. Обновите страницу.", 409);
      if (type === "meeting-confirm") {
        if (
          role !== "candidate" ||
          m.status !== "proposed" ||
          !m.slots.includes(b.slot) ||
          Date.parse(b.slot) <= Date.now() ||
          (await blocked(tx, p.candidate_id, p.company_id))
        )
          throw new HiringError("Это время уже недоступно", 409);
        // Lock this candidate's schedule to prevent concurrent overlapping confirmations.
        await tx.query(
          "SELECT id FROM candidate_profiles WHERE id=$1 FOR UPDATE",
          [p.candidate_id],
        );
        const { rows } = await tx.query(
          `SELECT 1 FROM interview_meetings other JOIN hiring_processes h ON h.id=other.process_id WHERE h.candidate_id=$1 AND other.status='confirmed' AND other.id<>$2 AND other.selected_at<($3::timestamptz+($4::text||' minutes')::interval) AND other.selected_at+(other.duration::text||' minutes')::interval>$3::timestamptz`,
          [p.candidate_id, m.id, b.slot, m.duration],
        );
        if (rows.length)
          throw new HiringError("У вас уже назначена встреча в это время", 409);
        await tx.query(
          "UPDATE interview_meetings SET status='confirmed',selected_at=$2,revision=revision+1,updated_at=now() WHERE id=$1",
          [m.id, b.slot],
        );
      } else
        await tx.query(
          "UPDATE interview_meetings SET status='cancelled',revision=revision+1,updated_at=now() WHERE id=$1",
          [m.id],
        );
      return { ok: true };
    });
  }
  if (type === "search-notifications") {
    const { rows } = await db.query(
      "SELECT * FROM saved_searches WHERE user_id=$1 AND role=$2 AND enabled ORDER BY created_at DESC LIMIT 20",
      [a.id, role],
    );
    const s = await loadPlatform(a),
      items = [];
    for (const search of rows) {
      try {
        const page = await searchCatalog(
          a,
          s,
          role === "employer" ? "candidates" : "jobs",
          search.filters,
          role,
          1,
          "market",
          { unseenSearchId: search.id, countOnly: true },
        );
        items.push({ id: search.id, count: page.total });
      } catch {
        items.push({ id: search.id, count: 0, unavailable: true });
      }
    }
    return { items };
  }
  if (type === "search-save") {
    const name = text(b.name, 100);
    if (
      !name ||
      !b.filters ||
      typeof b.filters !== "object" ||
      Array.isArray(b.filters) ||
      JSON.stringify(b.filters).length > 6000
    )
      throw new HiringError("Укажите имя поиска и фильтры");
    // Validate all criteria with the real catalog before persisting.
    const s = await loadPlatform(a);
    await searchCatalog(
      a,
      s,
      role === "employer" ? "candidates" : "jobs",
      b.filters,
      role,
      1,
      "market",
    );
    return db.transaction(async (tx) => {
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [a.id]);
      const {
        rows: [count],
      } = await tx.query(
        "SELECT count(*)::integer AS n FROM saved_searches WHERE user_id=$1",
        [a.id],
      );
      if (count.n >= 20) throw new HiringError("Можно сохранить до 20 поисков");
      const id = crypto.randomUUID();
      await tx.query(
        "INSERT INTO saved_searches(id,user_id,role,name,filters) VALUES($1,$2,$3,$4,$5)",
        [id, a.id, role, name, JSON.stringify(b.filters)],
      );
      return { id };
    });
  }
  if (
    [
      "searches",
      "search-matches",
      "search-seen",
      "search-update",
      "search-delete",
    ].includes(type)
  ) {
    const { rows } = await db.query(
      "SELECT * FROM saved_searches WHERE user_id=$1 AND role=$2 ORDER BY created_at DESC",
      [a.id, role],
    );
    if (type === "searches")
      return {
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          filters: r.filters,
          enabled: r.enabled,
        })),
      };
    const search = rows.find((r) => r.id === b.id);
    if (!search) throw new HiringError("Поиск недоступен", 404);
    if (type === "search-delete") {
      await db.query("DELETE FROM saved_searches WHERE id=$1 AND user_id=$2", [
        search.id,
        a.id,
      ]);
      return { ok: true };
    }
    if (type === "search-update") {
      if (typeof b.enabled !== "boolean")
        throw new HiringError("Укажите настройку");
      await db.query("UPDATE saved_searches SET enabled=$2 WHERE id=$1", [
        search.id,
        b.enabled,
      ]);
      return { ok: true };
    }
    const s = await loadPlatform(a),
      page = await searchCatalog(
        a,
        s,
        role === "employer" ? "candidates" : "jobs",
        search.filters,
        role,
        b.page || 1,
        "market",
      );
    const { rows: seen } = await db.query(
      "SELECT item_id FROM search_seen WHERE search_id=$1",
      [search.id],
    );
    const set = new Set(seen.map((r) => r.item_id));
    const fresh = page.items.filter((r: any) => !set.has(String(r.id)));
    if (type === "search-seen")
      for (const item of page.items)
        await db.query(
          "INSERT INTO search_seen(search_id,item_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [search.id, String((item as any).id)],
        );
    return {
      ...page,
      newIds: search.enabled ? fresh.map((r: any) => r.id) : [],
    };
  }
  if (type === "task-create") {
    if (role !== "employer") throw new HiringError("Доступно компании", 403);
    return db.transaction(async (tx) => {
      const p = await processAccess(tx, a, role, text(b.processId), true, true);
      if (
        !(await linked(tx, p)) ||
        (await blocked(tx, p.candidate_id, p.company_id))
      )
        throw new HiringError("Задачи доступны после согласия на общение", 403);
      const qs = b.questions;
      if (
        !text(b.title) ||
        !Number.isInteger(b.periodDays) ||
        b.periodDays < 1 ||
        b.periodDays > 90 ||
        !Array.isArray(qs) ||
        qs.length < 1 ||
        qs.length > 5 ||
        qs.some(
          (q) =>
            !q ||
            typeof q !== "object" ||
            !text(q.prompt, 1000) ||
            !Array.isArray(q.options) ||
            q.options.length < 2 ||
            q.options.length > 5 ||
            q.options.some((o: any) => !text(o, 500)) ||
            !Number.isInteger(q.correct) ||
            q.correct < 0 ||
            q.correct >= q.options.length,
        )
      )
        throw new HiringError(
          "Добавьте 1–5 вопросов, варианты и правильные ответы",
        );
      const {
        rows: [count],
      } = await tx.query(
        "SELECT count(*)::integer AS n FROM company_tasks WHERE process_id=$1 AND active",
        [p.id],
      );
      if (count.n >= 20)
        throw new HiringError("Можно назначить до 20 активных задач");
      const id = crypto.randomUUID();
      await tx.query(
        "INSERT INTO company_tasks(id,process_id,title,questions,period_days) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          p.id,
          text(b.title),
          JSON.stringify(
            qs.map((q: any) => ({
              id: crypto.randomUUID(),
              prompt: text(q.prompt, 1000),
              options: q.options.map((o: any) => text(o, 500)),
              correct: q.correct,
            })),
          ),
          b.periodDays,
        ],
      );
      return { id };
    });
  }
  if (type === "task-stop" || type === "task-answer") {
    return db.transaction(async (tx) => {
      const {
        rows: [initial],
      } = await tx.query("SELECT process_id FROM company_tasks WHERE id=$1", [
        text(b.id),
      ]);
      if (!initial) throw new HiringError("Задача недоступна", 404);
      const p = await processAccess(
        tx,
        a,
        role,
        initial.process_id,
        type === "task-stop",
        true,
      );
      const {
        rows: [t],
      } = await tx.query("SELECT * FROM company_tasks WHERE id=$1 FOR UPDATE", [
        text(b.id),
      ]);
      if (!t) throw new HiringError("Задача недоступна", 404);
      if (type === "task-stop") {
        if (role !== "employer")
          throw new HiringError("Доступно компании", 403);
        await tx.query("UPDATE company_tasks SET active=false WHERE id=$1", [
          t.id,
        ]);
        return { ok: true };
      }
      if (
        role !== "candidate" ||
        !t.active ||
        (await blocked(tx, p.candidate_id, p.company_id))
      )
        throw new HiringError("Задача недоступна", 403);
      const occurrence = Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(t.created_at).getTime()) /
            (t.period_days * 86400000),
        ),
      );
      if (b.occurrence !== occurrence)
        throw new HiringError(
          "Начался новый период задачи. Обновите страницу.",
          409,
        );
      const supplied = b.answers;
      const answers = Object.fromEntries(
        t.questions.map((q: any) => [q.id, supplied?.[q.id]]),
      );
      if (
        !supplied ||
        t.questions.some(
          (q: any) =>
            !Number.isInteger(answers[q.id]) ||
            answers[q.id] < 0 ||
            answers[q.id] >= q.options.length,
        )
      )
        throw new HiringError("Ответьте на все вопросы");
      const score = Math.round(
        (100 *
          t.questions.filter((q: any) => answers[q.id] === q.correct).length) /
          t.questions.length,
      );
      const {
        rows: [prior],
      } = await tx.query(
        "SELECT score,answers FROM company_task_answers WHERE task_id=$1 AND occurrence=$2",
        [t.id, occurrence],
      );
      if (prior) {
        if (t.questions.some((q: any) => prior.answers[q.id] !== answers[q.id]))
          throw new HiringError("Ответ уже сохранён", 409);
        return { score: prior.score };
      }
      await tx.query(
        "INSERT INTO company_task_answers(task_id,occurrence,answers,score) VALUES($1,$2,$3,$4)",
        [t.id, occurrence, JSON.stringify(answers), score],
      );
      return { score };
    });
  }
  throw new HiringError("Неизвестное действие", 404);
}
