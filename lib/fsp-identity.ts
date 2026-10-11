import { getDb } from "@/db";
import { createAccount, type Account } from "./platform";
import { FspError } from "./fsp-errors";

/** Called only after OIDC signature/iss/aud/nonce/expiry checks, never with browser-supplied claims. */
export async function resolveFspIdentity({
  issuer,
  claims,
  intent,
  consent,
  userId,
  participantClaim,
}: {
  issuer: string;
  claims: Record<string, unknown>;
  intent: "login" | "register" | "link";
  consent: boolean;
  userId?: string;
  participantClaim: string;
}): Promise<{ account: Account; created: boolean }> {
  const subject = typeof claims.sub === "string" ? claims.sub : "";
  if (!subject || subject.length > 255) throw new FspError("failed");
  const rawId = claims[participantClaim];
  const participantId =
    typeof rawId === "string" && rawId.length <= 160
      ? rawId
      : typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId >= 0
        ? String(rawId)
        : null;
  const db = await getDb();
  return db.transaction(async (tx) => {
    // A concurrent first login/link cannot create two owners of one identity.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      issuer + "\n" + subject,
    ]);
    const {
      rows: [existing],
    } = await tx.query(
      "SELECT u.* FROM external_identities i JOIN users u ON u.id=i.user_id WHERE i.issuer=$1 AND i.subject=$2 AND u.deleted_at IS NULL",
      [issuer, subject],
    );
    if (existing) {
      if (existing.demo) throw new FspError("demo");
      if (intent === "link" && existing.id !== userId)
        throw new FspError("linked_elsewhere");
      await tx.query(
        "UPDATE external_identities SET participant_id=COALESCE($3,participant_id) WHERE issuer=$1 AND subject=$2",
        [issuer, subject, participantId],
      );
      if (participantId)
        await tx.query(
          "UPDATE candidate_profiles SET payload=jsonb_set(payload,'{fsp}',to_jsonb($2::text)) WHERE user_id=$1",
          [existing.id, participantId],
        );
      return { account: existing, created: false };
    }
    let account: Account;
    let created = false;
    if (intent === "link") {
      const {
        rows: [own],
      } = await tx.query(
        "SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
        [userId],
      );
      if (!own || !own.verified_at) throw new FspError("session", 401);
      if (own.demo) throw new FspError("demo");
      const previous = await tx.query(
        "SELECT subject FROM external_identities WHERE user_id=$1 AND issuer=$2",
        [userId, issuer],
      );
      if (previous.rows.length) throw new FspError("already_linked");
      account = own;
    } else {
      if (intent !== "register" || !consent) throw new FspError("consent");
      const email =
        typeof claims.email === "string"
          ? claims.email.trim().toLowerCase()
          : "";
      if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 200)
        throw new FspError("email");
      // Never merge accounts by an email claim, even when the provider marks it verified.
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "fsp-email:" + email,
      ]);
      if (
        (
          await tx.query("SELECT id FROM users WHERE email=$1 AND NOT demo", [
            email,
          ])
        ).rows.length
      )
        throw new FspError("existing");
      const claimText = (key: string) =>
        typeof claims[key] === "string"
          ? (claims[key] as string).trim().slice(0, 60)
          : "";
      const firstName = claimText("given_name"),
        lastName = claimText("family_name"),
        patronymic = claimText("middle_name");
      const name =
        firstName && lastName
          ? [lastName, firstName, patronymic].filter(Boolean).join(" ")
          : typeof claims.name === "string"
            ? claims.name.trim().slice(0, 180)
            : "";
      account = {
        id: crypto.randomUUID(),
        email,
        name: name.length >= 2 ? name : "Участник ФСП",
        scope: "public",
        demo: false,
        verified_at:
          claims.email_verified === true ? new Date().toISOString() : null,
        deleted_at: null,
      };
      await createAccount(tx, account, null);
      if (firstName && lastName)
        await tx.query(
          "UPDATE candidate_profiles SET payload=payload||$2::jsonb WHERE user_id=$1",
          [
            account.id,
            JSON.stringify({
              name: account.name,
              firstName,
              lastName,
              patronymic,
            }),
          ],
        );
      await tx.query("UPDATE users SET verified_at=$2 WHERE id=$1", [
        account.id,
        account.verified_at,
      ]);
      await tx.query(
        "UPDATE account_state SET payload=payload||$2::jsonb WHERE user_id=$1",
        [
          account.id,
          JSON.stringify({
            registrationSource: "fsp",
            registrationConsentAt: new Date().toISOString(),
          }),
        ],
      );
      created = true;
    }
    await tx.query(
      "INSERT INTO external_identities(issuer,subject,user_id,participant_id) VALUES($1,$2,$3,$4)",
      [issuer, subject, account.id, participantId],
    );
    if (participantId)
      await tx.query(
        "UPDATE candidate_profiles SET payload=jsonb_set(payload,'{fsp}',to_jsonb($2::text)) WHERE user_id=$1",
        [account.id, participantId],
      );
    // No fabricated achievements, test score or grade is assigned by signing in.
    return { account, created };
  });
}
