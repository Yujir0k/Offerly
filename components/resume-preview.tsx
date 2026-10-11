"use client";
import { professionalDirection } from "@/lib/profile-options";
import { LogoMotion } from "./logo-motion";
import { useState } from "react";
import { Download } from "lucide-react";

import type { Profile } from "@/lib/model";
import { money } from "@/lib/model";
import { downloadResume, type ResumeTemplate } from "@/lib/profile-pdf";
import { ProfileAvatar } from "./profile-avatar";
export function ResumePreview({ profile: p }: { profile: Profile }) {
  const [template, setTemplate] = useState<ResumeTemplate>("accent"),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      await downloadResume(p, template);
    } catch (e) {
      setError((e as Error).message || "Не удалось создать PDF");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="resume-builder">
      <div className="resume-builder-heading">
        <div>
          <h2>Ваше резюме Офферли</h2>
          <p>
            Обновляется по мере заполнения профиля. Длинные разделы продолжаются
            на следующих страницах PDF.
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={download}
        >
          {busy ? <LogoMotion size={20} /> : <Download size={18} />} Скачать PDF
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div
        className="resume-template-options"
        role="group"
        aria-label="Оформление резюме"
      >
        {(
          [
            ["accent", "Акцент"],
            ["minimal", "Минимал"],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={template === id}
            onClick={() => setTemplate(id)}
          >
            <span className={`resume-template-swatch ${id}`} />
            {label}
          </button>
        ))}
      </div>
      <div
        className={`resume-paper template-${template}`}
        aria-label="Предпросмотр оформления резюме"
      >
        <aside>
          <div className="resume-brand">
            <img src="/brand/original.svg" alt="" />
            <span>
              Офферли<small>Дело найдёт.</small>
            </span>
          </div>
          <ProfileAvatar profile={p} status={false} className="resume-photo" />
          {p.city && (
            <>
              <h4>ЛОКАЦИЯ</h4>
              <p>{p.city}</p>
            </>
          )}
          <h4>ТЕХНОЛОГИИ</h4>
          <div className="resume-preview-skills">
            {p.skills.filter(Boolean).map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
          {p.languages.length > 0 && (
            <>
              <h4>ЯЗЫКИ</h4>
              <p>{p.languages.join(", ")}</p>
            </>
          )}
          <h4>КОНТАКТЫ</h4>
          <p>
            {p.email}
            <br />
            {p.phone}
          </p>
        </aside>
        <div>
          <h2>{p.name || "Ваше имя"}</h2>
          <strong>
            {p.headline ||
              p.roles.filter(Boolean).join(" · ") ||
              professionalDirection(p)}
          </strong>
          <h3>О себе</h3>
          <p>
            {p.bio ||
              "Несколько слов о ваших сильных сторонах и интересных задачах."}
          </p>
          <h3>Опыт работы</h3>
          {p.workHistory.filter((w) => w.company || w.role).length ? (
            p.workHistory
              .filter((w) => w.company || w.role)
              .map((w) => (
                <article key={w.id}>
                  <b>
                    {w.role} · {w.company}
                  </b>
                  <small>
                    {w.start} — {w.current ? "По настоящее время" : w.end}
                  </small>
                  <p>{w.description}</p>
                </article>
              ))
          ) : (
            <p>Опыт и проекты появятся по мере заполнения.</p>
          )}
          {p.projects && (
            <>
              <h3>Проекты</h3>
              <p>{p.projects}</p>
            </>
          )}
          {p.education && (
            <>
              <h3>Образование</h3>
              <p>{p.education}</p>
            </>
          )}
          <h3>Следующая работа</h3>
          <p>
            {p.format} · {p.employment}
          </p>
          {p.salaryMin > 0 && p.salaryMax > 0 && (
            <p>
              {money(p.salaryMin)} — {money(p.salaryMax)} ₽ в месяц
            </p>
          )}
          {p.notes && (
            <>
              <h3>Дополнительные сведения</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{p.notes}</p>
            </>
          )}
          <footer>Создано в Офферли</footer>
        </div>
      </div>
    </section>
  );
}
