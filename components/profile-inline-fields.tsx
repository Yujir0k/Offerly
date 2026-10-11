"use client";
import { PhoneInput } from "./phone-input";
import { ExperienceInput } from "./experience-input";
import { MonthPicker } from "./month-picker";
import { countryCatalog, regionCatalog } from "@/lib/location-catalogs";
import type { Profile } from "@/lib/model";
import { industries } from "@/lib/model";
import {
  profileGrades,
  availabilityOptions,
  professionalDirections,
  professionalDirection,
  softSkillCatalog,
  languageCatalog,
  languageLevels,
  splitLanguage,
  formatOptions,
  employmentOptions,
  withWorkPreferences,
} from "@/lib/profile-options";
import { ChoiceSelect } from "./choice-select";
import { jobStatuses } from "@/lib/profile-identity";
import { salaryRangeError } from "@/lib/salary-range";
import { SelectField } from "./journey";
import { SuggestionTags, SuggestionText } from "./suggestion-picker";
import {
  cityCatalog,
  skillCatalog,
  companyCatalog,
  professionCatalog,
} from "@/lib/suggestion-catalogs";
import { Checkbox } from "./ui/checkbox";
import { Field, FieldLabel } from "./ui/field";
import { Plus, Trash2 } from "lucide-react";

export function ProfileInlineFields({
  profile,
  card,
  put,
  addWork,
}: {
  profile: Profile;
  card: string;
  put: (key: keyof Profile, value: unknown) => void;
  addWork: () => void;
}) {
  const p = withWorkPreferences(profile);
  const text = (
    key: keyof Profile,
    label: string,
    options: {
      type?: string;
      required?: boolean;
      placeholder?: string;
      maxLength?: number;
    } = {},
  ) => (
    <label className="field">
      {label}
      {options.required && <i className="required-mark">*</i>}
      <input
        type={options.type || "text"}
        value={String(p[key] ?? "")}
        maxLength={options.maxLength || 200}
        placeholder={options.placeholder}
        required={options.required}
        onChange={(e) => put(key, e.target.value)}
      />
    </label>
  );
  const area = (
    key: keyof Profile,
    label: string,
    placeholder = "",
    maxLength = 3000,
  ) => (
    <label className="field">
      {label}
      <textarea
        rows={4}
        maxLength={maxLength}
        value={String(p[key] || "")}
        placeholder={placeholder}
        onChange={(e) => put(key, e.target.value)}
      />
    </label>
  );
  const city = (
    <Field className="field">
      <FieldLabel htmlFor={`city-${card}`}>
        Город <i className="required-mark">*</i>
      </FieldLabel>
      <SuggestionText
        id={`city-${card}`}
        value={p.city}
        onChange={(v) => put("city", v)}
        catalog={cityCatalog}
      />
    </Field>
  );
  const relocate = (
    <label className="filter-check">
      <Checkbox
        checked={p.relocation}
        onCheckedChange={(v) => put("relocation", v === true)}
      />{" "}
      Рассматриваю переезд
    </label>
  );
  if (card === "identity")
    return (
      <>
        {text("headline", "Короткий заголовок профиля", {
          placeholder: "Backend-разработчик · Python и продукты",
          maxLength: 100,
        })}
        <label className="field">
          Статус поиска
          <ChoiceSelect
            label="Статус поиска"
            value={p.jobStatus || "open"}
            onChange={(v) => put("jobStatus", v)}
            options={Object.entries(jobStatuses).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <small>
            Статус отображается рядом с фотографией. При выборе «Не ищу работу»
            профиль не участвует в подборе.
          </small>
        </label>
      </>
    );
  if (card === "personal")
    return (
      <div className="form-two">
        {text("lastName", "Фамилия", { required: true, maxLength: 60 })}
        {text("firstName", "Имя", { required: true, maxLength: 60 })}
        {text("patronymic", "Отчество", {
          maxLength: 60,
          placeholder: "Необязательно",
        })}
        {text("email", "Электронная почта", { type: "email", required: true })}
        <PhoneInput value={p.phone} onChange={(v) => put("phone", v)} />
        {city}
      </div>
    );
  if (card === "location")
    return (
      <>
        <div className="form-two">
          <Field className="field">
            <FieldLabel htmlFor="profile-country">Страна проживания</FieldLabel>
            <SuggestionText
              id="profile-country"
              value={p.country}
              onChange={(v) => put("country", v)}
              catalog={countryCatalog}
            />
          </Field>
          <Field className="field">
            <FieldLabel htmlFor="profile-region">Регион</FieldLabel>
            <SuggestionText
              id="profile-region"
              value={p.region}
              onChange={(v) => put("region", v)}
              catalog={regionCatalog(p.country)}
            />
          </Field>
        </div>
        <Field className="field">
          <FieldLabel htmlFor="preferred-locations">Желаемые города</FieldLabel>
          <SuggestionTags
            id="preferred-locations"
            value={p.preferredLocations}
            onChange={(v) => put("preferredLocations", v)}
            catalog={cityCatalog}
          />
        </Field>
        {relocate}
      </>
    );
  if (card === "roles")
    return (
      <>
        <div className="form-two">
          <Field className="field">
            <FieldLabel htmlFor="profile-industry">Сфера компании</FieldLabel>
            <SuggestionTags
              id="profile-industry"
              value={p.preferredIndustries || [p.industry].filter(Boolean)}
              onChange={(v) => put("preferredIndustries", v)}
              catalog={industries.map((name) => ({
                name,
                group: "Сферы компаний",
              }))}
              maxSelected={20}
              placeholder="Например, финтех или образование"
            />
            <small>
              В каких сферах хотите работать. Можно выбрать несколько или
              добавить свою.
            </small>
          </Field>
          <Field className="field">
            <FieldLabel htmlFor="profile-direction">
              Направление в IT
            </FieldLabel>
            <SuggestionText
              id="profile-direction"
              value={professionalDirection(p)}
              onChange={(v) => put("professionalDirection", v)}
              catalog={professionalDirections}
              placeholder="Ваша специализация или свой вариант"
            />
            <small>
              Чем вы занимаетесь: разработка, дизайн, данные, безопасность и
              другое.
            </small>
          </Field>
          <SelectField
            label="Предполагаемый грейд"
            value={p.claimed}
            options={profileGrades}
            onChange={(v) => put("claimed", v)}
          />
          <label className="field">
            Коммерческий опыт, лет
            <ExperienceInput
              value={p.experience}
              onChange={(v) => put("experience", v)}
            />
          </label>
        </div>
        <Field className="field">
          <FieldLabel htmlFor="profile-roles">
            Желаемые роли <i className="required-mark">*</i>
          </FieldLabel>
          <SuggestionTags
            id="profile-roles"
            value={p.roles}
            onChange={(v) => put("roles", v)}
            catalog={professionCatalog}
            maxSelected={20}
          />
        </Field>
        <p className="muted">
          Предполагаемый грейд — ваша самооценка. Подтверждённая категория
          появится после проверки.
        </p>
      </>
    );
  if (card === "skills")
    return (
      <Field className="field">
        <FieldLabel htmlFor="profile-skills">
          Технологии <i className="required-mark">*</i>
        </FieldLabel>
        <SuggestionTags
          id="profile-skills"
          value={p.skills}
          onChange={(v) => put("skills", v)}
          catalog={skillCatalog}
        />
      </Field>
    );
  if (card === "bio")
    return (
      <>
        {area(
          "bio",
          "О себе",
          "Сильные стороны, интересные задачи и подход к работе",
        )}
        <Field className="field">
          <FieldLabel htmlFor="profile-soft-skills">Софт-скиллы</FieldLabel>
          <SuggestionTags
            id="profile-soft-skills"
            value={p.softSkills}
            onChange={(v) => put("softSkills", v)}
            catalog={softSkillCatalog}
            maxSelected={20}
            placeholder="Выберите сильные стороны или добавьте свои"
          />
        </Field>
      </>
    );
  if (card === "format")
    return (
      <>
        <div className="form-two">
          <Field className="field">
            <FieldLabel htmlFor="profile-formats">Формат работы</FieldLabel>
            <SuggestionTags
              id="profile-formats"
              value={p.formats || []}
              onChange={(v) => put("formats", v)}
              catalog={formatOptions.map((name) => ({ name, group: "Формат" }))}
              allowCustom={false}
              maxSelected={3}
              placeholder="Можно выбрать несколько форматов"
            />
          </Field>
          {city}
        </div>
        <Field className="field">
          <FieldLabel htmlFor="work-locations">
            Предпочтительные локации работы
          </FieldLabel>
          <SuggestionTags
            id="work-locations"
            value={p.preferredLocations}
            onChange={(v) => put("preferredLocations", v)}
            catalog={cityCatalog}
            placeholder="Добавьте несколько городов"
          />
        </Field>
        {relocate}
      </>
    );
  if (card === "employment")
    return (
      <div className="form-two">
        <Field className="field">
          <FieldLabel htmlFor="profile-employment">Занятость</FieldLabel>
          <SuggestionTags
            id="profile-employment"
            value={p.employmentTypes || []}
            onChange={(v) => put("employmentTypes", v)}
            catalog={employmentOptions.map((name) => ({
              name,
              group: "Занятость",
            }))}
            allowCustom={false}
            maxSelected={4}
            placeholder="Выберите подходящие варианты"
          />
        </Field>
        <Field className="field">
          <FieldLabel htmlFor="profile-availability">
            Когда готовы начать?
          </FieldLabel>
          <SuggestionTags
            id="profile-availability"
            value={p.availabilities || []}
            onChange={(v) => put("availabilities", v)}
            catalog={availabilityOptions.map((name) => ({
              name,
              group: "Готовность к работе",
            }))}
            allowCustom={false}
            maxSelected={4}
            placeholder="Выберите подходящие сроки"
          />
        </Field>
      </div>
    );
  if (card === "salary") {
    const error =
      p.salaryMin && p.salaryMax
        ? salaryRangeError(p.salaryMin, p.salaryMax)
        : null;
    return (
      <>
        <div className="form-two">
          <label className="field">
            Зарплата от, ₽/мес <i className="required-mark">*</i>
            <input
              type="number"
              min={1}
              max={p.salaryMax || 10000000}
              aria-invalid={!!error}
              value={p.salaryMin || ""}
              onChange={(e) => put("salaryMin", Number(e.target.value))}
            />
          </label>
          <label className="field">
            До, ₽/мес <i className="required-mark">*</i>
            <input
              type="number"
              min={p.salaryMin || 1}
              max={10000000}
              aria-invalid={!!error}
              value={p.salaryMax || ""}
              onChange={(e) => put("salaryMax", Number(e.target.value))}
            />
          </label>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </>
    );
  }
  if (card === "consent")
    return (
      <label className="filter-check consent-publication">
        <Checkbox
          checked={p.consent}
          onCheckedChange={(v) => put("consent", v === true)}
        />{" "}
        Разрешаю показывать профессиональный профиль работодателям после
        проверки навыков <i className="required-mark">*</i>
      </label>
    );
  if (card === "projects")
    return area(
      "projects",
      "Проекты и достижения",
      "Что сделали, за что отвечали и какой получили результат?",
      5000,
    );
  if (card === "education")
    return area(
      "education",
      "Образование и курсы",
      "Учебное заведение, направление и год окончания",
      6000,
    );
  if (card === "notes")
    return area(
      "notes",
      "Дополнительные сведения",
      "Что ещё важно работодателю? Этот текст появится в конце резюме.",
      6000,
    );
  if (card === "languages")
    return (
      <div className="profile-language-list">
        {p.languages.map((value, index) => {
          const { language, level } = splitLanguage(value);
          const change = (name: string, proficiency: string) =>
            put(
              "languages",
              p.languages.map((v, i) =>
                i === index
                  ? [name, proficiency].filter(Boolean).join(" — ")
                  : v,
              ),
            );
          return (
            <div className="profile-language-row" key={index}>
              <Field className="field">
                <FieldLabel htmlFor={`language-${index}`}>Язык</FieldLabel>
                <SuggestionText
                  id={`language-${index}`}
                  value={language}
                  onChange={(v) => change(v, level)}
                  catalog={languageCatalog}
                  placeholder="Выберите язык"
                />
              </Field>
              <Field className="field">
                <FieldLabel>Уровень владения</FieldLabel>
                <ChoiceSelect
                  label={`Уровень языка ${index + 1}`}
                  value={level}
                  onChange={(v) => change(language, v)}
                  options={languageLevels.map((v) => ({ value: v, label: v }))}
                />
              </Field>
              <button
                type="button"
                className="profile-remove-row"
                aria-label={`Удалить язык ${language || index + 1}`}
                onClick={() =>
                  put(
                    "languages",
                    p.languages.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 size={17} />
              </button>
            </div>
          );
        })}
        <button
          className="btn outline"
          type="button"
          disabled={p.languages.length >= 20}
          onClick={() => put("languages", [...p.languages, ""])}
        >
          <Plus size={17} /> Добавить язык
        </button>
      </div>
    );
  if (card === "links")
    return (
      <label className="field">
        Портфолио и профессиональные ссылки
        <textarea
          rows={3}
          value={p.links.join("\n")}
          onChange={(e) => put("links", e.target.value.split("\n"))}
          placeholder="По одной ссылке в строке: https://github.com/…"
        />
      </label>
    );
  if (card.startsWith("work")) {
    const entries = card.includes(":")
      ? p.workHistory.filter((w) => w.id === card.slice(5))
      : p.workHistory;
    return (
      <>
        {entries.map((w) => {
          const patch = (values: Partial<typeof w>) =>
            put(
              "workHistory",
              p.workHistory.map((x) =>
                x.id === w.id ? { ...x, ...values } : x,
              ),
            );
          return (
            <div className="profile-inline-work" key={w.id}>
              <div className="form-two">
                <Field className="field">
                  <FieldLabel htmlFor={`company-${w.id}`}>Компания</FieldLabel>
                  <SuggestionText
                    id={`company-${w.id}`}
                    value={w.company}
                    onChange={(v) => patch({ company: v })}
                    catalog={companyCatalog}
                  />
                </Field>
                <Field className="field">
                  <FieldLabel htmlFor={`work-role-${w.id}`}>
                    Должность
                  </FieldLabel>
                  <SuggestionText
                    id={`work-role-${w.id}`}
                    value={w.role}
                    onChange={(v) => patch({ role: v })}
                    catalog={professionCatalog}
                  />
                </Field>
                <label className="field">
                  Начало
                  <MonthPicker
                    value={w.start}
                    max={!w.current ? w.end || undefined : undefined}
                    onChange={(value) => patch({ start: value })}
                  />
                </label>
                <label className="field">
                  Окончание
                  <MonthPicker
                    disabled={w.current}
                    min={w.start || undefined}
                    value={w.end}
                    onChange={(value) => patch({ end: value })}
                  />
                </label>
              </div>
              <label className="filter-check">
                <Checkbox
                  checked={w.current}
                  onCheckedChange={(v) => patch({ current: v === true })}
                />{" "}
                Работаю здесь сейчас
              </label>
              <label className="field">
                Задачи и результаты
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={w.description}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </label>
              {!w.current && w.start && w.end && w.end < w.start && (
                <p className="inline-error" role="alert">
                  Дата окончания не может быть раньше начала.
                </p>
              )}
              <button
                className="btn outline"
                type="button"
                onClick={() =>
                  put(
                    "workHistory",
                    p.workHistory.filter((x) => x.id !== w.id),
                  )
                }
              >
                <Trash2 size={16} /> Удалить запись
              </button>
            </div>
          );
        })}
        {card === "work" && (
          <button className="btn outline" type="button" onClick={addWork}>
            <Plus size={16} /> Добавить место работы
          </button>
        )}
      </>
    );
  }
  return null;
}
