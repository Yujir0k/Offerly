"use client";
import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { PasswordInput } from "./password-input";
import { VerificationCode } from "./verification-code";
export function PasswordRecovery({ email: initial }: { email: string }) {
  const [open, setOpen] = useState(false),
    [step, setStep] = useState("email"),
    [email, setEmail] = useState(initial),
    [code, setCode] = useState(""),
    [id, setId] = useState(""),
    [grant, setGrant] = useState(""),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [resendAt, setResendAt] = useState(0),
    [now, setNow] = useState(() => Date.now());
  const verifying = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);
  async function call(type: string, data: Record<string, unknown>) {
    const r = await fetch("/api/auth/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...data }),
    });
    const b = await r.json();
    if (!r.ok) throw Error(b.error);
    return b;
  }
  async function request() {
    setBusy(true);
    setError("");
    try {
      const r = await call("request", { email });
      setId(r.id);
      setResendAt(Date.parse(r.resendAt));
      setCode("");
      setStep("code");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(v: string) {
    if (verifying.current || v.length !== 6) return;
    verifying.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await call("verify", { id, code: v });
      setGrant(r.grant);
      setStep("password");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      verifying.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="text-button auth-recovery-link"
        onClick={() => {
          setOpen(true);
          setStep("email");
          setEmail(initial);
          setPassword("");
          setRepeat("");
          setCode("");
          setError("");
        }}
      >
        Забыли пароль?
      </button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setPassword("");
            setRepeat("");
            setGrant("");
          }
        }}
      >
        <DialogContent
          className="app-dialog email-change-dialog recovery-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            heading.current?.ownerDocument.getSelection()?.removeAllRanges();
            heading.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle ref={heading} tabIndex={-1}>
              {step === "done" ? "Пароль изменён" : "Восстановление доступа"}
            </DialogTitle>
            <DialogDescription>
              {step === "email"
                ? "Отправим код на почту аккаунта. Для аккаунта только с ФСП ID используйте восстановление у провайдера."
                : step === "code"
                  ? "Если аккаунт существует, письмо уже отправлено. Код действует 10 минут."
                  : step === "password"
                    ? "Почта проверена. Укажите новый пароль от 12 до 128 символов."
                    : "Все сеансы завершены. Теперь войдите с новым паролем."}
            </DialogDescription>
          </DialogHeader>
          <div className="form-stack">
            {step === "email" && (
              <>
                <label className="hiring-field">
                  <span>Электронная почта</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <button
                  className="btn primary"
                  disabled={busy || !email}
                  onClick={request}
                >
                  Отправить код
                </button>
              </>
            )}
            {step === "code" && (
              <>
                <VerificationCode
                  id="recovery-code"
                  label="Код восстановления"
                  value={code}
                  status={error ? "error" : "idle"}
                  disabled={busy}
                  onChange={(v) => {
                    setCode(v);
                    setError("");
                    if (v.length === 6) verify(v);
                  }}
                />
                <button
                  className="text-button"
                  disabled={busy || now < resendAt}
                  onClick={request}
                >
                  Отправить повторно
                  {now < resendAt
                    ? ` через ${Math.ceil((resendAt - now) / 1000)} с`
                    : ""}
                </button>
                <button
                  className="text-button"
                  onClick={() => setStep("email")}
                >
                  Изменить почту
                </button>
              </>
            )}
            {step === "password" && (
              <>
                <label className="hiring-field">
                  <span>Новый пароль</span>
                  <PasswordInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    maxLength={128}
                  />
                </label>
                <label className="hiring-field">
                  <span>Повторите пароль</span>
                  <PasswordInput
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                    autoComplete="new-password"
                    maxLength={128}
                  />
                </label>
                <button
                  className="btn primary"
                  disabled={busy || password.length < 12 || password !== repeat}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await call("complete", { id, grant, password });
                      setStep("done");
                      setPassword("");
                      setRepeat("");
                      setGrant("");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Сохранить пароль
                </button>
              </>
            )}
            {step === "done" && (
              <button className="btn primary" onClick={() => setOpen(false)}>
                Перейти ко входу
              </button>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
