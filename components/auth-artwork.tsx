"use client";
import {
  Award,
  ArrowUpRight,
  Mail,
  Fingerprint,
  Users,
  BriefcaseBusiness,
  CircleAlert,
  Clock3,
  PartyPopper,
  Building2,
} from "lucide-react";
export function AuthArtwork({
  kind,
  role = "candidate",
  state = "waiting",
}: {
  kind: "registration" | "login" | "email";
  role?: string;
  state?: string;
}) {
  const employer = role === "employer";
  const emailStates = {
    waiting: {
      title: "Один шаг до знакомства.",
      copy: "Профессиональные возможности начинаются с простого контакта.",
      chip: "Письмо открывает знакомство",
      icon: Mail,
    },
    error: {
      title: "Всё можно исправить.",
      copy: "Проверьте код или запросите новый — ваши данные сохранятся.",
      chip: "Знакомство не отменяется",
      icon: CircleAlert,
    },
    expired: {
      title: "Запросим новый код.",
      copy: "Получите новый код и вернитесь к следующему шагу.",
      chip: "Новый код — новый шаг",
      icon: Clock3,
    },
    success: {
      title: employer ? "Команда становится ближе." : "Впереди — ваше дело.",
      copy: employer
        ? "Следующий шаг — рассказать о команде и её задачах."
        : "Следующий шаг — рассказать о себе и подтвердить навыки.",
      chip: "Можно двигаться дальше",
      icon: PartyPopper,
    },
  };
  const emailState =
    emailStates[state as keyof typeof emailStates] || emailStates.waiting;
  const ArtworkIcon =
    kind === "email"
      ? emailState.icon
      : kind === "login"
        ? Fingerprint
        : employer
          ? Building2
          : Award;
  const imageName =
    kind === "email"
      ? employer || state !== "waiting"
        ? `email-${role}-${state}`
        : "email"
      : employer
        ? `${kind}-employer`
        : kind;
  const title =
    kind === "login"
      ? employer
        ? "Ваша команда — рядом."
        : "Ваше дело — ближе."
      : kind === "email"
        ? emailState.title
        : employer
          ? "Ваша следующая команда."
          : "Навыки. Люди. Ваше дело.";
  const copy =
    kind === "login"
      ? employer
        ? "Подборки, приглашения и переписка — в вашем кабинете."
        : "Приглашения, результаты и переписка — в вашем кабинете."
      : kind === "email"
        ? emailState.copy
        : employer
          ? "Найдите людей, чьи навыки подходят вашим задачам."
          : "Покажите, что умеете. Встретьте команду, которой это нужно.";
  return (
    <aside className={`auth-artwork artwork-${kind}`} aria-label="О платформе">
      <div className="artwork-orbit orbit-one" />
      <div className="artwork-orbit orbit-two" />
      <div className="artwork-heading">
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      <div className="artwork-scene">
        <img
          src={`/illustrations/auth-${imageName}.webp`}
          alt={
            kind === "registration"
              ? "Специалисты знакомятся и собираются в команду"
              : kind === "login"
                ? "Специалист возвращается в своё рабочее пространство"
                : state === "expired"
                  ? "Обновление кода: часы и календарь"
                  : state === "error"
                    ? "Специалисты восстанавливают соединение"
                    : state === "success"
                      ? "Специалисты готовы к следующему шагу"
                      : "Специалисты рядом с письмом и ноутбуком"
          }
          width={1024}
          height={1024}
        />
        <span className="artwork-chip chip-top">
          <ArtworkIcon size={18} />
          {kind === "email"
            ? emailState.chip
            : kind === "login"
              ? "Ваше пространство"
              : employer
                ? "Подбор начинается с задач"
                : "Навыки говорят за вас"}
        </span>
        <span className="artwork-chip chip-bottom">
          {employer ? <Users size={18} /> : <BriefcaseBusiness size={18} />}
          {employer ? "Люди для ваших задач" : "Условия до первого разговора"}
          <ArrowUpRight size={16} />
        </span>
      </div>
      <div className="artwork-footnote">
        <span />
        <p>
          {kind === "email"
            ? "Контакты открываются по вашему решению."
            : "Знакомство начинается с совпадения по делу."}
        </p>
      </div>
    </aside>
  );
}
