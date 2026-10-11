import { parseRequestJson, readRequestText } from "@/lib/request-security";
import {
  registerAccount,
  loginAccount,
  currentAccount,
  logout,
  throttle,
  setSession,
  verificationEmail,
} from "@/lib/auth";
import { createDemo } from "@/lib/demo-platform";
import { loadPlatform, accountById } from "@/lib/platform";
import { checkOrigin, clientState, errorResponse } from "@/lib/store";
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const text = await readRequestText(r, 15000);
    if (text.length > 5000) throw new Error("Запрос слишком большой");
    const b = parseRequestJson(text),
      role = b.role === "employer" ? "employer" : "candidate";
    if (b.type === "logout") {
      await logout();
      return Response.json({ ok: true });
    }
    if (!["register", "login", "demo-login"].includes(b.type))
      throw new Error("Неизвестное действие");
    const ip =
      process.env.TRUST_PROXY === "true"
        ? r.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
          "unknown"
        : "local";
    await throttle("auth-address:" + ip, 50, 600);
    let account;
    if (b.type === "demo-login") {
      if (process.env.ENABLE_DEMO !== "true")
        throw new Error("Демонстрация отключена");
      const old = await currentAccount();
      const local =
        process.env.NODE_ENV !== "production" && process.env.LOCAL_DEMO_ACCOUNT
          ? await accountById(process.env.LOCAL_DEMO_ACCOUNT)
          : null;
      account = old?.demo ? old : local?.demo ? local : await createDemo();
      if (local?.id === account.id && old?.id !== account.id)
        await setSession(account);
    } else
      account =
        b.type === "register"
          ? await registerAccount(b)
          : await loginAccount(b);
    let emailStatus = {};
    if (!account.demo && !account.verified_at) {
      try {
        emailStatus = await verificationEmail(account, true);
      } catch {
        emailStatus = {
          emailSent: false,
          emailDeliveryError:
            "Не удалось отправить письмо. Попробуйте повторную отправку.",
        };
      }
    }
    return Response.json(
      { ...clientState(await loadPlatform(account), role), ...emailStatus },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
