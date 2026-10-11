"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  FileSearch,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { ChoiceSelect } from "./choice-select";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from "./ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { FeedbackDialog } from "./feedback-dialog";
import { platform } from "@/lib/professional-client";
import type { RetakeEligibility } from "@/lib/assessment-retakes";
import {
  dimensionNames,
  stageNames,
  confirmationTitle,
  contentTagNames,
} from "@/lib/adaptive-presentation";
import type { NavigableSessionView as SessionView } from "@/lib/professional-navigation";
import type { TargetGrade } from "../vendor/fsp-assessment/src/adaptive/model";
import type {
  Topology,
  PackPresentation,
} from "../vendor/fsp-assessment/src/generative/model";
import type { Plan, LabControl } from "../vendor/fsp-assessment/src/domain";
type PublicPack = {
  id: string;
  name: string;
  presentation: PackPresentation | null;
};

function ExecutionControls({
  controls,
  value,
  disabled,
  change,
}: {
  controls: LabControl[];
  value: Plan;
  disabled: boolean;
  change: (id: string, selected: Plan[string]) => void;
}) {
  return (
    <div className="adaptive-plan-controls">
      {controls.map((control) =>
        control.type === "multiselect" ? (
          <fieldset key={control.id}>
            <legend>{control.label}</legend>
            {control.options.map((option) => (
              <label key={option.value}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={
                    Array.isArray(value[control.id]) &&
                    (value[control.id] as string[]).includes(option.value)
                  }
                  onChange={(event) => {
                    const current = Array.isArray(value[control.id])
                      ? (value[control.id] as string[])
                      : [];
                    change(
                      control.id,
                      event.target.checked
                        ? [...current, option.value]
                        : current.filter((entry) => entry !== option.value),
                    );
                  }}
                />{" "}
                {option.label}
              </label>
            ))}
            <button
              type="button"
              className="btn secondary"
              disabled={disabled}
              onClick={() => change(control.id, [])}
            >
              Выбрать пустой набор
            </button>
            {control.help && <p className="muted">{control.help}</p>}
          </fieldset>
        ) : (
          <div key={control.id}>
            <label htmlFor={`execution-${control.id}`}>{control.label}</label>
            <ChoiceSelect
              wrap
              id={`execution-${control.id}`}
              label={control.label}
              value={String(value[control.id] ?? "")}
              disabled={disabled}
              placeholder="Выберите значение"
              options={
                control.type === "number"
                  ? control.values.map((entry) => ({
                      value: String(entry),
                      label: String(entry),
                    }))
                  : control.options.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))
              }
              onChange={(selected) =>
                change(
                  control.id,
                  control.type === "number" ? Number(selected) : selected,
                )
              }
            />
            {control.help && <p className="muted">{control.help}</p>}
          </div>
        ),
      )}
    </div>
  );
}
import type { Action } from "./registration";
import type { Navigate } from "./landing";
import { AssessmentArtifact, AssessmentScenario } from "./assessment-artifacts";

/** One genuine qualification entry, with a claimed grade and server-persisted history. */
export function AdaptiveEntry({
  initialGrade,
  initialSpecialization = "backend",
  nav,
}: {
  initialGrade: TargetGrade;
  initialSpecialization?: string;
  nav: Navigate;
}) {
  const [grade, setGrade] = useState<TargetGrade>(() => {
    const requested =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("grade");
    return requested === "Junior" ||
      requested === "Middle" ||
      requested === "Senior"
      ? requested
      : initialGrade;
  });
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [specialization, setSpecialization] = useState(() =>
    typeof window === "undefined"
      ? initialSpecialization
      : new URLSearchParams(window.location.search).get("specialization") ||
        initialSpecialization,
  );
  const [packs, setPacks] = useState<PublicPack[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [eligibility, setEligibility] = useState<RetakeEligibility | null>(
    null,
  );
  const [retakeBusy, setRetakeBusy] = useState(true);
  const eligibilitySignature = `${specialization}:${grade}`;
  const [previousEligibility, setPreviousEligibility] = useState(eligibilitySignature);
  if (previousEligibility !== eligibilitySignature) { setPreviousEligibility(eligibilitySignature); setRetakeBusy(true); setEligibility(null); }
  useEffect(() => {
    let cancelled = false;
    platform<RetakeEligibility>(
      `/eligibility?specialization=${encodeURIComponent(specialization || "backend")}&targetGrade=${grade}`,
    )
      .then((value) => {
        if (!cancelled) setEligibility(value);
      })
      .catch((failure) => {
        if (!cancelled) setError((failure as Error).message);
      })
      .finally(() => {
        if (!cancelled) setRetakeBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [specialization, grade]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [sessions, packs] = await Promise.all([
          platform<SessionView[]>("/adaptive-sessions"),
          platform<PublicPack[]>("/generative-packs"),
        ]);
        if (!cancelled) {
          setSessions(sessions);
          setPacks(packs);
          const running = sessions.find(
            (session) => session.state === "active",
          );
          if (running) {
            setGrade(running.targetGrade);
            setSpecialization(running.specialization);
          }
        }
      } catch (failure) {
        if (!cancelled) setError((failure as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  const active = sessions.find((s) => s.state === "active");
  const selectedPack = packs.find((pack) => pack.id === specialization);
  const profile = selectedPack?.presentation;
  async function start() {
    setBusy(true);
    setError("");
    try {
      const session = await platform<SessionView>(
        "/adaptive-sessions",
        "POST",
        {
          specialization,
          targetGrade: grade,
        },
      );
      if (mounted.current)
        nav(`/demo/candidate/assessment?session=${session.id}`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="assessment-entry adaptive-entry">
      <section className="panel assessment-brief">
        <span className="eyebrow">ПОДТВЕРЖДЕНИЕ ЗАЯВЛЕННОГО УРОВНЯ</span>
        <h2>
          {packs.find((p) => p.id === specialization)?.name || "Backend"} ·
          проверка уровня {grade}
        </h2>
        <p className="assessment-lead">
          Решите рабочие ситуации и покажите, как находите причины, выбираете
          план и адаптируете его к новым условиям.
        </p>
        <div className="assessment-facts-row">
          <span>
            <Clock3 size={18} />
            До 20 минут
          </span>
          <span>
            <FileSearch size={18} />
            Два независимых инженерных кейса
          </span>
        </div>
        <div className="assessment-protocol">
          <h3>Как проходит проверка</h3>
          <ol>
            <li>
              <strong>
                {profile?.stages[0]?.label || "Короткие инженерные сценарии"} ·
                3–4 минуты
              </strong>
              <span>
                Четыре независимых вопроса. Можно отложить и вернуться.
              </span>
            </li>
            <li>
              <strong>
                {profile?.stages[1]?.label || "Расследование инцидента"} · 5–6
                минут
              </strong>
              <span>
                Изучите источники, найдите причину и выберите исправление.
              </span>
            </li>
            <li>
              <strong>
                {profile?.stages[2]?.label || "Анализ решения"} · 5–6 минут
              </strong>
              <span>
                Проверьте план, спрогнозируйте последствия и учтите новые
                условия.
              </span>
            </li>
            <li>
              <strong>Дополнительная проверка · при необходимости</strong>
              <span>
                Независимые задания по компетенциям, для которых остаётся
                недостаточно свидетельств.
              </span>
            </li>
          </ol>
        </div>
        {grade === "Senior" && (
          <p className="assessment-integrity">
            Senior также включает обязательный независимый сценарий: оценка
            ответственности, рисков и системных последствий.
          </p>
        )}
        <p className="assessment-integrity">
          <ShieldCheck size={18} />
          Вы выбираете грейд. Результат подтверждает или не подтверждает только
          этот уровень.
        </p>
        <p className="muted">
          Таймер идёт с начала проверки. Ответы сохраняются; дополнительные
          задания появятся при необходимости.
        </p>
        <details className="assessment-rules">
          <summary>Общие правила сценариев</summary>
          <p>
            Наблюдения внутри сценария относятся к одной операции.
            Подтверждённый источник содержит установленный результат; не
            указанные свойства инфраструктуры не меняются. Выбирайте минимальное
            действие, которое закрывает установленный риск и сохраняет уже
            работающие гарантии.
          </p>
        </details>
      </section>
      <aside className="assessment-entry-aside">
        <section className="panel assessment-session-setup">
          <span className="eyebrow">ПАРАМЕТРЫ ПРОВЕРКИ</span>
          <h3>Ваш заявленный уровень</h3>
          <label className="field">
            Специализация
            <Select
              value={specialization}
              disabled={busy || Boolean(active)}
              onValueChange={setSpecialization}
            >
              <SelectTrigger
                className="offerly-choice"
                aria-label="Специализация"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="offerly-choice-menu">
                {[
                  ...new Set(
                    packs.map(
                      (pack) => pack.presentation?.groupName || "Разработка",
                    ),
                  ),
                ].map((group) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {packs
                      .filter(
                        (pack) =>
                          (pack.presentation?.groupName || "Разработка") ===
                          group,
                      )
                      .map((pack) => (
                        <SelectItem key={pack.id} value={pack.id}>
                          {pack.name}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="field">
            Предполагаемый грейд
            <ChoiceSelect
              label="Предполагаемый грейд"
              value={grade}
              disabled={busy || Boolean(active)}
              options={["Junior", "Middle", "Senior"].map((value) => ({
                value,
                label: value,
              }))}
              onChange={(value) => setGrade(value as TargetGrade)}
            />
          </label>
          <p>
            {profile?.gradeDescriptions[grade] ||
              (grade === "Junior"
                ? "Локальная диагностика, API и данные, базовые гонки."
                : grade === "Middle"
                  ? "Несколько компонентов, частичные отказы, причинные связи и транзакционные границы."
                  : "Миграции, совместимость, rollout и rollback, ответственность за системные последствия.")}
          </p>
          {error && (
            <p role="alert" className="adaptive-error">
              {error}
            </p>
          )}
          <button
            className="btn primary"
            disabled={
              busy || (!active && (retakeBusy || !eligibility?.allowed))
            }
            onClick={() =>
              active
                ? nav(`/demo/candidate/assessment?session=${active.id}`)
                : void start()
            }
          >
            {busy
              ? "Загрузка…"
              : active
                ? "Продолжить проверку"
                : "Начать проверку"}
            <ArrowRight size={18} />
          </button>
          <p className="muted">
            {eligibility?.nextEligibleAt && !active
              ? `${eligibility.reason === "confirmed" ? "После подтверждения уровня действует интервал 90 дней." : "Повтор того же уровня доступен через 7 дней после неудачной попытки."} Следующая попытка: ${new Date(eligibility.nextEligibleAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} (МСК).`
              : "После подтверждения уровня — 90 дней до следующей проверки в этом направлении. После неудачи — 7 дней до повтора того же уровня. Другой уровень без подтверждённой категории и другое направление доступны отдельно."}
          </p>
        </section>
        <section className="panel">
          <h3>История проверок</h3>
          {sessions.map((s) => (
            <div className="adaptive-history" key={s.id}>
              <strong>
                {s.specializationName} · заявлено {s.targetGrade}
              </strong>
              <span>
                {s.result
                  ? confirmationTitle(
                      s.targetGrade,
                      s.result.decision === "CONFIRMED",
                    )
                  : "В процессе"}{" "}
                · {new Date(s.startedAt).toLocaleDateString("ru-RU")}
              </span>
              <button
                className="btn outline"
                onClick={() =>
                  nav(`/demo/candidate/assessment?session=${s.id}`)
                }
              >
                {s.result ? "Открыть отчёт" : "Продолжить"}
              </button>
            </div>
          ))}
          {!sessions.length && (
            <p className="muted">Здесь появятся ваши проверки.</p>
          )}
        </section>
      </aside>
    </div>
  );
}

function initialDraft(sessionId: string): {
  choice?: { key: string; value: string };
  execution?: { key: string; value: Plan };
  evidence?: { itemId: string; value: string };
  answers?: Record<string, { choice?: string; execution?: Plan }>;
} {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(
      sessionStorage.getItem(`offerly-formal-draft:${sessionId}`) || "{}",
    );
  } catch {
    return {};
  }
}
/** Render only the server-selected step and decision; this client never scores responses. */
export function AdaptiveSessionPage({
  sessionId,
  nav,
  act,
}: {
  sessionId: string;
  nav: Navigate;
  act: Action;
}) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState(
    () => initialDraft(sessionId).choice ?? { key: "", value: "" },
  );
  const [selectedExecution, setSelectedExecution] = useState<{
    key: string;
    value: Plan;
  }>(() => initialDraft(sessionId).execution ?? { key: "", value: {} });
  const [selectedEvidence, setSelectedEvidence] = useState(
    () => initialDraft(sessionId).evidence ?? { itemId: "", value: "" },
  );
  const [answers, setAnswers] = useState<
    Record<string, { choice?: string; execution?: Plan }>
  >(() => initialDraft(sessionId).answers || {});
  useEffect(() => {
    try {
      sessionStorage.setItem(
        `offerly-formal-draft:${sessionId}`,
        JSON.stringify({
          answers,
          choice: selectedChoice,
          execution: selectedExecution,
          evidence: selectedEvidence,
        }),
      );
    } catch {}
  }, [sessionId, selectedChoice, selectedExecution, selectedEvidence, answers]);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [clock, setClock] = useState(0);
  const [syncStatus, setSyncStatus] = useState<"pending" | "saved" | "failed">(
    "pending",
  );
  const syncStarted = useRef(false);
  const [offset, setOffset] = useState(0);
  const requestPending = useRef(false);
  const pollPending = useRef(false);
  const mutationVersion = useRef(0);
  function update(next: SessionView) {
    setOffset(Date.parse(next.serverNow) - Date.now());
    setSession(next);
    setClock(Date.now());
  }
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const s = await platform<SessionView>(
          `/adaptive-sessions/${sessionId}`,
        );
        if (!cancelled) update(s);
      } catch (failure) {
        if (!cancelled) setError((failure as Error).message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (session?.state !== "active") return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (requestPending.current || pollPending.current) return;
      pollPending.current = true;
      const version = mutationVersion.current;
      try {
        const next = await platform<SessionView>(
          `/adaptive-sessions/${sessionId}`,
        );
        if (
          !cancelled &&
          version === mutationVersion.current &&
          !requestPending.current
        ) {
          update(next);
          setError("");
        }
      } catch (failure) {
        if (!cancelled) setError((failure as Error).message);
      } finally {
        pollPending.current = false;
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session?.state, sessionId]);
  const stepKey = `${session?.current?.itemId}/${session?.current?.step.id}`;
  const choice = session?.savedAnswer
    ? session.savedAnswer.optionId
    : selectedChoice.key === stepKey
      ? selectedChoice.value
      : answers[stepKey]?.choice || "";
  const execution = session?.savedAnswer
    ? session.savedAnswer.execution || {}
    : selectedExecution.key === stepKey
      ? selectedExecution.value
      : answers[stepKey]?.execution || {};
  const executionComplete =
    !session?.current?.step.responseTask ||
    session.current.step.responseTask.controls.every((control) =>
      Object.hasOwn(execution, control.id),
    );
  const artifactId =
    selectedEvidence.itemId === session?.current?.itemId
      ? selectedEvidence.value
      : "";
  const sync = useCallback(async () => {
    try {
      const saved = await act("professional-result", { sessionId });
      setSyncStatus(saved ? "saved" : "failed");
    } catch {
      setSyncStatus("failed");
    }
  }, [act, sessionId]);
  useEffect(() => {
    if (session?.result && !syncStarted.current) {
      syncStarted.current = true;
      void sync();
    }
  }, [session?.result, sync]);
  async function operation(
    action: "answer" | "evidence" | "navigate" | "revise",
    data: Record<string, unknown>,
  ) {
    if (busy || !session?.current || requestPending.current) return;
    setBusy(true);
    requestPending.current = true;
    mutationVersion.current++;
    try {
      const next = await platform<SessionView>(
        `/adaptive-sessions/${sessionId}/${action}`,
        "POST",
        {
          interactionRevision: session.interactionRevision || 0,
          itemId: session.current.itemId,
          stepId: session.current.step.id,
          ...data,
        },
      );
      if (action === "revise") {
        setAnswers((previous) =>
          Object.fromEntries(
            Object.entries(previous).filter(([key]) =>
              next.navigation?.some(
                (n) =>
                  `${n.itemId}/${n.stepId}` === key && n.status === "answered",
              ),
            ),
          ),
        );
        setSelectedChoice({
          key: stepKey,
          value: session.savedAnswer?.optionId || "",
        });
        setSelectedExecution({
          key: stepKey,
          value: session.savedAnswer?.execution || {},
        });
        setReviseOpen(false);
      }
      update(next);
      setError("");
      if (action === "evidence")
        setSelectedEvidence({
          itemId: session.current.itemId,
          value: String(data.artifactId || ""),
        });
      if (action === "answer" || action === "navigate")
        document
          .querySelector(".adaptive-main")
          ?.scrollIntoView({ block: "start", behavior: "instant" });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
      requestPending.current = false;
    }
  }
  if (!session)
    return (
      <section className="panel results-empty">
        {error ? (
          <>
            <h1>Проверка недоступна</h1>
            <p role="alert">{error}</p>
            <button
              className="btn primary"
              onClick={() => nav("/demo/candidate/assessment")}
            >
              К проверкам
            </button>
          </>
        ) : (
          <>
            <Loader2 className="spin" />
            Загружаем проверку…
          </>
        )}
      </section>
    );
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(session.deadlineAt) - clock - offset) / 1000),
  );
  const remaining = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const result = session.result;
  const current = session.current;
  const questionNumber =
    (session.navigation || [])
      .filter((n) => n.stage === session.stage)
      .findIndex(
        (n) => n.itemId === current?.itemId && n.stepId === current?.step.id,
      ) + 1 ||
    (session.progress.stages.find((n) => n.stage === session.stage)
      ?.completed || 0) + 1;
  const selectedArtifact = current?.artifacts.find((a) => a.id === artifactId);
  const stages = ["anchors", "incident", "review", "boundary"] as const;
  const stageLabel = (stage: (typeof stages)[number]) =>
    session.packPresentation?.stages.find((blueprint) => blueprint.id === stage)
      ?.label || stageNames[stage];
  return (
    <div
      className={`engineering-page adaptive-page ${result ? "has-result" : "has-active-session"}`}
    >
      <FeedbackDialog
        open={Boolean(error)}
        message={error}
        onOpenChange={(open) => {
          if (!open) setError("");
        }}
      />
      <Dialog open={reviseOpen} onOpenChange={setReviseOpen}>
        <DialogContent
          className="auth-account-dialog"
          overlayClassName="auth-account-overlay"
        >
          <DialogTitle>Изменить сохранённый ответ?</DialogTitle>
          <DialogDescription>
            {session.revisionResetCount && session.revisionResetCount > 1
              ? `Этот ответ и последующие шаги (${session.revisionResetCount}) будут сняты с подтверждения. Их нужно будет заполнить снова, чтобы оценка соответствовала новому решению.`
              : "Ответ будет снят с подтверждения. Измените его и сохраните снова — прогресс обновится автоматически."}{" "}
            Общий таймер продолжит идти, открытые источники сохранятся.
          </DialogDescription>
          <button
            className="btn primary"
            disabled={busy || seconds === 0}
            onClick={() => void operation("revise", {})}
          >
            Изменить ответ
          </button>
          <button
            className="auth-account-secondary"
            onClick={() => setReviseOpen(false)}
          >
            Оставить как есть
          </button>
        </DialogContent>
      </Dialog>
      <aside
        className="panel assessment-controller engineering-status-bar"
        aria-label="Навигация по проверке"
      >
        <button
          className="text-link assessment-back"
          onClick={() => nav("/demo/candidate/assessment")}
        >
          <ArrowLeft size={16} /> К проверкам
        </button>
        <h2>
          {session.specializationName} <span>· {session.targetGrade}</span>
        </h2>
        {!result && (
          <>
            <div
              className="assessment-clock"
              role="timer"
              aria-label="Осталось времени"
            >
              <span>
                <Clock3 size={18} /> Осталось времени
              </span>
              <strong>{remaining}</strong>
            </div>
            <div className="assessment-completion">
              <strong>
                {Math.round(
                  (100 * session.progress.coreCompletedSteps) /
                    session.progress.coreTotalSteps,
                )}
                %
              </strong>
              <span>Основная часть</span>
              <progress
                aria-label="Основная часть"
                max={session.progress.coreTotalSteps}
                value={session.progress.coreCompletedSteps}
              />
              <small>
                {session.progress.coreCompletedSteps} из{" "}
                {session.progress.coreTotalSteps} шагов
              </small>
            </div>
            <nav
              className="assessment-stage-navigation"
              aria-label="Этапы проверки"
            >
              {stages.map((stage, index) => {
                const progress = session.progress.stages.find(
                  (p) => p.stage === stage,
                );
                return (
                  <div key={stage}>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        seconds === 0 ||
                        !(session.navigation || []).some(
                          (n) => n.stage === stage && n.available,
                        )
                      }
                      aria-current={
                        stage === session.stage ? "step" : undefined
                      }
                      data-state={progress?.status}
                      onClick={() => {
                        const target = session.navigation?.find(
                          (n) => n.stage === stage && n.available,
                        );
                        if (target)
                          void operation("navigate", {
                            itemId: target.itemId,
                            stepId: target.stepId,
                          });
                      }}
                    >
                      <span>
                        {progress?.status === "complete" ? (
                          <CheckCircle2 size={17} />
                        ) : (
                          String(index + 1).padStart(2, "0")
                        )}
                      </span>
                      <strong>{stageLabel(stage)}</strong>
                      <small>
                        {progress?.completed || 0}/{progress?.total || "—"}
                      </small>
                    </button>
                    {stage === session.stage && (
                      <div className="assessment-question-navigation">
                        {(session.navigation || [])
                          .filter((n) => n.stage === stage)
                          .map((n, i) => (
                            <button
                              type="button"
                              key={`${n.itemId}/${n.stepId}`}
                              disabled={busy || !n.available || seconds === 0}
                              aria-label={`Задание ${i + 1}${n.status === "answered" ? " — сохранено" : ""}`}
                              aria-current={n.selected ? "step" : undefined}
                              data-status={n.status}
                              onClick={() =>
                                void operation("navigate", {
                                  itemId: n.itemId,
                                  stepId: n.stepId,
                                })
                              }
                            >
                              {n.status === "answered" ? (
                                <CheckCircle2 size={16} />
                              ) : (
                                i + 1
                              )}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
            <p className="muted assessment-navigation-help">
              Сохранённые ответы можно открыть и изменить до завершения
              проверки. Связанные шаги открываются последовательно.
            </p>
          </>
        )}
      </aside>
      <main className="adaptive-main">
        {error && (
          <p role="alert" className="adaptive-error">
            {error}
          </p>
        )}
        {result ? (
          <section
            className="panel adaptive-result"
            data-decision={result.decision}
          >
            <div className="assessment-report-meta">
              <span>ОТЧЁТ О ПРОВЕРКЕ</span>
              <span>
                {new Date(
                  session.finishedAt || session.startedAt,
                ).toLocaleDateString("ru-RU")}
              </span>
            </div>
            <div className="assessment-report-hero">
              <div className="assessment-report-intro">
                <span className="eyebrow">
                  {session.specializationName} · ЗАЯВЛЕННЫЙ УРОВЕНЬ:{" "}
                  {result.targetGrade}
                </span>
                <div className="assessment-report-status">
                  <ShieldCheck size={24} />{" "}
                  {result.decision === "CONFIRMED"
                    ? "Уровень подтверждён"
                    : "Уровень пока не подтверждён"}
                </div>
                <h1>
                  {confirmationTitle(
                    result.targetGrade,
                    result.decision === "CONFIRMED",
                  )}
                </h1>
                <p className="assessment-lead">{result.reason}</p>
                {result.assessmentStatus === "insufficient-evidence" && (
                  <p className="adaptive-reset" role="status">
                    Недостаточно свидетельств для устойчивого решения.
                  </p>
                )}
                {result.decision === "CONFIRMED" && result.recommendation && (
                  <p className="assessment-report-recommendation">
                    Результат значительно выше проходного порога. Можно отдельно
                    проверить следующий уровень.
                  </p>
                )}
              </div>
              {result.decision === "CONFIRMED" && (
                <img
                  className="assessment-report-illustration"
                  src="/illustrations/auth-email-candidate-success.webp"
                  width={1200}
                  height={1200}
                  alt=""
                />
              )}
            </div>
            <div className="assessment-report-section-heading">
              <h2>Ваши компетенции</h2>
              <p>Отдельная оценка каждой стороны инженерного решения.</p>
            </div>
            <div className="adaptive-dimensions">
              {result.dimensions.map((d) => (
                <article
                  key={d.dimension}
                  data-strength={
                    d.label === "Сильная сторона" || d.label === "Соответствует"
                      ? "positive"
                      : "develop"
                  }
                >
                  <div className="assessment-dimension-heading">
                    <h2>
                      {session.packPresentation?.dimensions[d.dimension] ||
                        dimensionNames[d.dimension]}
                    </h2>
                    {d.label === "Сильная сторона" ||
                    d.label === "Соответствует" ? (
                      <CheckCircle2 size={22} aria-hidden="true" />
                    ) : (
                      <FileSearch size={22} aria-hidden="true" />
                    )}
                  </div>
                  <strong>{d.label}</strong>
                  <p>{d.description}</p>
                </article>
              ))}
            </div>
            <div className="assessment-report-section-heading">
              <h2>Что проверялось</h2>
            </div>
            <div className="adaptive-tags">
              {result.contentTags.map((tag) => (
                <span key={tag}>
                  {session.packPresentation?.domains.find(
                    (domain) => domain.id === tag,
                  )?.label ||
                    contentTagNames[tag] ||
                    tag}
                </span>
              ))}
            </div>
            <div className="assessment-report-summary">
              <h2>{result.stopReason === "timeout" ? "Время истекло" : "Итог попытки"}</h2>
              <p>
                {result.stopReason === "timeout"
                  ? "Общий лимит времени исчерпан. Неотвеченные задания учтены как 0; сохранённые ответы вошли в результат."
                  : result.stopReason === "boundary_exhausted"
                    ? "Дополнительная проверка завершена. Свидетельств для устойчивого подтверждения пока недостаточно."
                    : "Решение принято после обязательной части и оценки свидетельств."}
              </p>
              {result.timeoutSummary && <p>Ответов: {result.timeoutSummary.answered} из {result.timeoutSummary.total}. Без ответа: {result.timeoutSummary.unanswered} — 0 баллов. Итог: {result.timeoutSummary.score} из 100.</p>}
              <p role="status">
                {syncStatus === "saved"
                  ? "Результат сохранён в профиле."
                  : syncStatus === "failed"
                    ? "Отчёт сохранён на сервере. Не удалось обновить профиль."
                    : "Обновляем профиль…"}
              </p>
            </div>
            <details className="assessment-report-method">
              <summary>Методика и версия проверки</summary>
              <p>
                {session.methodVersion || "formal-generator-7.3.3"} ·{" "}
                {session.scoringVersion || "competency-4"}. Решение сохранено с
                конфигурацией этой попытки. Оценка учитывает компетенции и
                сложность заданий, а не только количество правильных ответов.
              </p>
            </details>
            {syncStatus === "failed" && (
              <button className="btn outline" onClick={() => void sync()}>
                Повторить обновление профиля
              </button>
            )}
            <div className="adaptive-actions">
              <button
                className="btn outline"
                onClick={() => nav("/demo/candidate/assessment")}
              >
                К проверкам
              </button>
              {result.recommendation && (
                <button
                  className="btn primary"
                  onClick={() =>
                    nav(
                      `/demo/candidate/assessment?grade=${result.recommendation}&specialization=${session.specialization}`,
                    )
                  }
                >
                  {result.decision === "CONFIRMED"
                    ? `Попробовать ${result.recommendation}`
                    : `Пройти проверку ${result.recommendation}`}
                  <ArrowRight size={18} />
                </button>
              )}
            </div>
            {result.decision === "CONFIRMED" && result.recommendation && (
              <p className="muted">
                Рекомендация не меняет грейд. Новая проверка этого направления
                доступна через 90 дней после подтверждения уровня; точная дата
                указана при выборе следующей попытки.
              </p>
            )}
          </section>
        ) : (
          current && (
            <div
              className={`adaptive-workspace ${current.architecture.length || session.stage === "incident" ? "" : "adaptive-standalone"}`}
            >
              <section className="panel adaptive-task">
                <span className="eyebrow">
                  {stageLabel(session.stage!)}
                  {session.stage !== "boundary" &&
                    ` · ${questionNumber}/${session.progress.stages.find((s) => s.stage === session.stage)?.total || 1}`}
                  {current.step.difficultyPoints !== undefined &&
                    ` · Вес сложности: ${current.step.difficultyPoints}`}
                </span>
                <h1>{current.step.prompt}</h1>
                {current.step.resetContext && (
                  <div className="adaptive-reset">
                    <CheckCircle2 size={18} />
                    <p>{current.step.resetContext}</p>
                  </div>
                )}
                <AssessmentScenario
                  scenario={current.step.scenario}
                  context={current.step.context}
                />
                {session.stage === "incident" && (
                  <a
                    className="mobile-evidence-link"
                    href="#assessment-evidence"
                  >
                    Перейти к источникам данных ↓
                  </a>
                )}
                {session.stage !== "incident" &&
                  current.artifacts.map((a) => (
                    <details
                      className="adaptive-inline-artifact"
                      key={a.id}
                      open={a.type === "code"}
                    >
                      <summary>{a.label}</summary>
                      <AssessmentArtifact artifact={a} />
                    </details>
                  ))}
                {current.step.exploration ? (
                  <>
                    <p>
                      Выберите{" "}
                      {current.step.requiredEvidenceSources === 1
                        ? "первый источник"
                        : "первые два источника"}
                      . Их порядок учитывается при оценке диагностики. Затем
                      можно открыть остальные источники.
                    </p>
                    <button
                      className="btn primary"
                      disabled={
                        busy ||
                        !!session.savedAnswer ||
                        seconds === 0 ||
                        current.artifacts.filter((a) => a.content !== null)
                          .length < (current.step.requiredEvidenceSources || 2)
                      }
                      onClick={() =>
                        void operation("answer", { optionId: "continue" })
                      }
                    >
                      Перейти к интерпретации
                      <ArrowRight size={18} />
                    </button>
                  </>
                ) : (
                  <>
                    <fieldset className="adaptive-options">
                      <legend>Выберите решение для указанных условий</legend>
                      {current.step.options.map((option) => (
                        <label
                          key={option.id}
                          data-selected={choice === option.id}
                        >
                          <input
                            type="radio"
                            name="response"
                            value={option.id}
                            checked={choice === option.id}
                            disabled={
                              busy || seconds === 0 || !!session.savedAnswer
                            }
                            onChange={() => {
                              setSelectedChoice({
                                key: stepKey,
                                value: option.id,
                              });
                              setAnswers((previous) => ({
                                ...previous,
                                [stepKey]: {
                                  ...previous[stepKey],
                                  choice: option.id,
                                },
                              }));
                            }}
                          />
                          <span>{option.text}</span>
                        </label>
                      ))}
                    </fieldset>
                    {current.step.responseTask && (
                      <section className="adaptive-response-task">
                        <h3>{current.step.responseTask.title}</h3>
                        <p>{current.step.responseTask.instructions}</p>
                        <ExecutionControls
                          controls={current.step.responseTask.controls}
                          value={execution}
                          disabled={
                            busy || seconds === 0 || !!session.savedAnswer
                          }
                          change={(id, value) => {
                            const plan = { ...execution, [id]: value };
                            setSelectedExecution({ key: stepKey, value: plan });
                            setAnswers((previous) => ({
                              ...previous,
                              [stepKey]: {
                                ...previous[stepKey],
                                execution: plan,
                              },
                            }));
                          }}
                        />
                      </section>
                    )}
                    {!session.savedAnswer && (
                      <button
                        className="btn primary"
                        disabled={
                          busy || !choice || !executionComplete || seconds === 0
                        }
                        onClick={() =>
                          void operation("answer", {
                            optionId: choice,
                            ...(current.step.responseTask ? { execution } : {}),
                          })
                        }
                      >
                        {busy ? "Сохраняем…" : "Сохранить и продолжить"}
                        <ArrowRight size={18} />
                      </button>
                    )}
                    {!session.savedAnswer &&
                      (choice || Object.keys(execution).length > 0) && (
                        <button
                          className="btn subtle assessment-skip"
                          disabled={busy || seconds === 0}
                          onClick={() => {
                            setSelectedChoice({ key: stepKey, value: "" });
                            setSelectedExecution({ key: stepKey, value: {} });
                            setAnswers((previous) => ({
                              ...previous,
                              [stepKey]: {},
                            }));
                          }}
                        >
                          Очистить ответ
                        </button>
                      )}
                  </>
                )}
                {session.savedAnswer && (
                  <div className="assessment-saved-answer">
                    <p>
                      <CheckCircle2 size={18} /> Ответ сохранён
                    </p>
                    {!current.step.exploration && (
                      <button
                        className="btn outline"
                        disabled={busy || seconds === 0}
                        onClick={() => setReviseOpen(true)}
                      >
                        Изменить ответ
                      </button>
                    )}
                    <button
                      className="btn subtle"
                      disabled={busy || seconds === 0}
                      onClick={() => {
                        const next = session.navigation?.find(
                          (n) => n.available && n.status !== "answered",
                        );
                        if (next)
                          void operation("navigate", {
                            itemId: next.itemId,
                            stepId: next.stepId,
                          });
                      }}
                    >
                      К текущему заданию <ArrowRight size={17} />
                    </button>
                  </div>
                )}
                {!session.savedAnswer &&
                  session.stage === "anchors" &&
                  (session.navigation || []).some(
                    (n) => n.available && n.itemId !== current.itemId,
                  ) && (
                    <button
                      className="btn subtle assessment-skip"
                      disabled={busy || seconds === 0 || !!session.savedAnswer}
                      onClick={() => {
                        const pending = (session.navigation || []).filter(
                          (n) => n.available,
                        );
                        const index = pending.findIndex(
                          (n) =>
                            n.itemId === current.itemId &&
                            n.stepId === current.step.id,
                        );
                        const next = pending[(index + 1) % pending.length];
                        if (next)
                          void operation("navigate", {
                            itemId: next.itemId,
                            stepId: next.stepId,
                          });
                      }}
                    >
                      Отложить вопрос <ArrowRight size={17} />
                    </button>
                  )}
                <p className="muted assessment-answer-note">
                  Прогресс учитывает сохранённые ответы. Черновики сохраняются в
                  этой вкладке; изменить ответ можно до завершения проверки.
                </p>
              </section>
              {(current.architecture.length > 0 ||
                session.stage === "incident") && (
                <aside className="adaptive-sidebar">
                  {current.architecture.length > 0 && (
                    <section className="panel">
                      <span className="eyebrow">КОНТУР ЗАДАЧИ</span>
                      {current.topology ? (
                        <TopologyArtifact topology={current.topology} />
                      ) : (
                        <div className="adaptive-flow">
                          {current.architecture.map((node, i) => (
                            <div key={i}>
                              <Database size={18} />
                              <strong>{node}</strong>
                              {i < current.architecture.length - 1 && (
                                <span aria-hidden="true">↓</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                  {session.stage === "incident" &&
                    current.artifacts.length > 0 && (
                      <section
                        className="panel adaptive-evidence"
                        id="assessment-evidence"
                      >
                        <h2>Источники данных</h2>
                        <div>
                          {current.artifacts.map((a) => (
                            <button
                              key={a.id}
                              className="evidence-chip"
                              disabled={
                                busy || seconds === 0 || !!session.savedAnswer
                              }
                              aria-pressed={artifactId === a.id}
                              data-opened={a.content !== null}
                              onClick={() =>
                                a.content === null
                                  ? void operation("evidence", {
                                      artifactId: a.id,
                                    })
                                  : setSelectedEvidence({
                                      itemId: current.itemId,
                                      value: a.id,
                                    })
                              }
                            >
                              {a.label}
                              {a.content !== null && (
                                <CheckCircle2 size={14} aria-hidden="true" />
                              )}
                            </button>
                          ))}
                        </div>
                        {selectedArtifact?.content && (
                          <div
                            className="evidence-reader"
                            role="region"
                            aria-label={`Открытый источник: ${selectedArtifact.label}`}
                          >
                            <h3>{selectedArtifact.label}</h3>
                            <AssessmentArtifact artifact={selectedArtifact} />
                          </div>
                        )}
                      </section>
                    )}
                  <p className="muted">
                    Все сохранённые ответы останутся после перезагрузки. Таймер
                    общий для всей проверки.
                  </p>
                </aside>
              )}
            </div>
          )
        )}
      </main>
    </div>
  );
}

/** Interactive topology uses the same nodes and edges as the scenario and trace. */
function TopologyArtifact({ topology }: { topology: Topology }) {
  const [selected, setSelected] = useState("");
  const height = Math.ceil(topology.nodes.length / 2) * 90;
  const position = (id: string) => {
    const index = topology.nodes.findIndex((n) => n.id === id);
    const col = Math.floor(index / 2) % 2 === 0 ? index % 2 : 1 - (index % 2);
    return { x: col * 192 + 96, y: Math.floor(index / 2) * 90 + 40 };
  };
  const node = topology.nodes.find((n) => n.id === selected);
  return (
    <div>
      <div className="generated-topology" style={{ height }}>
        <svg
          viewBox={`0 0 384 ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="topology-arrow"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M0 0 L6 3 L0 6" fill="#9b80d8" />
            </marker>
          </defs>
          {topology.edges.map((e, i) => {
            const a = position(e.from),
              b = position(e.to);
            const horizontal = a.y === b.y;
            const direction = Math.sign(b.x - a.x);
            return (
              <line
                key={i}
                x1={horizontal ? a.x + direction * 89 : a.x}
                y1={horizontal ? a.y : a.y + 28}
                x2={horizontal ? b.x - direction * 94 : b.x}
                y2={horizontal ? b.y : b.y - 32}
                stroke="#9b80d8"
                strokeWidth="2"
                markerEnd="url(#topology-arrow)"
              />
            );
          })}
        </svg>
        {topology.nodes.map((n, i) => (
          <button
            key={n.id}
            className="generated-topology-node"
            style={{
              left: position(n.id).x < 192 ? "2%" : "52%",
              top: Math.floor(i / 2) * 90 + 8,
            }}
            aria-pressed={selected === n.id}
            onClick={() => setSelected(n.id)}
          >
            {/DB|store/i.test(n.label) ? (
              <Database size={16} />
            ) : (
              <FileSearch size={16} />
            )}
            <span>{n.label}</span>
          </button>
        ))}
      </div>
      {node && (
        <p className="muted">
          {node.label}: {node.state}. Связи:{" "}
          {topology.edges
            .filter((e) => e.from === node.id || e.to === node.id)
            .map((e) => e.label)
            .join(", ")}
          .
        </p>
      )}
    </div>
  );
}
