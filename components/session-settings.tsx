"use client";
import { useEffect, useState } from "react";
import { Monitor, Smartphone, LogOut, X } from "lucide-react";
import type { DeviceSession } from "@/lib/session-device";
import type { State, Role } from "@/lib/model";
import { displayDate } from "@/lib/account-settings";
import { clearDraftCaches } from "@/hooks/use-draft";
import { FeedbackDialog } from "./feedback-dialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "./ui/dialog";
export function SessionSettings({ s, role }: { s: State; role: Role }) {
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [confirm, setConfirm] = useState<{
    action: string;
    id?: string;
    name?: string;
  } | null>(null);
  function leave() {
    clearDraftCaches();
    window.location.assign(`/login?role=${role}`);
  }
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      fetch("/api/sessions", { signal: controller.signal, cache: "no-store" })
        .then(async (r) => {
          if (r.status === 401) {
            leave();
            return;
          }
          const b = await r.json();
          if (!r.ok) throw new Error(b.error);
          setSessions(b.sessions);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => setLoading(false));
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [s.auth?.userId]);
  async function revoke() {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirm),
      });
      const b = await r.json();
      if (r.status === 401 || b.loggedOut) {
        leave();
        return;
      }
      if (!r.ok) throw new Error(b.error);
      setSessions(b.sessions);
      setConfirm(null);
    } catch (e) {
      setConfirm(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-panel">
      <div className="account-panel-title">
        <Monitor size={22} />
        <h2>Устройства и сеансы</h2>
      </div>
      <p className="session-intro">
        Здесь показаны активные входы в ваш аккаунт Офферли. Завершите сеанс,
        если больше не пользуетесь устройством.
      </p>
      {loading ? (
        <p role="status">Загружаем устройства…</p>
      ) : (
        sessions.map((device) => (
          <div className="account-row session-row" key={device.id}>
            <div className="session-device">
              <span className="session-device-icon">
                {device.type === "desktop" ? (
                  <Monitor size={22} />
                ) : (
                  <Smartphone size={22} />
                )}
              </span>
              <div>
                <h3>
                  {device.name}{" "}
                  {device.current && (
                    <span className="session-current">Это устройство</span>
                  )}
                </h3>
                <p>
                  Последняя активность:{" "}
                  {displayDate(device.lastSeenAt, s, {
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                <small>
                  Вход:{" "}
                  {displayDate(device.createdAt, s, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </small>
              </div>
            </div>
            <button
              className="activity-button"
              disabled={busy}
              onClick={() =>
                setConfirm({
                  action: device.current ? "logout" : "revoke",
                  id: device.id,
                  name: device.name,
                })
              }
            >
              {device.current ? "Выйти" : "Завершить сеанс"}
              <LogOut size={16} />
            </button>
          </div>
        ))
      )}
      <div className="account-save">
        <span className="session-hint">
          Название определяется по браузеру и может быть приблизительным.
        </span>
        <button
          className="activity-button"
          disabled={busy || sessions.filter((d) => !d.current).length === 0}
          onClick={() => setConfirm({ action: "others" })}
        >
          Завершить остальные сеансы
        </button>
      </div>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <DialogContent
          className="auth-account-dialog"
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
          <DialogTitle>
            {confirm?.action === "others"
              ? "Выйти на других устройствах?"
              : confirm?.action === "logout"
                ? "Выйти из аккаунта?"
                : "Завершить сеанс?"}
          </DialogTitle>
          <DialogDescription>
            {confirm?.action === "others"
              ? "Текущий сеанс останется активным. На остальных устройствах потребуется войти заново."
              : confirm?.action === "logout"
                ? "На этом устройстве потребуется войти заново. Ваши данные сохранятся."
                : `Вход на устройстве «${confirm?.name}» будет завершён. Чтобы продолжить, потребуется войти заново.`}
          </DialogDescription>
          <button className="btn primary full" disabled={busy} onClick={revoke}>
            {busy
              ? "Завершаем…"
              : confirm?.action === "logout"
                ? "Выйти"
                : "Завершить сеанс"}
          </button>
          <button
            className="auth-account-secondary"
            disabled={busy}
            onClick={() => setConfirm(null)}
          >
            Отмена
          </button>
        </DialogContent>
      </Dialog>
      <FeedbackDialog
        open={!!error}
        onOpenChange={(open) => {
          if (!open) setError("");
        }}
        message={error}
      />
    </section>
  );
}
