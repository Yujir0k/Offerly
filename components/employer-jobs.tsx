"use client";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Archive,
  Check,
  Eye,
  Plus,
  Search,
  Send,
  Users,
  MapPin,
  BriefcaseBusiness,
} from "lucide-react";
import type { State, Job } from "@/lib/model";
import { money, specialties } from "@/lib/model";
import { ownsJob } from "@/lib/job-applications";
import {
  assetUrl,
  specialtyLabels,
  publishedJob,
} from "@/lib/employer-profile";
import { profileGrades, employmentOptions } from "@/lib/profile-options";
import { cityCatalog, skillCatalog } from "@/lib/suggestion-catalogs";
import { useDraft, DraftStatus } from "@/hooks/use-draft";
import { salaryRangeError } from "@/lib/salary-range";
import { SuggestionTags, SuggestionText } from "./suggestion-picker";
import { EmployerField, EmployerSelect, CompanyMark } from "./employer-ui";
import { CompanyMediaUpload } from "./company-editor";
import { CandidateVacancies } from "./candidate-vacancies";
import type { Navigate } from "./landing";
import { EmployerJobApplications } from "./employer-job-applications";
import type { Action } from "./registration";
function JobEditor({
  s,
  job,
  act,
  close,
  onStateChange,
}: {
  s: State;
  job?: Job;
  act: Action;
  close: (status?: "draft" | "published") => void;
  onStateChange: (s: State) => void;
}) {
  const [d, setD, meta] = useDraft(`job:editor_${job?.id || "new"}`, {
    title: job?.title || "",
    description: job?.description || "",
    specialty: job?.specialty || "Backend",
    grade: job?.grade || "Middle",
    skills: job?.skills || [],
    format: job?.format || "Удалённо",
    employment: job?.employment || "Полная занятость",
    city: job?.city || s.company.city || "",
    team: job?.team || "",
    min: job?.min ? String(job.min) : "",
    max: job?.max ? String(job.max) : "",
    experienceMin: job?.experienceMin || 0,
    experienceMax:
      job?.experienceMax === undefined ? "" : String(job.experienceMax),
    responsibilities: job?.responsibilities || [],
    requirements: job?.requirements || [],
    niceToHave: job?.niceToHave || [],
    benefits: job?.benefits || s.company.benefits || [],
    hiringProcess: job?.hiringProcess || s.company.hiringProcess || "",
    mediaKeys: job?.mediaKeys || [],
  });
  const [tab, setTab] = useState("role"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (key: keyof typeof d, value: any) =>
    setD((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    const allowed = new Set([
      ...(s.company.media || []).map((m) => m.key),
      ...(job?.mediaKeys || []),
    ]);
    if (d.mediaKeys.some((key) => !allowed.has(key)))
      setD((current) => ({
        ...current,
        mediaKeys: current.mediaKeys.filter((key) => allowed.has(key)),
      }));
  }, [s.company.media, job?.mediaKeys, d.mediaKeys, setD]);
  const tabs = [
    ["role", "Роль и условия"],
    ["tasks", "Задачи и требования"],
    ["team", "Команда и фотографии"],
    ["preview", "Предпросмотр"],
  ];
  async function save(status: "draft" | "published") {
    setError("");
    if (status === "published") {
      if (!d.title.trim() || !d.description.trim() || !d.skills.length) {
        setTab("role");
        setError(
          "Заполните название, описание роли и профессиональные навыки.",
        );
        return;
      }
      const rangeError = salaryRangeError(d.min, d.max);
      if (rangeError) {
        setTab("role");
        setError(rangeError);
        return;
      }
      if (d.format !== "Удалённо" && !d.city) {
        setTab("role");
        setError("Укажите город для офисного или гибридного формата.");
        return;
      }
    }
    setBusy(true);
    const result = await act("job", { ...d, id: job?.id, status });
    setBusy(false);
    if (result) {
      if (!job)
        meta.reset({
          ...d,
          title: "",
          description: "",
          skills: [],
          min: "",
          max: "",
          mediaKeys: [],
        });
      close(status);
    } else
      setError(
        "Не удалось сохранить вакансию. Проверьте данные и повторите попытку.",
      );
  }
  const salary =
    d.min && d.max
      ? `${money(Number(d.min))} — ${money(Number(d.max))} ₽/мес`
      : "Укажите зарплатный диапазон";
  const details = (
    [
      ["Задачи", d.responsibilities],
      ["Требования", d.requirements],
      ["Будет преимуществом", d.niceToHave],
      ["Предлагаем", d.benefits],
    ] as const
  ).filter(([, items]) => items.length);
  const preview = (
    <article className="employer-panel employer-vacancy-preview">
      <div className="employer-company-heading">
        <CompanyMark company={s.company} />
        <div>
          <strong>{s.company.name || "Ваша компания"}</strong>
          <p>{d.team || s.company.tagline}</p>
        </div>
      </div>
      <h2>{d.title || "Название вакансии"}</h2>
      <strong className="employer-salary">{salary}</strong>
      <small>В месяц · до вычета налогов</small>
      <div className="company-facts">
        <span>{d.grade}</span>
        <span>{d.format}</span>
        {d.city && <span>{d.city}</span>}
        <span>{d.employment}</span>
      </div>
      <div className="employer-chips">
        {d.skills.map((v) => (
          <span key={v}>{v}</span>
        ))}
      </div>
      <p className="employer-description">
        {d.description || "Опишите роль и задачи команды"}
      </p>
      {details.map(([title, items]) => (
        <section key={title}>
          <h3>{title}</h3>
          <ul>
            {items.filter(Boolean).map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </section>
      ))}
      {!!d.mediaKeys.length && (
        <div className="company-photo-gallery">
          {d.mediaKeys.map((key, i) => (
            <img key={key} src={assetUrl(key)} alt={`Фото команды, ${i + 1}`} />
          ))}
        </div>
      )}
      {d.hiringProcess && (
        <section>
          <h3>Как проходит знакомство</h3>
          <p>{d.hiringProcess}</p>
        </section>
      )}
    </article>
  );
  return (
    <div className="employer-content">
      <div className="employer-toolbar">
        <button className="employer-link" onClick={() => close()}>
          <ArrowLeft size={17} />К моим вакансиям
        </button>
        <div className="employer-toolbar-actions">
          {(!job || job.status === "draft") && (
            <button
              className="employer-button"
              disabled={busy}
              onClick={() => save("draft")}
            >
              Сохранить черновик
            </button>
          )}
          <button
            className="employer-button primary"
            disabled={busy}
            onClick={() => save("published")}
          >
            {busy
              ? "Сохраняем…"
              : job && publishedJob(job)
                ? "Сохранить изменения"
                : "Опубликовать вакансию"}
            <Check size={17} />
          </button>
        </div>
      </div>
      <nav className="employer-editor-tabs" aria-label="Разделы вакансии">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <DraftStatus meta={meta} />
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {tab === "preview" ? (
        preview
      ) : (
        <div className="employer-editor-layout">
          <section className="employer-panel company-form-panel">
            {tab === "role" && (
              <>
                <h2>Кого вы ищете</h2>
                <p className="employer-section-note">
                  Профессия, условия и зарплата будут видны кандидату до начала
                  общения.
                </p>
                <EmployerField label="Название вакансии" required>
                  <input
                    value={d.title}
                    maxLength={200}
                    onChange={(e) => set("title", e.target.value)}
                    placeholder="Например, Backend-разработчик Python"
                  />
                </EmployerField>
                <EmployerField label="Коротко о роли" required>
                  <textarea
                    rows={4}
                    maxLength={6000}
                    value={d.description}
                    onChange={(e) => set("description", e.target.value)}
                    placeholder="Что будет делать специалист и какой результат нужен команде"
                  />
                </EmployerField>
                <div className="employer-form-grid">
                  <EmployerField label="Специализация" required>
                    <EmployerSelect
                      label="Специализация вакансии"
                      value={d.specialty}
                      options={specialties.map((value) => ({
                        value,
                        label: specialtyLabels[value],
                      }))}
                      onChange={(v) => set("specialty", v)}
                    />
                  </EmployerField>
                  <EmployerField label="Уровень вакансии" required>
                    <EmployerSelect
                      label="Уровень вакансии"
                      value={d.grade}
                      options={profileGrades.map((value) => ({
                        value,
                        label: value === "Intern" ? "Стажёр (Intern)" : value,
                      }))}
                      onChange={(v) => set("grade", v)}
                    />
                  </EmployerField>
                </div>
                <EmployerField label="Профессиональные навыки" required>
                  <SuggestionTags
                    id="job-editor-skills"
                    value={d.skills}
                    catalog={skillCatalog}
                    maxSelected={40}
                    onChange={(v) => set("skills", v)}
                    placeholder="Python, SQL, React…"
                  />
                </EmployerField>
                <div className="employer-form-grid">
                  <EmployerField label="Зарплата от, ₽/мес" required>
                    <input
                      type="number"
                      min={1}
                      max={10000000}
                      value={d.min}
                      onChange={(e) => set("min", e.target.value)}
                      placeholder="180000"
                    />
                  </EmployerField>
                  <EmployerField label="Зарплата до, ₽/мес" required>
                    <input
                      type="number"
                      min={1}
                      max={10000000}
                      value={d.max}
                      onChange={(e) => set("max", e.target.value)}
                      placeholder="240000"
                    />
                  </EmployerField>
                  <EmployerField label="Формат работы" required>
                    <EmployerSelect
                      label="Формат работы вакансии"
                      value={d.format}
                      options={["Удалённо", "Гибрид", "Офис"]}
                      onChange={(v) => set("format", v)}
                    />
                  </EmployerField>
                  <EmployerField label="Занятость">
                    <EmployerSelect
                      label="Занятость вакансии"
                      value={d.employment}
                      options={employmentOptions}
                      onChange={(v) => set("employment", v)}
                    />
                  </EmployerField>
                  <EmployerField
                    label="Город"
                    hint="Для офиса и гибрида укажите город"
                  >
                    <SuggestionText
                      id="job-editor-city"
                      value={d.city}
                      catalog={cityCatalog}
                      onChange={(v) => set("city", v)}
                      placeholder="Город или регион"
                    />
                  </EmployerField>
                  <EmployerField
                    label="Опыт от, лет"
                    hint="0 — можно без коммерческого опыта"
                  >
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={d.experienceMin}
                      onChange={(e) =>
                        set(
                          "experienceMin",
                          Math.max(
                            0,
                            Math.min(50, Number(e.target.value) || 0),
                          ),
                        )
                      }
                    />
                  </EmployerField>
                  <EmployerField label="Опыт до, лет" hint="Необязательно">
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={d.experienceMax}
                      onChange={(e) => set("experienceMax", e.target.value)}
                    />
                  </EmployerField>
                </div>
              </>
            )}
            {tab === "tasks" && (
              <>
                <h2>Задачи и ожидания</h2>
                <p className="employer-section-note">
                  Конкретные задачи и требования помогут специалисту оценить
                  предложение.
                </p>
                {(
                  [
                    [
                      "responsibilities",
                      "Чем предстоит заниматься",
                      "Задачи и зона ответственности",
                    ],
                    [
                      "requirements",
                      "Что важно для этой роли",
                      "Навыки и опыт, необходимые для работы",
                    ],
                    [
                      "niceToHave",
                      "Будет преимуществом",
                      "Дополнительные знания, которые помогут",
                    ],
                    [
                      "benefits",
                      "Что предлагает команда",
                      "Условия, развитие и поддержка",
                    ],
                  ] as const
                ).map(([key, label, placeholder]) => (
                  <EmployerField
                    key={key}
                    label={label}
                    hint="Каждый пункт с новой строки"
                  >
                    <textarea
                      rows={5}
                      value={d[key].join("\n")}
                      onChange={(e) => set(key, e.target.value.split("\n"))}
                      placeholder={placeholder}
                    />
                  </EmployerField>
                ))}
              </>
            )}
            {tab === "team" && (
              <>
                <h2>Команда и рабочая атмосфера</h2>
                <EmployerField label="Команда или продукт">
                  <input
                    value={d.team}
                    maxLength={160}
                    onChange={(e) => set("team", e.target.value)}
                    placeholder="Например, команда платформы данных"
                  />
                </EmployerField>
                <EmployerField label="Этапы знакомства">
                  <textarea
                    rows={4}
                    maxLength={3000}
                    value={d.hiringProcess}
                    onChange={(e) => set("hiringProcess", e.target.value)}
                    placeholder="Кто встретится с кандидатом и какие этапы предстоят"
                  />
                </EmployerField>
                <h3>Фотографии для вакансии</h3>
                <p className="employer-section-note">
                  Выберите до четырёх фотографий. Подойдут команда, офис и
                  рабочая атмосфера. Это необязательное поле.
                </p>
                <div className="job-photo-picker">
                  {(s.company.media || [])
                    .filter((m) => m.kind === "gallery")
                    .map((m, i) => (
                      <label
                        key={m.key}
                        className={
                          d.mediaKeys.includes(m.key) ? "selected" : ""
                        }
                      >
                        <img
                          src={assetUrl(m.key)}
                          alt={`Фотография команды ${i + 1}`}
                        />
                        <span>
                          <input
                            type="checkbox"
                            checked={d.mediaKeys.includes(m.key)}
                            disabled={
                              !d.mediaKeys.includes(m.key) &&
                              d.mediaKeys.length >= 4
                            }
                            onChange={(e) =>
                              set(
                                "mediaKeys",
                                e.target.checked
                                  ? [...d.mediaKeys, m.key]
                                  : d.mediaKeys.filter((k) => k !== m.key),
                              )
                            }
                          />
                          Использовать в вакансии
                        </span>
                      </label>
                    ))}
                </div>
                <CompanyMediaUpload
                  kind="gallery"
                  s={s}
                  onStateChange={onStateChange}
                  onUploaded={(key) => {
                    setD((current) =>
                      current.mediaKeys.length < 4
                        ? { ...current, mediaKeys: [...current.mediaKeys, key] }
                        : current,
                    );
                  }}
                />
              </>
            )}
          </section>
          <aside className="employer-editor-aside">
            <section className="employer-panel vacancy-preview-summary">
              <CompanyMark company={s.company} />
              <span>{s.company.name || "Ваша компания"}</span>
              <h2>{d.title || "Ваша новая вакансия"}</h2>
              <strong className="employer-salary">{salary}</strong>
              <div className="company-facts">
                <span>{d.grade}</span>
                <span>{d.format}</span>
              </div>
              <div className="employer-chips">
                {d.skills.slice(0, 5).map((v) => (
                  <span key={v}>{v}</span>
                ))}
              </div>
              <button
                className="employer-link"
                onClick={() => setTab("preview")}
              >
                Посмотреть целиком
                <Eye size={16} />
              </button>
            </section>
            <section className="employer-panel employer-tip">
              <h3>Условия до общения</h3>
              <p>
                Зарплатный диапазон обязателен. Фотографии и дополнительные
                преимущества можно добавить позже.
              </p>
              <p>Компания и её оформление берутся из вашего профиля.</p>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
export function EmployerJobs({
  s,
  act,
  onStateChange,
  nav,
  jobId,
}: {
  s: State;
  act: Action;
  onStateChange: (s: State) => void;
  nav: Navigate;
  jobId?: string;
}) {
  const [editing, setEditing] = useState<Job | "new" | null>(null),
    [tab, setTab] = useState("market"),
    [busy, setBusy] = useState("");
  const owned = s.jobs.filter((j) => ownsJob(j, s));
  const scope =
    tab === "market"
      ? s.jobs.filter(publishedJob)
      : owned.filter((j) => (j.status || "published") === tab);
  if (editing)
    return (
      <JobEditor
        key={editing === "new" ? "new" : editing.id}
        s={s}
        job={editing === "new" ? undefined : editing}
        act={act}
        onStateChange={onStateChange}
        close={(status) => {
          setEditing(null);
          if (status) setTab(status);
          if (jobId) nav("/demo/employer/jobs");
          window.scrollTo({ top: 0, behavior: "instant" });
        }}
      />
    );
  const edit = (job: Job) => {
    setEditing(job);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const actions = (job: Job) =>
    ownsJob(job, s) ? (
      <>
        <button className="vacancy-details-button" onClick={() => edit(job)}>
          Редактировать
        </button>
        <EmployerJobApplications s={s} job={job} act={act} nav={nav} />
        {job.status !== "draft" && (
          <button
            className="employer-link"
            disabled={busy === job.id}
            onClick={async () => {
              setBusy(job.id);
              await act("job-status", {
                id: job.id,
                status: job.status === "archived" ? "published" : "archived",
              });
              setBusy("");
            }}
          >
            <Archive size={16} />
            {job.status === "archived" ? "Вернуть в поиск" : "В архив"}
          </button>
        )}
      </>
    ) : null;
  const toolbar = (
    <div className="employer-catalog-toolbar">
      <h2>Вакансии и рынок</h2>
      <nav
        className="vacancy-view-tabs"
        aria-label="Список вакансий работодателя"
      >
        {[
          ["market", "Все вакансии"],
          ["published", "Мои вакансии"],
          ["draft", "Черновики"],
          ["archived", "Архив"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
            {id !== "market" && (
              <span>
                {s.catalogStats?.[id as "published" | "draft" | "archived"] ??
                  owned.filter((j) => (j.status || "published") === id).length}
              </span>
            )}
          </button>
        ))}
      </nav>
      <button
        className="btn primary"
        onClick={() => {
          setEditing("new");
          window.scrollTo({ top: 0, behavior: "instant" });
        }}
      >
        <Plus size={17} />
        Создать вакансию
      </button>
    </div>
  );
  return (
    <CandidateVacancies
      s={s}
      act={act}
      nav={nav}
      jobId={jobId}
      employer={{ scope, catalogScope: tab, toolbar, actions }}
    />
  );
}
