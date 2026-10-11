"use client";
import {
  ArrowRight,
  BriefcaseBusiness,
  Inbox,
  Users,
  Send,
  Plus,
} from "lucide-react";
import type { State } from "@/lib/model";
import { money } from "@/lib/model";
import { ownsJob, applicationLabel } from "@/lib/job-applications";
import { publishedJob } from "@/lib/employer-profile";
import { CompanyMark } from "./employer-ui";
import { displayDate } from "@/lib/account-settings";
import type { Navigate } from "./landing";
export function EmployerOverview({ s, nav }: { s: State; nav: Navigate }) {
  const jobs = s.jobs.filter((j) => ownsJob(j, s)),
    active = jobs.filter(publishedJob);
  const go = (page: string) => nav(`/demo/employer/${page}`);
  const metrics = [
    ["Вакансии в поиске", s.catalogStats?.published ?? active.length, "jobs", BriefcaseBusiness],
    ["Входящие отклики", s.applications.length, "jobs", Send],
    [
      "Ожидаем ответа",
      s.invitations.filter((i) => ["sent", "viewed"].includes(i.status)).length,
      "invitations",
      Inbox,
    ],
    ["Сохранённые кандидаты", s.saved.length, "candidates", Users],
  ] as const;
  return (
    <div className="employer-content employer-overview">
      <section className="activity-profile">
        <div className="activity-profile-person">
          <CompanyMark company={s.company} />
          <div>
            <span className="activity-eyebrow">ВАША КОМАНДА</span>
            <h2>{s.company.name || "Расскажите о вашей компании"}</h2>
            <p>
              {s.company.tagline ||
                "Профиль компании помогает специалисту оценить предложение"}
            </p>
            <div className="company-facts">
              {[s.company.industry, s.company.size, s.company.city]
                .filter(Boolean)
                .map((v) => (
                  <span key={v}>{v}</span>
                ))}
            </div>
          </div>
        </div>
        <button
          className="employer-button primary"
          onClick={() => go("company")}
        >
          Редактировать компанию
          <ArrowRight size={17} />
        </button>
      </section>
      <div className="activity-metrics">
        {metrics.map(([label, count, target, Icon]) => (
          <button
            key={label}
            className="activity-metric"
            onClick={() => go(target)}
          >
            <span>
              <Icon size={19} />
              {label}
              <ArrowRight size={15} />
            </span>
            <strong>{count}</strong>
            <small>Открыть раздел</small>
          </button>
        ))}
      </div>
      <div className="employer-overview-columns">
        <section className="employer-panel">
          <div className="employer-panel-heading">
            <h2>Последние отклики</h2>
            <button className="employer-link" onClick={() => go("jobs")}>
              Все отклики
              <ArrowRight size={16} />
            </button>
          </div>
          {s.applications.length ? (
            s.applications
              .slice()
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 4)
              .map((a) => {
                const job = s.jobs.find((j) => j.id === a.jobId);
                return (
                  <div className="employer-activity-row" key={a.id || a.jobId}>
                    <span className="employer-candidate-symbol">
                      <Users size={20} />
                    </span>
                    <div>
                      <strong>
                        {a.candidate?.name || `Кандидат #${a.candidateId}`}
                      </strong>
                      <p>
                        {job?.title || "Вакансия"} ·{" "}
                        {displayDate(a.createdAt, s)}
                      </p>
                    </div>
                    <span className="employer-status">
                      {applicationLabel(a.status)}
                    </span>
                  </div>
                );
              })
          ) : (
            <div className="employer-empty compact">
              <Send size={27} />
              <h3>Откликов пока нет</h3>
              <p>После публикации здесь появятся заявки специалистов.</p>
              <button className="employer-link" onClick={() => go("jobs")}>
                К вакансиям
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </section>
        <section className="employer-panel">
          <div className="employer-panel-heading">
            <h2>Ваши приглашения</h2>
            <button className="employer-link" onClick={() => go("invitations")}>
              Все предложения
              <ArrowRight size={16} />
            </button>
          </div>
          {s.invitations.length ? (
            s.invitations.slice(0, 4).map((i) => (
              <div className="employer-activity-row" key={i.id}>
                <span className="employer-candidate-symbol">
                  <Inbox size={20} />
                </span>
                <div>
                  <strong>{i.title}</strong>
                  <p>
                    Кандидат #{i.candidateId} · {money(i.min)} — {money(i.max)}{" "}
                    ₽
                  </p>
                </div>
                <span className="employer-status">
                  {i.status === "accepted"
                    ? "Принято"
                    : i.status === "cancelled"
                      ? "Отменено"
                    : i.status === "declined"
                      ? "Отклонено"
                      : i.status === "viewed"
                        ? "Прочитано"
                        : "Отправлено"}
                </span>
              </div>
            ))
          ) : (
            <div className="employer-empty compact">
              <Inbox size={27} />
              <h3>Начните знакомство с кандидатом</h3>
              <p>
                Выберите специалиста по проверенным навыкам и отправьте
                предложение с зарплатой.
              </p>
              <button
                className="employer-link"
                onClick={() => go("candidates")}
              >
                Найти кандидатов
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </section>
      </div>
      <section className="employer-panel">
        <div className="employer-panel-heading">
          <h2>Подборки под задачи команды</h2>
          <button className="employer-link" onClick={() => go("needs")}>
            Все подборки
            <ArrowRight size={16} />
          </button>
        </div>
        {s.needs.length ? (
          <div className="employer-overview-needs">
            {s.needs.slice(0, 3).map((n) => (
              <button key={n.id} onClick={() => go(`candidates?need=${n.id}`)}>
                <strong>{n.title}</strong>
                <span>
                  {n.specialty} · {n.grade}
                </span>
                <small>{n.skills.join(" · ")}</small>
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
        ) : (
          <div className="employer-empty compact">
            <BriefcaseBusiness size={27} />
            <h3>Сохраните потребность команды</h3>
            <p>
              Подборка помогает возвращаться к поиску с заданной специализацией,
              уровнем и стеком.
            </p>
            <button className="employer-button" onClick={() => go("needs")}>
              <Plus size={16} />
              Создать подборку
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
