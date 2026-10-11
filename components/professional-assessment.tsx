"use client";
import { Award, ArrowRight, Clock3 } from "lucide-react";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "./ui/empty";
import { useEffect, useState } from "react";
import { AdaptiveEntry, AdaptiveSessionPage } from "./adaptive-assessment";
import { LegacyResultsPage } from "./journey";
import { assessmentTrackId } from "@/lib/assessment-tracks";
import { confirmationTitle } from "@/lib/adaptive-presentation";
import { platform } from "@/lib/professional-client";
import type { State } from "@/lib/model";
import type { Action } from "./registration";
import type { Navigate } from "./landing";
import type {
  SessionView,
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
  const requested = s.profile.claimed;
  const grade: TargetGrade =
    requested === "Senior" || requested === "Middle" ? requested : "Junior";
  return (
    <div className="formal-assessment">
      {id ? (
        <AdaptiveSessionPage key={id} sessionId={id} act={act} nav={nav} />
      ) : (
        <AdaptiveEntry
          key={typeof window === "undefined" ? "" : window.location.search}
          initialGrade={grade}
          initialSpecialization={assessmentTrackId(s.profile.specialty)}
          nav={nav}
        />
      )}
    </div>
  );
}
export function ProfessionalResults({ s, nav }: { s: State; nav: Navigate }) {
  const [sessions, setSessions] = useState<SessionView[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  useEffect(() => {
    let cancelled = false;
    platform<SessionView[]>("/adaptive-sessions")
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
                  {session.specializationName} · {session.targetGrade}
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
              <button
                className="btn outline"
                onClick={() =>
                  nav(`/demo/candidate/assessment?session=${session.id}`)
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
