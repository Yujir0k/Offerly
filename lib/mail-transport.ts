import "server-only";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type AccountMail = Pick<Mail.Options, "from" | "to" | "subject" | "text" | "html" | "attachments" | "headers" | "messageId"> & {
  to: string;
  subject: string;
  text: string;
};
export function mailConfigured() {
  const local = process.env.NODE_ENV !== "production";
  return !!((local && process.env.MAIL_TRANSPORT === "file") ||
    (process.env.SMTP_HOST && process.env.MAIL_FROM));
}
export async function sendAccountMail(message: AccountMail, id = crypto.randomUUID()) {
  const mailpit = process.env.MAIL_TRANSPORT === "mailpit";
  if (mailpit && (process.env.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1", "::1"].includes(process.env.SMTP_HOST || "")))
    throw new Error("Локальная почта недоступна");
  const mail = { ...message, from: message.from || process.env.MAIL_FROM,
    disableFileAccess: true, disableUrlAccess: true };
  if (process.env.MAIL_TRANSPORT === "file" && process.env.NODE_ENV !== "production") {
    const dir = path.resolve(process.env.MAIL_OUTBOX_DIR || ".data/mail-outbox");
    await mkdir(dir, {recursive: true, mode: 0o700});
    // No tokens or recipient addresses are ever included in public logs or HTTP previews.
    await writeFile(path.join(dir, id + ".json"), JSON.stringify(mail), {mode: 0o600});
    return;
  }
  if (!process.env.SMTP_HOST || !process.env.MAIL_FROM)
    throw new Error("Почтовый сервис не настроен. Обратитесь к администратору");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    requireTLS: !mailpit && process.env.SMTP_PORT !== "465",
    ignoreTLS: mailpit,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    tls: {minVersion: "TLSv1.2"},
    auth: process.env.SMTP_USER ? {user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD} : undefined,
  });
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const info = await transport.sendMail(mail);
        if (!info.accepted?.length || info.rejected?.length)
          throw new Error("Почтовый сервер не принял письмо");
        break;
      } catch (error) {
        const failure = error as {code?: string; command?: string};
        // Retry only a connection that never reached SMTP submission. A timeout after
        // DATA could already have delivered the mail and must never be blindly replayed.
        if (attempt !== 0 || failure.command !== "CONN" ||
            !["ETIMEDOUT", "ECONNECTION", "ESOCKET"].includes(failure.code || "")) throw error;
      }
    }
  } finally { transport.close(); }
}
