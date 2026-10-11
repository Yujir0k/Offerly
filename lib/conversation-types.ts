export type Conversation = {
  canWrite: boolean;
  id: string;
  companyId: string;
  candidateId: number;
  label: string;
  lastAt: string;
  unread: number;
};
export const CHAT_LOCKED_MESSAGE =
  "Чат с кандидатом откроется после того, как он примет приглашение. До этого момента прямая связь недоступна для защиты от нерелевантного спама";
export type EmployerTask = {
  title: string;
  instructions: string;
  minutes: number;
  criteria: string;
  status:
    "offered" | "accepted" | "declined" | "submitted" | "expired" | "reviewed";
  startedAt?: string;
  deadlineAt?: string;
  expiredAt?: string;
  draftAnswer?: string;
  draftRevision?: number;
  draftSavedAt?: string;
  submittedAt?: string;
  answer?: string;
  feedback?: string;
};
export type ConversationMessage = {
  id: string;
  senderRole: "candidate" | "employer";
  createdAt: string;
  text: string;
  task?: EmployerTask;
};
