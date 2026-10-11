"use client";
import { useId, type ReactNode } from "react";
import { Pencil, Plus, CircleAlert, X, Check, Loader2 } from "lucide-react";
import { type Profile, money } from "@/lib/model";
import { profileStatus } from "@/lib/profile-identity";
import { professionalDirection } from "@/lib/profile-options";
import { ProfileAvatar } from "./profile-avatar";

export function SummaryCard({
  cardKey,
  title,
  missing,
  children,
  editor,
  open,
  onToggle,
  onSave,
  busy,
}: {
  cardKey: string;
  title: string;
  missing?: boolean;
  children: ReactNode;
  editor: ReactNode;
  open: boolean;
  onToggle: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const id = useId();
  return (
    <section
      data-profile-card={cardKey}
      className={`profile-summary-card ${open ? "is-editing" : ""}`}
    >
      <header>
        <h3>{title}</h3>
        {missing && (
          <span className="profile-missing">
            <CircleAlert size={14} /> Не заполнено
          </span>
        )}
        <button
          type="button"
          className="profile-pencil"
          aria-label={`${open ? "Свернуть" : "Редактировать"}: ${title}`}
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
        >
          {open ? <X size={21} /> : <Pencil size={21} />}
        </button>
      </header>
      {!open && <div className="profile-summary-body">{children}</div>}
      {open && (
        <div
          id={id}
          className={`profile-card-editor ${open ? "is-open" : ""}`}
          aria-hidden={!open}
          inert={!open}
        >
          <div>
            <div className="profile-inline-fields">{editor}</div>
            <div className="profile-inline-actions">
              <span>Изменения сохраняются в черновик</span>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={onSave}
              >
                {busy ? (
                  <Loader2 className="spin" size={17} />
                ) : (
                  <Check size={17} />
                )}{" "}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
export function SummaryRows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="profile-summary-rows">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {value || <span className="profile-value-empty">Не указано</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function Chips({ values }: { values: string[] }) {
  const items = values.filter((v) => v.trim());
  return items.length ? (
    <ul className="profile-summary-tags">
      {items.map((v, i) => (
        <li key={i}>{v}</li>
      ))}
    </ul>
  ) : (
    <p className="profile-value-empty">Пока ничего не добавлено</p>
  );
}
export function ProfileSummary({
  profile: p,
  section,
  editingCard,
  onEdit,
  renderEditor,
  onSave,
  busy,
  addWork,
}: {
  profile: Profile;
  section: string;
  editingCard: string | null;
  onEdit: (card: string | null) => void;
  renderEditor: (card: string) => ReactNode;
  onSave: () => void;
  busy: boolean;
  addWork: () => void;
}) {
  const card = (
    key: string,
    title: string,
    body: ReactNode,
    missing = false,
  ) => (
    <SummaryCard
      key={key}
      cardKey={key}
      title={title}
      missing={missing}
      editor={renderEditor(key)}
      open={editingCard === key}
      onToggle={() => onEdit(editingCard === key ? null : key)}
      onSave={onSave}
      busy={busy}
    >
      {body}
    </SummaryCard>
  );
  if (section === "personal")
    return (
      <>
        <div className="form-section-heading">
          <div>
            <h2>Личные данные</h2>
            <p>Фото, статус и контакты — основа вашего профиля.</p>
          </div>
        </div>
        {card(
          "identity",
          "Фото и статус",
          <div className="profile-identity-summary">
            <ProfileAvatar profile={p} className="profile-photo-large" />
            <div>
              <strong>
                {p.headline ||
                  p.roles.filter(Boolean).join(" · ") ||
                  p.specialty}
              </strong>
              <p
                className={`profile-status-label status-${p.jobStatus || "open"}`}
              >
                <span />
                {profileStatus(p)}
              </p>
              <p className="profile-summary-caption">
                Статус виден на вашей карточке и рядом с аватаром.
              </p>
            </div>
          </div>,
        )}
        {card(
          "personal",
          "Личная информация",
          <SummaryRows
            rows={[
              ["Имя и фамилия", p.name],
              ["Город", p.city],
              ["Электронная почта", p.email],
              ["Телефон", p.phone],
            ]}
          />,
          !p.city,
        )}
        {card(
          "location",
          "Локация и переезд",
          <SummaryRows
            rows={[
              ["Страна", p.country],
              ["Регион", p.region],
              [
                "Желаемые локации",
                p.preferredLocations.filter(Boolean).join(", "),
              ],
              ["Переезд", p.relocation ? "Рассматриваю" : "Не рассматриваю"],
            ]}
          />,
        )}
      </>
    );
  if (section === "skills")
    return (
      <>
        {card(
          "roles",
          "Желаемые роли и опыт",
          <>
            <p className="profile-summary-caption">
              Направления, в которых хотите развиваться.
            </p>
            <Chips values={p.roles} />
            <SummaryRows
              rows={[
                ["Направление в IT", professionalDirection(p)],
                [
                  "Сферы компаний",
                  (p.preferredIndustries || [p.industry]).join(" · "),
                ],
                ["Предполагаемый грейд", p.claimed],
                [
                  "Коммерческий опыт",
                  p.experience ? `${p.experience} лет` : "Пока нет опыта",
                ],
              ]}
            />
          </>,
          !p.roles.length,
        )}
        {card(
          "skills",
          "Ваши навыки",
          <>
            <Chips values={p.skills} />
            <p className="profile-summary-caption">
              Подтверждённые навыки появятся после отдельной проверки.
            </p>
          </>,
          !p.skills.length,
        )}
        {card(
          "bio",
          "О себе",
          <>
            <p className="profile-summary-paragraph">
              {p.bio || "Расскажите о сильных сторонах и интересных задачах."}
            </p>
            <Chips values={p.softSkills} />
          </>,
          !p.bio.trim(),
        )}
      </>
    );
  if (section === "expectations")
    return (
      <>
        <div className="form-section-heading">
          <div>
            <h2>Условия работы</h2>
            <p>Какие предложения вы хотите получать.</p>
          </div>
        </div>
        {card(
          "format",
          "Локация и формат",
          <SummaryRows
            rows={[
              ["Формат работы", p.format],
              ["Город", p.city],
              ["Желаемые локации", p.preferredLocations.join(" · ")],
              ["Переезд", p.relocation ? "Рассматриваю" : "Не рассматриваю"],
            ]}
          />,
        )}
        {card(
          "employment",
          "Занятость",
          <SummaryRows
            rows={[
              ["Тип занятости", p.employment],
              ["Готовность начать", p.availability],
            ]}
          />,
        )}
        {card(
          "salary",
          "Зарплатные ожидания",
          <SummaryRows
            rows={[
              [
                "В месяц",
                p.salaryMin && p.salaryMax
                  ? `${money(p.salaryMin)} — ${money(p.salaryMax)} ₽`
                  : "",
              ],
            ]}
          />,
          !p.salaryMin || !p.salaryMax,
        )}
        {card(
          "consent",
          "Участие в подборе",
          <p>
            {p.consent
              ? "Согласие сохранено. Контакты открываются по вашему решению."
              : "Заполните обязательные данные и подтвердите согласие на участие."}
          </p>,
          !p.consent,
        )}
      </>
    );
  return (
    <>
      <div className="profile-experience-heading">
        <div>
          <h2>Опыт работы</h2>
          <p>Учебные и личные проекты тоже подходят.</p>
        </div>
        <button
          type="button"
          className="btn outline"
          disabled={p.workHistory.length >= 12}
          onClick={addWork}
        >
          <Plus size={18} /> Добавить
        </button>
      </div>
      {p.workHistory.length
        ? p.workHistory.map((w) =>
            card(
              `work:${w.id}`,
              w.company || "Новое место работы",
              <>
                <SummaryRows
                  rows={[
                    ["Должность", w.role],
                    [
                      "Период",
                      `${w.start || "Не указан"} — ${w.current ? "По настоящее время" : w.end || "Не указан"}`,
                    ],
                  ]}
                />
                <p className="profile-summary-paragraph">{w.description}</p>
              </>,
            ),
          )
        : card(
            "work",
            "История работы",
            <p className="profile-value-empty">
              Пока нет записей. Можно начать без коммерческого опыта.
            </p>,
          )}
      {card(
        "projects",
        "Проекты",
        <p className="profile-summary-paragraph">
          {p.projects || "Добавьте учебные, личные или коммерческие проекты."}
        </p>,
        !p.projects.trim(),
      )}
      {card(
        "education",
        "Образование и курсы",
        <p className="profile-summary-paragraph">
          {p.education || "Пока не добавлено"}
        </p>,
        !p.education.trim(),
      )}
      {card(
        "languages",
        "Языки",
        <Chips values={p.languages} />,
        !p.languages.filter(Boolean).length,
      )}
      {card(
        "links",
        "Портфолио и ссылки",
        <Chips values={p.links} />,
        !p.links.filter(Boolean).length,
      )}
      {card(
        "notes",
        "Дополнительные сведения",
        <p className="profile-summary-paragraph">
          {p.notes || "Заметки, которые появятся в конце вашего резюме."}
        </p>,
      )}
    </>
  );
}
