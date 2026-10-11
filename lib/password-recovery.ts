import { randomBytes, randomInt } from "node:crypto";
import { getDb } from "@/db";
import { digest, hashPassword, throttle } from "./auth";
import { sendAccountMail } from "./mail-transport";
import { codeMail, passwordChangedMail } from "./mail-templates";
export async function requestPasswordReset(
  emailValue: unknown,
  binding: string,
) {
  const email =
    typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "";
  if (email.length > 200 || !/^\S+@\S+\.\S+$/.test(email))
    throw Error("Укажите корректную почту");
  await throttle("reset-email:" + email, 1, 60);
  const db = await getDb(),
    id = crypto.randomUUID(),
    code = String(randomInt(100000, 1000000));
  const {
    rows: [user],
  } = await db.query(
    "SELECT id,password_hash FROM users WHERE email=$1 AND demo=false AND deleted_at IS NULL AND password_hash IS NOT NULL",
    [email],
  );
  await db.transaction(async (tx) => {
    if (user)
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
    if (user)
      await tx.query(
        "UPDATE password_reset_flows SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [user.id],
      );
    await tx.query(
      "INSERT INTO password_reset_flows(id,user_id,binding_hash,code_hash,email,credential_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')",
      [
        id,
        user?.id || null,
        digest(binding),
        digest(id + ":" + code),
        email,
        user ? digest(user.password_hash) : null,
      ],
    );
  });
  if (user)
    try {
      await sendAccountMail(
        codeMail("recovery", email, code),
        id,
      );
    } catch {
      console.error("Password reset mail delivery failed");
    }
  return {
    id,
    message: "Если аккаунт с такой почтой существует, мы отправили код.",
    resendAt: new Date(Date.now() + 60000).toISOString(),
  };
}
export async function verifyPasswordReset(
  id: string,
  code: string,
  binding: string,
) {
  await throttle("reset-check:" + id, 10, 600);
  if (!/^\d{6}$/.test(code)) throw Error("Введите шесть цифр");
  const db = await getDb(),
    grant = randomBytes(32).toString("hex");
  const ok = await db.transaction(async (tx) => {
    const {
      rows: [r],
    } = await tx.query(
      "SELECT * FROM password_reset_flows WHERE id=$1 AND binding_hash=$2 FOR UPDATE",
      [id, digest(binding)],
    );
    if (
      !r ||
      !r.user_id ||
      r.used_at ||
      r.authorized_at ||
      Date.parse(r.expires_at) <= Date.now() ||
      r.attempts >= 5
    )
      return false;
    await tx.query(
      "UPDATE password_reset_flows SET attempts=attempts+1 WHERE id=$1",
      [id],
    );
    if (r.code_hash !== digest(id + ":" + code)) return false;
    await tx.query(
      "UPDATE password_reset_flows SET grant_hash=$2,authorized_at=now() WHERE id=$1",
      [id, digest(grant)],
    );
    return true;
  });
  if (!ok) throw Error("Код неверный или истёк. Запросите новый.");
  return { grant };
}
export async function completePasswordReset(
  id: string,
  grant: string,
  password: string,
  binding: string,
) {
  await throttle("reset-finish:" + id, 5, 600);
  const hash = await hashPassword(password),
    db = await getDb();
  const account = await db.transaction(async (tx) => {
    const {
      rows: [owner],
    } = await tx.query("SELECT user_id FROM password_reset_flows WHERE id=$1", [
      id,
    ]);
    if (owner?.user_id)
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        owner.user_id,
      ]);
    const {
      rows: [r],
    } = await tx.query(
      `SELECT f.*,u.password_hash AS current_credential FROM password_reset_flows f JOIN users u ON u.id=f.user_id WHERE f.id=$1 AND f.binding_hash=$2 AND f.grant_hash=$3 AND f.used_at IS NULL AND f.authorized_at>now()-interval '5 minutes' AND f.expires_at>now() AND u.deleted_at IS NULL AND u.demo=false AND u.password_hash IS NOT NULL FOR UPDATE OF f,u`,
      [id, digest(binding), digest(grant)],
    );
    if (
      !r ||
      digest(r.current_credential) !== r.credential_hash ||
      (
        await tx.query("SELECT 1 FROM users WHERE id=$1 AND email=$2", [
          r.user_id,
          r.email,
        ])
      ).rows.length === 0
    )
      throw Error("Разрешение истекло. Начните восстановление заново.");
    await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
      r.user_id,
      hash,
    ]);
    await tx.query("DELETE FROM sessions WHERE user_id=$1", [r.user_id]);
    await tx.query(
      "UPDATE password_reset_flows SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [r.user_id],
    );
    return r;
  });
  try {
    await sendAccountMail(passwordChangedMail(account.email));
  } catch {
    console.error("Password reset notification delivery failed");
  }
  return { ok: true };
}
