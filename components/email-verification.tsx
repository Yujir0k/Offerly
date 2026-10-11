"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Mail, ExternalLink } from "lucide-react";
import { VerificationCode } from "./verification-code";
import { Brand } from "./brand";
import { AuthArtwork } from "./auth-artwork";
import { PublicFooter } from "./public-footer";
import type { State, Role } from "@/lib/model";
import type { Action } from "./registration";
import type { Navigate } from "./landing";

export function EmailVerification({
  s,
  nav,
  act,
  role,
  route = "",
}: {
  s: State | null;
  nav: Navigate;
  act: Action;
  role: Role;
  route?: string;
}) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(!!s?.emailSent);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(s?.emailDeliveryError || "");
  const [codeError, setCodeError] = useState(false);
  const [demoVerified, setDemoVerified] = useState(false);
  const [delivery, setDelivery] = useState(s?.emailDelivery);
  const [resendAt, setResendAt] = useState(
    s?.emailResendAt ? Date.parse(s.emailResendAt) : 0,
  );
  const [remaining, setRemaining] = useState(0);
  const pending = useRef(false),
    entered = useRef(false);
  const demo = !!s?.auth?.demo;
  const verified = s?.emailVerification.status === "verified" || demoVerified;
  const ready =
    new URLSearchParams(route.split("?")[1] || "").get("ready") === "1";

  function received(result: State) {
    setSent(!!result.emailSent);
    setDelivery(result.emailDelivery);
    setResendAt(
      result.emailResendAt
        ? Date.parse(result.emailResendAt)
        : Date.now() + 60000,
    );
    setFailure(result.emailDeliveryError || "");
  }
  async function send(automatic = false) {
    if (pending.current || (!automatic && remaining)) return;
    pending.current = true;
    setBusy(true);
    setFailure("");
    setCodeError(false);
    try {
      if (demo) {
        setDelivery({ previewCode: "123456" });
        setSent(true);
        setResendAt(Date.now() + 60000);
      } else {
        const result = await act("email-request", { automatic });
        if (result) received(result);
        else
          setFailure(
            "Не удалось отправить код. Попробуйте повторно чуть позже.",
          );
      }
      if (!automatic) setCode("");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!s || verified || entered.current) return;
    let cancelled = false;
    // The externally loaded account owns delivery initialization; cancel obsolete mounts.
    void Promise.resolve().then(() => {
      if (cancelled || entered.current) return;
      entered.current = true;
      if (s.emailSent) received(s);
      else if (s.emailDeliveryError) setFailure(s.emailDeliveryError);
      else void send(true);
    });
    return () => { cancelled = true; };
  }, [s?.auth?.userId, verified]);
  useEffect(() => {
    if (!resendAt) return;
    const tick = () =>
      setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  useEffect(() => {
    if (!verified) return;
    const timer = setTimeout(
      () =>
        nav(
          ready ? `/welcome?role=${role}&automatic=1` : `/onboarding/${role}`,
        ),
      650,
    );
    return () => clearTimeout(timer);
  }, [verified, ready, role]);
  async function confirm(value: string) {
    if (pending.current || verified || !s || value.length !== 6) return;
    pending.current = true;
    setBusy(true);
    setFailure("");
    try {
      if (demo) {
        const ok = sent && value === "123456";
        setDemoVerified(ok);
        setCodeError(!ok);
        if (!ok)
          setFailure("Неверный код. Проверьте шесть цифр и попробуйте снова.");
      } else {
        const result = await act("email-confirm", { code: value });
        setCodeError(!result);
        if (!result)
          setFailure(
            "Код неверен или истёк. Проверьте цифры либо запросите новый код.",
          );
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="registration-page auth-refresh auth-email">
      <header className="registration-header">
        <Link
          href="/"
          aria-label="Офферли — главная"
          onClick={(e) => {
            e.preventDefault();
            nav("/");
          }}
        >
          <Brand />
        </Link>
        <button
          className="back-home"
          onClick={() => nav(`/login?role=${role}`)}
        >
          <ArrowLeft size={17} /> Ко входу
        </button>
      </header>
      <div className="auth-layout">
        <main className="registration-content email-content auth-card">
          <div
            className={`verification-symbol ${verified ? "success" : "waiting"}`}
          >
            {verified ? <CheckCircle2 size={42} /> : <Mail size={42} />}
          </div>
          <span className="registration-kicker mono">ПОДТВЕРЖДЕНИЕ ПОЧТЫ</span>
          <h1>{verified ? "Адрес подтверждён." : "Проверьте почту."}</h1>
          <p className="registration-intro">
            {verified ? (
              demo ? (
                "Демонстрация подтверждения. Открываем анкету…"
              ) : ready ? (
                role === "employer" ? (
                  "Открываем компанию…"
                ) : (
                  "Открываем профиль…"
                )
              ) : (
                "Открываем анкету…"
              )
            ) : (
              <>
                {sent ? "Шестизначный код отправлен на" : "Подтвердите адрес"}{" "}
                <strong>{s?.emailVerification.email}</strong>. Код действует 10
                минут.
              </>
            )}
          </p>
          <form
            className="auth-form code-form"
            onSubmit={(e) => {
              e.preventDefault();
              void confirm(code);
            }}
          >
            <label htmlFor="email-code">Код из письма</label>
            <VerificationCode
              id="email-code"
              label="Шестизначный код из письма"
              value={code}
              onChange={(value) => {
                setCode(value);
                setCodeError(false);
                setFailure("");
                if (value.length === 6) void confirm(value);
              }}
              status={verified ? "success" : codeError ? "error" : "idle"}
              disabled={busy || verified}
              describedBy="email-code-status"
            />
            <p
              id="email-code-status"
              className={`code-status ${verified ? "success" : failure ? "error" : ""}`}
              aria-live="polite"
            >
              {verified
                ? "Код принят. Почта подтверждена."
                : busy
                  ? "Проверяем…"
                  : failure ||
                    "Введите шесть цифр. Код проверится автоматически."}
            </p>
            {!verified && (
              <button
                type="button"
                className="text-link code-resend-button"
                disabled={busy || !s || remaining > 0}
                onClick={() => void send(false)}
              >
                {remaining > 0
                  ? `Отправить код повторно через ${remaining} с`
                  : "Отправить код повторно"}
              </button>
            )}
          </form>
          {delivery?.previewCode && !verified && (
            <div className="local-mail-preview">
              <span className="mono">ТЕСТОВОЕ ПИСЬМО</span>
              <p>Офферли · код подтверждения</p>
              <strong>{delivery.previewCode}</strong>
              <small>Локальная имитация, без настоящей отправки.</small>
            </div>
          )}
          {delivery?.inboxUrl && !verified && (
            <a
              className="local-inbox-link"
              href={delivery.inboxUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Открыть локальную почту <ExternalLink size={16} />
            </a>
          )}
          {!verified && (
            <button
              className="text-link code-profile-link"
              disabled={!s || busy}
              onClick={() => nav(`/onboarding/${role}`)}
            >
              {role === "employer"
                ? "Заполнить компанию, пока ожидаю письмо"
                : "Заполнить профиль, пока ожидаю письмо"}
            </button>
          )}
        </main>
        <AuthArtwork
          kind="email"
          role={role}
          state={verified ? "success" : codeError ? "error" : "waiting"}
        />
      </div>
      <PublicFooter nav={nav} returnTo={`/verify-email?role=${role}`} />
    </div>
  );
}
