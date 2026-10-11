"use client";
import type { Need, Profile } from "@/lib/model";
import { money, rank } from "@/lib/model";
import { Check, Mail, Phone, LockKeyhole } from "lucide-react";
import { Badge, Tags } from "./brand";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

/** Shared full profile, using only the server-redacted profile supplied to the employer. */
export function CandidateProfileDialog({
  view,
  open,
  onOpenChange,
  activeNeed,
  onInvite,
}: {
  view: Profile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeNeed: Need;
  onInvite: (profile: Profile) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="app-dialog profile-dialog candidate-profile-dialog"
        overlayClassName="candidate-profile-overlay"
      >
        <DialogHeader>
          <DialogTitle>
            {view?.headline || `${view?.specialty}-специалист`}
          </DialogTitle>
          <DialogDescription>
            Кандидат #{view?.id} ·{" "}
            {view?.demonstration
              ? "демонстрационный профиль"
              : view?.grade
                ? "подтверждённый профиль"
                : "профиль кандидата"}
          </DialogDescription>
        </DialogHeader>
        {view && (
          <>
            <Badge>
              {view.demonstration
                ? `${view.grade || "Уровень не подтверждён"} · условная категория для демонстрации`
                : view.grade
                  ? `${view.grade} подтверждён · ${view.score} / 100`
                  : "Уровень не подтверждён"}
            </Badge>
            {!!view.verified.length && <Tags items={view.verified} />}
            {!!view.bio && <p>{view.bio}</p>}
            <div className="candidate-extra">
              <h3>Из профиля кандидата · самоописание</h3>
              {!!view.skills.length && <Tags items={view.skills} />}
              <p>{view.roles.join(" · ") || "Роли не указаны"}</p>
              {!!view.softSkills.length && <Tags items={view.softSkills} />}
              {view.workHistory.map((w) => (
                <div key={w.id}>
                  <strong>
                    {[w.company, w.role].filter(Boolean).join(" · ")}
                  </strong>
                  <p>{w.description}</p>
                </div>
              ))}
              {view.education && <p>Образование: {view.education}</p>}
              {view.projects && <p>Проекты: {view.projects}</p>}
            </div>
            {view.fsp && (
              <div className="candidate-extra">
                <h3>Достижения ФСП</h3>
                {view.achievements.length ? (
                  <ul>
                    {view.achievements.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    Достижения пока не получены. ID сам по себе не даёт бонуса в
                    подборе.
                  </p>
                )}
              </div>
            )}
            <div className="detail-grid">
              <div>
                <span>Город и формат</span>
                <strong>
                  {view.city} · {view.format}
                </strong>
              </div>
              <div>
                <span>Опыт</span>
                <strong>
                  {view.experience
                    ? `${view.experience} лет`
                    : "Без коммерческого опыта"}
                </strong>
              </div>
              <div>
                <span>Ожидания</span>
                <strong>
                  {money(view.salaryMin)} — {money(view.salaryMax)} ₽
                </strong>
              </div>
            </div>
            <div className="match-detail">
              <h3>
                {view.demonstration
                  ? "Пример соответствия"
                  : activeNeed.skills.length
                    ? "Почему в подборке"
                    : "Подтверждения кандидата"}
              </h3>
              {(view.ranking?.reasons || rank(view, activeNeed).reasons)
                .filter(
                  (_, index) => index !== 1 || activeNeed.skills.length > 0,
                )
                .map((t) => (
                  <p key={t}>
                    <Check size={16} />
                    {view.demonstration
                      ? t
                          .replace("Подтверждены", "Условные навыки:")
                          .replace(
                            "Есть история участия ФСП",
                            "История ФСП · демонстрационный пример",
                          )
                      : t}
                  </p>
                ))}
            </div>
            <div className="contact-gate">
              {view.email ? (
                <>
                  <h3>Контакты открыты с согласия кандидата</h3>
                  <p>
                    <Mail size={16} />
                    {view.email}
                  </p>
                  <p>
                    <Phone size={16} />
                    {view.phone || "Не указан"}
                  </p>
                </>
              ) : (
                <>
                  <LockKeyhole size={23} />
                  <div>
                    <strong>Контакты пока скрыты</strong>
                    <p>
                      Станут доступны после принятия приглашения или
                      самостоятельного отклика.
                    </p>
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <button
                className="btn primary"
                onClick={() => view && onInvite(view)}
              >
                Отправить предложение
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
