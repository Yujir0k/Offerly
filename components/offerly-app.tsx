"use client";
import { useState, useEffect, useRef } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Landing, PublicHeader } from "./landing";
import { PublicFooter } from "./public-footer";
import { Registration } from "./registration";
import { CompanySetup } from "./company-setup";
import { CandidateSetup } from "./candidate-setup";
import { EmailVerification } from "./journey";
import { Workspace } from "./workspace";
import { LogoMotion } from "./logo-motion";
import { FeedbackDialog } from "./feedback-dialog";
import { WelcomeScreen } from "./welcome-screen";
import { State, Role } from "@/lib/model";
import { clearDraftCaches } from "@/hooks/use-draft";
import { readWorkspace } from "@/lib/workspace-request";
export default function OfferlyApp() {
  const [route, setRoute] = useState("/"),
    [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [transition, setTransition] = useState<"cover" | "reveal" | null>(null);
  const [loginTransition, setLoginTransition] = useState<
    "cover" | "reveal" | null
  >(null);
  const pendingLogin = useRef(false);
  const [actionError, setActionError] = useState("");
  const switching = useRef(false);
  const currentState = useRef<State | null>(null);
  const stateGeneration = useRef(0);
  function commitState(next: State | null) {
    currentState.current = next;
    setState(next);
  }
  const [lastAction, setLastAction] = useState("");
  const preparedRole = useRef<Role | null>(null);
  const role: Role =
    route.includes("/employer") || route.includes("role=employer")
      ? "employer"
      : "candidate";
  const isWorkspace = route.startsWith("/demo/");
  const isSetup = route.startsWith("/onboarding/");
  const isWelcome = route.startsWith("/welcome");
  const needsState =
    isWorkspace || isSetup || isWelcome || route.startsWith("/verify-email");
  async function nav(path: string) {
    if (switching.current) return;
    setActionError("");
    const nextRole: Role =
      path.includes("/employer") || path.includes("role=employer")
        ? "employer"
        : "candidate";
    if (
      currentState.current &&
      !currentState.current.auth?.demo &&
      currentState.current.emailVerification?.status !== "verified" &&
      (path.startsWith("/demo/") || path.startsWith("/welcome"))
    )
      path = `/verify-email?role=${nextRole}${path.startsWith("/welcome") ? "&ready=1" : ""}`;
    if (!isWorkspace && path.startsWith("/demo/") && !currentState.current) {
      // Keep the current page visible while resolving authentication; never mount a
      // workspace loader for an anonymous visitor entering from the public menu.
      switching.current = true;
      try {
        const {response,body} = await readWorkspace(nextRole);
        if (response.status === 401) path = `/register?role=${nextRole}&returnTo=${encodeURIComponent(path)}`;
        else if (!response.ok) throw new Error(body.error || "Не удалось открыть кабинет");
        else { preparedRole.current = nextRole; stateGeneration.current++; commitState(body as State); }
      } catch (failure) { setActionError((failure as Error).message); switching.current = false; return; }
      switching.current = false;
    }
    if (pendingLogin.current && path.startsWith("/demo/")) {
      pendingLogin.current = false;
      switching.current = true;
      // Authentication already returned authoritative state. Mount the destination
      // under one opaque cover; do not expose it and then fetch it a second time.
      preparedRole.current = nextRole;
      window.history.pushState({}, "", path);
      setRoute(path);
      window.scrollTo({ top: 0, behavior: "instant" });
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await new Promise((resolve) => setTimeout(resolve, reduced ? 0 : 180));
      setLoginTransition("reveal");
      await new Promise((resolve) => setTimeout(resolve, reduced ? 0 : 300));
      setLoginTransition(null);
      switching.current = false;
      return;
    }
    if (isWorkspace && path.startsWith("/demo/") && nextRole !== role) {
      switching.current = true;
      setTransition("cover");
      const started = performance.now();
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      try {
        const [next] = await Promise.all([
          readWorkspace(nextRole).then(({ response, body }) => {
            if (!response.ok)
              throw new Error(body.error || "Не удалось открыть кабинет");
            return body as State;
          }),
          new Promise((resolve) => setTimeout(resolve, reduced ? 0 : 140)),
        ]);
        preparedRole.current = nextRole;
        stateGeneration.current++;
        commitState(next);
        window.history.pushState({}, "", path);
        setRoute(path);
        window.scrollTo({ top: 0, behavior: "instant" });
        // Commit and paint the new workspace during the covered logo sequence.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.max(0, (reduced ? 80 : 760) - (performance.now() - started)),
          ),
        );
        setTransition("reveal");
        setTimeout(
          () => {
            setTransition(null);
            switching.current = false;
          },
          reduced ? 80 : 160,
        );
      } catch (error) {
        setActionError((error as Error).message);
        setTransition(null);
        switching.current = false;
      }
      return;
    }
    window.history.pushState({}, "", path);
    setRoute(path);
    window.scrollTo({ top: 0, behavior: "instant" });
    switching.current = false;
  }
  useEffect(() => {
    function pop() {
      setActionError("");
      setRoute(window.location.pathname + window.location.search);
    }
    pop();
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (!needsState) return;
    if (preparedRole.current === role) {
      preparedRole.current = null;
      return;
    }
    const c = new AbortController();
    setError("");
    const generation = stateGeneration.current;
    readWorkspace(role, c.signal)
      .then(({ response: r, body: b }) => {
        if (r.status === 401) {
          clearDraftCaches();
          window.location.assign(`/login?role=${role}&returnTo=${encodeURIComponent(window.location.pathname+window.location.search)}`);
          return;
        }
        if (!r.ok)
          throw new Error(
            b.error || "Не удалось загрузить кабинет. Повторите попытку.",
          );
        if (!c.signal.aborted && generation === stateGeneration.current)
          commitState(b);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [needsState, role, revision]);
  useEffect(() => {
    if (!isWorkspace) return;
    const refresh = () => {
      if (!document.hidden && !switching.current) setRevision((v) => v + 1);
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [isWorkspace]);
  async function act(type: string, data: Record<string, unknown> = {}) {
    stateGeneration.current++;
    setLastAction(type);
    setActionError("");
    try {
      const r = await fetch(
        ["register", "login", "demo-login", "logout"].includes(type)
          ? "/api/auth"
          : "/api/action",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, role, ...data }),
        },
      );
      const b = (await r.json()) as State & { error?: string };
      if (
        r.status === 401 &&
        !["register", "login", "demo-login"].includes(type)
      ) {
        window.location.assign(`/login?role=${role}&returnTo=${encodeURIComponent(window.location.pathname+window.location.search)}`);
        return null;
      }
      if (!r.ok) throw new Error(b.error);
      if (
        type === "delete-account" ||
        type === "logout" ||
        (["register", "login", "demo-login"].includes(type) &&
          state?.auth?.userId !== b.auth?.userId)
      )
        clearDraftCaches();
      if (
        type === "demo-login" ||
        (type === "login" && b.emailVerification.status === "verified")
      ) {
        pendingLogin.current = true;
        setLoginTransition("cover");
      }
      commitState(type === "logout" ? null : b);
      return b as State;
    } catch (e) {
      setActionError((e as Error).message);
      if ((e as Error).message.includes("другой вкладке"))
        setRevision((v) => v + 1);
      return null;
    }
  }
  useEffect(() => {
    const mc = (navigator as Navigator & { modelContext?: { registerTool(tool: { name: string; description: string; inputSchema: object; execute: () => Promise<{ content: { type: string; text: string }[] }> }): void; unregisterTool(name: string): void } }).modelContext;
    if (!mc?.registerTool) return;
    const name = "offerly_view";
    try {
      mc.registerTool({
        name,
        description:
          "Read the currently visible Offerly demo role and page, without contacts or personal data.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                role,
                page: route.split("?")[0],
                demo: true,
              }),
            },
          ],
        }),
      });
      return () => mc.unregisterTool(name);
    } catch {}
  }, [route, role]);
  const needsVerification =
    !!state &&
    !state.auth?.demo &&
    state.emailVerification.status !== "verified" &&
    (isWorkspace || isWelcome);
  useEffect(() => {
    if (needsVerification) {
      const path = `/verify-email?role=${role}${isWelcome ? "&ready=1" : ""}`;
      window.history.replaceState({}, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, [needsVerification, role]);
  const requestedSection = route.split("?")[0].split("/")[3] || "overview";
  const section =
    requestedSection === "hiring"
      ? "messages"
      : role === "candidate" && requestedSection === "survey"
        ? "assessment"
        : requestedSection;
  useEffect(() => {
    if (requestedSection !== "hiring" && !(role === "candidate" && requestedSection === "survey")) return;
    const frame = requestAnimationFrame(() => void nav(requestedSection === "hiring" ? `/demo/${role}/messages` : "/demo/candidate/assessment"));
    return () => cancelAnimationFrame(frame);
  }, [requestedSection, role]);
  return (
    <>
      <div className="route-surface">
      {route === "/" || route.startsWith("/#") ? (
        <Landing nav={nav} />
      ) : route.startsWith("/register") || route.startsWith("/login") ? (
        <Registration
          nav={nav}
          act={act}
          login={route.startsWith("/login")}
          initialRole={role}
          feedback={actionError}
          returnTo={new URLSearchParams(route.split("?")[1] || "").get("returnTo") || undefined}
        />
      ) : route.startsWith("/verify-email") || needsVerification ? (
        <EmailVerification
          s={state}
          nav={nav}
          act={act}
          role={role}
          route={route}
        />
      ) : isWelcome && state && state.role === role ? (
        <div className="welcome-stage">
          <div className="welcome-workspace" aria-hidden="true" inert>
            <Workspace
              state={state}
              role={role}
              section={role === "candidate" ? "profile" : "company"}
              nav={nav}
              act={act}
              tutorialEnabled={false}
              onStateChange={commitState}
            />
          </div>
          <WelcomeScreen role={role} nav={nav} />
        </div>
      ) : isSetup ? (
        state && state.role === role ? (
          role === "employer" ? (
            <CompanySetup
              s={state}
              nav={nav}
              act={act}
              route={route}
              onStateChange={commitState}
            />
          ) : (
            <CandidateSetup s={state} nav={nav} act={act} route={route} />
          )
        ) : (
          <div className="app-loading">
            <LogoMotion mode="static" size={64} />
            <span>Готовим ваш профиль…</span>
            {error && <p role="alert">{error}</p>}
          </div>
        )
      ) : isWorkspace || isWelcome ? (
        state?.accountDeletedAt ? (
          <div className="app-error">
            <ShieldCheck size={38} />
            <h1>Аккаунт Офферли удалён</h1>
            <p>
              Ваш профиль и история больше недоступны. Можно вернуться на
              главную или создать новый профиль.
            </p>
            <button className="btn primary" onClick={() => nav("/register")}>
              Создать новый профиль
            </button>
            <button className="text-link" onClick={() => nav("/")}>
              На главную
            </button>
          </div>
        ) : error ? (
          <div className="app-error">
            <ShieldCheck size={38} />
            <h1>Не удалось открыть кабинет</h1>
            <p>{error}</p>
            {error.toLowerCase().includes("войти") && (
              <a
                className="btn primary"
                href={`/login?role=${role}`}
                target="_top"
              >
                Войти и открыть кабинет
              </a>
            )}
            <button
              className="btn secondary"
              onClick={async () => {
                const demo = await act("demo-login");
                if (demo) {
                  setError("");
                  await nav(`/demo/${role}/overview`);
                }
              }}
            >
              Посмотреть демоверсию
            </button>
            <button
              className="btn primary"
              onClick={() => setRevision((v) => v + 1)}
            >
              Попробовать снова
            </button>
            <button className="text-link" onClick={() => nav("/")}>
              На главную
            </button>
          </div>
        ) : state && state.role === role ? (
          <Workspace
            state={state}
            role={role}
            section={section}
            jobId={
              new URLSearchParams(route.split("?")[1] || "").get("job") ||
              undefined
            }
            invitationId={new URLSearchParams(route.split("?")[1] || "").get("invitation") || undefined}
            view={
              new URLSearchParams(route.split("?")[1] || "").get("view") ||
              undefined
            }
            intro={
              new URLSearchParams(route.split("?")[1] || "").get("intro") ===
              "1"
            }
            nav={nav}
            act={act}
            roleSwitching={!!transition || !!loginTransition}
            onStateChange={commitState}
            tutorialEnabled={!transition && !loginTransition}
          />
        ) : (
          <div className="app-loading">
            <LogoMotion mode="static" size={64} />
            <span>Готовим ваше пространство…</span>
          </div>
        )
      ) : (
        <InfoPage type={route} nav={nav} />
      )}
      </div>
      {transition && (
        <div
          className={`role-transition role-transition-${transition}`}
          role="status"
          aria-label="Переключаем рабочее пространство"
        >
          <div className="role-transition-mark">
            <span className="transition-progress" />
          </div>
        </div>
      )}
      {loginTransition && (
        <div
          className={`login-transition login-transition-${loginTransition}`}
          role="status"
          aria-label="Открываем рабочее пространство"
        >
          <span className="transition-progress" />
        </div>
      )}
      <FeedbackDialog
        open={
          !!actionError &&
          !route.startsWith("/register") &&
          !route.startsWith("/login") &&
          !route.startsWith("/verify-email") &&
          !lastAction.startsWith("email-change-")
        }
        onOpenChange={(open) => {
          if (!open) setActionError("");
        }}
        message={actionError}
      />
    </>
  );
}
function InfoPage({ type, nav }: { type: string; nav: (p: string) => void }) {
  const privacy = type.split("?")[0] === "/privacy",
    brand = type.split("?")[0] === "/brand";
  const requestedReturn = new URLSearchParams(type.split("?")[1] || "").get(
    "returnTo",
  );
  const returnTo =
    requestedReturn &&
    /^(\/(register|login|verify-email)(\?role=(candidate|employer))?|\/onboarding\/(candidate|employer)(\?step=[a-z-]+)?)$/.test(
      requestedReturn,
    )
      ? requestedReturn
      : "/";
  return (
    <div className="public-info-page">
      <PublicHeader nav={nav} />
      <main className="info-page">
        <button className="inline-link" onClick={() => nav(returnTo)}>
          <ArrowLeft size={17} />
          {returnTo.startsWith("/register")
            ? "Вернуться к регистрации"
            : returnTo.startsWith("/login")
              ? "Вернуться ко входу"
              : returnTo.startsWith("/onboarding")
                ? "Вернуться к заполнению профиля"
                : returnTo.startsWith("/verify-email")
                  ? "Вернуться к подтверждению почты"
                  : "На главную"}
        </button>
        <h1>
          {privacy
            ? "Данные под вашим контролем."
            : brand
              ? "Офферли. Дело найдёт."
              : "Поможем разобраться."}
        </h1>
        {privacy ? (
          <>
            <p>
              Вы управляете данными своего профиля и решаете, когда открыть
              контакты работодателю.
            </p>
            <p>
              Версия согласия: 2026-10-10-v1. Отдельно фиксируются обработка
              профиля, участие в подборе и передача контактов конкретной
              компании.
            </p>
            <h2>Что сохраняется</h2>
            <p>
              Профиль, результаты профессиональных проверок, подборки,
              приглашения, отклики и настройки сохраняются в базе данных.
              Загруженное PDF-резюме хранится отдельно; данные не отправляются
              сторонним рекрутерам.
            </p>
            <h2>Когда видны контакты</h2>
            <p>
              Телефон и почта исключаются из ответа сервера до принятия
              приглашения или самостоятельного отклика. После согласия контакты
              доступны только компании, с которой вы начали взаимодействие.
            </p>
            <h2>Дальнейший запуск</h2>
            <p>
              Перед публичным запуском необходимо подключить почтовый сервис,
              опубликовать документы оператора и проверить интеграцию ФСП.
            </p>
          </>
        ) : brand ? (
          <>
            <p>
              Знак с округлёнными внутренними концами. Палитра ФСП и белое
              название на тёмной поверхности.
            </p>
            <div className="brand-variants">
              {["original", "purple-white", "purple-white-inverse"].map((v) => (
                <div key={v}>
                  <img src={`/brand/${v}.svg`} alt={`Знак Офферли: ${v}`} />
                  <strong>Офферли</strong>
                  <span>Дело найдёт.</span>
                  <a href={`/brand/${v}.svg`} download>
                    Скачать SVG
                  </a>
                </div>
              ))}
            </div>
            <p className="mono">#402FFF · #EC1D35 · #C8C9CA · #1B1C21</p>
            <p>
              JetBrains Mono — фирменные технические акценты. Manrope — текст и
              интерфейс.
            </p>
          </>
        ) : (
          <>
            <p>
              Для полного сценария начните с профиля кандидата, подтвердите
              уровень, переключитесь в кабинет работодателя и отправьте
              приглашение. После принятия контакты станут доступны.
            </p>
            <button
              className="btn primary"
              onClick={() => nav("/demo/candidate")}
            >
              Попробовать платформу
            </button>
          </>
        )}
      </main>
      <PublicFooter
        nav={nav}
        returnTo={returnTo === "/" ? undefined : returnTo}
      />
    </div>
  );
}
