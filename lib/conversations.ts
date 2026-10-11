import { readRequestJson, RequestSecurityError } from "./request-security";
import { getDb, type Database } from "@/db";
import type { Account } from "./platform";
import type { Role } from "./model";
import { bucket } from "./file-storage";
import type { EmployerTask } from "./conversation-types";
import type { ChatMessage, Conversation } from "./chat-types";

export class ChatError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const timestamp = (v: string | Date) => new Date(v).toISOString();
export const chatRole = (r: Request): Role =>
  (r.headers.get("X-Offerly-Role") ||
    new URL(r.url).searchParams.get("role")) === "employer"
    ? "employer"
    : "candidate";
function access(role: Role) {
  return role === "candidate"
    ? "p.user_id=$1"
    : "EXISTS(SELECT 1 FROM company_memberships member WHERE member.company_id=c.company_id AND member.user_id=$1)";
}
const joins = `conversations c JOIN candidate_profiles p ON p.id=c.candidate_id
 JOIN companies co ON co.id=c.company_id JOIN users candidate ON candidate.id=p.user_id
 JOIN users employer ON employer.id=co.owner_id`;
function allowed(role: Role) {
  return `${access(role)} AND candidate.deleted_at IS NULL AND employer.deleted_at IS NULL
    AND candidate.scope=$2 AND co.scope=$2 AND employer.scope=$2`;
}
const consentSql = `(EXISTS(SELECT 1 FROM invitations i WHERE i.company_id=c.company_id AND i.candidate_id=c.candidate_id AND i.status='accepted') OR EXISTS(SELECT 1 FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.company_id=c.company_id AND a.candidate_id=c.candidate_id))`;
const canWrite = (role: Role) =>
  `(${consentSql} AND ${role === "candidate" ? "true" : "EXISTS(SELECT 1 FROM company_memberships writer WHERE writer.company_id=c.company_id AND writer.user_id=$1 AND writer.role IN ('owner','recruiter'))"})`;
// Called inside the transaction that records the contact-sharing consent.
export async function ensureConversation(
  db: Database,
  companyId: string,
  candidateId: number,
) {
  const {
    rows: [row],
  } = await db.query(
    `INSERT INTO conversations(id,company_id,candidate_id)
     SELECT $1,c.id,p.id FROM companies c JOIN candidate_profiles p ON p.id=$3
     WHERE c.id=$2 AND c.owner_id<>p.user_id
     ON CONFLICT(company_id,candidate_id) DO UPDATE SET company_id=excluded.company_id RETURNING id`,
    [crypto.randomUUID(), companyId, candidateId],
  );
  return row?.id as string | undefined;
}
export async function unreadConversations(account: Account, role: Role) {
  const db = await getDb();
  const {
    rows: [count],
  } = await db.query(
    `SELECT count(*)::integer AS unread FROM ${joins} JOIN conversation_messages m ON c.id=m.conversation_id
    WHERE ${allowed(role)} AND m.sender_id<>$1 AND m.id>coalesce((SELECT last_message_id FROM conversation_reads r WHERE r.conversation_id=c.id AND r.user_id=$1),0)`,
    [account.id, account.scope],
  );
  return count;
}
async function room(
  db: Database,
  account: Account,
  role: Role,
  id: string,
  lock = false,
) {
  const {
    rows: [row],
  } = await db.query(
    `SELECT c.*,p.user_id AS candidate_user_id,co.owner_id AS company_owner_id,p.payload AS profile,co.payload AS company,employer.name AS employer_name,${canWrite(role)} AS can_write
    FROM ${joins} WHERE c.id=$3 AND ${allowed(role)} ${lock ? "FOR UPDATE OF c" : ""}`,
    [account.id, account.scope, id],
  );
  if (!row) throw new ChatError("Диалог недоступен", 404);
  return row;
}
async function taskNotice(
  db: Database,
  roomId: string,
  messageId: string,
  event: string,
  sender: string,
  body: string,
) {
  await db.query(
    `INSERT INTO conversation_messages(conversation_id,sender_id,client_id,body) VALUES($1,$2,$3,$4) ON CONFLICT(conversation_id,sender_id,client_id) DO NOTHING`,
    [roomId, sender, `task-${messageId}-${event}`, body],
  );
  await db.query(
    "UPDATE conversations SET updated_at=clock_timestamp() WHERE id=$1",
    [roomId],
  );
}
async function expireTasks(db: Database, r: any) {
  const { rows } = await db.query(
    "SELECT id,task,created_at FROM conversation_messages WHERE conversation_id=$1 AND task->>'status'='accepted' FOR UPDATE",
    [r.id],
  );
  for (const row of rows) {
    const task = row.task as EmployerTask;
    const start = task.startedAt || timestamp(row.created_at);
    const deadline = new Date(
      Date.parse(start) + task.minutes * 60000,
    ).toISOString();
    if (Date.now() < Date.parse(deadline)) continue;
    task.status = "expired";
    task.startedAt = start;
    task.deadlineAt = deadline;
    task.expiredAt = deadline;
    task.submittedAt = deadline;
    task.answer = task.draftAnswer || "";
    delete task.draftAnswer;
    await db.query("UPDATE conversation_messages SET task=$2 WHERE id=$1", [
      row.id,
      JSON.stringify(task),
    ]);
    await taskNotice(
      db,
      r.id,
      String(row.id),
      "expired",
      r.company_owner_id,
      "Время выполнения задачи истекло. Доступ к выполнению закрыт.",
    );
    await taskNotice(
      db,
      r.id,
      String(row.id),
      "partial",
      r.candidate_user_id,
      task.answer
        ? "Сохранённый до дедлайна частичный ответ передан работодателю."
        : "До дедлайна ответ не был сохранён. Задача завершена без решения.",
    );
  }
}
async function summary(
  db: Database,
  account: Account,
  role: Role,
  row: any,
): Promise<Conversation> {
  const {
    rows: [last],
  } = await db.query(
    "SELECT body,task FROM conversation_messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 1",
    [row.id],
  );
  const {
    rows: [count],
  } = await db.query(
    `SELECT count(*)::integer AS unread FROM conversation_messages m
    WHERE m.conversation_id=$1 AND m.sender_id<>$2 AND m.id>coalesce((SELECT last_message_id FROM conversation_reads WHERE conversation_id=$1 AND user_id=$2),0)`,
    [row.id, account.id],
  );
  const { rows: context } = await db.query(
    `SELECT payload->>'title' AS title,'invitation' AS kind FROM invitations WHERE company_id=$1 AND candidate_id=$2 AND status='accepted'
    UNION ALL SELECT j.payload->>'title','application' FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.company_id=$1 AND a.candidate_id=$2 ORDER BY title LIMIT 20`,
    [row.company_id, row.candidate_id],
  );
  return {
    id: row.id,
    demonstration: !!(row.profile.demonstration || row.company.demonstration),
    name: role === "candidate" ? row.company.name : row.profile.name,
    subtitle:
      role === "candidate"
        ? `${row.company.contactName || row.employer_name} · Работодатель`
        : row.profile.headline || row.profile.specialty,
    grade: role === "employer" ? row.profile.grade || null : null,
    avatar: (role === "candidate" ? row.company.logoKey : row.profile.avatarKey)
      ? `/api/conversations/${row.id}/avatar?role=${role}`
      : null,
    updatedAt: timestamp(row.updated_at),
    unread: count.unread,
    lastMessage: taskIsHidden(last?.task, role)
      ? "Работодатель отправил вам задачу"
      : last?.body || "Вы обменялись контактами — можно общаться",
    canWrite: row.can_write,
    context,
  };
}
export async function conversationAvatar(
  account: Account,
  role: Role,
  id: string,
) {
  const row = await room(await getDb(), account, role, id);
  const key =
    role === "candidate" ? row.company.logoKey : row.profile.avatarKey;
  if (!key || !bucket) return new Response(null, { status: 404 });
  const file = await bucket.get(key);
  if (!file) return new Response(null, { status: 404 });
  return new Response(file.body, {
    headers: {
      "Content-Type": file.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
export async function listConversations(
  account: Account,
  role: Role,
  before: string | null,
) {
  const db = await getDb();
  let cursor: { at: string; id: string } | null = null;
  if (before) {
    try {
      cursor = JSON.parse(Buffer.from(before, "base64url").toString());
      if (
        !cursor ||
        typeof cursor.id !== "string" ||
        !Number.isFinite(Date.parse(cursor.at))
      )
        throw Error();
    } catch {
      throw new ChatError("Некорректная страница диалогов");
    }
  }
  const { rows } = await db.query(
    `SELECT c.*,p.payload AS profile,co.payload AS company,employer.name AS employer_name,${canWrite(role)} AS can_write FROM ${joins}
    WHERE ${allowed(role)} AND ($3::timestamptz IS NULL OR (c.updated_at,c.id)<($3::timestamptz,$4::text))
    ORDER BY c.updated_at DESC,c.id DESC LIMIT 31`,
    [account.id, account.scope, cursor?.at || null, cursor?.id || null],
  );
  const items = await Promise.all(
    rows.slice(0, 30).map((row) => summary(db, account, role, row)),
  );
  const last = rows[29];
  return {
    items,
    nextCursor:
      rows.length > 30
        ? Buffer.from(
            JSON.stringify({ at: timestamp(last.updated_at), id: last.id }),
          ).toString("base64url")
        : null,
  };
}
export async function openConversation(
  account: Account,
  role: Role,
  input: Record<string, unknown>,
) {
  if (!account.demo && !account.verified_at)
    throw new ChatError("Подтвердите почту перед началом общения", 403);
  const db = await getDb();
  return db.transaction(async (tx) => {
    let link: any;
    if (typeof input.invitationId === "string") {
      const {
        rows: [r],
      } = await tx.query(
        "SELECT company_id,candidate_id,status FROM invitations WHERE id=$1",
        [input.invitationId.slice(0, 100)],
      );
      if (r?.status === "accepted") link = r;
    } else if (typeof input.applicationId === "string") {
      const {
        rows: [r],
      } = await tx.query(
        "SELECT j.company_id,a.candidate_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=$1",
        [input.applicationId.slice(0, 100)],
      );
      link = r;
    }
    if (!link && (input.candidateId || input.companyId)) {
      const {
        rows: [target],
      } = await tx.query(
        `SELECT p.id AS candidate_id, co.id AS company_id FROM candidate_profiles p CROSS JOIN companies co
        WHERE ${role === "candidate" ? "p.user_id=$1 AND co.id=$3" : "p.id=$3::integer AND EXISTS(SELECT 1 FROM company_memberships member WHERE member.user_id=$1 AND member.company_id=co.id AND member.role IN ('owner','recruiter'))"}
        AND co.scope=$2 AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.user_id AND u.scope=$2 AND u.deleted_at IS NULL)
        AND (EXISTS(SELECT 1 FROM invitations i WHERE i.company_id=co.id AND i.candidate_id=p.id AND i.status='accepted') OR EXISTS(SELECT 1 FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.company_id=co.id AND a.candidate_id=p.id))`,
        [
          account.id,
          account.scope,
          role === "candidate"
            ? String(input.companyId)
            : Number(input.candidateId),
        ],
      );
      link = target;
    }
    if (!link)
      throw new ChatError(
        "Диалог доступен после принятия приглашения или отправки отклика",
        404,
      );
    const {
      rows: [target],
    } = await tx.query(
      `SELECT p.user_id,co.owner_id FROM candidate_profiles p JOIN users u ON u.id=p.user_id JOIN companies co ON co.id=$2 JOIN users owner ON owner.id=co.owner_id
      WHERE p.id=$3 AND u.scope=$4 AND co.scope=$4 AND owner.scope=$4 AND u.deleted_at IS NULL AND owner.deleted_at IS NULL AND p.user_id<>co.owner_id
      AND ${role === "candidate" ? "p.user_id=$1" : "EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=co.id AND m.user_id=$1 AND m.role IN ('owner','recruiter'))"}`,
      [account.id, link.company_id, link.candidate_id, account.scope],
    );
    if (!target) throw new ChatError("Диалог недоступен", 404);
    const {
      rows: [r],
    } = await tx.query(
      `INSERT INTO conversations(id,company_id,candidate_id) VALUES($1,$2,$3)
      ON CONFLICT(company_id,candidate_id) DO UPDATE SET company_id=excluded.company_id RETURNING id`,
      [crypto.randomUUID(), link.company_id, link.candidate_id],
    );
    return { id: r.id };
  });
}
function taskIsHidden(task: any, role: Role) {
  return (
    role === "candidate" &&
    task &&
    !task.startedAt &&
    ["offered", "declined"].includes(task.status)
  );
}
function message(row: any, account: Account, role: Role): ChatMessage {
  const hidden = taskIsHidden(row.task, role);
  let projected = row.task ? { ...row.task } : undefined;
  if (projected && role === "employer") delete projected.draftAnswer;
  if (projected?.expiredAt && role === "candidate") {
    projected.instructions = "";
    projected.criteria = "";
  }
  return {
    id: String(row.id),
    body: hidden ? "Работодатель отправил вам задачу" : row.body,
    ...(row.task
      ? {
          task: hidden
            ? {
                title: "",
                instructions: "",
                criteria: "",
                minutes: row.task.minutes,
                status: row.task.status,
              }
            : projected,
        }
      : {}),
    createdAt: timestamp(row.created_at),
    mine: row.sender_id === account.id,
    sender: row.sender_name || "Участник команды",
    ...(row.sender_id === account.id ? { clientId: row.client_id } : {}),
  };
}
function senderDisplayName(row: any, room: any) {
  if (row.sender_id === room.candidate_user_id)
    return room.profile.name || row.sender_name;
  if (row.sender_id === room.company_owner_id)
    return room.company.contactName || row.sender_name;
  return row.sender_name;
}
export async function readConversation(
  account: Account,
  role: Role,
  id: string,
  before: string | null,
) {
  const db = await getDb();
  const r = await db.transaction(async (tx) => {
    const r = await room(tx, account, role, id, true);
    await expireTasks(tx, r);
    return r;
  });
  if (before && !/^\d{1,18}$/.test(before))
    throw new ChatError("Некорректная страница сообщений");
  const { rows } = await db.query(
    `SELECT m.*,u.name AS sender_name FROM conversation_messages m JOIN users u ON u.id=m.sender_id
    WHERE m.conversation_id=$1 AND ($2::bigint IS NULL OR m.id<$2::bigint) ORDER BY m.id DESC LIMIT 41`,
    [id, before],
  );
  const {
    rows: [receipt],
  } = await db.query(
    `SELECT coalesce(max(r.last_message_id),0)::text AS last FROM conversation_reads r JOIN users u ON u.id=r.user_id
    WHERE r.conversation_id=$1 AND u.deleted_at IS NULL AND ${role === "candidate" ? "EXISTS(SELECT 1 FROM company_memberships member WHERE member.company_id=$2 AND member.user_id=r.user_id)" : "r.user_id=$2"}`,
    [id, role === "candidate" ? r.company_id : r.candidate_user_id],
  );
  return {
    conversation: await summary(db, account, role, r),
    messages: rows
      .slice(0, 40)
      .reverse()
      .map((m) =>
        message({ ...m, sender_name: senderDisplayName(m, r) }, account, role),
      ),
    hasOlder: rows.length > 40,
    otherReadThrough: receipt.last,
  };
}
export async function changeConversation(
  account: Account,
  role: Role,
  id: string,
  input: Record<string, unknown>,
) {
  if (!account.demo && !account.verified_at)
    throw new ChatError("Подтвердите почту перед общением", 403);
  const db = await getDb();
  const output = await db.transaction(async (tx) => {
    const r = await room(tx, account, role, id, true);
    if (input.type === "read") {
      const through = String(input.through || "");
      if (!/^\d{1,18}$/.test(through))
        throw new ChatError("Некорректная отметка прочтения");
      const {
        rows: [found],
      } = await tx.query(
        "SELECT id FROM conversation_messages WHERE conversation_id=$1 AND id=$2",
        [id, through],
      );
      if (!found) throw new ChatError("Сообщение не найдено", 404);
      await tx.query(
        `INSERT INTO conversation_reads(conversation_id,user_id,last_message_id) VALUES($1,$2,$3)
        ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_message_id=greatest(conversation_reads.last_message_id,excluded.last_message_id)`,
        [id, account.id, through],
      );
      return { ok: true };
    }
    if (!r.can_write)
      throw new ChatError(
        "Переписка доступна после принятия приглашения или отклика",
        403,
      );
    await expireTasks(tx, r);
    if (
      input.type === "task-response" ||
      input.type === "task-review" ||
      input.type === "task-draft"
    ) {
      if (!/^[0-9]{1,18}$/.test(String(input.messageId || "")))
        throw new ChatError("Некорректный идентификатор задачи");
      const {
        rows: [saved],
      } = await tx.query(
        "SELECT * FROM conversation_messages WHERE conversation_id=$1 AND id=$2 FOR UPDATE",
        [id, String(input.messageId)],
      );
      if (!saved?.task) throw new ChatError("Задача не найдена", 404);
      const task = saved.task as EmployerTask;
      const clean = (value: unknown, max: number) =>
        typeof value === "string" ? value.trim().slice(0, max) : "";
      if (
        task.status === "accepted" &&
        Date.now() >=
          Date.parse(
            task.deadlineAt ||
              new Date(
                Date.parse(task.startedAt || timestamp(saved.created_at)) +
                  task.minutes * 60000,
              ).toISOString(),
          )
      ) {
        await expireTasks(tx, r);
        return new ChatError(
          "Время выполнения истекло. Поздние ответы не принимаются.",
          409,
        );
      }
      if (input.type === "task-draft") {
        if (role !== "candidate")
          throw new ChatError("Ответ доступен кандидату", 403);
        if (task.status !== "accepted")
          return new ChatError(
            "Время истекло или задача уже завершена. Поздние ответы не принимаются.",
            409,
          );
        const draft = clean(input.answer, 12000),
          revision = Number(input.revision);
        if (!Number.isInteger(revision) || revision < 1)
          throw new ChatError("Некорректная версия ответа");
        if (
          revision === (task.draftRevision || 0) &&
          draft === task.draftAnswer
        )
          return { ok: true, revision, savedAt: task.draftSavedAt };
        if (revision !== (task.draftRevision || 0) + 1)
          throw new ChatError(
            "Ответ изменён в другой вкладке. Ваш текст сохранён на этом устройстве.",
            409,
          );
        task.draftAnswer = draft;
        task.draftRevision = revision;
        task.draftSavedAt = new Date().toISOString();
        await tx.query(
          "UPDATE conversation_messages SET task=$3 WHERE conversation_id=$1 AND id=$2",
          [id, saved.id, JSON.stringify(task)],
        );
        return { ok: true, revision, savedAt: task.draftSavedAt };
      }
      if (input.type === "task-response" && task.status === "expired")
        return new ChatError(
          "Время выполнения истекло. Сохранённый частичный ответ передан работодателю.",
          409,
        );
      if (
        input.type === "task-response" &&
        task.status === "submitted" &&
        input.status === "submitted" &&
        task.answer === clean(input.answer, 12000)
      )
        return { ok: true };
      if (
        input.type === "task-review" &&
        task.status === "reviewed" &&
        task.feedback === clean(input.feedback, 6000)
      )
        return { ok: true };
      if (input.type === "task-response") {
        if (role !== "candidate")
          throw new ChatError("Ответ доступен кандидату", 403);
        if (input.status === "accepted" && task.status === "offered") {
          task.status = "accepted";
          task.startedAt = new Date().toISOString();
          task.deadlineAt = new Date(
            Date.parse(task.startedAt) + task.minutes * 60000,
          ).toISOString();
        } else if (
          input.status === "declined" &&
          ["offered", "accepted"].includes(task.status)
        )
          task.status = "declined";
        else if (input.status === "submitted" && task.status === "accepted") {
          task.answer = clean(input.answer, 12000);
          if (!task.answer) throw new ChatError("Напишите решение задачи");
          task.status = "submitted";
          task.submittedAt = new Date().toISOString();
        } else
          throw new ChatError("Этот ответ уже сохранён или недоступен", 409);
      } else {
        if (
          role !== "employer" ||
          !["submitted", "expired"].includes(task.status)
        )
          throw new ChatError(
            "Обратная связь доступна работодателю после решения",
            403,
          );
        task.feedback = clean(input.feedback, 6000);
        if (!task.feedback) throw new ChatError("Напишите обратную связь");
        task.status = "reviewed";
      }
      await tx.query(
        "UPDATE conversation_messages SET task=$3 WHERE conversation_id=$1 AND id=$2",
        [id, saved.id, JSON.stringify(task)],
      );
      const labels: Record<string, string> = {
        accepted: "Соискатель приступил к задаче.",
        declined: "Соискатель отказался от задачи.",
        submitted: "Соискатель отправил решение задачи.",
        reviewed: "Работодатель оставил обратную связь по задаче.",
      };
      await taskNotice(
        tx,
        id,
        String(saved.id),
        task.status,
        account.id,
        labels[task.status],
      );
      return { ok: true };
    }
    if (input.type !== "message") throw new ChatError("Неизвестное действие");
    let task;
    if (input.task && typeof input.task === "object") {
      if (role !== "employer")
        throw new ChatError("Задачу отправляет работодатель", 403);
      const v = input.task as Record<string, unknown>;
      const clean = (value: unknown, max: number) =>
        typeof value === "string" ? value.trim().slice(0, max) : "";
      task = {
        title: clean(v.title, 200),
        instructions: clean(v.instructions, 10000),
        criteria: clean(v.criteria, 2000),
        minutes: Number(v.minutes),
        status: "offered",
      };
      if (
        !task.title ||
        !task.instructions ||
        !task.criteria ||
        !Number.isInteger(task.minutes) ||
        task.minutes < 1 ||
        task.minutes > 120
      )
        throw new ChatError(
          "Укажите задачу, критерии и время от 1 до 120 минут",
        );
    }
    const body =
      (typeof input.body === "string" ? input.body.trim() : "") ||
      (task ? `Добровольная задача: ${task.title}` : "");
    const clientId = typeof input.clientId === "string" ? input.clientId : "";
    if (!body || body.length > 4000)
      throw new ChatError("Введите сообщение от 1 до 4000 символов");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(clientId))
      throw new ChatError("Некорректный идентификатор сообщения");
    const {
      rows: [previous],
    } = await tx.query(
      "SELECT *, $4::text AS sender_name FROM conversation_messages WHERE conversation_id=$1 AND sender_id=$2 AND client_id=$3",
      [id, account.id, clientId, account.name],
    );
    if (previous) {
      const sameTask = task
        ? previous.task &&
          ["title", "instructions", "minutes", "criteria"].every(
            (key) => previous.task[key] === task[key as keyof typeof task],
          )
        : !previous.task;
      if (previous.body !== body || !sameTask)
        throw new ChatError("Этот запрос уже отправлен с другим текстом", 409);
      return {
        message: message(
          { ...previous, sender_name: senderDisplayName(previous, r) },
          account,
          role,
        ),
      };
    }
    const {
      rows: [saved],
    } = await tx.query(
      "INSERT INTO conversation_messages(conversation_id,sender_id,client_id,body,task) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [id, account.id, clientId, body, task ? JSON.stringify(task) : null],
    );
    await tx.query(
      "UPDATE conversations SET updated_at=clock_timestamp() WHERE id=$1",
      [id],
    );
    return {
      message: message(
        {
          ...saved,
          sender_name: senderDisplayName(
            { ...saved, sender_name: account.name },
            r,
          ),
        },
        account,
        role,
      ),
    };
  });
  if (output instanceof ChatError) throw output;
  return output;
}

export async function chatBody(request: Request, limit: number): Promise<Record<string, unknown>> {
  try { return await readRequestJson(request, limit); }
  catch (e) { if (e instanceof RequestSecurityError) throw new ChatError(e.message, e.status); throw e; }
}
