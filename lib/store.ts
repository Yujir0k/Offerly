import { RequestSecurityError } from "./request-security";
import { currentAccount } from "./auth";
import { loadPlatform, savePlatform } from "./platform";
import type { State, Role } from "./model";
import { profileCompletion } from "./profile-completion";
import { employerApplications } from "./job-applications";
import { splitPersonalName } from "./personal-name";
import { invitationOwned } from "./employer-profile";
import { getDb } from "@/db";
import { redactProfileText as redact, redactProfileValue } from './profile-redaction';
export async function workspace(
  targets: {
    jobId?: string;
    candidateId?: number;
    allOwnedJobs?: boolean;
    catalogOnly?: boolean;
  } = {},
) {
  const account = await currentAccount();
  if (!account) throw new Error("AUTH");
  return {
    owner: account.id,
    account,
    db: await getDb(),
    state: await loadPlatform(account, targets),
  };
}
export const save = savePlatform;
export function clientState(state: State, role: Role) {
  const s = structuredClone(state);
  s.role = role;
  const denied = new Set(s.blockedCandidateIds || []);
  delete s.blockedCandidateIds;
  const ownedApplications = employerApplications(s).map((a) =>
    denied.has(a.candidateId || 0) ? { ...a, candidate: undefined } : a,
  );
  const invitationAccepted = (id: number) =>
    s.invitations.some(
      (i) =>
        i.candidateId === id &&
        i.status === "accepted" &&
        invitationOwned(i, s),
    );
  if (role === "employer") {
    s.applications = ownedApplications;
    s.invitations = s.invitations.filter((invitation) =>
      invitationOwned(invitation, s),
    );
    s.favoriteJobs = [];
    s.candidates = [s.profile, ...s.candidates]
      .filter(
        (p) =>
          !denied.has(p.id) &&
          p.visible &&
          p.consent &&
          p.jobStatus !== "paused" &&
          profileCompletion(p).ready,
      )
      .map((p) => {
        p.canMessage = invitationAccepted(p.id) || ownedApplications.some((application) => application.candidateId === p.id);
        if (invitationAccepted(p.id))
          return { ...p, resumeKey: undefined, avatarKey: undefined };
        const snapshot = ownedApplications.find(
          (a) => (a.candidateId ?? s.profile.id) === p.id,
        )?.candidate;
        if (snapshot)
          return {
            ...p,
            ...splitPersonalName(snapshot.name),
            initials: snapshot.initials,
            email: snapshot.email,
            phone: snapshot.phone,
            resumeKey: undefined,
            avatarKey: undefined,
          };
        return {
          ...redactProfileValue(p),
          bio: redact(p.bio),
          notes: "",
          projects: redact(p.projects),
          education: redact(p.education),
          links: [],
          workHistory: p.workHistory.map((w) => ({
            ...w,
            description: redact(w.description),
          })),
          email: "",
          phone: "",
          resumeKey: undefined,
          avatarKey: undefined,
        };
      });
    s.profile = {
      ...s.profile,
      name: "",
      firstName: "",
      lastName: "",
      patronymic: "",
      initials: "",
      email: "",
      phone: "",
      resumeKey: undefined,
      avatarKey: undefined,
    };
    s.invitations = s.invitations.filter((i) => i.companyId === s.company.id);
    s.attempts = [];
    s.surveys = [];
  } else {
    s.jobs = s.jobs.filter((job) => job.status === "published");
    s.applications = s.applications.filter(
      (a) => a.candidateId === s.profile.id,
    );
    s.needs = [];
    s.saved = [];
    s.candidates = [];
    s.invitations = s.invitations.filter((i) => i.candidateId === s.profile.id);
  }
  // Large company-wide edits may load all owned records on the server, never ship them all.
  if (s.jobs.length > 60) {
    const linked = new Set(s.applications.map((a) => a.jobId));
    const own = s.jobs.filter((j) => j.companyId === s.company.id).slice(0, 20);
    const preview = s.jobs.filter((j) => j.status === "published").slice(0, 20);
    const ids = new Set([...own, ...preview].map((j) => j.id));
    s.jobs = s.jobs.filter((j) => ids.has(j.id) || linked.has(j.id));
  }
  return s;
}
export function errorResponse(e: unknown) {
  if (e instanceof RequestSecurityError) return Response.json({error: e.message}, {status: e.status, headers: {"Cache-Control": "no-store"}});
  let m = e instanceof Error ? e.message : "Ошибка сервера";
  const internal = m !== "AUTH" && m !== "CONFLICT" && !/[А-Яа-яЁё]/.test(m);
  if (internal) {
    const code = String((e as {code?: unknown})?.code || "INTERNAL_ERROR");
    console.error("Offerly server error", {
      name: e instanceof Error ? e.name : "UnknownError",
      code: /^[A-Z0-9_]{1,40}$/.test(code) ? code : "INTERNAL_ERROR",
    });
    m = "Не удалось выполнить действие. Повторите позже.";
  }
  return Response.json(
    {
      error:
        m === "AUTH"
          ? "Нужно войти в аккаунт"
          : m === "CONFLICT"
            ? "Данные изменились в другой вкладке. Обновите экран."
            : m,
    },
    {
      headers: {"Cache-Control": "private, no-store", ...(m === "Слишком много попыток. Попробуйте позже" ? {"Retry-After": "60"} : {})},
      status: m === "Слишком много попыток. Попробуйте позже" ? 429 : internal
        ? 500
        : m === "AUTH"
          ? 401
          : m === "CONFLICT"
            ? 409
            : 400,
    },
  );
}
export function checkOrigin(r: Request) {
  const origin = r.headers.get("origin");
  const expected = process.env.APP_URL || new URL(r.url).origin;
  const canonical = new URL(expected);
  let incoming: URL | null = null;
  try { incoming = origin ? new URL(origin) : null; } catch { throw new RequestSecurityError("Недопустимый источник запроса", 403); }
  const loopbackAlias =
    process.env.NODE_ENV !== "production" &&
    incoming &&
    ["localhost", "127.0.0.1"].includes(canonical.hostname) &&
    ["localhost", "127.0.0.1"].includes(incoming.hostname) &&
    incoming.protocol === "http:" &&
    canonical.protocol === "http:" &&
    incoming.port === canonical.port;
  if (!origin || (origin !== canonical.origin && !loopbackAlias))
    throw new RequestSecurityError("Недопустимый источник запроса", 403);
}
