import type { Database } from "@/db";
export const consentVersion = "2026-10-10-v1";
export async function recordConsent(
  db: Database,
  userId: string,
  purpose: string,
  granted: boolean,
  context: Record<string, unknown> = {},
) {
  await db.query(
    "INSERT INTO consent_events(id,user_id,version,purpose,granted,context) VALUES($1,$2,$3,$4,$5,$6)",
    [
      crypto.randomUUID(),
      userId,
      consentVersion,
      purpose,
      granted,
      JSON.stringify(context),
    ],
  );
}
