// Mutates synthetic QA accounts only. Never point at the primary application.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL,
  fixture = process.env.TEST_FIXTURE_FILE;
if (
  !base ||
  !fixture ||
  !["localhost", "127.0.0.1"].includes(new URL(base).hostname) ||
  new URL(base).port === "5173"
)
  throw Error("Use isolated QA fixtures and a separate loopback app");
const u = JSON.parse(await readFile(fixture, "utf8"));
let n = 0;
async function req(w, path, data, role = "candidate", status = 200, method) {
  const r = await fetch(base + path, {
    method: method || (data ? "POST" : "GET"),
    headers: {
      Origin: base,
      "X-Offerly-Role": role,
      ...(!(data instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(w?.cookies ? { Cookie: w.cookies } : {}),
    },
    body: data
      ? data instanceof FormData
        ? data
        : JSON.stringify(data)
      : undefined,
  });
  if (w && r.headers.getSetCookie().length)
    w.cookies = r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  assert.equal(r.status, status, path);
  n++;
  if (r.headers.get("content-type")?.includes("json")) return r.json();
  return r;
}
for (const k of ["e", "a", "b", "c", "o"])
  u[k].state = await req(u[k], "/api/auth", {
    type: "login",
    email: u[k].email,
    password: u[k].password,
    role: k === "e" ? "employer" : "candidate",
  });
const act = (w, type, data = {}, role = w === u.e ? "employer" : "candidate") =>
  req(w, "/api/action", { type, role, ...data }, role);
const invitationTitle = "Проверка перехода в сообщения " + Date.now();
const pendingTitle = "UI: знакомство с командой " + Date.now();
const s = await act(u.e, "invite", {
  candidateId: u.c.state.profile.id,
  title: invitationTitle,
  description: "Разработка API",
  min: 160000,
  max: 220000,
  contact: u.e.email,
});
const iv = s.invitations.find((i) => i.title === invitationTitle);
assert(iv);
n++;
await req(u.c, "/api/conversations", { invitationId: iv.id }, "candidate", 404);
await act(u.c, "respond", { id: iv.id, status: "accepted" });
const ec = await req(u.e, "/api/conversations", undefined, "employer");
const room = ec.items.find((r) => r.name === u.c.state.profile.name);
assert(room);
n++;
const repeated = await req(u.c, "/api/conversations", { invitationId: iv.id });
assert.equal(repeated.id, room.id);
n++;
await req(u.o, `/api/conversations/${room.id}`, undefined, "candidate", 404);
await req(
  u.o,
  `/api/conversations/${room.id}/avatar?role=employer`,
  undefined,
  "employer",
  404,
);
const photo = await readFile(
  new URL("../public/portraits/developer-male.webp", import.meta.url),
);
const img =
  photo ||
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
const avatar = new FormData();
avatar.set(
  "file",
  new Blob([img], { type: photo ? "image/webp" : "image/png" }),
  "avatar.png",
);
await req(u.c, "/api/avatar", avatar);
const logo = new FormData();
logo.set(
  "file",
  new Blob([img], { type: photo ? "image/webp" : "image/png" }),
  "logo.png",
);
logo.set("role", "employer");
logo.set("kind", "logo");
await req(u.e, "/api/company-media", logo, "employer");
const et = await req(
  u.e,
  `/api/conversations/${room.id}`,
  undefined,
  "employer",
);
assert.equal(et.conversation.grade, u.c.state.profile.grade);
assert(et.conversation.avatar);
n += 2;
await req(u.e, et.conversation.avatar, undefined, "employer");
const ct = await req(u.c, `/api/conversations/${room.id}`);
assert(ct.conversation.subtitle.includes("Работодатель"));
assert(ct.conversation.avatar);
assert(!JSON.stringify(ct).includes("avatarKey"));
n += 3;
await req(u.c, ct.conversation.avatar);
const title = "Вакансия для проверки чата " + Date.now();
const js = await act(u.e, "job", {
  status: "published",
  title,
  description: "Разработка API в команде",
  specialty: "Backend",
  grade: "Middle",
  skills: "Python,SQL",
  format: "Удалённо",
  city: "Москва",
  min: 160000,
  max: 220000,
  employment: "Полная занятость",
});
const job = js.jobs.find((j) => j.title === title);
assert(job);
n++;
await act(u.a, "apply", {
  id: job.id,
  message: "Готов обсудить задачи команды",
  shareContacts: true,
});
const application = (await req(u.a, "/api/state")).applications.find(
  (a) => a.jobId === job.id,
);
assert(application);
n++;
const ar = await req(u.a, "/api/conversations", {
  applicationId: application.id,
});
const list = await req(u.e, "/api/conversations", undefined, "employer");
assert(list.items.some((r) => r.id === ar.id));
n++;
const msg = await req(
  u.e,
  `/api/conversations/${ar.id}`,
  {
    type: "message",
    body: "Тестовая переписка после отклика",
    clientId: crypto.randomUUID(),
  },
  "employer",
);
const received = await req(u.a, `/api/conversations/${ar.id}`);
assert(received.messages.some((m) => m.id === msg.message.id));
n++;
// Keep new candidate invitation pending for a complete UI acceptance scenario.
const pending = await act(u.e, "invite", {
  candidateId: u.b.state.profile.id,
  title: pendingTitle,
  description: "Обсудим задачи и условия",
  min: 160000,
  max: 220000,
  contact: u.e.email,
});
await writeFile(
  process.env.TEST_OUTPUT_FILE || "/tmp/offerly-chat-focus-fixtures.json",
  JSON.stringify({
    users: u,
    room: room.id,
    pending: pending.invitations.find((i) => i.title === pendingTitle).id,
  }),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    checks: n,
    automaticConversation: true,
    avatarAcl: true,
    exchangeConsent: true,
  }),
);
