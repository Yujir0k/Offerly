"use client";
import type { Profile, Need, State } from "@/lib/model";
import { rank, money } from "@/lib/model";
import { invitationOwned } from "@/lib/employer-profile";
import { candidateExperience } from "@/lib/candidate-comparison";
import { Check, Bookmark, Code2, ShieldCheck, CircleHelp } from "lucide-react";
import { Badge } from "./brand";
import { ChatLaunch } from "./chat-launch";
import type { Action } from "./registration";
import type { Navigate } from "./landing";
export function CandidateCard({
  p,
  n,
  s,
  act,
  onView,
  onInvite,
  nav,
  comparing,
  onCompare,
  onExplain,
  onSearch,
}: {
  p: Profile;
  n: Need;
  s: State;
  act: Action;
  onView: () => void;
  onInvite: () => void;
  nav: Navigate;
  comparing?: boolean;
  onCompare?: () => void;
  onExplain?: () => void;
  onSearch?: () => void;
}) {
  // Use the server policy for explanations as well as ordering.
  const m = p.ranking
    ? {
        matched: p.ranking.verified,
        declared: p.ranking.matched,
        reasons: p.ranking.reasons,
      }
    : rank(p, n);
  const existing = s.invitations.find(
    (i) =>
      i.candidateId === p.id &&
      invitationOwned(i, s) &&
      ["sent", "viewed"].includes(i.status),
  );
  const accepted = s.invitations.find(
    (i) =>
      i.candidateId === p.id &&
      invitationOwned(i, s) &&
      i.status === "accepted",
  );
  const application = s.applications.find((a) => a.candidateId === p.id);
  const achievements = p.achievements.length
    ? p.achievements
    : (p.competitionResults || []).map(
        (event) =>
          `${event.title} · ${event.result === "winner" ? "победа" : event.result === "prize" ? "призовое место" : "участие"}`,
      );
  const conditions = [
    ...new Set(
      [
        ...(p.formats?.length ? p.formats : [p.format]),
        ...(p.employmentTypes?.length ? p.employmentTypes : [p.employment]),
        ...(p.availabilities?.length ? p.availabilities : [p.availability]),
        p.relocation ? "Готов к переезду" : "",
      ].filter(Boolean),
    ),
  ];
  return (
    <article
      className="candidate-card"
      tabIndex={0}
      aria-label={`Профиль кандидата #${p.id}: ${p.headline || p.specialty}`}
      onClick={(event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest(
            "button, a, input, select, textarea, [role='checkbox']",
          )
        )
          onView();
      }}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          ["Enter", " "].includes(event.key)
        ) {
          event.preventDefault();
          onView();
        }
      }}
    >
      {onCompare && (
        <button
          className={`compare-candidate ${comparing ? "selected" : ""}`}
          role="checkbox"
          aria-label={
            comparing ? "Убрать из сравнения" : "Добавить к сравнению"
          }
          aria-checked={comparing}
          title={comparing ? "Убрать из сравнения" : "Добавить к сравнению"}
          onClick={onCompare}
        >
          <span className="compare-square">
            {comparing && <Check size={15} />}
          </span>
        </button>
      )}
      {onExplain && (
        <button
          className="compare-candidate"
          aria-label="Почему выбран этот кандидат"
          title="Почему выбран этот кандидат"
          onClick={onExplain}
        >
          <CircleHelp size={22} />
        </button>
      )}
      <button
        className={`save-candidate ${s.saved.includes(p.id) ? "saved" : ""}`}
        onClick={() => act("saved", { id: p.id })}
        aria-label={
          s.saved.includes(p.id)
            ? "Убрать из избранного"
            : "Сохранить кандидата"
        }
        aria-pressed={s.saved.includes(p.id)}
        title={
          s.saved.includes(p.id)
            ? "Убрать из избранного"
            : "Сохранить в избранное"
        }
      >
        <Bookmark
          size={22}
          fill={s.saved.includes(p.id) ? "currentColor" : "none"}
        />
      </button>
      <div className={`candidate-avatar avatar-${p.id % 4}`}>
        {p.demonstration && p.demoAvatar ? (
          <img src={p.demoAvatar} alt="Демонстрационный портрет" />
        ) : (
          p.initials || <Code2 size={28} />
        )}
      </div>
      <div className="candidate-card-body">
        <div className="candidate-caption">
          <span>Кандидат #{p.id}</span>
          {!!achievements.length && (
            <span className="fsp-label">
              <img src="/brand/fsp.svg" alt="" />
              Достижения ФСП · {achievements.length}
            </span>
          )}
        </div>
        <h2>{p.headline || `${p.specialty}-специалист`}</h2>
        <div className="candidate-confirm">
          <Badge>
            {p.demonstration
              ? `Уровень: ${p.grade || "не подтверждён"}`
              : p.grade
                ? `${p.grade} подтверждён`
                : "Уровень не подтверждён"}
          </Badge>
          {!!p.grade && (
            <span className="test-score">
              Проверка: <b>{p.score} / 100</b>
            </span>
          )}
        </div>
        <div className="candidate-compact-skills">
          <span>Профессиональные навыки</span>
          <div className="tags">
            {[...new Set([...p.verified, ...p.skills])]
              .slice(0, 10)
              .map((skill) => (
                <span
                  key={skill}
                  className={
                    p.verified.includes(skill) ? "skill-confirmed" : ""
                  }
                  title={
                    p.verified.includes(skill)
                      ? "Подтверждённый навык"
                      : "Указан в профиле"
                  }
                >
                  {p.verified.includes(skill) && <Check size={12} />}
                  {skill}
                </span>
              ))}
          </div>
        </div>
        <dl className="candidate-facts">
          <div>
            <dt>Зарплатные ожидания</dt>
            <dd className="candidate-fact-salary">
              {money(p.salaryMin)} — {money(p.salaryMax)} ₽
              <small>в месяц</small>
            </dd>
          </div>
          <div>
            <dt>Город и опыт</dt>
            <dd>
              {p.city || "Город не указан"}
              <small>{candidateExperience(p.experience)}</small>
            </dd>
          </div>
          {!!conditions.length && (
            <div className="candidate-fact-conditions">
              <dt>Условия работы</dt>
              <dd>{conditions.join(" · ")}</dd>
            </div>
          )}
        </dl>
        <div
          className={`candidate-achievements ${achievements.length ? "has-achievements" : ""}`}
        >
          <span>
            <img src="/brand/fsp.svg" alt="" />
            Достижения ФСП
          </span>
          {achievements.length ? (
            <p>
              {achievements.slice(0, 2).join(" · ")}
              {achievements.length > 2
                ? ` · ещё ${achievements.length - 2}`
                : ""}
            </p>
          ) : (
            <p>Пока нет сведений об участии</p>
          )}
        </div>
        <div className="candidate-reason">
          <ShieldCheck size={16} />
          <span>
            <b>
              {p.demonstration
                ? "Пример соответствия:"
                : n.skills.length
                  ? "Подходит:"
                  : "Проверено:"}
            </b>{" "}
            {m.matched.length
              ? (p.demonstration ? "условные навыки: " : "подтверждены ") +
                m.matched.join(", ")
              : m.declared.length
                ? "в профиле: " + m.declared.join(", ") + " · требуют проверки"
                : m.reasons[0]}
          </span>
        </div>
      </div>
      <div className="candidate-actions">
        {accepted ? (
          <ChatLaunch role="employer" invitationId={accepted.id} nav={nav} />
        ) : application?.id ? (
          <ChatLaunch
            role="employer"
            applicationId={application.id}
            nav={nav}
          />
        ) : (
          <button
            className="btn primary"
            disabled={!!existing}
            onClick={onInvite}
          >
            {existing ? "Приглашён" : "Пригласить"}
          </button>
        )}
        {onSearch && (
          <button className="btn subtle" onClick={onSearch}>
            Показать в поиске
          </button>
        )}
        <button className="btn subtle" onClick={onView}>
          Подробнее
        </button>
      </div>
    </article>
  );
}
