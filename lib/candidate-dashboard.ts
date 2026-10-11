import type { State } from "./model";
import type { profileCompletion } from "./profile-completion";
import { invitationUnread } from "./invitations";
import { vacancyMatch } from "./vacancy-search";
import { salaryRangeError } from "./salary-range";
import { applicationStatus } from "./job-applications";

export function dashboardActivity(s: State, now = Date.now()) {
  const p = s.profile;
  const invitations = s.invitations
    .filter((i) => i.candidateId === p.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const applications = s.applications
    .filter((a) => a.candidateId === undefined || a.candidateId === p.id)
    .sort((a, b) =>
      (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
    );
  const applied = new Set(applications.map((a) => a.jobId));
  const salaryValid = !salaryRangeError(p.salaryMin, p.salaryMax);
  const opportunities = s.jobs
    .filter((job) => {
      if (job.status && job.status !== "published") return false;
      if (applied.has(job.id) || job.specialty !== p.specialty) return false;
      if (
        p.formats?.length &&
        !p.formats.includes("Любой") &&
        !p.formats.includes(job.format)
      )
        return false;
      if (
        p.employmentTypes?.length &&
        job.employment &&
        !p.employmentTypes.includes(job.employment)
      )
        return false;
      if (
        p.preferredIndustries?.length &&
        !p.preferredIndustries.includes(job.industry || "")
      )
        return false;
      return !salaryValid || (job.max >= p.salaryMin && job.min <= p.salaryMax);
    })
    .sort(
      (a, b) =>
        vacancyMatch(b, p).score - vacancyMatch(a, p).score ||
        Date.parse(b.publishedAt || "1970-01-01") -
          Date.parse(a.publishedAt || "1970-01-01"),
    );
  const recent = opportunities
    .filter((job) => {
      const age = now - Date.parse(job.publishedAt || "");
      return age >= 0 && age <= 7 * 86400000;
    })
    .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  return {
    invitations,
    unread: invitations.filter(invitationUnread).length,
    waiting: invitations.filter((i) => ["sent", "viewed"].includes(i.status))
      .length,
    applications,
    reviewed: applications.filter(
      (a) => applicationStatus(a.status) === "viewed",
    ).length,
    declined: applications.filter(
      (a) => applicationStatus(a.status) === "declined",
    ).length,
    recent,
    opportunities,
  };
}

export function candidateDashboard(
  s: State,
  completion: ReturnType<typeof profileCompletion>,
) {
  const p = s.profile;
  const invitations = s.invitations
    .filter(
      (i) => i.candidateId === p.id && ["sent", "viewed"].includes(i.status),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeAttempt = s.attempts.find((a) => !a.completedAt);
  const participating = !!(
    p.visible &&
    p.consent &&
    p.grade &&
    p.jobStatus !== "paused" &&
    completion.ready
  );
  const missing = completion.required.filter((f) => !f.done);
  const status =
    p.jobStatus === "paused"
      ? {
          title: "Поиск на паузе",
          text: "Профиль не участвует в подборе. Возобновите поиск, когда будете готовы.",
          target: "personal",
        }
      : !p.visible
        ? {
            title: "Профиль скрыт",
            text: "Включите видимость в настройках, когда захотите получать приглашения.",
            target: "settings",
          }
        : !completion.ready
          ? {
              title: "Готовим профиль к подбору",
              text: "Добавьте основные данные и согласие на участие. Все вкладки уже доступны.",
              target: "personal",
            }
          : !p.grade
            ? {
                title: "Осталось подтвердить уровень",
                text: "После проверки работодатели смогут находить вас по подтверждённой категории.",
                target: "assessment",
              }
            : {
                title: "Участвуете в подборе",
                text: "Работодатели могут найти ваш профиль и отправить предложение с зарплатой.",
                target: "settings",
              };
  const next = invitations.length
    ? {
        title: "Вам пришло приглашение",
        text: "Посмотрите компанию, условия и зарплату — решение о знакомстве за вами.",
        button: "Посмотреть",
        target: "invitations",
        kind: "invitation",
      }
    : activeAttempt
      ? {
          title: "Продолжите проверку уровня",
          text: "Ваши ответы сохранены. Можно вернуться к начатой проверке.",
          button: "Продолжить",
          target: "assessment",
          kind: "assessment",
        }
      : !completion.ready
        ? {
            title: "Добавьте основу профиля",
            text: `Для участия в подборе осталось заполнить ${missing.length} из ${completion.required.length} основных пунктов.`,
            button: "Дополнить профиль",
            target: "personal",
            kind: "profile",
          }
        : p.jobStatus === "paused"
          ? {
              title: "Возвращайтесь, когда будете готовы",
              text: "Пока поиск на паузе, можно обновить профиль или потренировать навыки.",
              button: "Мой профиль",
              target: "personal",
              kind: "profile",
            }
          : !p.grade
            ? {
                title: "Покажите, что умеете",
                text: "Выберите специализацию и заявленный уровень, затем пройдите профессиональное испытание.",
                button: "Проверить уровень",
                target: "assessment",
                kind: "assessment",
              }
            : !p.visible
              ? {
                  title: "Станьте заметнее работодателям",
                  text: "Навыки подтверждены. Включите видимость профиля для участия в подборе.",
                  button: "Настроить видимость",
                  target: "settings",
                  kind: "visibility",
                }
              : {
                  title: "Посмотрите подходящие вакансии",
                  text: "Можно самостоятельно выбрать интересную роль и откликнуться.",
                  button: "К вакансиям",
                  target: "jobs",
                  kind: "jobs",
                };
  return { invitations, activeAttempt, participating, missing, status, next };
}
