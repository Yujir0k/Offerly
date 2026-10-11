"use client";
import Link from "next/link";
import { registrationDestination } from "@/lib/registration-flow";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Users,
  Check,
  LockKeyhole,
} from "lucide-react";
import { Brand } from "./brand";
import { PublicFooter } from "./public-footer";
import { LogoMotion } from "./logo-motion";
import { SetupField, SetupSelect } from "./candidate-setup";
import { CompanyMediaUpload } from "./company-editor";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { FieldGroup } from "./ui/field";
import { Progress } from "./ui/progress";
import { SuggestionText, SuggestionTags } from "./suggestion-picker";
import { cityCatalog, skillCatalog } from "@/lib/suggestion-catalogs";
import { companySizes, companyWebsiteError } from "@/lib/employer-profile";
import { industries, type State } from "@/lib/model";
import { formatPhone, phoneError } from "@/lib/phone";
import { useDraft, DraftStatus } from "@/hooks/use-draft";
import type { Action } from "./registration";
import type { Navigate } from "./landing";
const steps = [
  {
    id: "company",
    label: "О компании",
    title: "Познакомим с вашей компанией.",
    copy: "Основные сведения помогут специалистам понять, кто их приглашает.",
    icon: Building2,
  },
  {
    id: "team",
    label: "Команда и общение",
    title: "Покажите, как вы работаете.",
    copy: "Условия, технологии и контакты — чтобы знакомство началось с главного.",
    icon: Users,
  },
];
export function CompanySetup({
  s,
  nav,
  act,
  route,
  onStateChange,
}: {
  s: State;
  nav: Navigate;
  act: Action;
  route: string;
  onStateChange: (s: State) => void;
}) {
  const [d, setD, meta] = useDraft("company", {
    ...s.company,
    values: s.company.values || [],
    benefits: s.company.benefits || [],
    technologies: s.company.technologies || [],
  });
  const index =
    new URLSearchParams(route.split("?")[1] || "").get("step") === "team"
      ? 1
      : 0;
  const step = steps[index],
    heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const websiteIssue = companyWebsiteError(d.website);
  const [previousIndex, setPreviousIndex] = useState(index);
  if (previousIndex !== index) {
    setPreviousIndex(index);
    setError("");
  }
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [index]);
  const put = <K extends keyof typeof d>(key: K, value: (typeof d)[K]) => {
    setD((current) => ({ ...current, [key]: value }));
    setError("");
  };
  async function returnToCode(ready = false) {
    setBusy(true);
    if (await meta.flush())
      nav(`/verify-email?role=employer${ready ? "&ready=1" : ""}`);
    else setError("Не удалось сохранить черновик. Повторите переход.");
    setBusy(false);
  }
  async function persist(skip = false) {
    if (busy || meta.status === "loading") return;
    setError("");
    if (skip && !s.auth?.demo && s.emailVerification.status !== "verified") {
      if (
        d.name.trim() &&
        /^\S+@\S+\.\S+$/.test(d.email) &&
        !websiteIssue &&
        !phoneError(d.phone || "")
      ) {
        const result = await act("company", d);
        if (!result) {
          setError(
            "Не удалось сохранить данные компании. Повторите сохранение.",
          );
          return;
        }
        if (
          result.auth?.demo ||
          result.emailVerification.status === "verified"
        ) {
          nav(registrationDestination(result, "employer"));
          return;
        }
      }
      await returnToCode(true);
      return;
    }
    if (websiteIssue) {
      if (index === 1) nav("/onboarding/employer?step=company");
      return;
    }
    if (
      !skip &&
      (!d.name.trim() ||
        !d.description.trim() ||
        !d.industry ||
        !d.size ||
        !d.city)
    ) {
      setError(
        "Заполните название, описание, сферу, размер команды и город компании.",
      );
      return;
    }
    if (
      !skip &&
      (!/^\S+@\S+\.\S+$/.test(d.email) || phoneError(d.phone || ""))
    ) {
      setError(
        phoneError(d.phone || "") || "Укажите корректный email для связи.",
      );
      return;
    }
    setBusy(true);
    if (!(await meta.flush())) {
      setError("Не удалось сохранить черновик. Повторите переход.");
      setBusy(false);
      return;
    }
    let saved = s;
    if (d.name.trim() && /^\S+@\S+\.\S+$/.test(d.email)) {
      const result = await act("company", d);
      if (!result) {
        setError("Проверьте данные компании и повторите сохранение.");
        setBusy(false);
        return;
      }
      saved = result;
    }
    setBusy(false);
    nav(
      skip || index === 1
        ? registrationDestination(saved, "employer")
        : "/onboarding/employer?step=team",
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void persist();
  };
  return (
    <div className="registration-page auth-refresh candidate-setup employer-setup">
      <header className="registration-header">
        <Link
          href="/"
          onClick={(e) => {
            e.preventDefault();
            nav("/");
          }}
        >
          <Brand />
        </Link>
        <button className="back-home" onClick={() => nav("/")}>
          <ArrowLeft />
          На главную
        </button>
      </header>
      <div className="setup-layout">
        <main className="registration-content auth-card setup-card">
          <div className="setup-progress-heading">
            <span className="mono">ПРОФИЛЬ ВАШЕЙ КОМПАНИИ</span>
            <span className="mono">0{index + 1} / 02</span>
          </div>
          <Progress value={index * 50} aria-label={`Шаг ${index + 1} из 2`} />
          <div className="setup-step-content" key={step.id}>
            <h1 ref={heading} tabIndex={-1}>
              {step.title}
            </h1>
            <p className="setup-lead">{step.copy}</p>
            <DraftStatus meta={meta} />
            <form className="setup-form" noValidate onSubmit={submit}>
              <FieldGroup>
                {index === 0 ? (
                  <>
                    <SetupField
                      id="setup-company-name"
                      label="Название компании"
                      required
                    >
                      <Input
                        id="setup-company-name"
                        maxLength={150}
                        value={d.name}
                        onChange={(e) => put("name", e.target.value)}
                        placeholder="Как называется ваша команда"
                      />
                    </SetupField>
                    <SetupField
                      id="setup-company-tagline"
                      label="Коротко о компании"
                      hint="Одна фраза о том, что вы создаёте."
                    >
                      <Input
                        id="setup-company-tagline"
                        maxLength={200}
                        value={d.tagline || ""}
                        onChange={(e) => put("tagline", e.target.value)}
                        placeholder="Например, делаем городские сервисы удобнее"
                      />
                    </SetupField>
                    <FieldGroup className="setup-two">
                      <SetupSelect
                        id="setup-company-industry"
                        label="Сфера компании"
                        value={d.industry || ""}
                        options={industries}
                        change={(v) => put("industry", v)}
                      />
                      <SetupSelect
                        id="setup-company-size"
                        label="Размер команды"
                        value={d.size || ""}
                        options={companySizes}
                        change={(v) => put("size", v)}
                      />
                    </FieldGroup>
                    <SetupField
                      id="setup-company-city"
                      label="Город компании"
                      required
                    >
                      <SuggestionText
                        id="setup-company-city"
                        dark
                        value={d.city || ""}
                        onChange={(v) => put("city", v)}
                        catalog={cityCatalog}
                        placeholder="Город или регион"
                      />
                    </SetupField>
                    <SetupField
                      id="setup-company-description"
                      label="О компании"
                      required
                      hint="Расскажите о продукте, клиентах и задачах вашей команды."
                    >
                      <Textarea
                        id="setup-company-description"
                        rows={4}
                        maxLength={6000}
                        value={d.description}
                        onChange={(e) => put("description", e.target.value)}
                        placeholder="Что делаете и для кого"
                      />
                    </SetupField>
                    <SetupField
                      id="setup-company-website"
                      label="Сайт компании"
                    >
                      <Input
                        id="setup-company-website"
                        type="url"
                        aria-invalid={!!websiteIssue}
                        aria-describedby={
                          websiteIssue
                            ? "setup-company-website-error"
                            : undefined
                        }
                        value={d.website}
                        onChange={(e) => put("website", e.target.value)}
                        placeholder="https://company.ru"
                      />
                      {websiteIssue && (
                        <p
                          id="setup-company-website-error"
                          className="setup-error"
                          role="alert"
                        >
                          {websiteIssue}
                        </p>
                      )}
                    </SetupField>
                  </>
                ) : (
                  <>
                    <SetupField
                      id="setup-company-culture"
                      label="Как работает ваша команда"
                    >
                      <Textarea
                        id="setup-company-culture"
                        rows={3}
                        maxLength={5000}
                        value={d.culture || ""}
                        onChange={(e) => put("culture", e.target.value)}
                        placeholder="Формат работы, коммуникация и развитие"
                      />
                    </SetupField>
                    <SetupField
                      id="setup-company-technologies"
                      label="Технологии команды"
                      hint="Можно выбрать несколько или добавить свой вариант."
                    >
                      <SuggestionTags
                        id="setup-company-technologies"
                        dark
                        value={d.technologies || []}
                        catalog={skillCatalog}
                        maxSelected={30}
                        onChange={(v) => put("technologies", v)}
                      />
                    </SetupField>
                    <SetupField
                      id="setup-company-hiring"
                      label="Как проходит знакомство с кандидатом"
                    >
                      <Textarea
                        id="setup-company-hiring"
                        rows={3}
                        maxLength={3000}
                        value={d.hiringProcess || ""}
                        onChange={(e) => put("hiringProcess", e.target.value)}
                        placeholder="Встреча с рекрутером, разговор с командой, предложение"
                      />
                    </SetupField>
                    <FieldGroup className="setup-two">
                      <SetupField
                        id="setup-company-contact"
                        label="Контактное лицо"
                      >
                        <Input
                          id="setup-company-contact"
                          maxLength={120}
                          value={d.contactName || ""}
                          onChange={(e) => put("contactName", e.target.value)}
                          placeholder="Имя или роль"
                        />
                      </SetupField>
                      <SetupField
                        id="setup-company-email"
                        label="Email для связи"
                        required
                      >
                        <Input
                          id="setup-company-email"
                          type="email"
                          maxLength={200}
                          value={d.email}
                          onChange={(e) => put("email", e.target.value)}
                        />
                      </SetupField>
                    </FieldGroup>
                    <SetupField
                      id="setup-company-phone"
                      label="Телефон компании"
                      hint="Необязательно. Используйте международный формат."
                    >
                      <Input
                        id="setup-company-phone"
                        type="tel"
                        maxLength={24}
                        value={d.phone || ""}
                        onChange={(e) =>
                          put("phone", formatPhone(e.target.value))
                        }
                        placeholder="+7 (999) 999-99-99"
                      />
                    </SetupField>
                    <CompanyMediaUpload
                      kind="logo"
                      s={s}
                      onStateChange={onStateChange}
                    />
                    <p className="setup-note">
                      <LockKeyhole />
                      Обложку, фотографии, продукты и преимущества можно
                      добавить позже в разделе «Моя компания».
                    </p>
                  </>
                )}
              </FieldGroup>
              {error && (
                <p className="setup-error" role="alert">
                  {error}
                </p>
              )}
              <div className="setup-actions">
                <div className="setup-secondary-actions">
                  {index > 0 && (
                    <button
                      className="btn auth-demo-button"
                      type="button"
                      disabled={busy}
                      onClick={() => nav("/onboarding/employer?step=company")}
                    >
                      <ArrowLeft />
                      Назад
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn auth-demo-button setup-skip-button"
                    disabled={busy || meta.status === "loading"}
                    onClick={() => void persist(true)}
                  >
                    Пропустить
                  </button>
                </div>
                <button
                  className="btn primary brand-flow-button"
                  disabled={busy || meta.status === "loading"}
                >
                  {busy ? (
                    <LogoMotion size={20} />
                  ) : (
                    <>
                      {index === 1 ? "Сохранить и продолжить" : "Продолжить"}
                      <ArrowRight />
                    </>
                  )}
                </button>
              </div>
              {!s.auth?.demo && s.emailVerification.status !== "verified" && (
                <button
                  type="button"
                  className="text-link setup-return-code"
                  disabled={busy || meta.status === "loading"}
                  onClick={() => void returnToCode()}
                >
                  <ArrowLeft size={16} /> Вернуться к вводу кода
                </button>
              )}
            </form>
          </div>
        </main>
        <aside className="setup-aside">
          <div className="setup-aside-intro">
            <h2>
              {index === 0
                ? "Ваша команда — ваше преимущество."
                : "Сильные команды начинаются со знакомства."}
            </h2>
            <p>
              {index === 0
                ? "Помогите специалисту увидеть смысл вашей работы ещё до первого разговора."
                : "Расскажите об атмосфере и процессе найма, чтобы ожидания совпали."}
            </p>
          </div>
          <div className="setup-illustration">
            <img
              src={`/illustrations/onboarding-employer-${index === 0 ? "company" : "team"}.png`}
              alt={
                index === 0
                  ? "Основатели создают профиль компании"
                  : "Рекрутер и руководитель знакомятся с будущей командой"
              }
              width={1280}
              height={1280}
            />
          </div>
          <ol>
            {steps.map((v, i) => (
              <li key={v.id} aria-current={i === index ? "step" : undefined}>
                <button
                  type="button"
                  disabled={i > index || busy}
                  onClick={() => nav(`/onboarding/employer?step=${v.id}`)}
                >
                  <span className="setup-step-icon">
                    {i < index ? <Check /> : <v.icon />}
                  </span>
                  <span>
                    <small>ШАГ 0{i + 1}</small>
                    {v.label}
                  </span>
                  {i === index && <ArrowRight />}
                </button>
              </li>
            ))}
          </ol>
          <div className="setup-aside-note">
            <LockKeyhole />
            <p>
              Профиль компании помогает кандидату принять осознанное решение.
              Данные можно обновить в кабинете.
            </p>
          </div>
        </aside>
      </div>
      <PublicFooter
        nav={nav}
        returnTo={`/onboarding/employer?step=${step.id}`}
      />
    </div>
  );
}
