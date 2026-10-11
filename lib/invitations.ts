import type { Invitation, Need } from './model';
import { taskBriefGrades } from './task-brief';

/** Freeze the invitation's source so edits or deletion of a need do not rewrite its history. */
export function invitationSource(need: Need): NonNullable<Invitation['source']> {
  return {
    id: need.id || undefined,
    kind: 'companyId' in need ? 'vacancy' : 'task',
    title: need.title,
    specialty: need.specialty,
    grades: need.taskBrief ? [...taskBriefGrades(need.taskBrief)] : need.grade ? [need.grade] : [],
    skills: [...need.skills],
    salaryMin: need.taskBrief ? Number(need.taskBrief.salaryMin) || undefined : need.min,
    salaryMax: need.taskBrief ? Number(need.taskBrief.salaryMax) || undefined : need.max,
    formats: need.taskBrief ? [...need.taskBrief.formats] : need.format === 'Любой' ? [] : [need.format],
  };
}

/** Elapsed whole days for pending invitations; this is not an invented expiry deadline. */
export function invitationWaitingDays(invitation: Invitation, now = Date.now()): number | null {
  if (!['sent', 'viewed'].includes(invitation.status)) return null;
  const sent = Date.parse(invitation.createdAt);
  return Number.isFinite(sent) ? Math.max(0, Math.floor((now - sent) / 86400000)) : null;
}

export type InvitationFilter =
  "all" | "unread" | "read" | "accepted" | "declined" | "cancelled";
export function invitationUnread(invitation: Invitation) {
  return invitation.status === "sent" && !invitation.readAt;
}
export function invitationMatches(
  invitation: Invitation,
  filter: InvitationFilter,
) {
  if (filter === "unread") return invitationUnread(invitation);
  if (filter === "read") return !invitationUnread(invitation);
  return filter === "all" || invitation.status === filter;
}

// Local presentation examples. They never enter the user's saved workspace.
export function exampleInvitations(candidateId: number): Invitation[] {
  const now = Date.now();
  const date = (hours: number) => new Date(now - hours * 3600000).toISOString();
  return [
    {
      id: "example-orion",
      candidateId,
      title: "Backend-разработчик Python",
      company: "Команда Орион",
      min: 220000,
      max: 280000,
      format: "Удалённо",
      city: "Москва",
      grade: "Middle",
      skills: ["Python", "FastAPI", "PostgreSQL"],
      description:
        "Здравствуйте! Нам понравился ваш опыт разработки API и результат проверки Python. Приглашаем познакомиться с командой платформы: вы будете развивать сервисы совместной работы и проектировать интеграции. На первой встрече расскажем о задачах и ответим на ваши вопросы.",
      contact: "team@example.test",
      status: "sent",
      createdAt: date(1),
    },
    {
      id: "example-vector",
      candidateId,
      title: "Data Engineer",
      company: "Вектор Финтех",
      min: 270000,
      max: 350000,
      format: "Гибрид",
      city: "Санкт-Петербург",
      grade: "Senior",
      skills: ["Python", "SQL", "Apache Airflow"],
      description:
        "Ищем инженера в команду платформы данных. Ваши навыки Python и SQL подходят нашим задачам. Предлагаем обсудить работу над хранилищем и надёжными пайплайнами. Будем рады рассказать о команде и формате работы.",
      contact: "data@example.test",
      status: "sent",
      createdAt: date(5),
    },
    {
      id: "example-lumen",
      candidateId,
      title: "ML-инженер",
      company: "Люмен",
      min: 200000,
      max: 260000,
      format: "Удалённо",
      grade: "Middle",
      skills: ["Python", "PyTorch", "Machine Learning"],
      description:
        "Приглашаем в команду персонализации образовательных продуктов. Предстоит работать с рекомендательными моделями и оценкой качества. Готовы обсудить ваши интересы и возможные задачи.",
      contact: "ml@example.test",
      status: "viewed",
      readAt: date(8),
      createdAt: date(24),
    },
    {
      id: "example-sever",
      candidateId,
      title: "MLOps Engineer",
      company: "Север Облако",
      min: 280000,
      max: 370000,
      format: "Удалённо",
      grade: "Senior",
      skills: ["Python", "Docker", "Kubernetes"],
      description:
        "Команда ML-платформы приглашает на знакомство. Мы развиваем инфраструктуру обучения, доставки моделей и мониторинга качества. Обсудим задачи и ваш опыт работы с ML-сервисами.",
      contact: "platform@example.test",
      status: "accepted",
      readAt: date(30),
      respondedAt: date(29),
      createdAt: date(48),
    },
  ];
}
