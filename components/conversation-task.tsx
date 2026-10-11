"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useTaskAnswer } from "@/hooks/use-task-answer";
import { X } from "lucide-react";
import type { EmployerTask } from "@/lib/conversation-types";
import type { Role } from "@/lib/model";
import { chatRequest } from "@/lib/chat-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
export function ConversationTask({
  task,
  role,
  room,
  messageId,
  canWrite,
  uid,
}: {
  task: EmployerTask;
  role: Role;
  room: string;
  messageId: string;
  canWrite: boolean;
  uid: string;
}) {
  const [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const deadline = Date.parse(
    task.deadlineAt ||
      (task.startedAt
        ? new Date(
            Date.parse(task.startedAt) + task.minutes * 60000,
          ).toISOString()
        : ""),
  );
  const elapsed =
    task.status === "expired" ||
    !!task.expiredAt ||
    (task.status === "accepted" &&
      Number.isFinite(deadline) &&
      now >= deadline);
  const remaining = Math.min(
    task.minutes * 60,
    Math.max(0, Math.ceil((deadline - now) / 1000)),
  );
  const active =
    role === "candidate" && canWrite && task.status === "accepted" && !elapsed;
  const answer = useTaskAnswer(uid, room, messageId, task, active);
  const value = role === "candidate" ? answer.text : feedback;
  const notified = useRef(false);
  useEffect(() => {
    if (task.status !== "accepted") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [task.status]);
  useEffect(() => {
    if (elapsed && !notified.current) {
      notified.current = true;
      window.dispatchEvent(new Event("offerly:task-changed"));
    }
  }, [elapsed]);
  async function change(status?: string) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await chatRequest(
        role,
        `/${room}`,
        role === "candidate"
          ? { type: "task-response", messageId, status, answer: value }
          : { type: "task-review", messageId, feedback: value },
      );
      if (role === "candidate") answer.clear();
      else setFeedback("");
      if (status === "accepted") setConfirm(false);
      window.dispatchEvent(new Event("offerly:task-changed"));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const labels = {
    offered: "Предложена",
    accepted: "Принята",
    declined: "Отклонена",
    submitted: "Решение отправлено",
    expired: "Время истекло",
    reviewed: "Есть обратная связь",
  };
  const hidden =
    role === "candidate" &&
    !task.startedAt &&
    ["offered", "declined"].includes(task.status);
  return (
    <section className="conversation-task">
      <span className="mono">Добровольная задача · {task.minutes} мин.</span>
      <h3>{hidden ? "Работодатель отправил вам задачу" : task.title}</h3>
      {!hidden && (!elapsed || role === "employer") && (
        <>
          <p>{task.instructions}</p>
          <strong>Критерии результата</strong>
          <p>{task.criteria}</p>
        </>
      )}
      {active && (
        <p
          className="conversation-task-timer"
          role="timer"
          aria-label="Оставшееся время"
        >
          Осталось{" "}
          <strong className="mono">
            {Math.floor(remaining / 60)
              .toString()
              .padStart(2, "0")}
            :{(remaining % 60).toString().padStart(2, "0")}
          </strong>
        </p>
      )}
      {elapsed && (
        <p className="conversation-task-expired">
          Время выполнения истекло. Доступ к выполнению закрыт. Ответ,
          сохранённый на сервере до дедлайна, передан работодателю как частичный
          результат.
        </p>
      )}
      {task.status !== "offered" && (
        <span className="conversation-task-status">{labels[task.status]}</span>
      )}
      {!hidden && (
        <small>
          Не влияет на подтверждённый грейд.{active ? " Можно отказаться." : ""}
        </small>
      )}
      {task.answer && (
        <>
          <strong>Решение кандидата</strong>
          <p className="conversation-task-answer">{task.answer}</p>
        </>
      )}
      {task.feedback && (
        <>
          <strong>Обратная связь</strong>
          <p>{task.feedback}</p>
        </>
      )}
      {canWrite && role === "candidate" && task.status === "offered" && (
        <div className="conversation-task-actions">
          <button
            type="button"
            disabled={busy}
            className="btn primary"
            onClick={() => {
              setError("");
              setConfirm(true);
            }}
          >
            Принять задачу
          </button>
          <button
            type="button"
            disabled={busy}
            className="btn secondary"
            onClick={() => void change("declined")}
          >
            Отказаться
          </button>
        </div>
      )}
      {canWrite &&
        (active ||
          (role === "employer" &&
            ["submitted", "expired"].includes(task.status))) && (
          <div className="conversation-task-response">
            <label>
              {role === "candidate" ? "Решение задачи" : "Обратная связь"}
              <textarea
                rows={6}
                value={value}
                onChange={(e) =>
                  role === "candidate"
                    ? answer.edit(e.target.value)
                    : setFeedback(e.target.value)
                }
                onBlur={() => {
                  if (role === "candidate") answer.save();
                }}
                maxLength={role === "candidate" ? 12000 : 6000}
              />
            </label>
            {role === "candidate" && (
              <small role="status">
                {answer.status === "saved"
                  ? "Ответ сохранён"
                  : answer.status === "local"
                    ? "Нет связи с сервером. Текст сохранён на устройстве; повторим сохранение при подключении."
                    : "Сохраняем ответ…"}
              </small>
            )}
            <div className="conversation-task-actions">
              <button
                type="button"
                disabled={busy || !value.trim()}
                className="btn primary"
                onClick={() => void change("submitted")}
              >
                {role === "candidate"
                  ? "Отправить решение"
                  : "Отправить обратную связь"}
              </button>
              {role === "candidate" && (
                <button
                  type="button"
                  disabled={busy}
                  className="btn secondary"
                  onClick={() => void change("declined")}
                >
                  Отказаться
                </button>
              )}
            </div>
          </div>
        )}
      {error && !confirm && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open);
        }}
      >
        <DialogContent
          className="app-dialog conversation-task-start-dialog"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>Готовы приступить?</DialogTitle>
            <DialogDescription>
              После подтверждения откроются условия задачи и поле для ответа.
              Сразу начнётся отсчёт времени: {task.minutes} мин. Задание
              добровольное и не влияет на подтверждённый грейд.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Пока не готов
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void change("accepted")}
            >
              {busy ? "Открываем…" : "Готов, начать"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
export function OfferConversationTask({
  role,
  room,
}: {
  role: Role;
  room: string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const titleId = useId(),
    trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef<{ json: string; id: string } | null>(null);
  const [task, setTask] = useState({
    title: "",
    instructions: "",
    minutes: 30,
    criteria: "",
  });
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  async function send() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const json = JSON.stringify(task);
      if (pending.current?.json !== json)
        pending.current = { json, id: crypto.randomUUID() };
      await chatRequest(role, `/${room}`, {
        type: "message",
        clientId: pending.current.id,
        task,
      });
      pending.current = null;
      close();
      setTask({ title: "", instructions: "", minutes: 30, criteria: "" });
      window.dispatchEvent(new Event("offerly:task-changed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (role !== "employer") return null;
  return (
    <div className="conversation-task-offer">
      <button
        ref={trigger}
        type="button"
        className="activity-button"
        aria-expanded={open}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        Предложить добровольную задачу
      </button>
      {open && (
        <section
          className="conversation-task-compose-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) {
              e.stopPropagation();
              close();
            }
          }}
        >
          <header>
            <div>
              <h3 id={titleId}>Добровольная задача</h3>
              <p>
                Для знакомства с работой команды. Кандидат может отказаться;
                подтверждённый грейд не изменится.
              </p>
            </div>
            <button
              type="button"
              className="conversation-task-close"
              aria-label="Закрыть форму задачи"
              disabled={busy}
              onClick={close}
            >
              <X size={20} />
            </button>
          </header>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="conversation-task-compose-fields">
              <label>
                Название
                <input
                  autoFocus
                  required
                  maxLength={200}
                  value={task.title}
                  placeholder="Например, спроектировать метод API"
                  onChange={(e) => setTask({ ...task, title: e.target.value })}
                />
              </label>
              <label>
                Описание
                <textarea
                  required
                  rows={4}
                  maxLength={10000}
                  value={task.instructions}
                  placeholder="Опишите задачу и исходные данные"
                  onChange={(e) =>
                    setTask({ ...task, instructions: e.target.value })
                  }
                />
              </label>
              <label>
                Критерии результата
                <textarea
                  required
                  rows={3}
                  maxLength={2000}
                  value={task.criteria}
                  placeholder="Что ожидаете увидеть в решении"
                  onChange={(e) =>
                    setTask({ ...task, criteria: e.target.value })
                  }
                />
              </label>
              <label className="conversation-task-time">
                Ожидаемое время, минут
                <input
                  required
                  type="number"
                  min={1}
                  max={120}
                  value={task.minutes}
                  onChange={(e) =>
                    setTask({ ...task, minutes: Number(e.target.value) })
                  }
                />
              </label>
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={close}
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={
                  busy ||
                  !task.title.trim() ||
                  !task.instructions.trim() ||
                  !task.criteria.trim()
                }
                className="btn primary"
              >
                {busy ? "Отправляем…" : "Отправить задачу"}
              </button>
            </footer>
          </form>
        </section>
      )}
    </div>
  );
}
