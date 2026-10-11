import type { Job, State } from "./model";
export function applicationStatus(status: string) {
  if (["Просмотрен", "viewed"].includes(status)) return "viewed";
  if (["Отклонён", "Отклонен", "declined"].includes(status)) return "declined";
  return "sent";
}
export function applicationLabel(status: string) {
  return { sent: "Отправлен", viewed: "Просмотрен", declined: "Отказ" }[
    applicationStatus(status)
  ];
}
export function ownsJob(job: Job, state: State) {
  return job.companyId === state.company.id;
}
export function employerApplications(state: State) {
  const owned = new Set(
    state.jobs.filter((job) => ownsJob(job, state)).map((job) => job.id),
  );
  return state.applications.filter((application) =>
    owned.has(application.jobId),
  );
}
export function applicationProfileError(profile: State["profile"]) {
  if (
    profile.name.trim().length < 2 ||
    !/^\S+@\S+\.\S+$/.test(profile.email.trim())
  )
    return "Добавьте имя и электронную почту в профиле, чтобы компания могла ответить.";
  return "";
}
