"use client";
import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Building2 } from "lucide-react";
import type { CompanyProfile } from "@/lib/model";
import { assetUrl } from "@/lib/employer-profile";
import { demoEmployers } from "@/lib/vacancy-catalog";
export function EmployerField({
  label,
  hint,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="employer-field field">
      <span>
        {label}
        {required && <b aria-hidden="true"> *</b>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function EmployerSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | { value: string; label: string }>;
}) {
  return (
    <Select
      value={value || "__any"}
      onValueChange={(v) => onChange(v === "__any" ? "" : v)}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder="Выберите" />
      </SelectTrigger>
      <SelectContent>
        {options.map((item) => {
          const option =
            typeof item === "string" ? { value: item, label: item } : item;
          return (
            <SelectItem
              key={option.value || "__any"}
              value={option.value || "__any"}
            >
              {option.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
export function CompanyMark({
  company,
  className = "",
}: {
  company: CompanyProfile;
  className?: string;
}) {
  const src =
    assetUrl(company.logoKey) ||
    Object.values(demoEmployers).find((c) => c.name === company.name)?.logo;
  return (
    <span className={`employer-company-mark ${className}`}>
      {src ? (
        <img src={src} alt={`Логотип ${company.name}`} />
      ) : (
        <Building2 size={28} />
      )}
    </span>
  );
}
export function CompanyShowcase({ company }: { company: CompanyProfile }) {
  const photos = (company.media || []).filter((m) => m.kind === "gallery");
  return (
    <article className="company-showcase">
      {company.coverKey && (
        <img
          className="company-showcase-cover"
          src={assetUrl(company.coverKey)}
          alt={`Обложка компании ${company.name}`}
        />
      )}
      <div className="company-showcase-intro">
        <CompanyMark company={company} />
        <div>
          <h2>{company.name || "Ваша компания"}</h2>
          <p>{company.tagline || "Добавьте короткое описание вашей команды"}</p>
        </div>
      </div>
      <div className="company-facts">
        {[
          company.industry,
          company.size,
          company.city,
          company.founded ? `С ${company.founded} года` : "",
        ]
          .filter(Boolean)
          .map((value) => (
            <span key={value}>{value}</span>
          ))}
      </div>
      {(
        [
          ["О компании", company.description],
          ["Наша миссия", company.mission],
          ["Продукты и задачи", company.products],
          ["Команда и культура", company.culture],
        ] as const
      )
        .filter(([, value]) => value)
        .map(([title, value]) => (
          <section className="company-story" key={title}>
            <h3>{title}</h3>
            <p>{value}</p>
          </section>
        ))}
      {!!company.technologies?.length && (
        <section className="company-story">
          <h3>Наши технологии</h3>
          <div className="employer-chips">
            {company.technologies.map((v) => (
              <span key={v}>{v}</span>
            ))}
          </div>
        </section>
      )}
      {(
        [
          ["Что для нас важно", company.values],
          ["Что мы предлагаем", company.benefits],
        ] as const
      )
        .filter(([, items]) => items?.some((v) => v.trim()))
        .map(([title, items]) => (
          <section className="company-story" key={title}>
            <h3>{title}</h3>
            <ul>
              {items
                ?.filter((v) => v.trim())
                .map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
            </ul>
          </section>
        ))}
      {photos.length > 0 && (
        <section className="company-story">
          <h3>Жизнь команды</h3>
          <div className="company-photo-gallery">
            {photos.map((photo, i) => (
              <img
                key={photo.key}
                src={assetUrl(photo.key)}
                alt={`Фото команды ${company.name}, ${i + 1}`}
              />
            ))}
          </div>
        </section>
      )}
      {company.hiringProcess && (
        <section className="company-story">
          <h3>Как проходит знакомство</h3>
          <p>{company.hiringProcess}</p>
        </section>
      )}
      {(company.website || company.email) && (
        <section className="company-story">
          <h3>Контакты компании</h3>
          <div className="company-contacts">
            {company.website && (
              <a href={company.website} target="_blank" rel="noreferrer">
                Сайт компании
              </a>
            )}
            {company.email && (
              <a href={`mailto:${company.email}`}>{company.email}</a>
            )}
            {company.phone && <span>{company.phone}</span>}
          </div>
        </section>
      )}
    </article>
  );
}
