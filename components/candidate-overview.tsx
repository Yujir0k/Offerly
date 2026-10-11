"use client";
import {
  ArrowRight,
  Bookmark,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileText,
  Inbox,
  LockKeyhole,
  MapPin,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { State } from "@/lib/model";
import { money } from "@/lib/model";
import { profileCompletion } from "@/lib/profile-completion";
import {
  candidateDashboard,
  dashboardActivity,
} from "@/lib/candidate-dashboard";
import { profileStatus } from "@/lib/profile-identity";
import { invitationUnread } from "@/lib/invitations";
import { demoEmployers } from "@/lib/vacancy-catalog";
import { vacancyDate, vacancyMatch } from "@/lib/vacancy-search";
import { seedDraft } from "@/hooks/use-draft";
import { ProfileAvatar } from "./profile-avatar";
import { Progress } from "./ui/progress";
import { accountNotifications, displayDate } from "@/lib/account-settings";
import type { Action } from "./registration";
import { useState } from "react";
import { applicationStatus, applicationLabel } from "@/lib/job-applications";
import type { Navigate } from "./landing";
function CompanyLogo({ company, logo }: { company: string; logo?: string }) {
  const src =
    logo || Object.values(demoEmployers).find((c) => c.name === company)?.logo;
  return (
    <span className="activity-company-logo">
      {src ? <img src={src} alt={`Логотип ${company}`} /> : <Inbox size={20} />}
    </span>
  );
}
const applicationLabels: Record<string, string> = {
  sent: "Отправлен",
  viewed: "Просмотрен",
  declined: "Отказ",
};
export function CandidateOverview({
  s,
  nav,
  act,
}: {
  s: State;
  nav: Navigate;
  act: Action;
}) {
  const [reading, setReading] = useState(false);
  const notifications = accountNotifications(s);
  const p = s.profile,
    completion = profileCompletion(p);
  const { participating, status, next } = candidateDashboard(s, completion);
  const a = dashboardActivity(s);
  const go = (target: string) => nav(`/demo/candidate/${target}`);
  const edit = () =>
    void seedDraft("profile:ui", { tab: "personal" })
      .catch(() => {})
      .then(() => go("profile"));
  const pending = a.invitations.filter((i) =>
    ["sent", "viewed"].includes(i.status),
  );
  const invitationRows = [
    ...pending.filter(invitationUnread),
    ...pending.filter((i) => !invitationUnread(i)),
  ].slice(0, 3);
  const jobs = (a.recent.length ? a.recent : a.opportunities).slice(0, 3);
  const metrics = [
    {
      label: "Приглашения",
      count: a.invitations.length,
      detail: `${a.unread} непрочитанных · ${a.waiting} ждут ответа`,
      icon: Inbox,
      target: "invitations",
    },
    {
      label: "Мои отклики",
      count: a.applications.length,
      detail: "Все отправленные заявки",
      icon: Send,
      target: "jobs?view=applications",
    },
    {
      label: "Отклики просмотрены",
      count: a.reviewed,
      detail: `${a.declined} с отказом`,
      icon: Eye,
      target: "jobs?view=applications",
    },
    {
      label: "Свежие вакансии",
      count: s.catalogStats?.recent ?? a.recent.length,
      detail: "По вашим предпочтениям · за 7 дней",
      icon: Sparkles,
      target: "jobs?view=recent",
    },
  ];
  return (
    <div className="candidate-dashboard candidate-activity">
      <section className="activity-profile" aria-label="Ваш профиль">
        <div className="activity-profile-person">
          <ProfileAvatar profile={p} />
          <div>
            <span className="activity-eyebrow">ВАШ ПРОФИЛЬ</span>
            <h2>{p.name || "Добавьте имя в профиль"}</h2>
            <p>{p.headline || p.roles[0] || "Укажите профессию или роль"}</p>
            <div className="activity-profile-meta">
              <span>
                <MapPin size={15} />
                {[p.city, p.country].filter(Boolean).join(", ") ||
                  "Город не указан"}
              </span>
              <span className="activity-search-status">{profileStatus(p)}</span>
            </div>
          </div>
        </div>
        <div className="activity-profile-side">
          <div className="activity-profile-completion">
            <span>
              Профиль заполнен <b>{completion.percent}%</b>
            </span>
            <Progress
              value={completion.percent}
              aria-label={`Профиль заполнен на ${completion.percent}%`}
            />
          </div>
          <div className="activity-profile-buttons">
            <button
              className="activity-button primary"
              onClick={() => go("profile-view")}
            >
              Посмотреть профиль
              <ArrowRight size={16} />
            </button>
            <button className="activity-button" onClick={edit}>
              Редактировать
            </button>
          </div>
        </div>
      </section>
      <div className="activity-metrics" aria-label="Сводка поиска работы">
        {metrics.map(({ label, count, detail, icon: Icon, target }) => (
          <button
            key={label}
            className="activity-metric"
            onClick={() => go(target)}
          >
            <span>
              <Icon size={19} />
              {label}
              <ChevronRight size={15} />
            </span>
            <strong>{count}</strong>
            <small>{detail}</small>
          </button>
        ))}
      </div>
      <div className="activity-columns">
        <div className="activity-main">
          <section className="activity-panel">
            <div className="activity-panel-heading">
              <div>
                <h2>Кто приглашает вас</h2>
                <p>Предложения компаний, на которые можно ответить</p>
              </div>
              <button
                className="activity-link"
                onClick={() => go("invitations")}
              >
                Все приглашения
                <ArrowRight size={16} />
              </button>
            </div>
            {invitationRows.length ? (
              <div className="activity-list">
                {invitationRows.map((i) => (
                  <article
                    className={`activity-invitation ${invitationUnread(i) ? "is-new" : ""}`}
                    key={i.id}
                  >
                    <CompanyLogo company={i.company} />
                    <div className="activity-row-body">
                      <div className="activity-row-title">
                        <strong>{i.company}</strong>
                        <span
                          className={`activity-badge ${invitationUnread(i) ? "purple" : ""}`}
                        >
                          {invitationUnread(i) ? "Новое" : "Ожидает ответа"}
                        </span>
                      </div>
                      <h3>{i.title}</h3>
                      <b className="activity-salary">
                        {money(i.min)} — {money(i.max)} ₽/мес
                      </b>
                      <p>
                        {[i.format, i.city].filter(Boolean).join(" · ") ||
                          "Условия внутри приглашения"}
                      </p>
                    </div>
                    <button
                      className="activity-icon-button"
                      onClick={() => go("invitations")}
                      aria-label={`Посмотреть приглашение от ${i.company}`}
                    >
                      <ArrowRight size={19} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="activity-empty">
                <Inbox size={26} />
                <h3>
                  {a.invitations.length
                    ? "Все предложения разобраны"
                    : "Приглашений пока нет"}
                </h3>
                <p>
                  {participating
                    ? "Ваш профиль участвует в подборе. Новые предложения компаний появятся здесь."
                    : "Чтобы компании находили вас в подборе, заполните профиль, подтвердите навыки и включите видимость."}
                </p>
                <button
                  className="activity-link"
                  onClick={() => go("invitations")}
                >
                  Открыть приглашения
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </section>
          <section className="activity-panel">
            <div className="activity-panel-heading">
              <div>
                <h2>Что происходит с откликами</h2>
                <p>Последние заявки и текущие статусы компаний</p>
              </div>
              <button
                className="activity-link"
                onClick={() => go("jobs?view=applications")}
              >
                Все отклики
                <ArrowRight size={16} />
              </button>
            </div>
            {a.applications.length ? (
              <div className="activity-list">
                {a.applications.slice(0, 3).map((app) => {
                  const job = s.jobs.find((j) => j.id === app.jobId);
                  return (
                    <article
                      className="activity-application"
                      key={app.id || app.jobId}
                    >
                      <CompanyLogo
                        company={job?.company || "Компания"}
                        logo={job?.logo}
                      />
                      <div className="activity-row-body">
                        <strong>{job?.company || "Компания"}</strong>
                        <h3>{job?.title || "Вакансия недоступна"}</h3>
                        <p>
                          Обновлено{" "}
                          {displayDate(app.updatedAt || app.createdAt, s)}
                        </p>
                      </div>
                      <span
                        className={`activity-badge ${applicationStatus(app.status) === "viewed" ? "purple" : applicationStatus(app.status) === "declined" ? "red" : ""}`}
                      >
                        {applicationLabel(app.status)}
                      </span>
                      {job && (
                        <button
                          className="activity-icon-button"
                          onClick={() =>
                            go(`jobs?job=${encodeURIComponent(job.id)}`)
                          }
                          aria-label={`Открыть отклик на ${job.title}`}
                        >
                          <ArrowRight size={19} />
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="activity-empty compact">
                <Send size={24} />
                <div>
                  <h3>Вы пока не отправляли отклики</h3>
                  <p>
                    Выберите вакансию самостоятельно. Здесь сохранятся заявки и
                    их статусы.
                  </p>
                </div>
                <button className="activity-link" onClick={() => go("jobs")}>
                  К вакансиям
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </section>
          <section className="activity-panel">
            <div className="activity-panel-heading">
              <div>
                <h2>
                  {a.recent.length
                    ? "Новые интересные варианты"
                    : "Варианты по вашим предпочтениям"}
                </h2>
                <p>Учитываем направление, зарплату, сферу и формат работы</p>
              </div>
              <button className="activity-link" onClick={() => go("jobs")}>
                Все вакансии
                <ArrowRight size={16} />
              </button>
            </div>
            {jobs.length ? (
              <div className="activity-vacancies">
                {jobs.map((job) => {
                  const match = vacancyMatch(job, p);
                  return (
                    <article className="activity-vacancy" key={job.id}>
                      <div className="activity-vacancy-top">
                        <CompanyLogo company={job.company} logo={job.logo} />
                        <div>
                          <strong>{job.company}</strong>
                          <small>{vacancyDate(job)}</small>
                        </div>
                        {a.recent.some((j) => j.id === job.id) && (
                          <span className="activity-badge purple">Новое</span>
                        )}
                      </div>
                      <h3>{job.title}</h3>
                      <b className="activity-salary">
                        {money(job.min)} — {money(job.max)} ₽/мес
                      </b>
                      <p>
                        {[job.grade, job.format, job.city]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <div className="activity-match">
                        <CheckCircle2 size={15} />
                        {match.matched.length
                          ? `Совпали проверенные навыки: ${match.matched.slice(0, 2).join(", ")}`
                          : "Совпадает выбранное направление"}
                      </div>
                      <button
                        className="activity-link"
                        onClick={() =>
                          go(`jobs?job=${encodeURIComponent(job.id)}`)
                        }
                      >
                        Посмотреть вакансию
                        <ArrowRight size={16} />
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="activity-empty compact">
                <Sparkles size={25} />
                <div>
                  <h3>Подходящих вариантов пока нет</h3>
                  <p>Расширьте предпочтения или посмотрите весь каталог.</p>
                </div>
                <button className="activity-link" onClick={() => go("jobs")}>
                  Открыть каталог
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
            <button
              className="activity-saved-link"
              onClick={() => go("jobs?view=favorites")}
            >
              <Bookmark size={16} />
              Избранные вакансии<b>{s.favoriteJobs.length}</b>
              <ArrowRight size={16} />
            </button>
          </section>
        </div>
        <aside className="activity-aside">
          <section className="activity-panel activity-updates">
            <span className="activity-eyebrow">ОБНОВЛЕНИЯ</span>
            <h2>Уведомления</h2>
            {notifications.length ? (
              <>
                <div className="activity-notifications">
                  {notifications.map((event) => (
                    <button
                      className="activity-link"
                      key={event.key}
                      onClick={() => go(event.target)}
                    >
                      {event.label}
                      <b>{event.count}</b>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
                <button
                  className="activity-link"
                  disabled={reading}
                  onClick={async () => {
                    setReading(true);
                    await act("notifications-read");
                    setReading(false);
                  }}
                >
                  Отметить просмотренным
                  <CheckCircle2 size={15} />
                </button>
              </>
            ) : (
              <p>
                Новых уведомлений нет. Приглашения, заявки и результаты всегда
                доступны в своих разделах.
              </p>
            )}
            <button className="activity-link" onClick={() => go("settings")}>
              Настроить уведомления
              <ArrowRight size={15} />
            </button>
          </section>
          <section className="activity-panel activity-search">
            <span className="activity-eyebrow">УЧАСТИЕ В ПОДБОРЕ</span>
            <h2>{status.title}</h2>
            <p>{status.text}</p>
            <button
              className="activity-link"
              onClick={() =>
                status.target === "personal" ? edit() : go(status.target)
              }
            >
              {status.target === "settings"
                ? "Настроить видимость"
                : status.target === "assessment"
                  ? "Выбрать проверку"
                  : "Дополнить профиль"}
              <ArrowRight size={16} />
            </button>
            <div className="activity-privacy">
              <LockKeyhole size={17} />
              <span>
                Контакты открываются конкретной компании после вашего согласия
                или отклика.
              </span>
            </div>
          </section>
          <section className="activity-panel">
            <ShieldCheck className="activity-accent" size={25} />
            <h2>Ваша категория</h2>
            <strong className="activity-category">
              {p.grade ? `${p.specialty} · ${p.grade}` : "Пока не подтверждена"}
            </strong>
            <p>
              {p.grade
                ? `Результат подтверждения: ${p.score}%. Категория отделена от самооценки в резюме.`
                : `В профиле указан ${p.claimed}. Подтвердите уровень в профессиональном испытании.`}
            </p>
            <button
              className="activity-link"
              onClick={() => go(p.grade ? "results" : "assessment")}
            >
              {p.grade ? "Результаты проверки" : "Подтвердить навыки"}
              <ArrowRight size={16} />
            </button>
          </section>
          <section className="activity-panel activity-next">
            <FileText size={23} />
            <span className="activity-eyebrow">СЛЕДУЮЩИЙ ШАГ</span>
            <h2>{next.title}</h2>
            <p>{next.text}</p>
            <button
              className="activity-button primary"
              onClick={() =>
                next.target === "personal" ? edit() : go(next.target)
              }
            >
              {next.button}
              <ArrowRight size={16} />
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}
