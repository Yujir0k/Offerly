"use client";
import { chatRequest } from "@/lib/chat-client";
import { ChatLaunch } from "./chat-launch";
import type { Navigate } from "./landing";
import { useState, useEffect, useRef } from "react";
import { McpInvitationDrafts } from "./mcp-invitation-drafts";
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Eye,
  Pencil,
  Inbox,
  LockKeyhole,
  Mail,
  MapPin,
  MessageSquare,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import type { Invitation, Role, State } from "@/lib/model";
import { EmployerField, EmployerSelect } from "./employer-ui";
import { SuggestionTags } from "./suggestion-picker";
import { skillCatalog } from "@/lib/suggestion-catalogs";
import { salaryRangeError } from "@/lib/salary-range";
import { grades, money } from "@/lib/model";
import {
  exampleInvitations,
  invitationMatches,
  invitationUnread,
  invitationWaitingDays,
  type InvitationFilter,
} from "@/lib/invitations";
import { demoEmployers } from "@/lib/vacancy-catalog";
import { assetUrl } from "@/lib/employer-profile";
import type { Action } from "./registration";
import { displayDate } from "@/lib/account-settings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const candidateFilters: [InvitationFilter, string][] = [
  ["all", "Все"],
  ["unread", "Непрочитанные"],
  ["read", "Прочитанные"],
  ["accepted", "Принятые"],
  ["declined", "Отклонённые"],
  ["cancelled", "Отменённые"],
];
function statusText(invitation: Invitation, role: Role) {
  if (invitation.status === "cancelled") return "Отменено компанией";
  if (invitation.status === "accepted")
    return role === "employer" ? "Принято" : "Знакомство началось";
  if (role === "employer")
    return invitation.status === "declined" ? "Отклонено" : "Ожидает ответа";
  if (invitation.status === "declined") return "Отклонено";
  return invitationUnread(invitation) ? "Новое" : "Ожидает ответа";
}

export function InvitationInbox({
  s,
  role,
  act,
  nav,
  onStateChange,
  requestedInvitationId,
}: {
  s: State;
  role: Role;
  act: Action;
  nav?: Navigate;
  onStateChange?: (state: State) => void;
  requestedInvitationId?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const invitationDate = (value: string) => displayDate(value, s);
  const filters =
    role === "employer"
      ? candidateFilters.filter(([key]) =>
          ["all", "accepted", "declined", "cancelled"].includes(key),
        )
      : candidateFilters;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InvitationFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [previousRole, setPreviousRole] = useState(role);
  const [openedLink, setOpenedLink] = useState<string | null>(null);
  if (previousRole !== role) {
    setPreviousRole(role); setFilter("all"); setExpanded(null); setQuery(""); setOpenedLink(null);
  }
  if (role === "candidate" && requestedInvitationId && openedLink !== requestedInvitationId &&
      s.invitations.some(i => i.id === requestedInvitationId && i.candidateId === s.profile.id)) {
    setOpenedLink(requestedInvitationId); setExpanded(requestedInvitationId); setFilter("all"); setQuery("");
  }
  useEffect(() => {
    if (role !== "candidate" || expanded !== requestedInvitationId || !expanded) return;
    const timer = setTimeout(() => document.getElementById(`invitation-${expanded}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 100);
    return () => clearTimeout(timer);
  }, [expanded, requestedInvitationId, role]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Invitation | null>(null);
  const [cancelling, setCancelling] = useState<Invitation | null>(null);
  const [preview, setPreview] = useState(false);
  const [examples, setExamples] = useState(() =>
    exampleInvitations(s.profile.id),
  );
  const [decision, setDecisionValue] = useState<{
    invitation: Invitation;
    status: "accepted" | "declined";
  } | null>(null);
  const items = preview ? examples : s.invitations;
  const rows = items
    .filter(
      (i) =>
        invitationMatches(i, filter) ||
        (filter === "unread" && expanded === i.id),
    )
    .filter(
      (i) =>
        !query.trim() ||
        [
          i.title,
          i.description,
          `Кандидат #${i.candidateId}`,
          s.candidates.find((p) => p.id === i.candidateId)?.name,
          ...(i.skills || []),
        ]
          .join(" ")
          .toLocaleLowerCase("ru-RU")
          .includes(query.trim().toLocaleLowerCase("ru-RU")),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [declineReason, setDeclineReason] = useState("");
  function setDecision(value: typeof decision) { setDeclineReason(""); setDecisionValue(value); }
  async function respond(
    invitation: Invitation,
    status: "viewed" | "accepted" | "declined",
  ) {
    setBusy(invitation.id);
    setError("");
    try {
      if (preview) {
        const now = new Date().toISOString();
        setExamples((rows) =>
          rows.map((i) =>
            i.id === invitation.id
              ? {
                  ...i,
                  status,
                  readAt: i.readAt || now,
                  ...(status !== "viewed" && { respondedAt: now }),
                }
              : i,
          ),
        );
        return true;
      }
      const result = await act("respond", {
        id: invitation.id,
        expectedUpdatedAt: invitation.updatedAt || invitation.createdAt,
        status,
        ...(status === "declined" ? { declineReason } : {}),
      });
      if (!result) setError("Не удалось сохранить ответ. Попробуйте ещё раз.");
      if (result && status === "accepted") {
        let url = `/demo/${role}/messages`;
        try {
          const { id } = await chatRequest<{ id: string }>(role, "", {
            invitationId: invitation.id,
          });
          url += `?conversation=${id}`;
        } catch {
          // Consent and the room are already saved atomically; do not ask to accept twice.
        }
        if (nav) nav(url);
        else window.location.assign(url);
      }
      return !!result;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }
  async function open(invitation: Invitation) {
    const opening = expanded !== invitation.id;
    setExpanded(opening ? invitation.id : null);
    if (opening && role === "candidate" && invitationUnread(invitation))
      await respond(invitation, "viewed");
  }
  function togglePreview() {
    setPreview(!preview);
    setFilter("all");
    setExpanded(null);
    setError("");
    setExamples(exampleInvitations(s.profile.id));
  }
  return (
    <section
      className="invitation-inbox"
      aria-label={
        role === "candidate"
          ? "Входящие приглашения"
          : "Отправленные приглашения"
      }
    >
      {role === "employer" && s.auth?.demo && (
        <McpInvitationDrafts onStateChange={onStateChange} nav={nav} />
      )}
      <div className="invitation-inbox-toolbar">
        <div
          className="invitation-inbox-tabs"
          role="tablist"
          aria-label="Статусы приглашений"
        >
          {filters.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              aria-controls="invitation-list"
              id={`invitation-tab-${key}`}
              onClick={() => {
                setFilter(key);
                setExpanded(null);
              }}
            >
              {label}
              <span>
                {items.filter((i) => invitationMatches(i, key)).length}
              </span>
            </button>
          ))}
        </div>
        <button className="invitation-preview-button" onClick={togglePreview}>
          {preview ? "К моим приглашениям" : "Посмотреть пример"}
          <ArrowUpRight size={15} />
        </button>
      </div>
      {role === "employer" && (
        <label className="invitation-search">
          <Search size={19} aria-hidden="true" />
          <input
            aria-label="Поиск отправленных приглашений"
            placeholder="Роль, имя или номер кандидата"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      {preview && (
        <div className="invitation-example-note">
          <Eye size={17} />
          <span>
            Пример сценария. Компании и предложения вымышлены; действия здесь не
            меняют ваши приглашения.
          </span>
        </div>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="invitation-inbox-layout">
        <div
          className="invitation-inbox-list"
          id="invitation-list"
          role="tabpanel"
          aria-labelledby={`invitation-tab-${filter}`}
        >
          {rows.map((invitation) => {
            const unread = role === "candidate" && invitationUnread(invitation),
              opened = expanded === invitation.id;
            const waiting = invitationWaitingDays(invitation, now);
            const employer = Object.values(demoEmployers).find(
              (c) => c.name === invitation.company,
            );
            const company = s.companies?.find(
              (c) => c.id === invitation.companyId,
            );
            const companyLogo = company?.logoKey
              ? assetUrl(company.logoKey)
              : employer?.logo;
            const candidate = s.candidates.find(
              (p) => p.id === invitation.candidateId,
            );
            return (
              <article
                className={`offer-invitation ${unread ? "is-unread" : ""} ${opened ? "is-open" : ""}`}
                key={invitation.id}
                id={`invitation-${invitation.id}`}
                aria-label={`${invitation.title}, ${statusText(invitation, role)}`}
              >
                <div className="offer-invitation-top">
                  <div className="offer-company-logo">
                    {role === "candidate" && companyLogo ? (
                      <img
                        src={companyLogo}
                        alt={`Логотип ${invitation.company}`}
                      />
                    ) : role === "candidate" ? (
                      invitation.company[0]
                    ) : (
                      <UserRound size={24} />
                    )}
                  </div>
                  <div className="offer-company-name">
                    <strong>
                      {role === "candidate"
                        ? invitation.company
                        : invitation.status === "accepted" && candidate?.name
                          ? candidate.name
                          : `Кандидат #${invitation.candidateId}`}
                    </strong>
                    <span>
                      {role === "candidate"
                        ? "Приглашение от команды"
                        : "Приглашение отправлено"}
                    </span>
                  </div>
                  <div className="offer-invitation-state">
                    <span className={`offer-status ${invitation.status}`}>
                      {unread ? (
                        <span className="offer-unread-dot" />
                      ) : invitation.status === "accepted" ? (
                        <Check size={13} />
                      ) : invitation.status === "cancelled" ? (
                        <X size={13} />
                      ) : invitation.status === "declined" ? (
                        <X size={13} />
                      ) : role === "employer" ? (
                        <Clock3 size={13} />
                      ) : (
                        <Eye size={13} />
                      )}{" "}
                      {statusText(invitation, role)}
                    </span>
                    <time dateTime={invitation.createdAt}>
                      {invitationDate(invitation.createdAt)}
                    </time>
                    {role === "employer" && waiting !== null && (
                      <span className="offer-waiting">
                        Ожидает ответа: {waiting} дн.
                      </span>
                    )}
                  </div>
                </div>
                <h2>{invitation.title}</h2>
                {invitation.source ? (
                  <div className="offer-invitation-source">
                    <strong>
                      По{" "}
                      {invitation.source.kind === "vacancy"
                        ? "вакансии"
                        : "задаче"}
                      : {invitation.source.title}
                    </strong>
                    <span>
                      {[
                        invitation.source.specialty,
                        invitation.source.grades.join(" / "),
                        invitation.source.skills.join(", "),
                        invitation.source.formats.join(" / "),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {(invitation.source.salaryMin ||
                      invitation.source.salaryMax) && (
                      <span>
                        Бюджет задачи:{" "}
                        {invitation.source.salaryMin
                          ? `от ${money(invitation.source.salaryMin)} ₽`
                          : ""}
                        {invitation.source.salaryMax
                          ? ` до ${money(invitation.source.salaryMax)} ₽`
                          : ""}
                        /мес
                      </span>
                    )}
                  </div>
                ) : (
                  role === "employer" && (
                    <p className="muted">
                      Без привязки к сохранённой задаче или вакансии
                    </p>
                  )
                )}
                <p className="offer-invitation-salary">
                  {money(invitation.min)} — {money(invitation.max)} ₽
                  <span>в месяц · до вычета налогов</span>
                </p>
                <div className="offer-invitation-conditions">
                  {invitation.grade && (
                    <span className="offer-grade">{invitation.grade}</span>
                  )}
                  {invitation.format && (
                    <span>
                      <BriefcaseBusiness size={16} />
                      {invitation.format}
                    </span>
                  )}
                  {invitation.city && (
                    <span>
                      <MapPin size={16} />
                      {invitation.city}
                    </span>
                  )}
                </div>
                {!!invitation.skills?.length && (
                  <div className="offer-invitation-skills">
                    {invitation.skills.map((skill) => (
                      <span key={skill}>{skill}</span>
                    ))}
                  </div>
                )}
                <p className="offer-invitation-message">
                  {opened
                    ? invitation.description
                    : invitation.description.length > 185
                      ? invitation.description.slice(0, 182).trimEnd() + "…"
                      : invitation.description}
                </p>
                <button
                  className="offer-details-button"
                  onClick={() => open(invitation)}
                  disabled={busy === invitation.id}
                  aria-expanded={opened}
                  aria-controls={`invitation-details-${invitation.id}`}
                >
                  {opened
                    ? "Свернуть приглашение"
                    : role === "employer"
                      ? "Детали приглашения"
                      : "Прочитать приглашение"}
                  <ChevronDown size={17} className={opened ? "rotate" : ""} />
                </button>
                {opened && (
                  <div
                    className="offer-invitation-details"
                    id={`invitation-details-${invitation.id}`}
                  >
                    <div>
                      <MessageSquare size={18} />
                      <span>
                        <strong>
                          {role === "candidate"
                            ? "Как связаться с командой"
                            : "Контакт команды в приглашении"}
                        </strong>
                        <span>{invitation.contact}</span>
                      </span>
                    </div>
                    <div>
                      <Clock3 size={18} />
                      <span>
                        <strong>
                          {invitation.respondedAt
                            ? "Ответ сохранён"
                            : invitation.readAt ||
                                invitation.status === "viewed"
                              ? "Приглашение просмотрено"
                              : "Приглашение отправлено"}
                        </strong>
                        <span>
                          {invitationDate(
                            invitation.respondedAt ||
                              invitation.readAt ||
                              invitation.createdAt,
                          )}
                        </span>
                      </span>
                    </div>
                    {role === "employer" &&
                      invitation.status === "accepted" && (
                        <div className="offer-shared-contacts">
                          <CheckCircle2 size={18} />
                          <span>
                            <strong>Кандидат открыл контакты</strong>
                            <span>
                              {candidate?.email ||
                                "Контакты доступны в профиле кандидата"}
                            </span>
                            {candidate?.phone && <span>{candidate.phone}</span>}
                          </span>
                        </div>
                      )}
                  </div>
                )}
                {invitation.updatedAt && (
                  <p className="muted">
                    {invitation.status === "cancelled"
                      ? "Отменено"
                      : "Условия обновлены"}
                    : {invitationDate(invitation.updatedAt)}
                  </p>
                )}
                <div className={`offer-invitation-footer${invitation.status === "accepted" ? " is-accepted" : ""}`}>
                  {invitation.status === "accepted" && !preview && (
                    <ChatLaunch
                      role={role}
                      invitationId={invitation.id}
                      nav={nav}
                    />
                  )}
                  {invitation.status === "accepted" ? null : invitation.status === "cancelled" ? (
                    <p className="offer-outcome">
                      <X size={18} />
                      Компания отменила приглашение.
                    </p>
                  ) : invitation.status === "declined" ? (
                    <p className="offer-outcome">
                      <X size={18} />
                      Предложение отклонено. Контакты кандидата остались
                      закрытыми.
                      {invitation.declineReason && (
                        <span> Причина: {invitation.declineReason}</span>
                      )}
                    </p>
                  ) : (
                    <>
                      <p className="offer-contact-note">
                        <LockKeyhole size={16} />
                        {role === "candidate"
                          ? "Ваши контакты пока закрыты"
                          : "Контакты откроются после согласия кандидата"}
                      </p>
                      {role === "employer" && !preview && (
                        <div className="offer-invitation-actions">
                          <button
                            className="offer-secondary"
                            disabled={!!busy}
                            onClick={() => {
                              setError("");
                              setEditing(invitation);
                            }}
                          >
                            <Pencil size={16} />
                            Изменить
                          </button>
                          <button
                            className="offer-secondary"
                            disabled={!!busy}
                            onClick={() => {
                              setError("");
                              setCancelling(invitation);
                            }}
                          >
                            Отменить приглашение
                          </button>
                        </div>
                      )}
                      {role === "candidate" && (
                        <div className="offer-invitation-actions">
                          <button
                            className="offer-secondary"
                            disabled={busy === invitation.id}
                            onClick={() =>
                              setDecision({ invitation, status: "declined" })
                            }
                          >
                            Отклонить
                          </button>
                          <button
                            className="offer-primary"
                            disabled={busy === invitation.id}
                            onClick={() =>
                              setDecision({ invitation, status: "accepted" })
                            }
                          >
                            Хочу познакомиться
                            <ArrowRight size={17} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
          {!rows.length && (
            <div className="invitation-inbox-empty">
              <div className="invitation-empty-icon">
                <Inbox size={32} />
              </div>
              <h2>
                {items.length
                  ? query.trim()
                    ? "Приглашения не найдены"
                    : "В этой вкладке пока пусто"
                  : role === "candidate"
                    ? "Ваше следующее знакомство — впереди"
                    : "Начните знакомство с кандидатом"}
              </h2>
              <p>
                {items.length
                  ? query.trim()
                    ? "Измените запрос или выберите другой статус."
                    : "Выберите другой статус, чтобы посмотреть остальные приглашения."
                  : role === "candidate"
                    ? "Здесь появятся предложения компаний с задачами и зарплатой. Вы решаете, с кем знакомиться."
                    : "Отправленные предложения и ответы кандидатов появятся здесь."}
              </p>
              {!items.length && (
                <button className="offer-secondary" onClick={togglePreview}>
                  Посмотреть пример приглашений
                  <ArrowRight size={17} />
                </button>
              )}
            </div>
          )}
        </div>
        <aside
          className="invitation-guide"
          aria-label="Как проходит знакомство"
        >
          <span className="invitation-guide-icon">
            <ShieldCheck size={25} />
          </span>
          <h2>
            {role === "candidate"
              ? "Знакомство на ваших условиях"
              : "От предложения — к знакомству"}
          </h2>
          <ol>
            <li>
              <span>1</span>
              <div>
                <strong>Условия сразу</strong>
                <p>Задачи и зарплата видны до начала общения.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>
                  {role === "candidate"
                    ? "Спокойно изучите"
                    : "Дождитесь решения"}
                </strong>
                <p>Прочтение приглашения не открывает контакты.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Личное знакомство</strong>
                <p>
                  {role === "candidate"
                    ? "Подтвердите интерес, чтобы поделиться контактами с этой командой."
                    : "После согласия кандидата можно связаться напрямую."}
                </p>
              </div>
            </li>
          </ol>
          <div className="invitation-guide-note">
            <LockKeyhole size={17} />
            <p>
              Согласие на знакомство не означает принятие трудового предложения.
            </p>
          </div>
        </aside>
      </div>
      {editing && (
        <InvitationEditor
          invitation={editing}
          act={act}
          close={() => setEditing(null)}
        />
      )}
      <Dialog
        open={!!cancelling}
        onOpenChange={(open) => {
          if (!open && !busy) setCancelling(null);
        }}
      >
        <DialogContent className="app-dialog invitation-decision-dialog">
          <DialogHeader>
            <DialogTitle>Отменить приглашение?</DialogTitle>
            <DialogDescription>
              Кандидат увидит, что предложение отменено, и больше не сможет его
              принять.
            </DialogDescription>
          </DialogHeader>
          <p>
            {cancelling?.title} · Кандидат #{cancelling?.candidateId}
          </p>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <DialogFooter>
            <button
              className="offer-secondary"
              disabled={!!busy}
              onClick={() => setCancelling(null)}
            >
              Вернуться
            </button>
            <button
              className="offer-primary"
              disabled={!!busy}
              onClick={async () => {
                if (!cancelling) return;
                setBusy(cancelling.id);
                setError("");
                try {
                  if (
                    await act("invitation-cancel", {
                      id: cancelling.id,
                      expectedUpdatedAt:
                        cancelling.updatedAt || cancelling.createdAt,
                    })
                  )
                    setCancelling(null);
                  else
                    setError(
                      "Не удалось отменить приглашение. Проверьте его текущий статус.",
                    );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy ? "Отменяем…" : "Отменить приглашение"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!decision}
        onOpenChange={(open) => {
          if (!open && !busy) setDecision(null);
        }}
      >
        <DialogContent className="app-dialog invitation-decision-dialog">
          <DialogHeader>
            <DialogTitle>
              {decision?.status === "accepted"
                ? "Познакомиться с командой?"
                : "Отклонить приглашение?"}
            </DialogTitle>
            <DialogDescription>
              {decision?.status === "accepted"
                ? "Вы поделитесь email и телефоном с этой компанией. Это согласие на общение; принимать предложение о работе пока не нужно."
                : "Компания увидит ваш отказ. Ваши контакты останутся закрытыми."}
            </DialogDescription>
          </DialogHeader>
          {decision && (
            <div className="invitation-decision-summary">
              <strong>{decision.invitation.company}</strong>
              <span>{decision.invitation.title}</span>
              <b>
                {money(decision.invitation.min)} —{" "}
                {money(decision.invitation.max)} ₽/мес
              </b>
            </div>
          )}
          {decision?.status === "declined" && (
            <label className="hiring-field">
              <span>Причина · необязательно, видна компании</span>
              <textarea
                maxLength={500}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="Например, не подходит зарплата, формат или задачи"
              />
            </label>
          )}
          {preview && (
            <p className="small-note">
              Это пример: контакты никуда не передаются.
            </p>
          )}
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <DialogFooter>
            <button
              className="offer-secondary"
              disabled={!!busy}
              onClick={() => setDecision(null)}
            >
              Вернуться
            </button>
            <button
              className="offer-primary"
              disabled={!!busy}
              onClick={async () => {
                if (
                  decision &&
                  (await respond(decision.invitation, decision.status))
                )
                  setDecision(null);
              }}
            >
              {decision?.status === "accepted"
                ? "Познакомиться и открыть контакты"
                : "Отклонить приглашение"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function InvitationEditor({
  invitation,
  act,
  close,
}: {
  invitation: Invitation;
  act: Action;
  close: () => void;
}) {
  const [d, setD] = useState({
    ...invitation,
    format: invitation.format || "Удалённо",
    city: invitation.city || "",
    grade: invitation.grade || "",
    skills: invitation.skills || [],
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const field = (
    key: "title" | "description" | "contact" | "city",
    value: string,
  ) => setD((x) => ({ ...x, [key]: value }));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="app-dialog invitation-compose-dialog">
        <DialogHeader>
          <DialogTitle>Изменить приглашение</DialogTitle>
          <DialogDescription>
            Кандидат #{invitation.candidateId} увидит обновлённые условия и
            сможет ответить на них.
          </DialogDescription>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            const validation = salaryRangeError(d.min, d.max);
            if (validation) {
              setError(validation);
              return;
            }
            setBusy(true);
            try {
              const result = await act("invitation-update", {
                id: invitation.id,
                expectedUpdatedAt: invitation.updatedAt || invitation.createdAt,
                title: d.title,
                description: d.description,
                min: d.min,
                max: d.max,
                contact: d.contact,
                format: d.format,
                city: d.city,
                grade: d.grade,
                skills: d.skills,
              });
              if (result) close();
              else
                setError(
                  "Не удалось сохранить изменения. Проверьте текущий статус приглашения.",
                );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <EmployerField label="Должность">
            <input
              required
              maxLength={200}
              value={d.title}
              onChange={(e) => field("title", e.target.value)}
            />
          </EmployerField>
          <EmployerField label="Задачи и предложение">
            <textarea
              required
              rows={4}
              maxLength={3000}
              value={d.description}
              onChange={(e) => field("description", e.target.value)}
            />
          </EmployerField>
          <div className="form-two">
            <EmployerField label="Зарплата от, ₽/мес">
              <input
                required
                type="number"
                min={1}
                max={10000000}
                value={d.min}
                onChange={(e) =>
                  setD((x) => ({ ...x, min: Number(e.target.value) }))
                }
              />
            </EmployerField>
            <EmployerField label="До, ₽/мес">
              <input
                required
                type="number"
                min={1}
                max={10000000}
                value={d.max}
                onChange={(e) =>
                  setD((x) => ({ ...x, max: Number(e.target.value) }))
                }
              />
            </EmployerField>
          </div>
          <div className="form-two">
            <EmployerField label="Формат работы">
              <EmployerSelect
                label="Формат приглашения"
                value={d.format}
                onChange={(format) => setD((x) => ({ ...x, format }))}
                options={["Удалённо", "Гибрид", "Офис"]}
              />
            </EmployerField>
            <EmployerField label="Город">
              <input
                value={d.city}
                maxLength={100}
                onChange={(e) => field("city", e.target.value)}
              />
            </EmployerField>
          </div>
          <EmployerField label="Грейд">
            <EmployerSelect
              label="Грейд приглашения"
              value={d.grade}
              onChange={(grade) => setD((x) => ({ ...x, grade }))}
              options={[{ value: "", label: "Не указан" }, ...grades]}
            />
          </EmployerField>
          <EmployerField label="Технологии">
            <SuggestionTags
              id="invitation-edit-skills"
              catalog={skillCatalog}
              value={d.skills}
              onChange={(skills) => setD((x) => ({ ...x, skills }))}
            />
          </EmployerField>
          <EmployerField label="Контакт команды">
            <input
              required
              maxLength={200}
              value={d.contact}
              onChange={(e) => field("contact", e.target.value)}
            />
          </EmployerField>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <DialogFooter>
            <button
              type="button"
              className="btn subtle"
              disabled={busy}
              onClick={close}
            >
              Отмена
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? "Сохраняем…" : "Сохранить изменения"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
