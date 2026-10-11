import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  changeInvitation,
  assertInvitationRevision,
} from "../lib/invitation-changes";
import { invitationMatches, invitationUnread } from "../lib/invitations";
import {
  createAccount,
  loadPlatform,
  savePlatform,
  type Account,
} from "../lib/platform";
import type { Database } from "../db";
import type { Invitation } from "../lib/model";

// A separate, in-memory database: never attach another engine to the live demo database.
const pg = new PGlite();
for (const name of (await readdir("db/migrations"))
  .filter((v) => v.endsWith(".sql"))
  .sort())
  await pg.exec(await readFile(`db/migrations/${name}`, "utf8"));
const wrap = (client: Pick<PGlite, "query">): Database => ({
  query: (sql, params = []) => client.query(sql, params),
  transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
});
const db = wrap(pg);
(globalThis as typeof globalThis & {offerlyDb?: Promise<Database>}).offerlyDb = Promise.resolve(db);
after(async () => {
  delete (globalThis as typeof globalThis & {offerlyDb?: Promise<Database>}).offerlyDb;
  await pg.close();
});
const account = (id: string): Account => ({
  id,
  email: `${id}@example.test`,
  name: id,
  scope: "invitation-change-qa",
  demo: true,
  verified_at: new Date().toISOString(),
  deleted_at: null,
});
const employer = account("employer"),
  candidate = account("candidate"),
  other = account("other");
for (const a of [employer, candidate, other]) await createAccount(db, a, null);
const employerState = await loadPlatform(employer),
  candidateState = await loadPlatform(candidate);
const original: Invitation = {
  id: "offer-1",
  companyId: employerState.company.id,
  company: "QA",
  candidateId: candidateState.profile.id,
  title: "Backend",
  description: "Задачи команды",
  contact: "qa@example.test",
  min: 150000,
  max: 200000,
  format: "Удалённо",
  status: "viewed",
  readAt: "2026-10-10T12:01:00.000Z",
  createdAt: "2026-10-10T12:00:00.000Z",
  source: {
    kind: "task",
    title: "Исходная задача",
    specialty: "Backend",
    grades: ["Junior"],
    skills: ["Python"],
    formats: ["Удалённо"],
  },
};
const patch = {
  expectedUpdatedAt: original.createdAt,
  title: "Backend Junior",
  description: "Обновлённые задачи",
  contact: "qa@example.test",
  min: 160000,
  max: 210000,
  format: "Гибрид",
  city: "Москва",
  grade: "Junior",
  skills: ["Python", "SQL"],
};
const seed = async (i: Invitation) => {
  await db.query("DELETE FROM invitations WHERE id=$1", [i.id]);
  await db.query(
    "INSERT INTO invitations(id,company_id,candidate_id,status,min_salary,max_salary,payload) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      i.id,
      i.companyId,
      i.candidateId,
      i.status,
      i.min,
      i.max,
      JSON.stringify(i),
    ],
  );
};

test("edit reopens viewed invitation, preserves source/recipient and validates money", () => {
  const next = changeInvitation(
    original,
    "invitation-update",
    patch,
    "2026-10-10T12:02:00.000Z",
  );
  assert.equal(next.status, "sent");
  assert.equal(next.readAt, undefined);
  assert.equal(invitationUnread(next), true);
  assert.equal(next.min, 160000);
  assert.deepEqual(next.source, original.source);
  assert.equal(next.candidateId, original.candidateId);
  assert.equal(original.status, "viewed");
  assert.throws(
    () =>
      changeInvitation(original, "invitation-update", {
        ...patch,
        min: 220000,
      }),
    /не меньше|превыш|Зарплат|зарплат/,
  );
  assert.throws(
    () =>
      changeInvitation(original, "invitation-update", {
        ...patch,
        expectedUpdatedAt: "old",
      }),
    /CONFLICT/,
  );
  assert.throws(
    () => assertInvitationRevision(next, original.createdAt),
    /Условия/,
  );
  assert.doesNotThrow(() => assertInvitationRevision(next, next.updatedAt));
});
test("answered invitations cannot be edited or cancelled", () => {
  for (const status of ["accepted", "declined", "cancelled"] as const)
    for (const action of ["invitation-update", "invitation-cancel"] as const)
      assert.throws(
        () => changeInvitation({ ...original, status }, action, patch),
        /без ответа/,
      );
});
test("edit persists and candidate receives updated conditions without contacts consent", async () => {
  await seed(original);
  const s = await loadPlatform(employer);
  s.invitations[0] = changeInvitation(
    s.invitations[0],
    "invitation-update",
    patch,
    "2026-10-10T12:03:00.000Z",
  );
  await savePlatform(employer.id, s);
  const received = (await loadPlatform(candidate)).invitations[0];
  assert.equal(received.min, 160000);
  assert.equal(received.status, "sent");
  assert.equal(received.readAt, undefined);
  assert.deepEqual(received.source, original.source);
  const rooms = await db.query("SELECT * FROM conversations");
  assert.equal(rooms.rows.length, 0);
});
test("cancellation persists, remains in history and frees the active invitation slot", async () => {
  await seed(original);
  const s = await loadPlatform(employer);
  s.invitations[0] = changeInvitation(
    s.invitations[0],
    "invitation-cancel",
    patch,
  );
  await savePlatform(employer.id, s);
  const i = (await loadPlatform(candidate)).invitations[0];
  assert.equal(i.status, "cancelled");
  assert.equal(invitationMatches(i, "cancelled"), true);
  assert.equal(invitationUnread(i), false);
  const slot = await db.query(
    "SELECT id FROM invitations WHERE company_id=$1 AND candidate_id=$2 AND status IN ('sent','viewed')",
    [i.companyId, i.candidateId],
  );
  assert.equal(slot.rows.length, 0);
});
test("other company and candidate cannot rewrite the employer proposal", async () => {
  await seed(original);
  const otherState = await loadPlatform(other);
  otherState.invitations.push(
    changeInvitation(original, "invitation-update", patch),
  );
  await assert.rejects(
    () => savePlatform(other.id, otherState),
    /другого аккаунта/,
  );
  const s = await loadPlatform(candidate);
  s.invitations[0] = changeInvitation(original, "invitation-update", patch);
  await assert.rejects(
    () => savePlatform(candidate.id, s),
    /предложение работодателя/,
  );
});
test("accepting and editing concurrently cannot overwrite the accepted proposal", async () => {
  await seed(original);
  const stale = await loadPlatform(employer);
  stale.invitations[0] = changeInvitation(original, "invitation-update", patch);
  const s = await loadPlatform(candidate);
  s.invitations[0].status = "accepted";
  s.invitations[0].respondedAt = new Date().toISOString();
  await savePlatform(candidate.id, s);
  await assert.rejects(() => savePlatform(employer.id, stale), /CONFLICT/);
  assert.equal(
    (await loadPlatform(candidate)).invitations[0].status,
    "accepted",
  );
  assert.equal((await db.query("SELECT * FROM conversations")).rows.length, 1);
});

test("voluntary task hides details until acceptance, persists server timer and completes without changing grade", async () => {
  const { changeConversation, readConversation, listConversations } =
    await import("../lib/conversations");
  const room = (await db.query("SELECT id FROM conversations")).rows[0].id;
  const gradeBefore = (await loadPlatform(candidate)).profile.grade;
  const secret = {
    title: "Секретное название",
    instructions: "Закрытые условия задачи",
    criteria: "Закрытые критерии",
    minutes: 20,
    startedAt: "2000-01-01T00:00:00.000Z",
    answer: "Поддельный ответ",
  };
  const sent = await changeConversation(employer, "employer", room, {
    type: "message",
    clientId: crypto.randomUUID(),
    task: secret,
  });
  assert.ok("message" in sent);
  if (!("message" in sent) || !sent.message) throw Error("Message missing");
  const messageId = sent.message.id;
  assert.equal(sent.message.task?.startedAt, undefined);
  assert.equal(sent.message.task?.answer, undefined);
  let received = (
    await readConversation(candidate, "candidate", room, null)
  ).messages.find((m) => m.id === messageId)!;
  assert.equal(received.body, "Работодатель отправил вам задачу");
  assert.deepEqual(received.task, {
    title: "",
    instructions: "",
    criteria: "",
    minutes: 20,
    status: "offered",
  });
  assert.equal(
    (await listConversations(candidate, "candidate", null)).items[0]
      .lastMessage,
    "Работодатель отправил вам задачу",
  );
  await assert.rejects(
    () =>
      changeConversation(candidate, "candidate", room, {
        type: "task-response",
        messageId,
        status: "submitted",
        answer: "Раньше старта",
      }),
    /недоступен/,
  );
  await assert.rejects(
    () =>
      changeConversation(employer, "employer", room, {
        type: "task-response",
        messageId,
        status: "accepted",
      }),
    /кандидату/,
  );
  await assert.rejects(
    () =>
      changeConversation(candidate, "candidate", room, {
        type: "message",
        clientId: crypto.randomUUID(),
        task: secret,
      }),
    /работодатель/,
  );
  await changeConversation(candidate, "candidate", room, {
    type: "task-response",
    messageId,
    status: "accepted",
    startedAt: secret.startedAt,
  });
  received = (
    await readConversation(candidate, "candidate", room, null)
  ).messages.find((m) => m.id === messageId)!;
  assert.equal(received.task?.instructions, secret.instructions);
  assert.equal(received.task?.criteria, secret.criteria);
  const start = received.task!.startedAt!;
  assert.ok(Math.abs(Date.parse(start) - Date.now()) < 5000);
  await assert.rejects(
    () =>
      changeConversation(candidate, "candidate", room, {
        type: "task-response",
        messageId,
        status: "accepted",
      }),
    /уже сохранён/,
  );
  assert.equal(
    (await readConversation(candidate, "candidate", room, null)).messages.find(
      (m) => m.id === messageId,
    )!.task?.startedAt,
    start,
  );
  await changeConversation(candidate, "candidate", room, {
    type: "task-response",
    messageId,
    status: "submitted",
    answer: "Готовое решение",
  });
  const submitted = (
    await readConversation(employer, "employer", room, null)
  ).messages.find((m) => m.id === messageId)!.task!;
  assert.equal(submitted.answer, "Готовое решение");
  assert.ok(Date.parse(submitted.submittedAt!) >= Date.parse(start));
  await changeConversation(employer, "employer", room, {
    type: "task-review",
    messageId,
    feedback: "Спасибо за решение",
  });
  assert.equal(
    (await readConversation(candidate, "candidate", room, null)).messages.find(
      (m) => m.id === messageId,
    )!.task?.feedback,
    "Спасибо за решение",
  );
  assert.equal((await loadPlatform(candidate)).profile.grade, gradeBefore);
  // Declining before starting must never reveal the private conditions.
  const second = await changeConversation(employer, "employer", room, {
    type: "message",
    clientId: crypto.randomUUID(),
    task: secret,
  });
  if (!("message" in second) || !second.message) throw Error("Message missing");
  await changeConversation(candidate, "candidate", room, {
    type: "task-response",
    messageId: second.message.id,
    status: "declined",
  });
  const declined = (
    await readConversation(candidate, "candidate", room, null)
  ).messages.find((m) => m.id === second.message!.id)!.task!;
  assert.equal(declined.instructions, "");
  assert.equal(declined.title, "");
  assert.equal(declined.startedAt, undefined);
});

test("hard task deadline locks answers, preserves partial draft, persists expiry after a rejected late request and notifies both participants", async () => {
  const { changeConversation, readConversation, unreadConversations } =
    await import("../lib/conversations");
  const room = (await db.query("SELECT id FROM conversations")).rows[0].id;
  const sent = await changeConversation(employer, "employer", room, {
    type: "message",
    clientId: crypto.randomUUID(),
    task: {
      title: "Дедлайн",
      instructions: "Закрытые условия",
      criteria: "Критерии",
      minutes: 1,
    },
  });
  if (!("message" in sent) || !sent.message) throw Error("missing message");
  const messageId = sent.message.id;
  await changeConversation(candidate, "candidate", room, {
    type: "task-response",
    messageId,
    status: "accepted",
  });
  await changeConversation(candidate, "candidate", room, {
    type: "task-draft",
    messageId,
    answer: "Частичное решение",
    revision: 1,
  });
  await changeConversation(candidate, "candidate", room, {
    type: "task-draft",
    messageId,
    answer: "Частичное решение",
    revision: 1,
  });
  await assert.rejects(
    () =>
      changeConversation(candidate, "candidate", room, {
        type: "task-draft",
        messageId,
        answer: "Несогласованная вкладка",
        revision: 1,
      }),
    /другой вкладке/,
  );
  await assert.rejects(
    () =>
      changeConversation(other, "candidate", room, {
        type: "task-draft",
        messageId,
        answer: "Чужой ответ",
        revision: 2,
      }),
    /недоступен/,
  );
  const returned = (
    await readConversation(candidate, "candidate", room, null)
  ).messages.find((m) => m.id === messageId)!;
  assert.equal(returned.task?.draftAnswer, "Частичное решение");
  assert.equal(
    (await readConversation(employer, "employer", room, null)).messages.find(
      (m) => m.id === messageId,
    )!.task?.draftAnswer,
    undefined,
  );
  const last = (
    await db.query(
      "SELECT max(id)::text id FROM conversation_messages WHERE conversation_id=$1",
      [room],
    )
  ).rows[0].id;
  for (const [who, role] of [
    [candidate, "candidate"],
    [employer, "employer"],
  ] as const)
    await changeConversation(who, role, room, { type: "read", through: last });
  const start = new Date(Date.now() - 61000).toISOString(),
    deadline = new Date(Date.parse(start) + 60000).toISOString();
  await db.query(
    "UPDATE conversation_messages SET task=task||$2::jsonb WHERE id=$1",
    [messageId, JSON.stringify({ startedAt: start, deadlineAt: deadline })],
  );
  await assert.rejects(
    () =>
      changeConversation(candidate, "candidate", room, {
        type: "task-response",
        messageId,
        status: "submitted",
        answer: "Поздний ответ",
      }),
    /истекло/,
  );
  const expired = (
    await readConversation(candidate, "candidate", room, null)
  ).messages.find((m) => m.id === messageId)!.task!;
  assert.equal(expired.status, "expired");
  assert.equal(expired.answer, "Частичное решение");
  assert.equal(expired.instructions, "");
  assert.equal(expired.criteria, "");
  assert.equal(expired.expiredAt, deadline);
  await assert.rejects(
    () =>
      changeConversation(candidate, "candidate", room, {
        type: "task-draft",
        messageId,
        answer: "Поздняя правка",
        revision: 2,
      }),
    /истекло|завершена/,
  );
  assert.ok((await unreadConversations(employer, "employer")).unread > 0);
  assert.ok((await unreadConversations(candidate, "candidate")).unread > 0);
  const before = (
    await db.query(
      "SELECT count(*)::int n FROM conversation_messages WHERE conversation_id=$1",
      [room],
    )
  ).rows[0].n;
  await readConversation(candidate, "candidate", room, null);
  await readConversation(employer, "employer", room, null);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM conversation_messages WHERE conversation_id=$1",
        [room],
      )
    ).rows[0].n,
    before,
    "expiry notifications are exactly once",
  );
  await changeConversation(employer, "employer", room, {
    type: "task-review",
    messageId,
    feedback: "Проверен частичный результат",
  });
  const reviewed = (
    await readConversation(candidate, "candidate", room, null)
  ).messages.find((m) => m.id === messageId)!.task!;
  assert.equal(reviewed.expiredAt, deadline);
  assert.equal(reviewed.instructions, "");
  assert.equal(reviewed.feedback, "Проверен частичный результат");
});

test("fresh demo invitation belongs to a separate employer and opens a usable isolated chat", async () => {
  const {seedDemo} = await import('../lib/demo-platform');
  const {changeConversation,readConversation} = await import('../lib/conversations');
  const a = {...account('demo-chat-owner'),scope:'demo-chat-owner'};
  await seedDemo(a);
  const s = await loadPlatform(a);
  const i = s.invitations.find(i=>i.candidateId===s.profile.id)!;
  assert.ok(i);
  assert.notEqual(i.companyId,s.company.id);
  const company = (await db.query('SELECT owner_id,scope FROM companies WHERE id=$1',[i.companyId])).rows[0];
  assert.notEqual(company.owner_id,a.id);
  assert.equal(company.scope,a.scope);
  Object.assign(i,{status:'accepted',readAt:new Date().toISOString(),respondedAt:new Date().toISOString()});
  await savePlatform(a.id,s);
  const room = (await db.query('SELECT id FROM conversations WHERE company_id=$1 AND candidate_id=$2',[i.companyId,s.profile.id])).rows[0].id;
  const text='Здравствуйте! Обсудим задачи команды.';
  await changeConversation(a,'candidate',room,{type:'message',clientId:crypto.randomUUID(),body:text});
  const thread = await readConversation(a,'candidate',room,null);
  assert.equal(thread.messages.at(-1)?.body,text);
  await assert.rejects(readConversation(other,'candidate',room,null),/недоступен/);
  assert.equal((await loadPlatform(a)).invitations.find(x=>x.id===i.id)?.status,'accepted');
});
