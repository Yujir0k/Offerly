"use client";
import { createPortal } from "react-dom";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { SummaryCard, SummaryRows } from "./profile-summary";
import { CompanyCompletion, companyCompletion } from "./company-completion";
import { formatPhone, phoneError } from "@/lib/phone";
import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  ImagePlus,
  Trash2,
  Upload,
  Building2,
  Pencil,
} from "lucide-react";
import type { State } from "@/lib/model";
import type { Action } from "./registration";
import { useDraft, DraftStatus } from "@/hooks/use-draft";
import { SuggestionTags, SuggestionText } from "./suggestion-picker";
import { skillCatalog, cityCatalog } from "@/lib/suggestion-catalogs";
import { industries } from "@/lib/model";
import {
  assetUrl,
  companySizes,
  companyWebsiteError,
} from "@/lib/employer-profile";
import {
  EmployerField,
  EmployerSelect,
  CompanyMark,
  CompanyShowcase,
} from "./employer-ui";
export function CompanyMediaUpload({
  kind,
  s,
  onStateChange,
  onUploaded,
}: {
  kind: "logo" | "cover" | "gallery";
  s: State;
  onStateChange: (s: State) => void;
  onUploaded?: (key: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (
      !/^image\/(png|jpeg|webp)$/.test(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Выберите JPG, PNG или WebP до 5 МБ");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("role", "employer");
      form.set("kind", kind);
      const response = await fetch("/api/company-media", {
        method: "POST",
        body: form,
      });
      const body = (await response.json().catch(() => null)) as
        | (State & {
            error?: string;
            uploadedKey: string;
          })
        | null;
      if (!response.ok || !body)
        throw new Error(
          body?.error ||
            (response.status === 413
              ? "Файл слишком большой. Выберите изображение до 5 МБ."
              : "Не удалось загрузить изображение. Попробуйте ещё раз."),
        );
      onStateChange(body);
      onUploaded?.(body.uploadedKey);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  const key =
    kind === "logo"
      ? s.company.logoKey
      : kind === "cover"
        ? s.company.coverKey
        : undefined;
  return (
    <div className={`company-media-uploader media-${kind}`}>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        ref={input}
        aria-label={
          kind === "logo"
            ? "Логотип компании"
            : kind === "cover"
              ? "Обложка компании"
              : "Фотография компании"
        }
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      {key && (
        <img
          src={assetUrl(key)}
          alt={kind === "logo" ? "Логотип компании" : "Обложка компании"}
        />
      )}
      <div>
        <ImagePlus size={24} />
        <h3>
          {kind === "logo"
            ? "Логотип"
            : kind === "cover"
              ? "Обложка компании"
              : "Фотографии команды"}
        </h3>
        <p>
          {kind === "logo"
            ? "Квадратное изображение, желательно от 400 × 400 px."
            : kind === "cover"
              ? "Широкая фотография офиса, команды или продукта. Формат 3:1, желательно от 1500 × 500 px."
              : "Офис, люди, командные события и рабочая атмосфера. До восьми фотографий."}
        </p>
        <button
          type="button"
          className="employer-button"
          disabled={
            busy ||
            (kind === "gallery" &&
              (s.company.media || []).filter((m) => m.kind === "gallery")
                .length >= 8)
          }
          onClick={() => input.current?.click()}
        >
          <Upload size={16} />
          {busy
            ? "Загружаем…"
            : key
              ? "Заменить изображение"
              : "Выбрать изображение"}
        </button>
        <small>JPG, PNG, WebP · до 5 МБ. Фотографии сохраняются сразу.</small>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function CompanyEditor({
  s,
  act,
  onStateChange,
  actionsHost,
}: {
  actionsHost?: HTMLDivElement | null;
  s: State;
  act: Action;
  onStateChange: (s: State) => void;
}) {
  const [draft, setDraft, meta] = useDraft("company", {
    ...s.company,
    values: s.company.values || [],
    benefits: s.company.benefits || [],
    technologies: s.company.technologies || [],
  });
  const [editing, setEditing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingField = useRef("");
  const [tab, setTab] = useState("basic"),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const c = {
    ...s.company,
    ...draft,
    media: s.company.media,
    logoKey: s.company.logoKey,
    coverKey: s.company.coverKey,
  };
  const set = (key: keyof typeof draft, value: any) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setNotice("");
    setError("");
  };
  const tabs = [
    ["basic", "Основное"],
    ["story", "О компании"],
    ["team", "Команда и культура"],
    ["photos", "Фотографии"],
    ["contacts", "Контакты"],
  ];
  const progress = companyCompletion(c);
  const websiteIssue = companyWebsiteError(draft.website);
  function selectField(key: string) {
    const field = progress.fields.find((f) => f.key === key);
    if (!field) return;
    pendingField.current = field.label;
    setTab(field.section);
    setEditing(true);
  }
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (pendingField.current) {
        const label = [
          ...(contentRef.current?.querySelectorAll<HTMLLabelElement>(
            ".employer-field",
          ) || []),
        ].find(
          (l) =>
            l
              .querySelector("span")
              ?.textContent?.trim()
              .replace(/\s*\*$/, "") === pendingField.current,
        );
        const target =
          label?.querySelector<HTMLElement>(
            "input, textarea, [role=combobox]",
          ) ||
          contentRef.current?.querySelector<HTMLElement>(
            ".company-media-uploader button",
          );
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
        target?.focus({ preventScroll: true });
        pendingField.current = "";
      } else contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, editing]);
  async function save() {
    setNotice("");
    setError("");
    if (websiteIssue) {
      setPreview(false);
      setTab("contacts");
      setEditing(true);
      return;
    }
    if (!c.name.trim()) {
      setPreview(false);
      setTab("basic");
      setError("Укажите название компании.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(c.email)) {
      setPreview(false);
      setTab("contacts");
      setError("Укажите корректную контактную почту компании.");
      return;
    }
    const telError = phoneError(c.phone || "");
    if (telError) {
      setTab("contacts");
      setError(telError);
      return;
    }
    setBusy(true);
    const result = await act("company", draft);
    setBusy(false);
    if (result) {
      setNotice("Профиль компании сохранён");
      setEditing(false);
    } else {
      setPreview(false);
      setError(
        "Не удалось сохранить компанию. Проверьте поля и повторите попытку.",
      );
    }
  }
  async function remove(key: string) {
    setError("");
    try {
      const response = await fetch("/api/company-media", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "employer", key }),
      });
      const body = (await response.json()) as State & { error?: string };
      if (!response.ok) throw new Error(body.error);
      onStateChange(body);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (preview)
    return (
      <div className="employer-content company-preview">
        <div className="employer-toolbar">
          <button className="employer-link" onClick={() => setPreview(false)}>
            <ArrowLeft size={17} />К редактору
          </button>
          {notice && (
            <span className="employer-save-notice" role="status">
              {notice}
            </span>
          )}
          <button
            className="employer-button primary"
            disabled={busy}
            onClick={save}
          >
            Сохранить компанию
            <Check size={16} />
          </button>
        </div>
        <CompanyShowcase company={c} />
      </div>
    );
  const sectionTitles: Record<string, [string, string]> = {
    basic: [
      "Основные сведения",
      "Название, сфера и команда — основа профиля вашей компании.",
    ],
    story: [
      "О компании",
      "Покажите, какие задачи решаете и для кого создаёте продукты.",
    ],
    team: [
      "Команда и культура",
      "Условия, технологии и рабочая атмосфера вашей команды.",
    ],
    photos: ["Фотографии", "Логотип, обложка и настоящая жизнь компании."],
    contacts: ["Контакты", "Как кандидат сможет связаться с вашей командой."],
  };
  const summaries: Record<string, React.ReactNode> = {
    basic: (
      <SummaryRows
        rows={[
          ["Название компании", c.name],
          ["Коротко о компании", c.tagline || ""],
          ["Сфера компании", c.industry || ""],
          ["Размер команды", c.size || ""],
          ["Город компании", c.city || ""],
          ["Год основания", c.founded ? String(c.founded) : ""],
        ]}
      />
    ),
    story: (
      <SummaryRows
        rows={[
          ["О компании", c.description],
          ["Миссия", c.mission || ""],
          ["Продукты и проекты", c.products || ""],
        ]}
      />
    ),
    team: (
      <SummaryRows
        rows={[
          ["Как мы работаем", c.culture || ""],
          ["Что для нас важно", c.values?.filter(Boolean).join(" · ") || ""],
          ["Что предлагаем", c.benefits?.filter(Boolean).join(" · ") || ""],
          ["Технологии", c.technologies?.join(" · ") || ""],
          ["Знакомство с кандидатом", c.hiringProcess || ""],
        ]}
      />
    ),
    contacts: (
      <SummaryRows
        rows={[
          ["Email для связи", c.email],
          ["Сайт компании", c.website],
          ["Контактное лицо", c.contactName || ""],
          ["Телефон компании", c.phone || ""],
        ]}
      />
    ),
    photos: (
      <>
        <div className="profile-identity-summary">
          <CompanyMark company={c} />
          <div>
            <strong>{c.name || "Ваша компания"}</strong>
            <p className="muted">
              {c.media?.length
                ? `${c.media.length} изображений в профиле`
                : "Добавьте логотип и фотографии команды"}
            </p>
          </div>
        </div>
        {c.coverKey && (
          <img
            className="company-profile-cover"
            src={assetUrl(c.coverKey)}
            alt="Обложка компании"
          />
        )}
      </>
    ),
  };
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(v);
        setEditing(false);
      }}
      orientation="vertical"
      className="profile-tabbed-editor company-profile-editor"
    >
      {actionsHost &&
        createPortal(
          <div className="profile-toolbar">
            <button className="btn outline" onClick={() => setPreview(true)}>
              <Eye size={17} />
              Посмотреть компанию
            </button>
          </div>,
          actionsHost,
        )}
      <div className="editor-layout">
        <div className="profile-navigation-card">
          <TabsList
            className="profile-section-nav"
            aria-label="Разделы профиля компании"
          >
            {tabs.map(([key, label]) => (
              <TabsTrigger key={key} value={key}>
                <span className="profile-tab-copy">
                  <strong>{label}</strong>
                </span>
                {progress.fields
                  .filter((f) => f.section === key && f.required)
                  .every((f) => f.done) &&
                  progress.fields.some(
                    (f) => f.section === key && f.required,
                  ) && (
                    <Check
                      className="profile-tab-check"
                      aria-label="Заполнено"
                    />
                  )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="panel form-stack profile-form" ref={contentRef}>
          <DraftStatus meta={meta} />
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="employer-save-notice" role="status">
              {notice}
            </p>
          )}
          <div className="profile-section-content">
            <div className="form-section-heading">
              <div>
                <h2>{sectionTitles[tab][0]}</h2>
                <p>{sectionTitles[tab][1]}</p>
              </div>
            </div>
            {tab === "basic" && (
              <section className="profile-summary-card">
                <header>
                  <h3>Логотип и описание</h3>
                  <button
                    className="profile-pencil"
                    aria-label="Редактировать оформление компании"
                    onClick={() => {
                      setTab("photos");
                      setEditing(true);
                    }}
                  >
                    <Pencil size={21} />
                  </button>
                </header>
                <div className="profile-summary-body">
                  <div className="profile-identity-summary">
                    <CompanyMark company={c} />
                    <div>
                      <strong>{c.name || "Ваша компания"}</strong>
                      <p className="profile-status-label">
                        {c.tagline || "Расскажите о продукте и вашей команде"}
                      </p>
                      <p className="muted">
                        Логотип и описание видны в профиле компании и рядом с
                        вакансией.
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            )}
            <SummaryCard
              cardKey={`company-${tab}`}
              title={
                (
                  {
                    basic: "Информация о компании",
                    story: "Продукты и миссия",
                    team: "Работа в команде",
                    photos: "Оформление компании",
                    contacts: "Способы связи",
                  } as Record<string, string>
                )[tab]
              }
              missing={progress.fields.some(
                (f) => f.section === tab && f.required && !f.done,
              )}
              open={editing}
              onToggle={() => setEditing(!editing)}
              onSave={save}
              busy={busy || meta.status === "loading"}
              editor={
                <div className="company-inline-editor">
                  {tab === "basic" && (
                    <>
                      <p className="employer-section-note">
                        Помогите кандидату понять, кто его приглашает.
                      </p>
                      <EmployerField label="Название компании" required>
                        <input
                          value={draft.name}
                          maxLength={150}
                          onChange={(e) => set("name", e.target.value)}
                          placeholder="Как называется ваша команда"
                        />
                      </EmployerField>
                      <EmployerField
                        label="Коротко о компании"
                        hint="Одна фраза о продукте или направлении работы"
                      >
                        <input
                          value={draft.tagline || ""}
                          maxLength={200}
                          onChange={(e) => set("tagline", e.target.value)}
                          placeholder="Например, создаём инструменты для совместной работы"
                        />
                      </EmployerField>
                      <div className="employer-form-grid">
                        <EmployerField label="Сфера компании" required>
                          <EmployerSelect
                            label="Сфера компании"
                            value={draft.industry || ""}
                            options={[
                              { value: "", label: "Выберите сферу" },
                              ...industries,
                            ]}
                            onChange={(v) => set("industry", v)}
                          />
                        </EmployerField>
                        <EmployerField label="Размер команды" required>
                          <EmployerSelect
                            label="Размер команды"
                            value={draft.size || ""}
                            options={[
                              { value: "", label: "Выберите размер" },
                              ...companySizes,
                            ]}
                            onChange={(v) => set("size", v)}
                          />
                        </EmployerField>
                        <EmployerField label="Город компании" required>
                          <SuggestionText
                            id="company-city"
                            value={draft.city || ""}
                            onChange={(v) => set("city", v)}
                            catalog={cityCatalog}
                            placeholder="Город или регион"
                          />
                        </EmployerField>
                        <EmployerField label="Год основания">
                          <input
                            type="number"
                            min={1800}
                            max={new Date().getFullYear()}
                            value={draft.founded || ""}
                            onChange={(e) =>
                              set(
                                "founded",
                                e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              )
                            }
                            placeholder="Например, 2018"
                          />
                        </EmployerField>
                      </div>
                    </>
                  )}
                  {tab === "story" && (
                    <>
                      <EmployerField label="О компании" required>
                        <textarea
                          rows={7}
                          maxLength={6000}
                          value={draft.description}
                          onChange={(e) => set("description", e.target.value)}
                          placeholder="Какие задачи решаете, для кого создаёте продукты и как развиваетесь"
                        />
                      </EmployerField>
                      <EmployerField label="Миссия">
                        <textarea
                          rows={3}
                          maxLength={2500}
                          value={draft.mission || ""}
                          onChange={(e) => set("mission", e.target.value)}
                          placeholder="Что хотите изменить своей работой"
                        />
                      </EmployerField>
                      <EmployerField label="Наши продукты и проекты">
                        <textarea
                          rows={5}
                          maxLength={5000}
                          value={draft.products || ""}
                          onChange={(e) => set("products", e.target.value)}
                          placeholder="Расскажите о продуктах и задачах, к которым присоединится специалист"
                        />
                      </EmployerField>
                    </>
                  )}
                  {tab === "team" && (
                    <>
                      <EmployerField label="Как мы работаем">
                        <textarea
                          rows={5}
                          maxLength={5000}
                          value={draft.culture || ""}
                          onChange={(e) => set("culture", e.target.value)}
                          placeholder="Коммуникация, самостоятельность, рабочий ритм и развитие"
                        />
                      </EmployerField>
                      <EmployerField
                        label="Что для нас важно"
                        hint="Каждый пункт с новой строки"
                      >
                        <textarea
                          rows={4}
                          value={(draft.values || []).join("\n")}
                          onChange={(e) =>
                            set("values", e.target.value.split("\n"))
                          }
                          placeholder="Открытая обратная связь\nОтветственность за результат"
                        />
                      </EmployerField>
                      <EmployerField
                        label="Что предлагаем команде"
                        hint="Каждый пункт с новой строки"
                      >
                        <textarea
                          rows={4}
                          value={(draft.benefits || []).join("\n")}
                          onChange={(e) =>
                            set("benefits", e.target.value.split("\n"))
                          }
                          placeholder="Обучение и профессиональное развитие\nГибкий график"
                        />
                      </EmployerField>
                      <EmployerField label="Наши технологии">
                        <SuggestionTags
                          id="company-technologies"
                          value={draft.technologies || []}
                          onChange={(v) => set("technologies", v)}
                          catalog={skillCatalog}
                          maxSelected={30}
                        />
                      </EmployerField>
                      <EmployerField label="Как проходит знакомство с кандидатом">
                        <textarea
                          rows={4}
                          maxLength={3000}
                          value={draft.hiringProcess || ""}
                          onChange={(e) => set("hiringProcess", e.target.value)}
                          placeholder="Например: встреча с рекрутером, техническое знакомство, предложение"
                        />
                      </EmployerField>
                    </>
                  )}
                  {tab === "photos" && (
                    <>
                      <p className="employer-section-note">
                        Покажите настоящую рабочую атмосферу. Все изображения
                        необязательны.
                      </p>
                      <CompanyMediaUpload
                        kind="logo"
                        s={s}
                        onStateChange={onStateChange}
                      />
                      {s.company.logoKey && (
                        <button
                          className="employer-link"
                          onClick={() => remove(s.company.logoKey!)}
                        >
                          Убрать логотип
                        </button>
                      )}
                      <CompanyMediaUpload
                        kind="cover"
                        s={s}
                        onStateChange={onStateChange}
                      />
                      {s.company.coverKey && (
                        <button
                          className="employer-link"
                          onClick={() => remove(s.company.coverKey!)}
                        >
                          Убрать обложку
                        </button>
                      )}
                      <CompanyMediaUpload
                        kind="gallery"
                        s={s}
                        onStateChange={onStateChange}
                      />
                      <div className="company-media-grid">
                        {(s.company.media || [])
                          .filter((m) => m.kind === "gallery")
                          .map((m, i) => (
                            <div key={m.key}>
                              <img
                                src={assetUrl(m.key)}
                                alt={`Фотография компании ${i + 1}`}
                              />
                              <span>{m.name}</span>
                              <button
                                aria-label={`Удалить фотографию ${i + 1}`}
                                onClick={() => remove(m.key)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          ))}
                      </div>
                    </>
                  )}
                  {tab === "contacts" && (
                    <>
                      <p className="employer-section-note">
                        Кандидат увидит способ связи, когда получит приглашение
                        или изучит вакансию.
                      </p>
                      <EmployerField label="Email для связи" required>
                        <input
                          type="email"
                          value={draft.email}
                          maxLength={200}
                          onChange={(e) => set("email", e.target.value)}
                          placeholder="team@company.ru"
                        />
                      </EmployerField>
                      <EmployerField label="Сайт компании">
                        <input
                          type="url"
                          aria-label="Сайт компании"
                          aria-invalid={!!websiteIssue}
                          aria-describedby={
                            websiteIssue ? "company-website-error" : undefined
                          }
                          value={draft.website}
                          onChange={(e) => set("website", e.target.value)}
                          placeholder="https://company.ru"
                        />
                        {websiteIssue && (
                          <p
                            id="company-website-error"
                            className="inline-error"
                            role="alert"
                          >
                            {websiteIssue}
                          </p>
                        )}
                      </EmployerField>
                      <div className="employer-form-grid">
                        <EmployerField label="Контактное лицо">
                          <input
                            value={draft.contactName || ""}
                            maxLength={120}
                            onChange={(e) => set("contactName", e.target.value)}
                            placeholder="Имя или роль"
                          />
                        </EmployerField>
                        <EmployerField label="Телефон компании">
                          <input
                            type="tel"
                            value={draft.phone || ""}
                            maxLength={24}
                            onChange={(e) =>
                              set("phone", formatPhone(e.target.value))
                            }
                            placeholder="Необязательно"
                          />
                        </EmployerField>
                      </div>
                    </>
                  )}
                </div>
              }
            >
              {summaries[tab]}
            </SummaryCard>
          </div>
        </div>
        <aside className="editor-aside">
          <CompanyCompletion company={c} onSelect={selectField} />
          <section className="panel">
            <h3>Профиль глазами кандидата</h3>
            <p className="muted">
              Сфера, продукты и условия помогают понять вашу команду ещё до
              знакомства.
            </p>
            <button className="employer-link" onClick={() => setPreview(true)}>
              Предпросмотр <ArrowRight size={16} />
            </button>
          </section>
        </aside>
      </div>
    </Tabs>
  );
}
