"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Role } from "@/lib/model";
import type { Navigate } from "./landing";
import { seedDraft, useDraft } from "@/hooks/use-draft";
import { LogoMotion } from "./logo-motion";

export function WelcomeScreen({ role, nav }: { role: Role; nav: Navigate }) {
  const [welcome, setWelcome, welcomeMeta] = useDraft(
    `settings:welcome_${role}_v1`,
    { completed: false },
  );
  const [error, setError] = useState("");
  const replay =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("replay") === "1";

  const automatic =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("automatic") === "1";
  const autoStarted = useRef(false);
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [entering, setEntering] = useState(false);
  const enteringRef = useRef(false);
  useEffect(() => {
    if (
      welcomeMeta.status === "saved" &&
      welcome.completed &&
      !replay &&
      !automatic &&
      !entering
    )
      nav(`/demo/${role}/${role === "candidate" ? "overview" : "candidates"}`);
  }, [welcomeMeta.status, welcome.completed, replay, role, entering, automatic]);
  const heading = useRef<HTMLHeadingElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // CSS intro lasts 2.6s. Its animationend normally releases the transition;
    // keep a fallback for disabled/missing animations, never the former 700ms cut.
    const timer = setTimeout(() => setReady(true), reduced ? 0 : 3000);
    return () => {
      clearTimeout(timer);
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, []);
  useEffect(() => {
    if (
      automatic &&
      ready &&
      welcomeMeta.status === "saved" &&
      !autoStarted.current
    ) {
      autoStarted.current = true;
      void enter();
    }
  }, [automatic, ready, welcomeMeta.status, welcome.completed]);
  async function enter() {
    if (enteringRef.current) return;
    enteringRef.current = true;
    setEntering(true);
    setWelcome({ completed: true });
    if (!(await welcomeMeta.flush())) {
      enteringRef.current = false;
      setEntering(false);
      setError("Не удалось сохранить знакомство. Попробуйте ещё раз.");
      return;
    }
    if (role === "candidate")
      await seedDraft("profile:ui", { tab: "personal" });
    setLeaving(true);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    exitTimer.current = setTimeout(
      () =>
        nav(
          `/demo/${role}/${role === "candidate" ? "profile" : "company"}?intro=1`,
        ),
      reduced ? 0 : 550,
    );
  }
  return (
    <main className={`offerly-welcome ${leaving ? "is-leaving" : ""}`}>
      <div
        className="welcome-backdrop"
        aria-hidden="true"
        onAnimationEnd={(event) => {
          if (event.animationName === "welcome-workspace-morph") setReady(true);
        }}
      />
      <div className="welcome-content">
        <div className="welcome-mark">
          <LogoMotion size={176} mode="assemble" />
        </div>
        <h1 ref={heading} tabIndex={-1}>
          Добро пожаловать в Офферли
        </h1>
        {(!automatic || error) && (
          <button
            className="btn primary welcome-enter"
            disabled={!ready || entering || welcomeMeta.status === "loading"}
            onClick={() => void enter()}
          >
            Далее
            <ArrowRight size={19} />
          </button>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </main>
  );
}
