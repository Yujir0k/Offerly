import { recordConsent } from "./consent";
import { showcaseEnabled } from "./showcase-policy";
import { cookies, headers } from "next/headers";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  randomInt,
} from "node:crypto";
import { promisify } from "node:util";
import { query, getDb } from "@/db";
import { accountById, createAccount, type Account } from "./platform";
import { sessionDevice } from "./session-device";
import { sendAccountMail } from "./mail-transport";
import { codeMail } from "./mail-templates";
export { sendAccountMail } from "./mail-transport";
const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "offerly_session";
const COOKIE = SESSION_COOKIE;
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 128)
    throw new Error("Пароль должен содержать от 12 до 128 символов");
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
async function passwordMatches(password: string, hash: string) {
  const [, salt, key] = hash.split(":");
  if (!salt || !key) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}
export async function currentAccount() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const {
    rows: [row],
  } = await query(
    "SELECT user_id,last_seen_at,device_name FROM sessions WHERE token_hash=$1 AND expires_at>now()",
    [digest(token)],
  );
  if (!row) return null;
  if (row.device_name === "Неизвестное устройство") {
    const device = sessionDevice((await headers()).get("user-agent") || "");
    if (device.name !== "Неизвестное устройство")
      await query(
        "UPDATE sessions SET device_name=$2,device_type=$3 WHERE token_hash=$1 AND expires_at>now() AND device_name='Неизвестное устройство'",
        [digest(token), device.name, device.type],
      );
  }
  if (Date.now() - new Date(row.last_seen_at).getTime() > 300000)
    await query(
      "UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1 AND expires_at>now() AND last_seen_at<now()-interval '5 minutes'",
      [digest(token)],
    );
  return accountById(row.user_id);
}
export async function setSession(account: Account) {
  const token = randomBytes(32).toString("hex");
  const device = sessionDevice((await headers()).get("user-agent") || "");
  await query(
    "INSERT INTO sessions(token_hash,user_id,expires_at,device_name,device_type) VALUES ($1,$2,now()+interval '14 days',$3,$4)",
    [digest(token), account.id, device.name, device.type],
  );
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production" ||
      process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: 14 * 86400,
  });
}
export async function logout() {
  const jar = await cookies(),
    token = jar.get(COOKIE)?.value;
  if (token)
    await query("DELETE FROM sessions WHERE token_hash=$1", [digest(token)]);
  jar.delete(COOKIE);
}
export async function throttle(key: string, limit: number, seconds = 600) {
  const {
    rows: [row],
  } = await query(
    "INSERT INTO auth_throttles(key,count,reset_at) VALUES ($1,1,now()+($2::text||' seconds')::interval) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_throttles.reset_at<now() THEN 1 ELSE auth_throttles.count+1 END,reset_at=CASE WHEN auth_throttles.reset_at<now() THEN now()+($2::text||' seconds')::interval ELSE auth_throttles.reset_at END RETURNING count",
    [digest(key), seconds],
  );
  if (row.count > limit)
    throw new Error("Слишком много попыток. Попробуйте позже");
}
export async function registerAccount(b: Record<string, unknown>) {
  const email = String(b.email || "")
      .trim()
      .toLowerCase(),
    name = String(b.name || "").trim();
  if (
    !/^\S+@\S+\.\S+$/.test(email) ||
    email.length > 200 ||
    name.length < 2 ||
    name.length > 180 ||
    b.consent !== true
  )
    throw new Error("Проверьте имя, почту и согласие");
  await throttle("register:" + email, 5);
  const hash = await hashPassword(String(b.password || ""));
  const account: Account = {
    id: crypto.randomUUID(),
    email,
    name,
    scope: "public",
    demo: false,
    verified_at: null,
    deleted_at: null,
  };
  try {
    await (
      await getDb()
    ).transaction(async (db) => {
      await createAccount(
        db,
        account,
        hash,
        b.role === "employer"
          ? String(b.company || "")
              .trim()
              .slice(0, 150)
          : "",
      );
      await recordConsent(db, account.id, "profile-processing", true);
    });
  } catch (e) {
    if ((e as any).code === "23505")
      throw new Error(
        "Аккаунт с этой почтой уже зарегистрирован. Перейдите ко входу и используйте пароль, указанный при регистрации.",
      );
    throw e;
  }
  await setSession(account);
  return account;
}
export async function loginAccount(b: Record<string, unknown>) {
  const email = String(b.email || "")
      .trim()
      .toLowerCase(),
    password = String(b.password || "");
  if (email.length > 200 || password.length > 128)
    throw new Error("Неверная почта или пароль");
  await throttle("login:" + email, 10);
  const {
    rows: [row],
  } = await query(
    "SELECT * FROM users WHERE email=$1 AND demo=false AND deleted_at IS NULL AND (id NOT LIKE 'offerly-showcase-v1-%' OR $2)",
    [email, showcaseEnabled()],
  );
  // Use a real slow hash even for nonexistent accounts, avoiding a cheap enumeration path.
  const hash =
    row?.password_hash ||
    "scrypt:0123456789abcdef0123456789abcdef:" + "00".repeat(64);
  if (!(await passwordMatches(password, hash)) || !row)
    throw new Error("Неверная почта или пароль");
  await setSession(row);
  return row as Account;
}
export async function proveAccountPassword(account: Account, password: string) {
  await throttle("email-password:" + account.id, 5);
  const {
    rows: [row],
  } = await query(
    "SELECT password_hash FROM users WHERE id=$1 AND deleted_at IS NULL",
    [account.id],
  );
  if (
    !row?.password_hash ||
    password.length > 128 ||
    !(await passwordMatches(password, row.password_hash))
  )
    throw new Error(
      "Пароль не подходит. Попробуйте подтвердить доступ письмом на текущую почту.",
    );
}
export async function requestEmail(account: Account) {
  return requestEmailCode(account, account.email, "verify");
}
/** Entry/reload reuses a live challenge; only an explicit resend issues a new code. */
export async function verificationEmail(account: Account, automatic = false) {
  if (automatic) {
    const {
      rows: [existing],
    } = await query(
      "SELECT created_at FROM email_challenges WHERE user_id=$1 AND purpose='verify' AND used_at IS NULL AND expires_at>now() AND attempts<5 ORDER BY created_at DESC LIMIT 1",
      [account.id],
    );
    if (existing)
      return {
        emailSent: true,
        emailResendAt: new Date(
          new Date(existing.created_at).getTime() + 60000,
        ).toISOString(),
        emailDelivery:
          process.env.MAIL_TRANSPORT === "mailpit"
            ? { inboxUrl: "http://localhost:8025" }
            : {},
      };
  }
  const emailDelivery = await requestEmail(account);
  return {
    emailSent: true,
    emailResendAt: new Date(Date.now() + 60000).toISOString(),
    emailDelivery,
  };
}
export async function requestEmailCode(
  account: Account,
  email: string,
  purpose: "verify" | "change-old" | "change-new",
  flowId: string | null = null,
) {
  if (account.demo)
    throw new Error(
      "В демоверсии письма не отправляются. Для проверки почты создайте обычный аккаунт",
    );
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Проверьте адрес почты");
  const localMailpit = process.env.MAIL_TRANSPORT === "mailpit";
  if (
    localMailpit &&
    (process.env.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1", "::1"].includes(process.env.SMTP_HOST || ""))
  )
    throw new Error(
      "Локальная почта доступна только в разработке на этом компьютере",
    );
  await throttle("email-send:" + account.id + ":" + purpose, 1, 60);
  const code = String(randomInt(100000, 1000000)),
    id = crypto.randomUUID();
  await sendAccountMail(codeMail(purpose, email, code), id);
  await (
    await getDb()
  ).transaction(async (db) => {
    await db.query(
      "UPDATE email_challenges SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL",
      [account.id, purpose],
    );
    await db.query(
      "INSERT INTO email_challenges(id,user_id,email,code_hash,expires_at,purpose,flow_id) VALUES ($1,$2,$3,$4,now()+interval '10 minutes',$5,$6)",
      [
        id,
        account.id,
        email.toLowerCase(),
        digest(id + ":" + code),
        purpose,
        flowId,
      ],
    );
  });
  return {
    ...(localMailpit ? { inboxUrl: "http://localhost:8025" } : {}),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.MAIL_TRANSPORT === "file" &&
    process.env.MAIL_PREVIEW === "true"
      ? { previewCode: code }
      : {}),
  };
}
export async function confirmEmail(account: Account, code: string) {
  await throttle("email-confirm:" + account.id, 15);
  if (!/^\d{6}$/.test(code)) throw new Error("Введите шестизначный код");
  // Failed attempts must commit, not roll back with the user-facing error.
  const result = await (
    await getDb()
  ).transaction(async (db) => {
    const {
      rows: [challenge],
    } = await db.query(
      "SELECT * FROM email_challenges WHERE user_id=$1 AND purpose='verify' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [account.id],
    );
    if (
      !challenge ||
      new Date(challenge.expires_at).getTime() < Date.now() ||
      challenge.attempts >= 5
    )
      return "Код истёк. Запросите новый";
    await db.query(
      "UPDATE email_challenges SET attempts=attempts+1 WHERE id=$1",
      [challenge.id],
    );
    if (digest(challenge.id + ":" + code) !== challenge.code_hash)
      return "Неверный код";
    try {
      await db.query(
        "UPDATE users SET email=$2,verified_at=now() WHERE id=$1",
        [account.id, challenge.email],
      );
      await db.query("UPDATE email_challenges SET used_at=now() WHERE id=$1", [
        challenge.id,
      ]);
      // Revoke other sessions after an email change.
      if (challenge.email !== account.email) {
        const token = (await cookies()).get(COOKIE)?.value;
        await db.query(
          "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2",
          [account.id, digest(token || "")],
        );
      }
      await db.query(
        "UPDATE candidate_profiles SET payload=jsonb_set(payload,'{email}',to_jsonb($2::text)) WHERE user_id=$1",
        [account.id, challenge.email],
      );
      return null;
    } catch (e) {
      if ((e as any).code === "23505")
        throw new Error("Не удалось изменить адрес");
      throw e;
    }
  });
  if (result) throw new Error(result);
  return (await accountById(account.id))!;
}

