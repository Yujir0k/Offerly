import { withPersonalName } from "./personal-name";
import type { Profile } from "./model";
export const jobStatuses = {
  active: "Ищу работу",
  open: "Рассматриваю предложения",
  paused: "Не ищу работу",
} as const;
export function profileInitials(profile: Profile) {
  const p = withPersonalName(profile);
  return (
    [p.firstName, p.lastName]
      .filter(Boolean)
      .map((v) => v![0])
      .join("") || "Вы"
  );
}
export function avatarUrl(profile: Profile) {
  return profile.avatarKey
    ? `/api/avatar?v=${encodeURIComponent(profile.avatarKey.split("/").pop()!)}`
    : undefined;
}
export function profileStatus(profile: Profile) {
  return jobStatuses[profile.jobStatus || "open"] || jobStatuses.open;
}
