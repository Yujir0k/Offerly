import { cookies } from "next/headers";
import { getDb, query, type Database } from "@/db";
import {
  digest,
  SESSION_COOKIE,
  throttle,
  proveAccountPassword,
  requestEmailCode,
} from "./auth";
import { accountById, type Account } from "./platform";
async function sessionHash() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) throw new Error("AUTH");
  return digest(token);
}
async function flowFor(
  db: Database,
  account: Account,
  id: string,
  hash: string,
) {
  const {
    rows: [flow],
  } = await db.query(
    "SELECT * FROM email_change_flows WHERE id=$1 AND user_id=$2 AND session_hash=$3 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
    [id, account.id, hash],
  );
  if (!flow || flow.old_email !== account.email)
    throw new Error("Смена почты устарела. Начните заново.");
  return flow;
}
async function checkCode(
  db: Database,
  account: Account,
  flowId: string,
  purpose: string,
  code: string,
) {
  if (!/^\d{6}$/.test(code))
    return { error: "Введите шестизначный код", challenge: null };
  const {
    rows: [challenge],
  } = await db.query(
    "SELECT * FROM email_challenges WHERE user_id=$1 AND flow_id=$2 AND purpose=$3 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
    [account.id, flowId, purpose],
  );
  if (
    !challenge ||
    new Date(challenge.expires_at).getTime() < Date.now() ||
    challenge.attempts >= 5
  )
    return { error: "Код истёк. Запросите новый", challenge: null };
  await db.query(
    "UPDATE email_challenges SET attempts=attempts+1 WHERE id=$1",
    [challenge.id],
  );
  if (digest(challenge.id + ":" + code) !== challenge.code_hash)
    return { error: "Неверный код", challenge: null };
  return { error: null, challenge };
}
export async function beginEmailChange(
  account: Account,
  email: string,
  method: string,
  password: string,
) {
  if (account.demo) throw new Error("Смена почты недоступна в демоверсии.");
  email = email.trim().toLowerCase();
  if (
    email.length > 200 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    email === account.email
  )
    throw new Error("Укажите новый корректный адрес почты.");
  if (!account.verified_at && method !== "password")
    throw new Error(
      "Сначала подтвердите текущую почту или используйте пароль.",
    );
  if (!["old-email", "password"].includes(method))
    throw new Error("Выберите способ подтверждения доступа.");
  await throttle("email-change-begin:" + account.id, 10);
  const { rows } = await query(
    "SELECT id FROM users WHERE email=$1 AND demo=false AND deleted_at IS NULL AND id<>$2",
    [email, account.id],
  );
  if (rows.length)
    throw new Error("Этот адрес уже используется другим аккаунтом.");
  if (method === "password") await proveAccountPassword(account, password);
  const id = crypto.randomUUID(),
    hash = await sessionHash();
  await (
    await getDb()
  ).transaction(async (db) => {
    await db.query(
      "UPDATE email_change_flows SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [account.id],
    );
    await db.query(
      "INSERT INTO email_change_flows(id,user_id,session_hash,old_email,new_email,authorized_at,expires_at) VALUES ($1,$2,$3,$4,$5,CASE WHEN $6 THEN now() ELSE NULL END,now()+interval '30 minutes')",
      [id, account.id, hash, account.email, email, method === "password"],
    );
  });
  const delivery = await requestEmailCode(
    account,
    method === "password" ? email : account.email,
    method === "password" ? "change-new" : "change-old",
    id,
  );
  return {
    id,
    stage:
      method === "password" ? ("new-code" as const) : ("old-code" as const),
    email,
    delivery,
  };
}
export async function authorizeEmailChange(
  account: Account,
  id: string,
  code: string,
) {
  await throttle("email-change-confirm:" + account.id, 15);
  const hash = await sessionHash();
  const result = await (
    await getDb()
  ).transaction(async (db) => {
    const flow = await flowFor(db, account, id, hash);
    if (flow.authorized_at) throw new Error("Доступ уже подтверждён.");
    const checked = await checkCode(db, account, id, "change-old", code);
    if (checked.error) return { error: checked.error, flow };
    if (checked.challenge.email !== flow.old_email)
      throw new Error("Начните смену почты заново.");
    await db.query("UPDATE email_challenges SET used_at=now() WHERE id=$1", [
      checked.challenge.id,
    ]);
    await db.query(
      "UPDATE email_change_flows SET authorized_at=now() WHERE id=$1",
      [id],
    );
    return { error: null, flow };
  });
  if (result.error) throw new Error(result.error);
  // If delivery fails, the session-bound grant remains authorized; resend retries delivery.
  const delivery = await requestEmailCode(
    account,
    result.flow.new_email,
    "change-new",
    id,
  );
  return {
    id,
    stage: "new-code" as const,
    email: result.flow.new_email,
    delivery,
  };
}
export async function resendEmailChange(account: Account, id: string) {
  const hash = await sessionHash();
  const flow = await (
    await getDb()
  ).transaction((db) => flowFor(db, account, id, hash));
  const authorized = !!flow.authorized_at;
  const delivery = await requestEmailCode(
    account,
    authorized ? flow.new_email : flow.old_email,
    authorized ? "change-new" : "change-old",
    id,
  );
  return {
    id,
    stage: authorized ? ("new-code" as const) : ("old-code" as const),
    email: flow.new_email,
    delivery,
  };
}
export async function finishEmailChange(
  account: Account,
  id: string,
  code: string,
) {
  await throttle("email-change-confirm:" + account.id, 15);
  const hash = await sessionHash();
  const result = await (
    await getDb()
  ).transaction(async (db) => {
    const flow = await flowFor(db, account, id, hash);
    if (!flow.authorized_at)
      throw new Error("Сначала подтвердите доступ к аккаунту.");
    const checked = await checkCode(db, account, id, "change-new", code);
    if (checked.error) return checked.error;
    if (checked.challenge.email !== flow.new_email)
      throw new Error("Начните смену почты заново.");
    try {
      await db.query(
        "UPDATE users SET email=$2,verified_at=now() WHERE id=$1",
        [account.id, flow.new_email],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new Error(
          "Аккаунт с этой почтой уже зарегистрирован. Укажите другой адрес.",
        );
      throw error;
    }
    await db.query(
      "UPDATE candidate_profiles SET payload=jsonb_set(payload,'{email}',to_jsonb($2::text)) WHERE user_id=$1",
      [account.id, flow.new_email],
    );
    await db.query(
      "UPDATE email_challenges SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [account.id],
    );
    await db.query(
      "UPDATE email_change_flows SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [account.id],
    );
    await db.query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", [
      account.id,
      hash,
    ]);
    return null;
  });
  if (result) throw new Error(result);
  return (await accountById(account.id))!;
}
