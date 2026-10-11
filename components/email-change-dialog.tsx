"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "./ui/dialog";
import { PasswordInput } from "./password-input";
import { VerificationCode } from "./verification-code";
import type { State } from "@/lib/model";
import type { Action } from "./registration";
type Step =
  "address" | "access" | "password" | "old-code" | "new-code" | "success";
export function EmailChangeDialog({
  s,
  open,
  onOpenChange,
  act,
  onChanged,
}: {
  s: State;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  act: Action;
  onChanged: (s: State) => void;
}) {
  const [step, setStep] = useState<Step>("address");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [flow, setFlow] = useState<State["emailChange"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codeStatus, setCodeStatus] = useState<"idle" | "error" | "success">(
    "idle",
  );
  const [resendAt, setResendAt] = useState(0),
    [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (open) {
      setStep("address");
      setEmail("");
      setCode("");
      setPassword("");
      setFlow(undefined);
      setError("");
      setCodeStatus("idle");
      setResendAt(0);
      setRemaining(0);
    } else setPassword("");
  }, [open]);
  useEffect(() => {
    if (!open || !resendAt) return;
    const tick = () =>
      setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [open, resendAt]);
  const oldEmail = s.emailVerification.email;
  const codeStep = step === "old-code" || step === "new-code";
  const progress =
    step === "address"
      ? 1
      : ["access", "password", "old-code"].includes(step)
        ? 2
        : 3;
  function acceptFlow(result: State) {
    if (!result.emailChange) return;
    setFlow(result.emailChange);
    setStep(result.emailChange.stage);
    setCode("");
    setCodeStatus("idle");
    setError("");
    setResendAt(Date.now() + 60000);
  }
  async function begin(method: "old-email" | "password") {
    setBusy(true);
    setError("");
    try {
      const result = await act("email-change-begin", {
        email,
        method,
        password: method === "password" ? password : undefined,
      });
      if (result) acceptFlow(result);
      else
        setError(
          method === "password"
            ? "Не удалось подтвердить доступ. Проверьте пароль и новый адрес почты."
            : "Не удалось отправить код. Проверьте новый адрес и попробуйте чуть позже.",
        );
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  async function confirm() {
    if (!flow || code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      const result = await act(
        step === "old-code" ? "email-change-authorize" : "email-change-confirm",
        { flowId: flow.id, code },
      );
      if (!result) {
        setCodeStatus("error");
        setError(
          "Код неверен или истёк. Проверьте цифры или запросите новый код.",
        );
      } else if (step === "old-code") acceptFlow(result);
      else {
        setStep("success");
        setCodeStatus("success");
        onChanged(result);
      }
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    if (!flow || remaining || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await act("email-change-resend", { flowId: flow.id });
      if (result) acceptFlow(result);
      else
        setError(
          "Не удалось отправить код. Попробуйте чуть позже или начните смену почты заново.",
        );
    } finally {
      setBusy(false);
    }
  }
  const title =
    step === "address"
      ? "Новая почта."
      : step === "new-code"
        ? "Подтвердите новый адрес."
        : step === "success"
          ? "Почта изменена."
          : "Подтвердите доступ.";
  const description = s.auth?.demo
    ? "В демоверсии адрес не меняется. Для проверки используйте обычный аккаунт."
    : step === "address"
      ? "Текущий адрес останется действующим, пока вы не подтвердите новый."
      : step === "access"
        ? "Сначала убедимся, что аккаунт принадлежит вам."
        : step === "password"
          ? "Нет доступа к старой почте? Используйте пароль этого аккаунта."
          : step === "old-code"
            ? `Введите код из письма на ${oldEmail}.`
            : step === "new-code"
              ? `Доступ подтверждён. Теперь введите код из письма на ${email}.`
              : `Теперь для входа и уведомлений используется ${email}. Повторное подтверждение при входе не требуется.`;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent
        className="auth-account-dialog auth-refresh email-change-dialog"
        overlayClassName="auth-account-overlay"
        showCloseButton={false}
      >
        <DialogClose
          className="auth-account-close"
          aria-label="Закрыть"
          disabled={busy}
        >
          <X size={20} />
        </DialogClose>
        <div className="email-change-steps" aria-label={`Шаг ${progress} из 3`}>
          <span className={progress >= 1 ? "active" : ""}>Новый адрес</span>
          <i />
          <span className={progress >= 2 ? "active" : ""}>Доступ</span>
          <i />
          <span className={progress >= 3 ? "active" : ""}>Подтверждение</span>
        </div>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <form
          className="auth-form code-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (step === "address") {
              if (email.toLowerCase().trim() === oldEmail) {
                setError("Укажите другой адрес почты.");
                return;
              }
              setError("");
              setStep(
                s.emailVerification.status === "verified"
                  ? "access"
                  : "password",
              );
            } else if (step === "password") void begin("password");
            else if (codeStep) void confirm();
          }}
        >
          {step === "address" && (
            <>
              <label htmlFor="account-new-email">Новая электронная почта</label>
              <input
                id="account-new-email"
                type="email"
                autoComplete="email"
                maxLength={200}
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError("");
                }}
              />
              <button
                className="btn primary full"
                disabled={busy || !!s.auth?.demo || !email.trim()}
              >
                Продолжить <ArrowRight size={18} />
              </button>
            </>
          )}
          {step === "access" && (
            <>
              <button
                type="button"
                className="btn primary full"
                disabled={busy}
                onClick={() => void begin("old-email")}
              >
                Получить код на текущую почту
              </button>
              <p className="email-change-current">{oldEmail}</p>
              <button
                type="button"
                className="auth-account-secondary"
                onClick={() => {
                  setStep("password");
                  setError("");
                }}
              >
                Нет доступа к этой почте
              </button>
            </>
          )}
          {step === "password" && (
            <>
              <label htmlFor="account-current-password">Пароль аккаунта</label>
              <PasswordInput
                id="account-current-password"
                aria-label="Пароль аккаунта"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
              />
              <button className="btn primary full" disabled={busy || !password}>
                {busy ? "Проверяем…" : "Подтвердить доступ"}
              </button>
            </>
          )}
          {(codeStep || step === "success") && (
            <>
              <label htmlFor="account-email-code">
                {step === "old-code"
                  ? "Код с текущей почты"
                  : "Код с новой почты"}
              </label>
              <VerificationCode
                id="account-email-code"
                label={
                  step === "old-code"
                    ? "Код с текущей почты"
                    : "Код с новой почты"
                }
                value={code}
                onChange={(value) => {
                  setCode(value);
                  setCodeStatus("idle");
                  setError("");
                }}
                status={codeStatus}
                disabled={busy || step === "success"}
                describedBy="email-change-error"
              />
              {step === "new-code" && (
                <p className="email-change-access-confirmed">
                  <CheckCircle2 size={16} /> Доступ к аккаунту подтверждён
                </p>
              )}
              {step !== "success" && (
                <>
                  <button
                    className="btn primary full"
                    disabled={busy || code.length !== 6}
                  >
                    {busy
                      ? "Проверяем…"
                      : step === "old-code"
                        ? "Подтвердить доступ"
                        : "Сохранить новую почту"}
                  </button>
                  <button
                    type="button"
                    className="auth-account-secondary"
                    disabled={busy || remaining > 0}
                    onClick={resend}
                  >
                    {remaining > 0
                      ? `Новый код через ${remaining} с`
                      : "Отправить код повторно"}
                  </button>
                </>
              )}
            </>
          )}
          {error && (
            <p
              id="email-change-error"
              className="code-status error"
              role="alert"
            >
              {error}
            </p>
          )}
          {flow?.delivery.inboxUrl && codeStep && (
            <a
              className="local-inbox-link"
              href={flow.delivery.inboxUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Открыть локальную почту <ExternalLink size={16} />
            </a>
          )}
          {flow?.delivery.previewCode && codeStep && (
            <p className="email-change-current">
              Тестовый код: {flow.delivery.previewCode}
            </p>
          )}
          {step === "success" && (
            <button
              type="button"
              className="btn primary full"
              onClick={() => onOpenChange(false)}
            >
              Готово <CheckCircle2 size={18} />
            </button>
          )}
          {step !== "address" && step !== "success" && (
            <button
              type="button"
              className="email-change-back"
              disabled={busy}
              onClick={() => {
                setStep("address");
                setError("");
                setPassword("");
              }}
            >
              <ArrowLeft size={16} /> Изменить новый адрес
            </button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
