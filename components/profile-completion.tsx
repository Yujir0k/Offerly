"use client";
import { useState } from "react";
import { Check, ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { type Profile } from "@/lib/model";
import { profileCompletion } from "@/lib/profile-completion";
import { Progress } from "./ui/progress";
export function ProfileCompletion({
  profile,
  savedProfile,
  onEdit,
  onFieldSelect,
  variant = "card",
}: {
  profile: Profile;
  savedProfile?: Profile;
  onEdit?: () => void;
  onFieldSelect?: (key: string) => void;
  variant?: "card" | "rail";
}) {
  const [expanded, setExpanded] = useState(true);
  const progress = profileCompletion(profile),
    saved = profileCompletion(savedProfile || profile);
  const barPercent =
    variant === "rail"
      ? progress.percent
      : onFieldSelect
        ? Math.round((progress.completed / progress.required.length) * 100)
        : progress.percent;
  return (
    <section
      className={`profile-completion ${variant === "rail" ? "profile-completion-rail" : ""}`}
      aria-label="Полнота профиля"
    >
      {variant === "rail" && (
        <>
          <strong className="profile-rail-percent">{progress.percent}%</strong>
          <Progress
            value={progress.percent}
            aria-label={`Профиль заполнен на ${progress.percent}%`}
          />
          <h2>Заполнение профиля</h2>
          <p className="profile-rail-required">
            {progress.completed} из {progress.required.length} обязательных
            полей
          </p>
        </>
      )}
      <div className="profile-completion-heading">
        <div>
          <span className="eyebrow">
            {onFieldSelect ? "ГОТОВНОСТЬ К ПОДБОРУ" : "ВАШ ПРОФИЛЬ"}
          </span>
          <h2>
            {onFieldSelect
              ? "Основные данные"
              : `Заполнен на ${progress.percent}%`}
          </h2>
          <p>
            {saved.ready
              ? "Основные данные сохранены. Остальные сведения можно добавить по желанию."
              : progress.ready
                ? "Основные поля заполнены. Сохраните изменения в профиле."
                : "Дополните профиль для точного подбора. Все разделы кабинета уже доступны."}
          </p>
        </div>
        <strong className="mono">
          {progress.completed} / {progress.required.length}
          <small>обязательных полей</small>
        </strong>
      </div>
      <Progress
        value={barPercent}
        aria-label={
          onFieldSelect
            ? `Заполнено ${progress.completed} из ${progress.required.length} обязательных полей`
            : `Профиль заполнен на ${progress.percent}%`
        }
      />
      {variant === "rail" && (
        <button
          type="button"
          className="completion-toggle"
          aria-expanded={expanded}
          aria-controls="profile-checklist"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Скрыть список" : "Показать список"}
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      )}
      {(variant !== "rail" || expanded) && (
        <ul id={variant === "rail" ? "profile-checklist" : undefined}>
          {(variant === "rail"
            ? [...progress.required, ...progress.optionalFields]
            : progress.required
          ).map((field) => (
            <li key={field.key} className={field.done ? "done" : ""}>
              {onFieldSelect ? (
                <button
                  className="profile-completion-link"
                  type="button"
                  onClick={() => onFieldSelect(field.key)}
                >
                  {field.done ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <span className="completion-circle" />
                  )}
                  <span>{field.label}</span>
                  {!field.done && (
                    <ArrowRight className="completion-go" aria-hidden="true" />
                  )}
                </button>
              ) : (
                <>
                  {field.done ? (
                    <Check />
                  ) : (
                    <span className="completion-circle" />
                  )}
                  {field.label}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {onEdit && !saved.ready && (
        <button type="button" className="btn primary" onClick={onEdit}>
          Дополнить профиль
          <ArrowRight />
        </button>
      )}
      {(variant !== "rail" || expanded) && (
        <p className="profile-completion-hint">
          Проверка навыков проходит отдельно в кабинете. Она подтверждает
          категорию, а не процент заполнения.
        </p>
      )}
    </section>
  );
}
