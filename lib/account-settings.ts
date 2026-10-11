import type { State } from "./model";
import { initialState } from "./model";
import { applicationStatus } from "./job-applications";
export type UserSettings = {
  email: string;
  timeZone: string;
  invitations: boolean;
  emailInvitations?: boolean;
  applications: boolean;
  assessments: boolean;
  emailDigest: "off" | "daily" | "weekly";
  snoozedUntil: string | null;
  notificationReadAt?: string;
};
export const timeZones = [
  "Europe/Moscow",
  "Europe/Kaliningrad",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Novosibirsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Yakutsk",
  "Asia/Vladivostok",
  "Asia/Magadan",
  "Asia/Kamchatka",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Almaty",
  "Asia/Tashkent",
  "Asia/Tbilisi",
  "Asia/Yerevan",
  "America/New_York",
];
export function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
export function userSettings(s: State): UserSettings {
  return {
    email: s.profile.email,
    timeZone: "Europe/Moscow",
    invitations: true,
    emailInvitations: true,
    applications: true,
    assessments: true,
    emailDigest: "off",
    snoozedUntil: null,
    ...s.settings,
  };
}
export function notificationActive(
  s: State,
  event: "invitations" | "applications" | "assessments",
  now = Date.now(),
) {
  const settings = userSettings(s);
  return (
    s.notifications &&
    settings[event] &&
    (!settings.snoozedUntil || Date.parse(settings.snoozedUntil) <= now)
  );
}
export function accountNotifications(s: State) {
  const since = Date.parse(userSettings(s).notificationReadAt || "1970-01-01");
  return [
    {
      key: "invitations" as const,
      label: "Новые приглашения",
      target: "invitations",
      count: s.invitations.filter(
        (i) =>
          i.candidateId === s.profile.id &&
          i.status === "sent" &&
          !i.readAt &&
          Date.parse(i.createdAt) > since,
      ).length,
    },
    {
      key: "applications" as const,
      label: "Обновлены статусы откликов",
      target: "jobs?view=applications",
      count: s.applications.filter(
        (a) =>
          (a.candidateId === undefined || a.candidateId === s.profile.id) &&
          applicationStatus(a.status) !== "sent" &&
          Date.parse(a.updatedAt || a.createdAt) > since,
      ).length,
    },
    {
      key: "assessments" as const,
      label: "Результаты проверки готовы",
      target: "results",
      count: s.attempts.filter(
        (a) => a.completedAt && Date.parse(a.completedAt) > since,
      ).length,
    },
  ].filter((event) => notificationActive(s, event.key) && event.count > 0);
}
export function displayDate(
  value: string,
  s: State,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" },
) {
  return new Intl.DateTimeFormat("ru-RU", {
    ...options,
    timeZone: userSettings(s).timeZone,
  }).format(new Date(value));
}
export function deletedAccountState(s: State): State {
  const fresh = initialState();
  const p = fresh.profile;
  for (const key of Object.keys(p)) {
    const value = p[key as keyof typeof p];
    if (typeof value === "string") Object.assign(p, { [key]: "" });
    else if (Array.isArray(value)) Object.assign(p, { [key]: [] });
    else if (typeof value === "number") Object.assign(p, { [key]: 0 });
    else if (typeof value === "boolean") Object.assign(p, { [key]: false });
  }
  Object.assign(p, {
    id: s.profile.id,
    specialty: "Backend",
    claimed: "Junior",
    grade: null,
    lastGradeChange: null,
    visible: false,
    consent: false,
    resumeKey: undefined,
    avatarKey: undefined,
  });
  Object.assign(fresh, {
    version: s.version,
    onboarded: false,
    profile: p,
    company: {
      id: s.company.id,
      name: "",
      description: "",
      website: "",
      email: "",
    },
    invitations: [],
    applications: [],
    attempts: [],
    surveys: [],
    needs: [],
    saved: [],
    favoriteJobs: [],
    taskAnswer: "",
    notifications: false,
    settings: undefined,
    journey: "profile",
    emailVerification: { email: "", status: "unverified" },
    accountDeletedAt: new Date().toISOString(),
  });
  return fresh;
}
