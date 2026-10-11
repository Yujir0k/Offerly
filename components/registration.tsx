"use client";
import { withPersonalName, editPersonalName } from "@/lib/personal-name";
import { workspaceReturnTo } from "@/lib/login-return";
import { FspConnect } from "./fsp-connect";
import { PasswordRecovery } from "./password-recovery";
import { PasswordInput } from "./password-input";
import { FeedbackDialog } from "./feedback-dialog";
import { LogoMotion } from "./logo-motion";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  FileText,
  MapPin,
  UserRound,
  Users,
} from "lucide-react";
import { Brand } from "./brand";
import { AuthArtwork } from "./auth-artwork";
import { PublicFooter } from "./public-footer";
import { SuggestionText } from "./suggestion-picker";
import { companyCatalog } from "@/lib/suggestion-catalogs";
import { Navigate } from "./landing";
import { Role, State } from "@/lib/model";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useDraft, seedDraft } from "@/hooks/use-draft";
export type Action = (
  type: string,
  data?: Record<string, unknown>,
) => Promise<State | null>;
export function Registration({
  nav,
  act,
  login = false,
  initialRole = "candidate",
  feedback = "",
  returnTo,
}: {
  nav: Navigate;
  act: Action;
  login?: boolean;
  initialRole?: Role;
  feedback?: string;
  returnTo?: string;
}) {
  const [d, setD] = useDraft("registration", {
    role: initialRole,
    name: "",
    firstName: "",
    lastName: "",
    patronymic: "",
    email: "",
    company: "",
    consent: false,
  });
  const { name, email, company, consent } = d;
  const person = withPersonalName(d);
  // A role chosen through a landing CTA takes precedence over a restored draft.
  const [role, setSelectedRole] = useState<Role>(initialRole);
  useEffect(() => setSelectedRole(initialRole), [initialRole]);
  const setRole = (v: Role) => {
    setSelectedRole(v);
    setD({ ...d, role: v });
  };
  const setEmail = (v: string) => setD({ ...d, role, email: v }),
    setCompany = (v: string) => setD({ ...d, role, company: v }),
    setConsent = (v: boolean) => setD({ ...d, role, consent: v });
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  useEffect(() => {
    setDuplicateOpen(!!feedback);
  }, [feedback]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const s = await act("register", {
      ...person,
      role,
      email,
      company,
      consent,
      password,
    });
    setBusy(false);
    if (s) {
      await seedDraft(`settings:welcome_${role}_v1`, { completed: false });
      await seedDraft(`settings:tour_${role}_v1`, {});
      if (role === "candidate") {
        await seedDraft("profile", s.profile);
        await seedDraft("setup", {
          step: 0,
          profile: s.profile,
          experienceChoice: "",
          filename: "",
        });
        await seedDraft("assessment", {
          spec: s.profile.specialty,
          grade: s.profile.claimed,
          index: 0,
          answers: {},
          tab: "test",
        });
      } else await seedDraft("company", s.company);
      nav(`/verify-email?role=${role}`);
    }
  }
  return (
    <div
      className={`registration-page auth-refresh ${login ? "auth-login" : "auth-register"}`}
    >
      <header className="registration-header">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            nav("/");
          }}
        >
          <Brand />
        </a>
        <button className="back-home" onClick={() => nav("/")}>
          <ArrowLeft size={17} />
          На главную
        </button>
      </header>
      <div className="auth-layout">
        <main className="registration-content auth-card">
          <div className="registration-kicker mono">ВАШ СЛЕДУЮЩИЙ ШАГ</div>
          <h1>{login ? "С возвращением." : "Дело найдёт."}</h1>
          <p className="registration-intro">
            {login
              ? "Выберите кабинет и продолжите с того места, где остановились."
              : "Начните с профиля. Дальше — навыки, люди и подходящие предложения."}
          </p>
          <div className="role-switch" aria-label="Тип кабинета">
            <button
              aria-pressed={role === "candidate"}
              className={role === "candidate" ? "selected" : ""}
              onClick={() => setRole("candidate")}
            >
              <UserRound size={18} />Я кандидат
            </button>
            <button
              aria-pressed={role === "employer"}
              className={role === "employer" ? "selected" : ""}
              onClick={() => setRole("employer")}
            >
              <Users size={18} />Я работодатель
            </button>
          </div>
          <FspConnect
            role={role}
            intent={login ? "login" : "register"}
            consent={consent}
          />
          <div className="auth-method-divider">
            <span>или по электронной почте</span>
          </div>
          {login ? (
            <form
              className="auth-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const result = await act("login", { email, password, role });
                setBusy(false);
                if (result)
                  nav(
                    result.emailVerification.status === "verified"
                      ? workspaceReturnTo(returnTo, role)
                      : `/verify-email?role=${role}`,
                  );
              }}
            >
              <label>
                <span>Электронная почта</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                <span>Пароль</span>
                <PasswordInput
                  key="login-password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={128}
                />
              </label>
              <PasswordRecovery email={email} />
              <button
                className="btn primary full brand-flow-button"
                disabled={busy}
              >
                Войти <ArrowRight size={19} />
              </button>
              <button
                type="button"
                className="btn full auth-demo-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const result = await act("demo-login", { role });
                  setBusy(false);
                  if (result) nav(`/demo/${role}/overview`);
                }}
              >
                Посмотреть демоверсию
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <div className="step-label mono">СОЗДАНИЕ АККАУНТА</div>
              <div className="form-two">
                {(
                  [
                    ["lastName", "Фамилия", "family-name"],
                    ["firstName", "Имя", "given-name"],
                    ["patronymic", "Отчество", "additional-name"],
                  ] as const
                ).map(([key, label, complete]) => (
                  <label key={key}>
                    <span>
                      {label}
                      {key !== "patronymic" && (
                        <i className="required-mark">*</i>
                      )}
                    </span>
                    <input
                      autoComplete={complete}
                      required={key !== "patronymic"}
                      value={person[key] || ""}
                      maxLength={60}
                      onChange={(e) =>
                        setD(
                          editPersonalName(
                            { ...d, ...person },
                            key,
                            e.target.value,
                          ),
                        )
                      }
                      placeholder={
                        key === "patronymic" ? "Необязательно" : label
                      }
                    />
                  </label>
                ))}
              </div>
              {role === "employer" && (
                <label htmlFor="registration-company">
                  <span>
                    Название компании{" "}
                    <i className="required-mark" aria-hidden="true">
                      *
                    </i>
                  </span>
                  <SuggestionText
                    id="registration-company"
                    required
                    dark
                    value={company}
                    onChange={setCompany}
                    catalog={companyCatalog}
                    placeholder="Название вашей команды"
                  />
                </label>
              )}
              <label>
                <span>
                  Электронная почта{" "}
                  <i className="required-mark" aria-hidden="true">
                    *
                  </i>
                </span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.ru"
                />
                <small>
                  После регистрации подтвердите почту шестизначным кодом.
                </small>
              </label>
              <label>
                <span>
                  Пароль <i className="required-mark">*</i>
                </span>
                <PasswordInput
                  key="register-password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Не менее 12 символов"
                />
                <small>Пароль не сохраняется в черновиках.</small>
              </label>
              <div className="consent-row">
                <Checkbox
                  id="consent"
                  required
                  aria-required="true"
                  checked={consent}
                  onCheckedChange={(v) => setConsent(v === true)}
                />
                <label htmlFor="consent">
                  Согласен на обработку данных профиля.{" "}
                  <i className="required-mark" aria-hidden="true">
                    *
                  </i>{" "}
                  <button
                    type="button"
                    onClick={() =>
                      nav(
                        `/privacy?returnTo=${encodeURIComponent(`${login ? "/login" : "/register"}?role=${role}`)}`,
                      )
                    }
                  >
                    Как используются данные
                  </button>
                </label>
              </div>
              <button
                className="btn primary full brand-flow-button"
                disabled={busy || !consent}
              >
                {busy ? (
                  <LogoMotion size={20} />
                ) : (
                  <>
                    Продолжить
                    <ArrowRight size={19} />
                  </>
                )}
              </button>
            </form>
          )}
          <p className="auth-account-link">
            {login ? "Нет аккаунта? " : "Уже зарегистрированы? "}
            <a
              href={login ? `/register?role=${role}` : `/login?role=${role}`}
              onClick={(e) => {
                e.preventDefault();
                nav(login ? `/register?role=${role}` : `/login?role=${role}`);
              }}
            >
              {login ? "Зарегистрироваться здесь" : "Войти здесь"}
            </a>
          </p>
        </main>
        <AuthArtwork kind={login ? "login" : "registration"} role={role} />
      </div>
      <PublicFooter
        nav={nav}
        returnTo={`${login ? "/login" : "/register"}?role=${role}`}
      />
      <FeedbackDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        message={feedback}
        onLogin={
          !login
            ? () => {
                setDuplicateOpen(false);
                nav(`/login?role=${role}`);
              }
            : undefined
        }
        onChangeEmail={() => {
          setDuplicateOpen(false);
          setEmail("");
        }}
      />
    </div>
  );
}
