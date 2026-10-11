"use client";
import { useEffect, useId, useState } from "react";
import type { Role } from "@/lib/model";
import { fspMessages, type FspCode } from "@/lib/fsp-errors";
import { DemoFspConnect } from './fsp-demo-connect';
export function FspConnect({
  role,
  intent,
  consent = false,
  demo = false,
}: {
  role: Role;
  intent: "login" | "register" | "link";
  consent?: boolean;
  demo?: boolean;
}) {
  const [status, setStatus] = useState<{
    available: boolean;
    linked: boolean;
    participantId?: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(() => {
      if (typeof window === "undefined") return "";
      const code = new URLSearchParams(window.location.search).get("fsp");
      return code && Object.hasOwn(fspMessages, code) ? fspMessages[code as FspCode] : "";
    });
  const description = useId();
  useEffect(() => {
    let active = true;
    fetch("/api/identity/fsp", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active) setStatus({ available: false, linked: false });
      });
    return () => {
      active = false;
    };
  }, []);
  async function connect() {
    if (demo || !status?.available) {
      setMessage(demo ? fspMessages.demo : fspMessages.unavailable);
      return;
    }
    if (intent === "register" && !consent) {
      setMessage(fspMessages.consent);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/identity/fsp/${intent === "link" ? "link" : "start"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent, role, consent }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        setMessage(
          data.code && Object.hasOwn(fspMessages, data.code)
            ? fspMessages[data.code as FspCode]
            : fspMessages.failed,
        );
        setBusy(false);
        return;
      }
      window.location.assign(data.authorizationUrl);
    } catch {
      setMessage(fspMessages.failed);
      setBusy(false);
    }
  }
  const linked = intent === "link" && status?.linked;
  if (demo && intent === 'link')
    return <DemoFspConnect role={role} intent="link" />;
  return (
    <div
      className={`fsp-connect ${intent === "link" ? "fsp-connect-light" : ""}`}
    >
      <button
        type="button"
        className="fsp-login-button"
        disabled={busy || !!linked}
        onClick={connect}
        aria-describedby={description}
        title={message || undefined}
      >
        <img src="/brand/fsp.svg" alt="" width={28} height={28} />
        <span>
          {busy
            ? "Подключаемся…"
            : linked
              ? "ФСП ID привязан"
              : intent === "link"
                ? "Привязать ФСП ID"
                : "Войти с ФСП ID"}
        </span>
      </button>
      <p id={description} className="sr-only">
        {linked
          ? status?.participantId
            ? `ID участника: ${status.participantId}`
            : "Аккаунт ФСП привязан. ID участника пока не передан реестром."
          : intent === "link"
            ? "Свяжите существующий аккаунт с ФСП. История участия не обязательна."
            : "Единый аккаунт Федерации спортивного программирования"}
      </p>
      {message && (
        <p className={intent === "link" ? "fsp-login-notice" : "sr-only"} role="status">
          {message}
        </p>
      )}
    </div>
  );
}
