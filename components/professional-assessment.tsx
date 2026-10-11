"use client";
import { Award, ArrowRight, Clock3, CheckCircle2 } from "lucide-react";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "./ui/empty";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { ChoiceSelect } from "./choice-select";
import type { NavigableSessionView } from "@/lib/professional-navigation";
import { AdaptiveEntry, AdaptiveSessionPage } from "./adaptive-assessment";
import { LegacyResultsPage } from "./journey";
import { assessmentTrackId } from "@/lib/assessment-tracks";
import { confirmationTitle } from "@/lib/adaptive-presentation";
import { platform } from "@/lib/professional-client";
import type { State } from "@/lib/model";
import type { Action } from "./registration";
import type { Navigate } from "./landing";
import type {
  TargetGrade,
} from "../vendor/fsp-assessment/src/adaptive/model";
export function FormalAssessment({
  s,
  act,
  nav,
}: {
  s: State;
  act: Action;
  nav: Navigate;
}) {
  const id =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("session");
  const expert = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("presentation") === "expert";
  const requested = s.profile.claimed;
  const grade: TargetGrade =
    requested === "Senior" || requested === "Middle" ? requested : "Junior";
  const promptKey = `offerly-expert-intro:v2:${s.auth?.userId}`;
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoBusy, setDemoBusy] = useState(true);
  const [demoError, setDemoError] = useState("");
  const [demoGrade, setDemoGrade] = useState<TargetGrade>(grade);
  const [demoSpecialization, setDemoSpecialization] = useState(assessmentTrackId(s.profile.specialty));
  const [demoPacks, setDemoPacks] = useState<{id:string;name:string}[]>([]);
  const [demoActive, setDemoActive] = useState<NavigableSessionView | null>(null);
  useEffect(() => {
    if (id || expert) return;
    // Show the introduction after the underlying assessment has painted.
    const frame = requestAnimationFrame(() => {
      try { if (!sessionStorage.getItem(promptKey)) setDemoOpen(true); } catch { setDemoOpen(true); }
    });
    return () => cancelAnimationFrame(frame);
  }, [id, expert, promptKey]);
  function openDemo() { setDemoBusy(true); setDemoError(""); setDemoOpen(true); }
  function closeDemo(open: boolean) {
    setDemoOpen(open);
    if (!open) { try { sessionStorage.setItem(promptKey, "seen"); } catch {} }
  }
  useEffect(() => {
    if (!demoOpen) return;
    let cancelled = false;
    Promise.all([platform<{id:string;name:string}[]>("/generative-packs"), platform<NavigableSessionView[]>("/demo-sessions")])
      .then(([packs, sessions]) => {
        if (cancelled) return;
        setDemoPacks(packs);
        const running = sessions.find(session => session.state === "active") || null;
        setDemoActive(running);
        if (running) {setDemoGrade(running.targetGrade);setDemoSpecialization(running.specialization);}
      }).catch(error => { if (!cancelled) setDemoError(error.message); })
      .finally(() => { if (!cancelled) setDemoBusy(false); });
    return () => { cancelled = true; };
  }, [demoOpen]);
  async function launchDemo() {
    setDemoBusy(true); setDemoError("");
    try {
      const session = demoActive || await platform<NavigableSessionView>("/demo-sessions", "POST", {specialization:demoSpecialization, targetGrade:demoGrade});
      closeDemo(false);
      nav(`/demo/candidate/assessment?session=${session.id}&presentation=expert`);
    } catch (error) { setDemoError((error as Error).message); }
    finally { setDemoBusy(false); }
  }
  return (
    <div className="formal-assessment">
      <section className="expert-demo-banner" aria-label="Демонстрация для экспертов">
        <div><strong>{expert ? "Экспертная демонстрация" : "Проверяете платформу?"}</strong><p>{expert ? "Без таймера, с заполнением ответов. Отчёт сохранится в кабинете отдельно от реального грейда и поиска кандидатов." : "Попробуйте формат заданий в отдельной демонстрации — без влияния на квалификацию."}</p></div>
        <button className="btn outline" onClick={() => expert ? nav("/demo/candidate/assessment") : openDemo()}>{expert ? "Обычная проверка" : "Открыть демонстрацию"}</button>
      </section>
      <Dialog open={demoOpen} onOpenChange={closeDemo}>
        <DialogContent className="expert-intro-dialog" overlayClassName="auth-account-overlay">
          <div className="expert-intro-copy">
            <span className="eyebrow">ЗНАКОМСТВО С ПРОВЕРКОЙ · ДЛЯ ЭКСПЕРТОВ</span>
            <DialogTitle>Хотите пройти пробный демонстрационный тест?</DialogTitle>
            <DialogDescription>Выберите специализацию и грейд, чтобы оценить формат заданий и весь путь до отчёта.</DialogDescription>
            <ul>
              <li><CheckCircle2 size={20} /> Без ограничения времени</li>
              <li><CheckCircle2 size={20} /> Правильные ответы можно заполнить кнопкой</li>
              <li><CheckCircle2 size={20} /> Разделы доступны в любом порядке</li>
            </ul>
            <p className="expert-intro-note">Демо-отчёт останется в ваших результатах с отдельной отметкой. Он не подтверждает реальную квалификацию, не меняет грейд и не участвует в подборе кандидатов.</p>
          </div>
          <div className="expert-intro-setup">
            <h3>Ваша демонстрация</h3>
            <label className="field">Специализация
              <ChoiceSelect label="Специализация демонстрации" value={demoSpecialization} options={demoPacks.map(pack => ({value:pack.id,label:pack.name}))} onChange={setDemoSpecialization} disabled={demoBusy || !!demoActive} />
            </label>
            <label className="field">Грейд
              <ChoiceSelect label="Грейд демонстрации" value={demoGrade} options={["Junior","Middle","Senior"].map(value => ({value,label:value}))} onChange={value => setDemoGrade(value as TargetGrade)} disabled={demoBusy || !!demoActive} />
            </label>
            {demoActive && <p className="muted">У вас есть незавершённая демонстрация. Продолжите её с сохранёнными ответами.</p>}
            {demoError && <p role="alert" className="adaptive-error">{demoError}</p>}
            <button className="btn primary" disabled={demoBusy || !demoPacks.length} onClick={() => void launchDemo()}>{demoBusy ? "Подготавливаем…" : demoActive ? "Продолжить демонстрацию" : "Начать демонстрацию"}<ArrowRight size={18} /></button>
            <button className="btn subtle" onClick={() => closeDemo(false)}>Перейти к обычной проверке</button>
          </div>
        </DialogContent>
      </Dialog>
      {id ? (
        <AdaptiveSessionPage key={`${expert}:${id}`} sessionId={id} act={act} nav={nav} demonstration={expert} />
      ) : (
        <AdaptiveEntry
          key={typeof window === "undefined" ? "" : window.location.search}
          demonstration={expert}
          initialGrade={grade}
          initialSpecialization={assessmentTrackId(s.profile.specialty)}
          nav={nav}
        />
      )}
    </div>
  );
}
export function ProfessionalResults({ s, nav }: { s: State; nav: Navigate }) {
  const [sessions, setSessions] = useState<NavigableSessionView[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  useEffect(() => {
    let cancelled = false;
    Promise.all([platform<NavigableSessionView[]>("/adaptive-sessions"), platform<NavigableSessionView[]>("/demo-sessions")])
      .then(([real, demo]) => [...real, ...demo.map(session => ({...session, demonstration:true}))].sort((a,b) => b.startedAt.localeCompare(a.startedAt)))
      .then((data) => {
        if (!cancelled) setSessions(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="formal-assessment">
      <section className="panel professional-results-panel">
        <header className="professional-results-heading">
          <div>
            <h2>Ваши проверки</h2>
            <p>Подтверждённый уровень, сильные стороны и история попыток.</p>
          </div>
          {sessions.length > 0 && (
            <button
              className="btn primary"
              onClick={() => nav("/demo/candidate/assessment")}
            >
              Новая проверка <ArrowRight size={18} />
            </button>
          )}
        </header>
        {busy && <p className="muted">Загружаем историю…</p>}
        {error && <p role="alert">{error}</p>}
        {!busy && !error && !sessions.length && (
          <Empty className="professional-results-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Award />
              </EmptyMedia>
              <EmptyTitle>Первая проверка — впереди</EmptyTitle>
              <EmptyDescription>
                Выберите специализацию и уровень. После испытания здесь появится
                отчёт по вашим компетенциям.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <button
                className="btn primary"
                onClick={() => nav("/demo/candidate/assessment")}
              >
                Выбрать проверку <ArrowRight size={18} />
              </button>
              <span className="muted">
                <Clock3 size={16} /> До 20 минут
              </span>
            </EmptyContent>
          </Empty>
        )}
        <div className="professional-results-list">
          {sessions.map((session) => (
            <article className="adaptive-history" key={session.id}>
              <div>
                <strong>
                  {session.specializationName} · {session.targetGrade}{session.demonstration && <span className="demo-result-label">Демонстрация</span>}
                </strong>
                <span>
                  {session.result
                    ? confirmationTitle(
                        session.targetGrade,
                        session.result.decision === "CONFIRMED",
                      )
                    : "Проверка продолжается"}{" "}
                  · {new Date(session.startedAt).toLocaleDateString("ru-RU")}
                </span>
              </div>
              {session.demonstration && <p className="muted">Учебный результат — не влияет на реальный грейд и поиск.</p>}
              <button
                className="btn outline"
                onClick={() =>
                  nav(`/demo/candidate/assessment?session=${session.id}${session.demonstration ? "&presentation=expert" : ""}`)
                }
              >
                {session.result ? "Открыть отчёт" : "Продолжить"}
                <ArrowRight size={18} />
              </button>
            </article>
          ))}
        </div>
      </section>
      {s.attempts.some((a) => !a.formal && a.completedAt) && (
        <details className="panel">
          <summary>История прежних проверок прототипа</summary>
          <p>
            Эти попытки относятся к прежней методике и не переоценивались новым
            алгоритмом.
          </p>
          <LegacyResultsPage
            s={{ ...s, attempts: s.attempts.filter((a) => !a.formal) }}
            nav={nav}
          />
        </details>
      )}
    </div>
  );
}
