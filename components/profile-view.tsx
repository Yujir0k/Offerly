"use client";
import { professionalDirection } from "@/lib/profile-options";
import {
  Pencil,
  MapPin,
  BriefcaseBusiness,
  ShieldCheck,
  ArrowLeft,
  ExternalLink,
  UserRound,
  Code2,
  Layers,
  GraduationCap,
  Target,
  Sparkles,
  Mail,
} from "lucide-react";
import type { State } from "@/lib/model";
import { money } from "@/lib/model";
import { profileStatus } from "@/lib/profile-identity";
import { ProfileAvatar } from "./profile-avatar";
import type { Navigate } from "./landing";
import { useDraft } from "@/hooks/use-draft";
import { BrandGraphic } from "./logo-motion";
import { ResumePreview } from "./resume-preview";
function safeLink(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function ProfileView({ s, nav }: { s: State; nav: Navigate }) {
  const [draft] = useDraft("profile", s.profile);
  const p = {
    ...s.profile,
    ...draft,
    avatarKey: s.profile.avatarKey,
    grade: s.profile.grade,
    verified: s.profile.verified,
    score: s.profile.score,
  };
  return (
    <div className="social-profile">
      <div className="social-profile-toolbar">
        <button
          className="text-link profile-return-link"
          onClick={() => nav("/demo/candidate/profile")}
        >
          <ArrowLeft size={17} /> К заполнению профиля
        </button>
        <span>Предпросмотр вашего профиля</span>
      </div>
      <section className="social-profile-hero">
        <div className="social-profile-cover">
          <img src="/brand/original.svg" alt="" />
          <span>Навыки. Люди. Ваше дело.</span>
          <BrandGraphic />
        </div>
        <div className="social-profile-intro">
          <ProfileAvatar profile={p} className="profile-photo-hero" />
          <button
            className="btn outline"
            onClick={() => nav("/demo/candidate/profile")}
          >
            <Pencil size={17} /> Редактировать
          </button>
          <h1>{p.name || "Ваше имя"}</h1>
          <p className="social-profile-headline">
            {p.headline ||
              p.roles.filter(Boolean).join(" · ") ||
              professionalDirection(p)}
          </p>
          <p className={`profile-status-label status-${p.jobStatus || "open"}`}>
            <span />
            {profileStatus(p)}
          </p>
          <div className="social-profile-meta">
            {p.city && (
              <span>
                <MapPin size={17} />
                {[p.city, p.country].filter(Boolean).join(", ")}
              </span>
            )}
            <span>
              <BriefcaseBusiness size={17} />
              {p.format}
            </span>
            {p.grade && (
              <span className="social-profile-verified">
                <ShieldCheck size={17} />
                {p.specialty} · {p.grade} <small>Проверка в прототипе</small>
              </span>
            )}
          </div>
        </div>
      </section>
      <div className="social-profile-columns">
        <div>
          <section className="social-profile-card">
            <h2>
              <UserRound aria-hidden="true" />О себе
            </h2>
            <p>
              {p.bio ||
                "Расскажите, какие задачи вам интересны и в чём ваша сильная сторона."}
            </p>
          </section>
          <section className="social-profile-card">
            <h2>
              <Code2 aria-hidden="true" />
              Навыки и направления
            </h2>
            <div className="profile-summary-tags">
              {[...p.roles, ...p.skills].filter(Boolean).map((v, i) => (
                <span key={i}>{v}</span>
              ))}
            </div>
            {p.verified.length > 0 && (
              <>
                <h3>Подтверждены в прототипе</h3>
                <div className="profile-summary-tags verified-tags">
                  {p.verified.map((v) => (
                    <span key={v}>
                      <ShieldCheck size={14} />
                      {v}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
          <section className="social-profile-card">
            <h2>
              <BriefcaseBusiness aria-hidden="true" />
              Опыт работы
            </h2>
            {p.workHistory.filter((w) => w.company || w.role).length ? (
              p.workHistory
                .filter((w) => w.company || w.role)
                .map((w) => (
                  <article className="social-work-entry" key={w.id}>
                    <span />
                    <div>
                      <h3>{w.role || "Должность"}</h3>
                      <strong>{w.company}</strong>
                      <small>
                        {w.start} {w.start && "—"}{" "}
                        {w.current ? "По настоящее время" : w.end}
                      </small>
                      <p>{w.description}</p>
                    </div>
                  </article>
                ))
            ) : (
              <p className="muted">
                Можно начать без коммерческого опыта. Добавьте учебные или
                личные проекты.
              </p>
            )}
          </section>
          {p.projects && (
            <section className="social-profile-card">
              <h2>
                <Layers aria-hidden="true" />
                Проекты
              </h2>
              <p>{p.projects}</p>
            </section>
          )}
          {p.education && (
            <section className="social-profile-card">
              <h2>
                <GraduationCap aria-hidden="true" />
                Образование и курсы
              </h2>
              <p>{p.education}</p>
            </section>
          )}
          {p.notes && (
            <section className="social-profile-card">
              <h2>Дополнительные сведения</h2>
              <p style={{ whiteSpace: "pre-wrap" }}>{p.notes}</p>
            </section>
          )}
        </div>
        <aside>
          <section className="social-profile-card">
            <h2>
              <Target aria-hidden="true" />
              Следующая работа
            </h2>
            <dl>
              <dt>Занятость</dt>
              <dd>{p.employment}</dd>
              <dt>Готовность начать</dt>
              <dd>{p.availability}</dd>
              {p.salaryMin > 0 && p.salaryMax > 0 && (
                <>
                  <dt>Ожидания в месяц</dt>
                  <dd>
                    {money(p.salaryMin)} — {money(p.salaryMax)} ₽
                  </dd>
                </>
              )}
              {p.relocation && <dd>Рассматриваю переезд</dd>}
            </dl>
          </section>
          {(p.languages.length > 0 || p.links.length > 0) && (
            <section className="social-profile-card">
              <h2>
                <Sparkles aria-hidden="true" />
                Дополнительно
              </h2>
              {p.languages.map((v) => (
                <p key={v}>{v}</p>
              ))}
              {p.links.map((v, i) =>
                safeLink(v) ? (
                  <a
                    href={safeLink(v)}
                    key={i}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {v}
                    <ExternalLink size={14} />
                  </a>
                ) : (
                  <p key={i}>{v}</p>
                ),
              )}
            </section>
          )}
          <section className="social-profile-card">
            <h2>
              <Mail aria-hidden="true" />
              Контакты
            </h2>
            <p>{p.email}</p>
            {p.phone && <p>{p.phone}</p>}
            <small>
              Это ваш личный просмотр. Работодатель увидит контакты после вашего
              согласия на конкретное приглашение.
            </small>
          </section>
        </aside>
      </div>
      <ResumePreview profile={p} />
    </div>
  );
}
