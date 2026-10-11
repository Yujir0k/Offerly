"use client";
import { registrationDestination } from "@/lib/registration-flow";
import { MonthPicker } from "./month-picker";
import { workHistoryDateError } from "@/lib/work-dates";
import {
  withWorkPreferences,
  editWorkPreference,
  employmentOptions,
  formatOptions,
} from "@/lib/profile-options";
import { countryCatalog, regionCatalog } from "@/lib/location-catalogs";
import { withPersonalName, editPersonalName } from "@/lib/personal-name";
import {
  resumeFieldLabels,
  resumeFieldText,
  photoPreview,
  importResumePhoto,
  type ResumeImportResponse,
} from "@/lib/resume-import";
import { ResumePhotoReview } from "./resume-photo-review";
import { LogoMotion } from "./logo-motion";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Upload,
  FileText,
  BriefcaseBusiness,
  MapPin,
  Wallet,
  SlidersHorizontal,
  Code2,
  Award,
  Plus,
  X,
  LockKeyhole,
} from "lucide-react";
import { Brand } from "./brand";
import { PublicFooter } from "./public-footer";
import { type Action } from "./registration";
import { type Navigate } from "./landing";
import { type Profile, type State, type WorkEntry, money } from "@/lib/model";
import { useDraft, seedDraft, DraftStatus } from "@/hooks/use-draft";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "./ui/select";
import { Progress } from "./ui/progress";
import { SuggestionTags, SuggestionText } from "./suggestion-picker";
import {
  skillCatalog,
  professionCatalog,
  cityCatalog,
  companyCatalog,
} from "@/lib/suggestion-catalogs";
import { salaryRangeError } from "@/lib/salary-range";

const steps = [
  [
    "resume",
    "Навыки и опыт",
    "Только главное. Подробности можно добавить позже.",
    FileText,
  ],
  [
    "expectations",
    "Работа и условия",
    "Зарплата, локация и удобный формат.",
    Wallet,
  ],
] as const;
const parsedLabels = resumeFieldLabels;
type SetupDraft = {
  step: number;
  profile: Profile;
  experienceChoice: string;
  filename: string;
};
export function SetupField({
  id,
  label,
  required = false,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        {required && (
          <i className="required-mark" aria-hidden="true">
            *
          </i>
        )}
      </FieldLabel>
      {children}
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );
}
export function SetupSelect({
  id,
  label,
  value,
  options,
  change,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  change: (value: string) => void;
}) {
  return (
    <SetupField id={id} label={label} required>
      <Select value={value} onValueChange={change}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Выберите" />
        </SelectTrigger>
        <SelectContent className="setup-select-menu">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </SetupField>
  );
}
export function CandidateSetup({
  s,
  nav,
  act,
  route,
}: {
  s: State;
  nav: Navigate;
  act: Action;
  route: string;
}) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<number | null>(null);
  const [d, setD, meta] = useDraft<SetupDraft>("setup", {
    step: 0,
    profile: s.profile,
    experienceChoice:
      s.profile.workHistory.length || s.profile.experience ? "experienced" : "",
    filename: "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [parsed, setParsed] = useState<Partial<Profile> | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const requested = new URLSearchParams(route.split("?")[1] || "").get("step");
  const requestedIndex = steps.findIndex((step) => step[0] === requested);
  const index =
    requestedIndex >= 0 ? requestedIndex : Math.min(1, Math.max(0, d.step));
  const p = withWorkPreferences(withPersonalName(d.profile));
  const rangeError =
    p.salaryMin && p.salaryMax
      ? salaryRangeError(p.salaryMin, p.salaryMax)
      : null;
  const [key, title, description] = steps[index];
  const put = <K extends keyof Profile>(field: K, value: Profile[K]) => {
    setD((current) => ({
      ...current,
      profile: editWorkPreference(
        editPersonalName(current.profile, field, value),
        field,
        value,
      ),
    }));
    setError("");
  };
  const work = (id: string, patch: Partial<WorkEntry>) =>
    put(
      "workHistory",
      p.workHistory.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    );
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [key]);
  const go = (next: number) => {
    setD((current) => ({ ...current, step: next }));
    nav(`/onboarding/candidate?step=${steps[next][0]}`);
    setError("");
  };
  async function returnToCode() {
    setBusy(true);
    if (await meta.flush()) nav("/verify-email?role=candidate");
    else setError("Не удалось сохранить данные. Повторите переход.");
    setBusy(false);
  }
  async function skip() {
    setBusy(true);
    if (!(await meta.flush())) {
      setError("Не удалось сохранить данные. Повторите переход.");
      setBusy(false);
      return;
    }
    const result = await act("profile-draft", p);
    if (result) {
      await seedDraft("profile", result.profile);
      nav(registrationDestination(result, "candidate"));
    }
    setBusy(false);
  }
  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/resume", { method: "POST", body });
      const result = (await response.json()) as ResumeImportResponse;
      if (!response.ok)
        throw new Error(result.error || "Не удалось прочитать PDF");
      const fields = Object.fromEntries(
        Object.entries(result.parsed || {}).filter(
          ([name]) => name in parsedLabels,
        ),
      );
      const previews = (result.photos || []).map(photoPreview);
      setPhotos(previews);
      setSelectedPhoto(previews.length === 1 ? 0 : null);
      setParsed(fields);
      setSelected(Object.keys(fields));
      setD((current) => ({ ...current, filename: result.filename }));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function next(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (
      index === 0 &&
      (!p.name.trim() || !p.skills.some((skill) => skill.trim()))
    ) {
      setError("Укажите имя и хотя бы одну технологию.");
      return;
    }
    if (
      index === 0 &&
      d.experienceChoice === "experienced" &&
      !p.workHistory.length
    ) {
      setError("Добавьте хотя бы одно место работы.");
      return;
    }
    const workDateError = workHistoryDateError(p.workHistory);
    if (d.experienceChoice !== "none" && workDateError) {
      setError(workDateError);
      return;
    }
    if (index === 1 && salaryRangeError(p.salaryMin, p.salaryMax)) {
      setError(salaryRangeError(p.salaryMin, p.salaryMax)!);
      return;
    }
    if (index === 1 && !p.roles.some((role) => role.trim())) {
      setError("Выберите хотя бы одну профессию или роль.");
      return;
    }
    if (index === 1 && !p.consent) {
      setError("Подтвердите согласие на публикацию профессионального профиля.");
      return;
    }
    setBusy(true);
    if (!(await meta.flush())) {
      setError(
        "Не удалось сохранить шаг. Повторите — заполненные поля остаются на экране.",
      );
      setBusy(false);
      return;
    }
    if (index === 1) {
      const result = await act("profile", {
        ...p,
        workHistory: d.experienceChoice === "none" ? [] : p.workHistory,
        experience: d.experienceChoice === "none" ? 0 : p.experience,
        skills: p.skills.map((x) => x.trim()).filter(Boolean),
        roles: p.roles.map((x) => x.trim()).filter(Boolean),
        preferredLocations: p.preferredLocations
          .map((x) => x.trim())
          .filter(Boolean),
      });
      if (result) {
        await seedDraft("profile", result.profile);
        nav(registrationDestination(result, "candidate"));
      }
    } else go(index + 1);
    setBusy(false);
  }
  if (!s.onboarded)
    return (
      <div className="registration-page auth-refresh">
        <header className="registration-header">
          <Brand />
          <button
            className="back-home"
            onClick={() => nav("/register?role=candidate")}
          >
            Создать аккаунт
            <ArrowRight />
          </button>
        </header>
        <main className="setup-intro">
          <h1>Начнём со знакомства.</h1>
          <p>
            Создайте аккаунт, чтобы заполнить профиль и сохранить каждый шаг.
          </p>
          <button
            className="btn primary"
            onClick={() => nav("/register?role=candidate")}
          >
            Зарегистрироваться
          </button>
        </main>
        <PublicFooter nav={nav} />
      </div>
    );
  return (
    <div className="registration-page auth-refresh candidate-setup">
      <header className="registration-header">
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            nav("/");
          }}
        >
          <Brand />
        </a>
        <button className="back-home" onClick={() => nav("/")}>
          <ArrowLeft />
          На главную
        </button>
      </header>
      <div className="setup-layout">
        <main className="registration-content auth-card setup-card">
          <div className="setup-progress-heading">
            <span className="mono">ВАШ ПРОФЕССИОНАЛЬНЫЙ ПРОФИЛЬ</span>
            <span className="mono">
              {String(index + 1).padStart(2, "0")} /{" "}
              {String(steps.length).padStart(2, "0")}
            </span>
          </div>
          <Progress
            value={(index / steps.length) * 100}
            aria-label={`Шаг ${index + 1} из ${steps.length}`}
          />
          <div className="setup-step-content" key={key}>
            <h1 ref={heading} tabIndex={-1}>
              {title}
            </h1>
            <p className="setup-lead">{description}</p>
            <DraftStatus meta={meta} />
            {index < 2 ? (
              <form onSubmit={next} className="setup-form">
                <FieldGroup>
                  {index === 0 && (
                    <>
                      <div
                        className="setup-upload"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          upload(event.dataTransfer.files[0]);
                        }}
                      >
                        <Upload />
                        <div>
                          <strong>
                            {busy
                              ? "Читаем резюме…"
                              : d.filename ||
                                "Загрузите резюме — заполним основу"}
                          </strong>
                          <p>
                            PDF до 10 МБ. Можно пропустить и загрузить позже в
                            профиле.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn outline"
                          disabled={busy}
                          onClick={() => fileInput.current?.click()}
                        >
                          Выбрать PDF
                        </button>
                        <input
                          ref={fileInput}
                          type="file"
                          accept="application/pdf"
                          hidden
                          aria-label="Загрузить PDF-резюме"
                          onChange={(event) => upload(event.target.files?.[0])}
                        />
                      </div>
                      {parsed && (
                        <section className="setup-parsed">
                          <h2>Проверьте найденные данные</h2>
                          <p>
                            Выберите поля, которые нужно перенести. Остальные
                            останутся как есть.
                          </p>
                          {Object.entries(parsed).map(([name, value]) => (
                            <label key={name}>
                              <Checkbox
                                checked={selected.includes(name)}
                                onCheckedChange={(checked) =>
                                  setSelected((current) =>
                                    checked
                                      ? [...current, name]
                                      : current.filter((x) => x !== name),
                                  )
                                }
                              />
                              <span>
                                <strong>{parsedLabels[name]}</strong>
                                {resumeFieldText(value)}
                              </span>
                            </label>
                          ))}
                          <ResumePhotoReview
                            photos={photos}
                            selected={selectedPhoto}
                            onSelect={setSelectedPhoto}
                          />
                          <button
                            type="button"
                            className="btn primary"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              setError("");
                              try {
                                const avatarState =
                                  selectedPhoto !== null &&
                                  photos[selectedPhoto]
                                    ? await importResumePhoto(
                                        photos[selectedPhoto],
                                      )
                                    : null;
                                setD((current) => ({
                                  ...current,
                                  profile: {
                                    ...current.profile,
                                    ...(avatarState
                                      ? {
                                          avatarKey:
                                            avatarState.profile.avatarKey,
                                        }
                                      : {}),
                                    ...Object.fromEntries(
                                      Object.entries(parsed).filter(([name]) =>
                                        selected.includes(name),
                                      ),
                                    ),
                                  },
                                }));
                                setParsed(null);
                              } catch (error) {
                                setError((error as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Перенести выбранное
                            <Check />
                          </button>
                        </section>
                      )}
                      <SetupField
                        id="setup-skills"
                        label="Ваши технологии"
                        required
                        hint="Выберите подсказку или добавьте свой навык. Подтверждённые навыки появятся после теста."
                      >
                        <SuggestionTags
                          id="setup-skills"
                          required
                          dark
                          value={p.skills}
                          onChange={(value) => put("skills", value)}
                          catalog={skillCatalog}
                          placeholder="Python, React, тестирование…"
                        />
                      </SetupField>
                    </>
                  )}
                  {index === 0 && (
                    <>
                      <Field>
                        <FieldLabel>Опыт работы — по желанию</FieldLabel>
                        <RadioGroup
                          value={d.experienceChoice}
                          onValueChange={(value) => {
                            setD((current) => ({
                              ...current,
                              experienceChoice: value,
                              profile: current.profile,
                            }));
                            setError("");
                          }}
                          className="setup-choice-grid"
                          aria-label="Коммерческий опыт"
                        >
                          {[
                            ["experienced", "Добавить место работы"],
                            ["none", "Пока нет опыта"],
                            ["later", "Заполню позже"],
                          ].map(([value, label]) => (
                            <label key={value}>
                              <RadioGroupItem value={value} />
                              {label}
                            </label>
                          ))}
                        </RadioGroup>
                      </Field>
                      {d.experienceChoice === "none" && (
                        <p className="setup-note">
                          Учебные и личные проекты тоже важны. Их можно описать
                          ниже. Отсутствие работы не мешает подтвердить навыки.
                        </p>
                      )}
                      {d.experienceChoice === "experienced" && (
                        <>
                          {p.workHistory.map((entry, position) => (
                            <section className="setup-work" key={entry.id}>
                              <div className="setup-work-title">
                                <h2>Место работы {position + 1}</h2>
                                <button
                                  className="btn icon"
                                  type="button"
                                  aria-label={`Удалить место работы ${position + 1}`}
                                  onClick={() =>
                                    put(
                                      "workHistory",
                                      p.workHistory.filter(
                                        (x) => x.id !== entry.id,
                                      ),
                                    )
                                  }
                                >
                                  <X />
                                </button>
                              </div>
                              <FieldGroup>
                                <FieldGroup className="setup-two">
                                  <SetupField
                                    id={`company-${entry.id}`}
                                    label="Компания"
                                    required
                                  >
                                    <SuggestionText
                                      id={`company-${entry.id}`}
                                      required
                                      dark
                                      value={entry.company}
                                      onChange={(value) =>
                                        work(entry.id, { company: value })
                                      }
                                      catalog={companyCatalog}
                                      placeholder="Найдите компанию или введите свою"
                                    />
                                  </SetupField>
                                  <SetupField
                                    id={`role-${entry.id}`}
                                    label="Должность"
                                    required
                                  >
                                    <SuggestionText
                                      id={`role-${entry.id}`}
                                      required
                                      dark
                                      value={entry.role}
                                      onChange={(value) =>
                                        work(entry.id, { role: value })
                                      }
                                      catalog={professionCatalog}
                                      placeholder="Найдите должность"
                                    />
                                  </SetupField>
                                </FieldGroup>
                                <FieldGroup className="setup-two">
                                  <SetupField
                                    id={`start-${entry.id}`}
                                    label="Начало работы"
                                  >
                                    <MonthPicker
                                      id={`start-${entry.id}`}
                                      max={
                                        !entry.current
                                          ? entry.end || undefined
                                          : undefined
                                      }
                                      value={entry.start}
                                      onChange={(value) =>
                                        work(entry.id, {
                                          start: value,
                                        })
                                      }
                                    />
                                  </SetupField>
                                  <SetupField
                                    id={`end-${entry.id}`}
                                    label="Окончание"
                                  >
                                    <MonthPicker
                                      id={`end-${entry.id}`}
                                      disabled={entry.current}
                                      min={entry.start}
                                      value={entry.current ? "" : entry.end}
                                      onChange={(value) =>
                                        work(entry.id, {
                                          end: value,
                                        })
                                      }
                                    />
                                  </SetupField>
                                </FieldGroup>
                                <label className="setup-check">
                                  <Checkbox
                                    checked={entry.current}
                                    onCheckedChange={(checked) =>
                                      work(entry.id, {
                                        current: checked === true,
                                        end: checked ? "" : entry.end,
                                      })
                                    }
                                  />
                                  Работаю здесь сейчас
                                </label>
                              </FieldGroup>
                            </section>
                          ))}
                          <button
                            className="btn outline setup-add-work"
                            type="button"
                            disabled={p.workHistory.length >= 12}
                            onClick={() =>
                              put("workHistory", [
                                ...p.workHistory,
                                {
                                  id: crypto.randomUUID(),
                                  company: "",
                                  role: "",
                                  start: "",
                                  end: "",
                                  current: false,
                                  description: "",
                                },
                              ])
                            }
                          >
                            <Plus />
                            Добавить место работы
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {index === 1 && (
                    <>
                      <SetupField
                        id="setup-roles"
                        label="Какие роли рассматриваете?"
                        required
                        hint="Можно выбрать несколько профессий. Свой вариант тоже можно добавить."
                      >
                        <SuggestionTags
                          id="setup-roles"
                          required
                          dark
                          value={p.roles}
                          onChange={(value) => put("roles", value)}
                          catalog={professionCatalog}
                          placeholder="Найдите профессию или роль"
                          maxSelected={20}
                        />
                      </SetupField>
                      <div className="setup-salary-label">
                        <Wallet />
                        <div>
                          <h2>Зарплатные ожидания</h2>
                          <p>
                            Рубли в месяц, на руки. Так условия будут понятны до
                            первого разговора.
                          </p>
                        </div>
                      </div>
                      <FieldGroup className="setup-two">
                        <SetupField
                          id="setup-min"
                          label="От, ₽ в месяц"
                          required
                        >
                          <Input
                            id="setup-min"
                            type="number"
                            inputMode="numeric"
                            required
                            min={1}
                            max={p.salaryMax || 10000000}
                            aria-invalid={!!rangeError}
                            aria-describedby={
                              rangeError ? "setup-range-error" : undefined
                            }
                            value={p.salaryMin || ""}
                            onChange={(event) =>
                              put("salaryMin", Number(event.target.value))
                            }
                            placeholder="180000"
                          />
                        </SetupField>
                        <SetupField
                          id="setup-max"
                          label="До, ₽ в месяц"
                          required
                        >
                          <Input
                            id="setup-max"
                            type="number"
                            inputMode="numeric"
                            required
                            min={p.salaryMin || 1}
                            max={10000000}
                            aria-invalid={!!rangeError}
                            aria-describedby={
                              rangeError ? "setup-range-error" : undefined
                            }
                            value={p.salaryMax || ""}
                            onChange={(event) =>
                              put("salaryMax", Number(event.target.value))
                            }
                            placeholder="230000"
                          />
                        </SetupField>
                      </FieldGroup>
                      {rangeError && (
                        <p
                          id="setup-range-error"
                          role="alert"
                          className="setup-error"
                        >
                          {rangeError}
                        </p>
                      )}
                      <SetupField
                        id="setup-employment"
                        label="Занятость"
                        hint="Можно выбрать несколько вариантов."
                      >
                        <SuggestionTags
                          id="setup-employment"
                          dark
                          value={p.employmentTypes || []}
                          onChange={(value) => put("employmentTypes", value)}
                          catalog={employmentOptions.map((name) => ({
                            name,
                            group: "Занятость",
                          }))}
                          maxSelected={4}
                          allowCustom={false}
                          placeholder="Выберите варианты занятости"
                        />
                      </SetupField>
                    </>
                  )}
                  {index === 1 && (
                    <>
                      <FieldGroup className="setup-two">
                        <SetupField
                          id="setup-country"
                          label="Страна проживания"
                        >
                          <SuggestionText
                            id="setup-country"
                            dark
                            catalog={countryCatalog}
                            value={p.country}
                            onChange={(value) => put("country", value)}
                            placeholder="Выберите страну"
                          />
                        </SetupField>
                        <SetupField
                          id="setup-region"
                          label="Регион"
                          hint="Необязательно, если ваш город является отдельным регионом."
                        >
                          <SuggestionText
                            id="setup-region"
                            dark
                            catalog={regionCatalog(p.country)}
                            value={p.region}
                            onChange={(value) => put("region", value)}
                            placeholder="Выберите регион"
                          />
                        </SetupField>
                      </FieldGroup>
                      <SetupField
                        id="setup-city"
                        label="Город проживания"
                        required
                      >
                        <SuggestionText
                          id="setup-city"
                          required
                          dark
                          value={p.city}
                          onChange={(value) => put("city", value)}
                          catalog={cityCatalog}
                          placeholder="Город — на русском или английском"
                        />
                      </SetupField>
                      <SetupField
                        id="setup-format"
                        label="Предпочтительные форматы"
                        hint="Можно сочетать офис, гибрид и удалённую работу."
                      >
                        <SuggestionTags
                          id="setup-format"
                          dark
                          value={p.formats || []}
                          onChange={(value) => put("formats", value)}
                          catalog={formatOptions.map((name) => ({
                            name,
                            group: "Формат",
                          }))}
                          maxSelected={3}
                          allowCustom={false}
                          placeholder="Выберите форматы работы"
                        />
                      </SetupField>
                      <SetupField
                        id="setup-preferred-locations"
                        label="Где хотите работать?"
                        hint="Можно выбрать несколько городов. Необязательно для удалённой работы."
                      >
                        <SuggestionTags
                          id="setup-preferred-locations"
                          dark
                          value={p.preferredLocations}
                          onChange={(value) => put("preferredLocations", value)}
                          catalog={cityCatalog}
                          maxSelected={20}
                          placeholder="Города или регионы"
                        />
                      </SetupField>
                    </>
                  )}
                  {index === 1 && (
                    <>
                      <label className="setup-check">
                        <Checkbox
                          checked={p.consent}
                          onCheckedChange={(value) =>
                            put("consent", value === true)
                          }
                        />
                        Согласен на участие профиля в подборе после
                        подтверждения навыков.<i className="required-mark">*</i>
                      </label>
                    </>
                  )}
                </FieldGroup>
                {error && (
                  <p role="alert" className="setup-error">
                    {error}
                  </p>
                )}
                <div className="setup-actions">
                  <div className="setup-secondary-actions">
                    {index > 0 && (
                      <button
                        className="btn auth-demo-button"
                        type="button"
                        disabled={busy}
                        onClick={() => go(index - 1)}
                      >
                        <ArrowLeft />
                        Назад
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn auth-demo-button setup-skip-button"
                      disabled={busy || meta.status === "loading"}
                      onClick={skip}
                    >
                      Пропустить
                    </button>
                  </div>
                  <button
                    className="btn primary brand-flow-button"
                    disabled={busy || meta.status === "loading"}
                  >
                    {busy ? (
                      <LogoMotion size={20} />
                    ) : (
                      <>
                        {index === 1 ? "Сохранить и продолжить" : "Продолжить"}
                        <ArrowRight />
                      </>
                    )}
                  </button>
                </div>
                {!s.auth?.demo && s.emailVerification.status !== "verified" && (
                  <button
                    type="button"
                    className="text-link setup-return-code"
                    disabled={busy || meta.status === "loading"}
                    onClick={returnToCode}
                  >
                    <ArrowLeft size={16} /> Вернуться к вводу кода
                  </button>
                )}
              </form>
            ) : null}
          </div>
        </main>
        <aside className="setup-aside">
          <div className="setup-aside-intro">
            <h2>
              {index === 0
                ? "Ваш опыт — ваше преимущество."
                : "Работа на ваших условиях."}
            </h2>
            <p>
              {index === 0
                ? "Покажите, что умеете. Подробности и резюме можно добавить позже."
                : "Выберите подходящий формат, локацию и зарплату — чтобы предложения были ближе к вашим ожиданиям."}
            </p>
          </div>
          <div className="setup-illustration">
            <img
              src={
                index === 0
                  ? "/illustrations/onboarding-skills.png"
                  : "/illustrations/onboarding-conditions.png"
              }
              alt={
                index === 0
                  ? "Специалисты собирают профессиональные навыки"
                  : "Специалисты выбирают локацию и условия работы"
              }
              width={1024}
              height={1024}
              decoding="async"
            />
          </div>
          <ol>
            {steps.map(([id, label, , Icon], position) => (
              <li
                key={id}
                aria-current={position === index ? "step" : undefined}
              >
                <button
                  type="button"
                  disabled={position > index || busy}
                  onClick={() => go(position)}
                >
                  <span className="setup-step-icon">
                    {position < index ? <Check /> : <Icon />}
                  </span>
                  <span>
                    <small>ШАГ {String(position + 1).padStart(2, "0")}</small>
                    {label}
                  </span>
                  {position === index && <ArrowRight />}
                </button>
              </li>
            ))}
          </ol>
          <div className="setup-aside-note">
            <LockKeyhole />
            <p>
              Вы решаете, с кем начать общение. Контакты открываются только
              после вашего согласия.
            </p>
          </div>
        </aside>
      </div>
      <PublicFooter nav={nav} returnTo={`/onboarding/candidate?step=${key}`} />
    </div>
  );
}
