"use client";
import { useState } from "react";
import { Check, ChevronUp, ChevronDown } from "lucide-react";
import type { CompanyProfile } from "@/lib/model";
import { Progress } from "./ui/progress";
export function companyCompletion(c: CompanyProfile) {
  const fields = [
    {
      key: "name",
      label: "Название компании",
      section: "basic",
      required: true,
      done: !!c.name.trim(),
    },
    {
      key: "description",
      label: "О компании",
      section: "story",
      required: true,
      done: !!c.description.trim(),
    },
    {
      key: "industry",
      label: "Сфера компании",
      section: "basic",
      required: true,
      done: !!c.industry,
    },
    {
      key: "size",
      label: "Размер команды",
      section: "basic",
      required: true,
      done: !!c.size,
    },
    {
      key: "city",
      label: "Город компании",
      section: "basic",
      required: true,
      done: !!c.city,
    },
    {
      key: "email",
      label: "Email для связи",
      section: "contacts",
      required: true,
      done: /^\S+@\S+\.\S+$/.test(c.email),
    },
    {
      key: "website",
      label: "Сайт компании",
      section: "contacts",
      required: false,
      done: !!c.website,
    },
    {
      key: "logo",
      label: "Логотип",
      section: "photos",
      required: false,
      done: !!c.logoKey,
    },
    {
      key: "photos",
      label: "Фотографии",
      section: "photos",
      required: false,
      done: !!c.coverKey || !!c.media?.some((m) => m.kind === "gallery"),
    },
    {
      key: "culture",
      label: "Как мы работаем",
      section: "team",
      required: false,
      done: !!c.culture?.trim(),
    },
    {
      key: "hiring",
      label: "Как проходит знакомство с кандидатом",
      section: "team",
      required: false,
      done: !!c.hiringProcess?.trim(),
    },
  ];
  const required = fields.filter((f) => f.required),
    completed = required.filter((f) => f.done).length;
  return {
    fields,
    required,
    completed,
    percent: Math.round(
      (fields.filter((f) => f.done).length / fields.length) * 100,
    ),
  };
}
export function CompanyCompletion({
  company,
  onSelect,
}: {
  company: CompanyProfile;
  onSelect: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(true),
    p = companyCompletion(company);
  return (
    <section
      className="profile-completion profile-completion-rail"
      aria-label="Полнота профиля компании"
    >
      <strong className="profile-rail-percent">{p.percent}%</strong>
      <Progress
        value={p.percent}
        aria-label={`Компания заполнена на ${p.percent}%`}
      />
      <h2>Заполнение профиля</h2>
      <p className="profile-rail-required">
        {p.completed} из {p.required.length} обязательных полей
      </p>
      <button
        type="button"
        className="completion-toggle"
        aria-expanded={expanded}
        aria-controls="company-checklist"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Скрыть список" : "Показать список"}
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {expanded && (
        <>
          <ul id="company-checklist">
            {p.fields.map((f) => (
              <li key={f.key} className={f.done ? "done" : ""}>
                <button
                  type="button"
                  className="profile-completion-link"
                  onClick={() => onSelect(f.key)}
                >
                  {f.done ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <span className="completion-circle" />
                  )}
                  <span>{f.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="profile-completion-hint">
            Логотип, фотографии и подробности о команде можно добавить позже.
            Процент отражает содержание профиля, а не проверку компании.
          </p>
        </>
      )}
    </section>
  );
}
