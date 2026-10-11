import type { Invitation } from "./model";
import { grades } from "./model";
import { salaryRangeError } from "./salary-range";

/** Employer edits never change the recipient, source or consent. SavePlatform adds ownership and optimistic concurrency. */
export function changeInvitation(
  current: Invitation,
  action: "invitation-update" | "invitation-cancel",
  b: Record<string, unknown>,
  now = new Date().toISOString(),
): Invitation {
  if (!["sent", "viewed"].includes(current.status))
    throw new Error(
      "Можно изменить или отменить только приглашение без ответа",
    );
  if (b.expectedUpdatedAt !== (current.updatedAt || current.createdAt))
    throw new Error("CONFLICT");
  const i = structuredClone(current);
  if (action === "invitation-cancel") {
    i.status = "cancelled";
    i.cancelledAt = now;
  } else {
    const str = (value: unknown, max = 3000) =>
      typeof value === "string" ? value.trim().slice(0, max) : "";
    const error = salaryRangeError(b.min, b.max);
    if (error) throw new Error(error);
    if (!str(b.title) || !str(b.description) || !str(b.contact))
      throw new Error("Заполните предложение и способ связи");
    if (!["Удалённо", "Гибрид", "Офис"].includes(String(b.format)))
      throw new Error("Выберите формат работы");
    if (b.grade && !grades.includes(String(b.grade)))
      throw new Error("Выберите грейд");
    Object.assign(i, {
      min: Number(b.min),
      max: Number(b.max),
      title: str(b.title, 200),
      description: str(b.description),
      contact: str(b.contact, 200),
      format: b.format,
      city: str(b.city, 100),
      grade: b.grade || undefined,
      skills: Array.isArray(b.skills)
        ? b.skills
            .slice(0, 20)
            .map((value) => str(value, 160))
            .filter(Boolean)
        : [],
      status: "sent",
    });
    delete i.readAt;
  }
  i.updatedAt = now;
  return i;
}

export function assertInvitationRevision(
  invitation: Invitation,
  expected: unknown,
) {
  if (invitation.updatedAt && expected !== invitation.updatedAt)
    throw new Error(
      "Условия приглашения изменились. Откройте актуальное предложение перед ответом.",
    );
}
