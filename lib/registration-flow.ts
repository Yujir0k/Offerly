import type { Role, State } from "./model";
/** Account verification is authoritative; contact/profile drafts never replace it. */
export function registrationDestination(state: State, role: Role) {
  return state.auth?.demo || state.emailVerification.status === "verified"
    ? `/welcome?role=${role}&automatic=1`
    : `/verify-email?role=${role}&ready=1`;
}
export function registrationProfilePath(role: Role) {
  return `/demo/${role}/${role === "candidate" ? "profile" : "company"}`;
}
