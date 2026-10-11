"use client";
import { SavedSearchTools } from "./hiring-tools";
import { chatRequest } from "@/lib/chat-client";
import { ChatLaunch } from "./chat-launch";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BriefcaseBusiness,
  Send,
  LockKeyhole,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  MapPin,
  Search,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useCatalog, catalogPages } from "@/hooks/use-catalog";
import { MultiChoice } from "./multi-choice";
import { CompanyShowcase } from "./employer-ui";
import { assetUrl, publishedJob } from "@/lib/employer-profile";
import { toast } from "sonner";
import type { Job, JobApplication, State, CompanyProfile } from "@/lib/model";
import { ChoiceSelect } from "./choice-select";
import { industries, money } from "@/lib/model";
import {
  emptyVacancyFilters,
  vacancyCount,
  vacancyDate,
  vacancyExperience,
  vacancyMatch,
  vacancySalaryError,
  type VacancyFilters,
} from "@/lib/vacancy-search";
import {
  cityCatalog,
  skillCatalog,
  companyCatalog,
} from "@/lib/suggestion-catalogs";
import { useDraft, DraftStatus } from "@/hooks/use-draft";
import { SuggestionTags, SuggestionText } from "./suggestion-picker";
import type { Action } from "./registration";
import type { Navigate } from "./landing";
import { applicationProfileError } from "@/lib/job-applications";
import { FeedbackDialog } from "./feedback-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

const pageSize = 20;
const specialtyNames: Record<string, string> = {
  Backend: "Backend-разработка",
  Frontend: "Frontend-разработка",
  Data: "Данные и машинное обучение",
  QA: "Тестирование",
  DevOps: "DevOps и инфраструктура",
  Design: "Дизайн",
  Mobile: "Мобильная разработка",
  Analytics: "Системная аналитика",
};
const experienceNames: Record<string, string> = {
  none: "Без опыта",
  "1-3": "1–3 года",
  "3-6": "3–6 лет",
  "6+": "Более 6 лет",
};
function CompanyLogo({ job, large = false }: { job: Job; large?: boolean }) {
  return job.logo ? (
    <img
      className={`vacancy-logo ${large ? "large" : ""}`}
      src={job.logo}
      alt={`Логотип ${job.company}`}
    />
  ) : (
    <span
      className={`vacancy-logo vacancy-logo-fallback ${large ? "large" : ""}`}
      aria-label={job.company}
    >
      {job.company.slice(0, 2).toUpperCase()}
    </span>
  );
}
function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Любая",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <label className="vacancy-filter-field">
      <span>{label}</span>
      <ChoiceSelect
        label={label}
        value={value}
        onChange={onChange}
        options={[{ value: "", label: placeholder }, ...options]}
      />
    </label>
  );
}
function SaveJob({
  job,
  saved,
  busy,
  onSave,
  full = false,
}: {
  job: Job;
  saved: boolean;
  busy: boolean;
  onSave: (job: Job) => void;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      className={`vacancy-save ${saved ? "is-saved" : ""} ${full ? "with-label" : ""}`}
      aria-label={`${saved ? "Убрать из избранного" : "Сохранить в избранное"}: ${job.title}`}
      aria-pressed={saved}
      disabled={busy}
      onClick={() => onSave(job)}
      title={saved ? "Убрать из избранного" : "Сохранить в избранное"}
    >
      <Bookmark size={21} fill={saved ? "currentColor" : "none"} />
      {full && <span>{saved ? "В избранном" : "В избранное"}</span>}
    </button>
  );
}
function JobMeta({ job }: { job: Job }) {
  return (
    <div className="vacancy-meta">
      <span>
        <MapPin size={15} />
        {job.city || "Город не указан"}
      </span>
      <span>
        <BriefcaseBusiness size={15} />
        {job.format}
      </span>
      <span>
        <Users size={15} />
        {vacancyExperience(job)}
      </span>
    </div>
  );
}
export function CandidateVacancies({
  s,
  act,
  nav,
  jobId,
  view,
  employer,
}: {
  employer?: {
    toolbar: ReactNode;
    scope: Job[];
    catalogScope: string;
    actions: (job: Job) => ReactNode;
  };
  s: State;
  act: Action;
  nav: Navigate;
  jobId?: string;
  view?: string;
}) {
  const [filters, setFilters, filtersMeta] = useDraft<VacancyFilters>(
    employer ? "job:employer-search" : "job:search",
    { ...emptyVacancyFilters, sort: employer ? "date" : "match" },
  );
  const [applicationJob, setApplicationJob] = useState<Job | null>(null);
  const [applicationsOnly, setApplicationsOnly] = useState(
    view === "applications",
  );
  const [recentOnly, setRecentOnly] = useState(view === "recent");
  const appliedView = useRef("");
  useEffect(() => {
    if (
      !view ||
      appliedView.current === view ||
      !["applications", "favorites", "recent"].includes(view)
    )
      return;
    appliedView.current = view;
    setApplicationsOnly(view === "applications");
    setRecentOnly(view === "recent");
    setFilters({
      ...emptyVacancyFilters,
      favoritesOnly: view === "favorites",
      sort: "date",
    });
  }, [view, setFilters, s.profile.specialty]);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const listScroll = useRef(0);
  const previousJob = useRef(jobId);
  const listStart = useRef<HTMLDivElement | null>(null);
  const favorites = s.favoriteJobs || [];
  const catalog = useCatalog<Job>(
    "jobs",
    { ...filters, applicationsOnly, recentOnly },
    employer ? "employer" : "candidate",
    filters.page || 1,
    employer?.catalogScope || "market",
    s,
  );
  const rows = catalog.data?.items || [];
  const total = catalog.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = catalog.data?.page || Math.max(1, filters.page || 1);
  const visible = rows;
  const salaryError = vacancySalaryError(filters);
  const [detail, setDetail] = useState<{
    job: Job;
    company: CompanyProfile;
    companyJobCount: number;
  } | null>(null);
  const [detailError, setDetailError] = useState("");
  const detailSignature = `${jobId}:${!!employer}:${s.version}`;
  const [previousDetail, setPreviousDetail] = useState(detailSignature);
  if (previousDetail !== detailSignature) { setPreviousDetail(detailSignature); setDetail(null); setDetailError(""); }
  useEffect(() => {
    if (!jobId) return;
    const c = new AbortController();
    fetch(
      `/api/catalog/jobs?role=${employer ? "employer" : "candidate"}&job=${encodeURIComponent(jobId)}`,
      { signal: c.signal, cache: "no-store" },
    )
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        setDetail(b);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setDetailError(e.message);
      });
    return () => c.abort();
  }, [jobId, !!employer, s.version]);
  const job = detail?.job;
  const specialtyOptions = Object.entries(specialtyNames).map(
    ([value, label]) => ({ value, label }),
  );
  useEffect(() => {
    if (jobId !== previousJob.current) {
      window.scrollTo({
        top: jobId ? 0 : listScroll.current,
        behavior: "instant",
      });
      previousJob.current = jobId;
    }
  }, [jobId]);
  const update = <K extends keyof VacancyFilters>(
    key: K,
    value: VacancyFilters[K],
  ) => setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const reset = () => {
    setRecentOnly(false);
    setFilters({
      ...emptyVacancyFilters,
      favoritesOnly: filters.favoritesOnly,
    });
  };
  const openJob = (item: Job) => {
    if (!jobId) listScroll.current = window.scrollY;
    nav(
      `/demo/${employer ? "employer" : "candidate"}/jobs?job=${encodeURIComponent(item.id)}`,
    );
  };
  const saveJob = async (item: Job) => {
    if (busyId) return;
    setBusyId(item.id);
    const saved = favorites.includes(item.id);
    const result = await act("favorite-job", { id: item.id, saved: !saved });

    setBusyId(null);
  };
  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (filters.query)
    chips.push({
      key: "query",
      label: `Поиск: ${filters.query}`,
      remove: () => update("query", ""),
    });
  if (filters.specialty)
    chips.push({
      key: "specialty",
      label: specialtyNames[filters.specialty] || filters.specialty,
      remove: () => update("specialty", ""),
    });
  if (filters.grade)
    chips.push({
      key: "grade",
      label: filters.grade,
      remove: () => update("grade", ""),
    });
  for (const skill of filters.skills || [])
    chips.push({
      key: `skill:${skill}`,
      label: skill,
      remove: () =>
        update(
          "skills",
          filters.skills.filter((item) => item !== skill),
        ),
    });
  for (const industry of filters.industries || [])
    chips.push({
      key: `industry:${industry}`,
      label: industry,
      remove: () =>
        update(
          "industries",
          (filters.industries || []).filter((value) => value !== industry),
        ),
    });
  for (const key of ["location", "employment", "format", "experience"] as const)
    if (filters[key])
      chips.push({
        key,
        label:
          key === "experience" ? experienceNames[filters[key]] : filters[key],
        remove: () => update(key, ""),
      });
  if (filters.salaryMin || filters.salaryMax)
    chips.push({
      key: "salary",
      label: `${filters.salaryMin ? `от ${money(Number(filters.salaryMin) || 0)}` : ""}${filters.salaryMax ? ` до ${money(Number(filters.salaryMax) || 0)}` : ""} ₽`,
      remove: () =>
        setFilters((current) => ({
          ...current,
          salaryMin: "",
          salaryMax: "",
          page: 1,
        })),
    });

  const applicationDialog = !employer && applicationJob && (
    <ApplicationDialog
      key={applicationJob.id}
      job={applicationJob}
      s={s}
      act={act}
      nav={nav}
      close={() => setApplicationJob(null)}
    />
  );
  if (jobId && !job && !detailError)
    return (
      <div className="vacancies-page">
        <p className="catalog-status" role="status">
          Загружаем вакансию…
        </p>
      </div>
    );
  if (jobId)
    return job ? (
      <>
        {applicationDialog}
        <VacancyDetails
          nav={nav}
          employer={employer}
          job={job}
          jobs={s.jobs}
          profile={s.profile}
          company={detail?.company}
          companyJobCount={detail?.companyJobCount || 0}
          application={
            !employer
              ? s.applications.find((a) => a.jobId === job.id)
              : undefined
          }
          apply={() => setApplicationJob(job)}
          saved={favorites.includes(job.id)}
          busy={busyId !== null}
          save={saveJob}
          back={() => nav(`/demo/${employer ? "employer" : "candidate"}/jobs`)}
          open={openJob}
          companyJobs={() => {
            setFilters({ ...emptyVacancyFilters, companies: [job.company] });
            listScroll.current = 0;
            nav(`/demo/${employer ? "employer" : "candidate"}/jobs`);
          }}
        />
      </>
    ) : (
      <section className="vacancy-empty">
        <Search size={34} />
        <h1>Вакансия не найдена</h1>
        <p>Вернитесь к списку и выберите другое предложение.</p>
        <button
          className="btn primary"
          onClick={() =>
            nav(`/demo/${employer ? "employer" : "candidate"}/jobs`)
          }
        >
          К вакансиям <ArrowRight size={18} />
        </button>
      </section>
    );

  return (
    <div className="vacancies-page">
      {applicationDialog}
      <FeedbackDialog
        open={!!catalog.error}
        onOpenChange={(open) => {
          if (!open) catalog.dismissError();
        }}
        message={catalog.error}
      />
      <div className="vacancy-layout">
        <div className="vacancy-results" ref={listStart}>
          {!employer && (
            <SavedSearchTools
              role="candidate"
              filters={filters}
              onApply={(v) => setFilters({ ...filters, ...v })}
            />
          )}
          <section className="vacancy-search-panel" aria-label="Поиск вакансий">
            <div className="vacancy-search-heading">
              {!employer && <h2>Работа и вакансии</h2>}
              {employer?.toolbar}
              {!employer && (
                <div
                  className="vacancy-view-tabs"
                  role="group"
                  aria-label="Список вакансий"
                >
                  <button
                    className={
                      !filters.favoritesOnly && !applicationsOnly && !recentOnly
                        ? "active"
                        : ""
                    }
                    aria-pressed={
                      !filters.favoritesOnly && !applicationsOnly && !recentOnly
                    }
                    onClick={() => {
                      setRecentOnly(false);
                      setApplicationsOnly(false);
                      update("favoritesOnly", false);
                    }}
                  >
                    Все вакансии
                  </button>
                  <button
                    className={filters.favoritesOnly ? "active" : ""}
                    aria-pressed={filters.favoritesOnly}
                    onClick={() => {
                      setRecentOnly(false);
                      setApplicationsOnly(false);
                      update("favoritesOnly", true);
                    }}
                  >
                    <Bookmark size={16} />
                    Избранное <span>{favorites.length}</span>
                  </button>
                  <button
                    className={applicationsOnly ? "active" : ""}
                    aria-pressed={applicationsOnly}
                    onClick={() => {
                      setRecentOnly(false);
                      setApplicationsOnly(true);
                      update("favoritesOnly", false);
                    }}
                  >
                    <Send size={16} /> Мои отклики{" "}
                    <span>{s.applications.length}</span>
                  </button>
                </div>
              )}
            </div>
            <div className="vacancy-search-row">
              <label className="vacancy-search-input">
                <Search size={21} />
                <input
                  type="search"
                  aria-label="Поиск по названию, компании или навыку"
                  value={filters.query}
                  onChange={(event) => update("query", event.target.value)}
                  placeholder="Должность, компания или технология"
                />
              </label>
              <ChoiceSelect
                label="Сортировка вакансий"
                value={filters.sort}
                onChange={(value) => update("sort", value)}
                options={[
                  ...(!employer
                    ? [{ value: "match", label: "По соответствию" }]
                    : []),
                  { value: "date", label: "Сначала новые" },
                  { value: "salary-desc", label: "Зарплата по убыванию" },
                  { value: "salary-asc", label: "Зарплата по возрастанию" },
                ]}
              />
            </div>
            <div className="vacancy-search-bottom">
              {recentOnly && (
                <button
                  className="activity-link"
                  onClick={() => setRecentOnly(false)}
                >
                  За 7 дней · по вашим предпочтениям <X size={15} />
                </button>
              )}
              <p role="status">
                {filters.favoritesOnly ? "В избранном" : "Найдено"}{" "}
                <strong>{vacancyCount(total)}</strong>
              </p>
              <button
                className="vacancy-mobile-toggle"
                aria-expanded={mobileFilters}
                aria-controls="vacancy-filters"
                onClick={() => setMobileFilters((value) => !value)}
              >
                <SlidersHorizontal size={17} />
                Фильтры{chips.length > 0 && <span>{chips.length}</span>}
              </button>
            </div>
            {filters.sort === "match" && (
              <p className="vacancy-sort-note">
                <Sparkles size={14} />
                Учитываем направление и подтверждённые навыки. Совпадение не
                заменяет требования вакансии.
              </p>
            )}
            {chips.length > 0 && (
              <div
                className="vacancy-active-filters"
                aria-label="Выбранные фильтры"
              >
                {chips.map((chip) => (
                  <button
                    key={chip.key}
                    onClick={chip.remove}
                    aria-label={`Убрать фильтр: ${chip.label}`}
                  >
                    {chip.label}
                    <X size={13} />
                  </button>
                ))}
                <button className="vacancy-clear" onClick={reset}>
                  Сбросить всё
                </button>
              </div>
            )}
            {salaryError && (
              <p className="vacancy-filter-error" role="alert">
                {salaryError}. Зарплатный фильтр не применён.
              </p>
            )}
            <DraftStatus meta={filtersMeta} />
          </section>
          <div
            className={`vacancy-card-list ${catalog.loading ? "catalog-pending" : ""}`}
            aria-busy={catalog.loading}
          >
            <p className={`catalog-status${visible.length && catalog.loading ? " sr-only" : ""}`} role="status">
              {catalog.loading ? "Загружаем вакансии…" : ""}
            </p>
            {visible.map((item) => {
              const match = vacancyMatch(item, s.profile);
              return (
                <article
                  className="vacancy-card"
                  key={item.id}
                  tabIndex={0}
                  aria-label={`Подробнее: ${item.title}`}
                  onClick={(e) => {
                    if (
                      !(e.target as HTMLElement).closest(
                        "button, a, input, select, textarea, [role=button], [role=combobox]",
                      )
                    )
                      openJob(item);
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.target === e.currentTarget &&
                      (e.key === "Enter" || e.key === " ")
                    ) {
                      e.preventDefault();
                      openJob(item);
                    }
                  }}
                >
                  <div className="vacancy-card-top">
                    <div className="vacancy-company-line">
                      <CompanyLogo job={item} />
                      <div>
                        <button
                          className="vacancy-company-name"
                          onClick={() =>
                            setFilters((current) => ({
                              ...current,
                              company: "",
                              companies: [item.company],
                              page: 1,
                            }))
                          }
                        >
                          {item.company}
                        </button>
                        <span>{item.team || "Продуктовая команда"}</span>
                        {item.demo && (
                          <small className="vacancy-example-label">
                            Пример вакансии
                          </small>
                        )}
                      </div>
                    </div>
                    <div className="vacancy-card-date">
                      <time dateTime={item.publishedAt}>
                        {vacancyDate(item)}
                      </time>
                      {!employer && (
                        <SaveJob
                          job={item}
                          saved={favorites.includes(item.id)}
                          busy={busyId !== null}
                          onSave={saveJob}
                        />
                      )}
                    </div>
                  </div>
                  <h2>
                    <a
                      href={`/demo/${employer ? "employer" : "candidate"}/jobs?job=${encodeURIComponent(item.id)}`}
                      onClick={(event) => {
                        if (
                          !event.ctrlKey &&
                          !event.metaKey &&
                          !event.shiftKey &&
                          event.button === 0
                        ) {
                          event.preventDefault();
                          openJob(item);
                        }
                      }}
                    >
                      {item.title}
                    </a>
                  </h2>
                  <p className="vacancy-salary">
                    {money(item.min)} — {money(item.max)} ₽
                    <span>в месяц · до вычета налогов</span>
                  </p>
                  <div className="vacancy-category">
                    <span>{item.grade}</span>
                    <span>
                      {specialtyNames[item.specialty] || item.specialty}
                    </span>
                    <span>{item.employment}</span>
                  </div>
                  <JobMeta job={item} />
                  <div className="vacancy-skill-chips">
                    {item.skills.map((skill) => (
                      <button
                        key={skill}
                        onClick={() => {
                          if (!filters.skills.includes(skill))
                            update("skills", [...filters.skills, skill]);
                        }}
                        title={`Показать вакансии с навыком ${skill}`}
                      >
                        {skill}
                      </button>
                    ))}
                  </div>
                  <p className="vacancy-card-description">{item.description}</p>
                  <div className="vacancy-card-bottom">
                    <span className="vacancy-match-hint">
                      {employer ? (
                        <>
                          <BriefcaseBusiness size={16} />
                          {item.status === "draft"
                            ? "Черновик"
                            : item.status === "archived"
                              ? "В архиве"
                              : item.industry || "Условия и требования роли"}
                        </>
                      ) : match.matched.length > 0 ? (
                        <>
                          <CheckCircle2 size={16} />
                          Подтверждены: {match.matched.join(", ")}
                        </>
                      ) : (
                        <>
                          <Code2 size={16} />
                          {match.sameSpecialty
                            ? "Ваше направление"
                            : "Изучите требования к навыкам"}
                        </>
                      )}
                    </span>
                    <div className="vacancy-card-buttons">
                      {employer ? (
                        employer.actions(item)
                      ) : (
                        <ApplyButton
                          nav={nav}
                          archived={item.status === "archived"}
                          application={s.applications.find(
                            (a) => a.jobId === item.id,
                          )}
                          onClick={() => setApplicationJob(item)}
                        />
                      )}
                      <button
                        className="vacancy-details-button"
                        onClick={() => openJob(item)}
                      >
                        Подробнее <ArrowRight size={17} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {!catalog.loading && !catalog.error && !rows.length && (
            <section className="vacancy-empty">
              <Bookmark size={32} />
              <h2>
                {applicationsOnly && !s.applications.length
                  ? "Ваш первый отклик ещё впереди"
                  : filters.favoritesOnly && !favorites.length
                    ? "Сохраните то, что интересно"
                    : "Пока нет таких вакансий"}
              </h2>
              <p>
                {applicationsOnly && !s.applications.length
                  ? "Выберите интересную роль, изучите условия и отправьте профиль команде. Здесь будет виден статус вашего отклика."
                  : filters.favoritesOnly && !favorites.length
                    ? "Нажмите закладку в карточке — вакансия останется здесь, и вы сможете вернуться к ней позже."
                    : "Попробуйте убрать часть фильтров или изменить поисковый запрос."}
              </p>
              <button
                className="btn primary"
                onClick={() => {
                  setApplicationsOnly(false);
                  setFilters({ ...emptyVacancyFilters });
                }}
              >
                {(applicationsOnly && !s.applications.length) ||
                (filters.favoritesOnly && !favorites.length)
                  ? "Смотреть все вакансии"
                  : "Сбросить фильтры"}
                <ArrowRight size={17} />
              </button>
            </section>
          )}
          {total > pageSize && (
            <nav className="vacancy-pagination" aria-label="Страницы вакансий">
              <button
                disabled={catalog.loading || page === 1}
                aria-label="Предыдущая страница вакансий"
                onClick={() => {
                  setFilters((current) => ({ ...current, page: page - 1 }));
                  listStart.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                }}
              >
                <ChevronLeft size={19} />
              </button>
              {catalogPages(page, totalPages).map((number) => (
                <button
                  key={number}
                  className={page === number ? "active" : ""}
                  aria-current={page === number ? "page" : undefined}
                  aria-label={`Страница ${number}`}
                  onClick={() => {
                    setFilters((current) => ({ ...current, page: number }));
                    listStart.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }}
                >
                  {number}
                </button>
              ))}
              <button
                disabled={catalog.loading || page === totalPages}
                aria-label="Следующая страница вакансий"
                onClick={() => {
                  setFilters((current) => ({ ...current, page: page + 1 }));
                  listStart.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                }}
              >
                <ChevronRight size={19} />
              </button>
            </nav>
          )}
        </div>
        <aside
          id="vacancy-filters"
          className={`vacancy-filters-column ${mobileFilters ? "is-open" : ""}`}
        >
          <div className="vacancy-filter-intro">
            <SlidersHorizontal size={25} />
            <div>
              <strong>Условия важны.</strong>
              <p>Настройте поиск под себя.</p>
            </div>
          </div>
          <section
            className="vacancy-filter-panel"
            aria-label="Фильтры вакансий"
          >
            <div className="vacancy-filter-title">
              <h2>Фильтры поиска</h2>
              <button onClick={reset}>Сбросить</button>
            </div>
            <FilterSelect
              label="Специализация"
              value={filters.specialty}
              onChange={(value) => update("specialty", value)}
              options={specialtyOptions}
            />
            <div className="vacancy-filter-field">
              <label htmlFor="vacancy-industries">Сферы компаний</label>
              <SuggestionTags
                id="vacancy-industries"
                value={filters.industries || []}
                onChange={(values) => update("industries", values)}
                catalog={industries.map((name) => ({
                  name,
                  group: "Сферы компаний",
                }))}
                maxSelected={20}
                placeholder="Финтех, образование и другие"
              />
              <small>Подойдёт любая из выбранных сфер.</small>
            </div>
            <FilterSelect
              label="Уровень"
              value={filters.grade}
              onChange={(value) => update("grade", value)}
              options={["Intern", "Junior", "Middle", "Senior", "Lead"].map(
                (value) => ({
                  value,
                  label: value === "Intern" ? "Стажёр (Intern)" : value,
                }),
              )}
              placeholder="Любой"
            />
            <div className="vacancy-filter-field">
              <label htmlFor="vacancy-skills">Профессиональные навыки</label>
              <SuggestionTags
                id="vacancy-skills"
                value={filters.skills || []}
                onChange={(values) => update("skills", values)}
                catalog={skillCatalog}
                placeholder="Python, React, SQL…"
                maxSelected={12}
              />
              <small>Вакансия должна содержать все выбранные навыки.</small>
            </div>
            <fieldset className="vacancy-filter-field">
              <legend>Зарплата, ₽ в месяц</legend>
              <div className="vacancy-salary-inputs">
                <label>
                  <span>От</span>
                  <input
                    type="number"
                    min="0"
                    max="10000000"
                    step="1000"
                    aria-label="Зарплата от"
                    value={filters.salaryMin}
                    onChange={(event) =>
                      update("salaryMin", event.target.value)
                    }
                    placeholder="100 000"
                    aria-invalid={Boolean(salaryError)}
                  />
                </label>
                <label>
                  <span>До</span>
                  <input
                    type="number"
                    min="0"
                    max="10000000"
                    step="1000"
                    aria-label="Зарплата до"
                    value={filters.salaryMax}
                    onChange={(event) =>
                      update("salaryMax", event.target.value)
                    }
                    placeholder="300 000"
                    aria-invalid={Boolean(salaryError)}
                  />
                </label>
              </div>
              <small>
                До вычета налогов. Показываем вакансии с пересекающимся
                диапазоном.
              </small>
              {salaryError && (
                <small className="vacancy-filter-error">{salaryError}</small>
              )}
            </fieldset>
            <div className="vacancy-filter-field">
              <label htmlFor="vacancy-location">Местоположение</label>
              <SuggestionText
                id="vacancy-location"
                value={filters.location}
                onChange={(value) => update("location", value)}
                catalog={cityCatalog}
                placeholder="Город или регион"
              />
            </div>
            <FilterSelect
              label="Формат работы"
              value={filters.format}
              onChange={(value) => update("format", value)}
              options={["Удалённо", "Гибрид", "Офис"].map((value) => ({
                value,
                label: value,
              }))}
              placeholder="Любой"
            />
            <FilterSelect
              label="Тип занятости"
              value={filters.employment}
              onChange={(value) => update("employment", value)}
              options={[
                "Полная занятость",
                "Частичная занятость",
                "Проектная работа",
              ].map((value) => ({ value, label: value }))}
              placeholder="Любой"
            />
            <FilterSelect
              label="Опыт работы"
              value={filters.experience}
              onChange={(value) => update("experience", value)}
              options={Object.entries(experienceNames).map(
                ([value, label]) => ({ value, label }),
              )}
              placeholder="Любой"
            />
            <div className="vacancy-filter-field">
              <label>Компании</label>
              <MultiChoice
                label="Компании"
                values={
                  filters.companies?.length
                    ? filters.companies
                    : filters.company
                      ? [filters.company]
                      : []
                }
                options={[]}
                remoteCompanies
                onChange={(values) =>
                  setFilters((current) => ({
                    ...current,
                    company: "",
                    companies: values,
                    page: 1,
                  }))
                }
              />
            </div>
            <label className="vacancy-check">
              <input
                type="checkbox"
                checked={filters.excludeCompany}
                disabled={!filters.company && !filters.companies?.length}
                onChange={(event) =>
                  update("excludeCompany", event.target.checked)
                }
              />
              <span>Исключить выбранные компании</span>
            </label>
            <button
              className="vacancy-mobile-apply btn primary"
              onClick={() => {
                setMobileFilters(false);
                listStart.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
            >
              Показать {vacancyCount(total)}
              <Check size={18} />
            </button>
          </section>
          <div className="vacancy-invitation-note">
            <Sparkles size={19} />
            <h3>
              {employer
                ? "Условия помогают сравнивать."
                : "Предложение может найти вас."}
            </h3>
            <p>
              {employer
                ? "Изучайте вакансии рынка и публикуйте свои роли с понятной зарплатой и требованиями."
                : "Компании видят подтверждённые навыки и отправляют приглашения с условиями."}
            </p>
            <button
              onClick={() =>
                nav(
                  `/demo/${employer ? "employer/candidates" : "candidate/invitations"}`,
                )
              }
            >
              {employer ? "Найти кандидатов" : "Мои приглашения"}{" "}
              <ArrowRight size={15} />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
function DetailSection({ title, items }: { title: string; items?: string[] }) {
  return items?.length ? (
    <section className="vacancy-detail-section">
      <h2>{title}</h2>
      <ul>
        {items.map((text, index) => (
          <li key={index}>{text}</li>
        ))}
      </ul>
    </section>
  ) : null;
}
function VacancyDetails({
  nav,
  job,
  jobs,
  profile,
  saved,
  busy,
  save,
  back,
  open,
  companyJobs,
  application,
  apply,
  company,
  companyJobCount,
  employer,
}: {
  nav: Navigate;
  employer?: { actions: (job: Job) => ReactNode };
  job: Job;
  jobs: Job[];
  profile: State["profile"];
  saved: boolean;
  busy: boolean;
  save: (job: Job) => void;
  back: () => void;
  open: (job: Job) => void;
  companyJobs: () => void;
  application?: JobApplication;
  apply: () => void;
  company?: CompanyProfile;
  companyJobCount: number;
}) {
  const [companyOpen, setCompanyOpen] = useState(false);
  const match = vacancyMatch(job, profile);
  const similar = jobs
    .filter(
      (item) =>
        item.id !== job.id &&
        item.specialty === job.specialty &&
        publishedJob(item),
    )
    .slice(0, 3);
  return (
    <div className="vacancies-page vacancy-details-page">
      <div className="vacancy-detail-toolbar">
        <button className="vacancy-back" onClick={back}>
          <ArrowLeft size={18} />К списку вакансий
        </button>
        <button
          className="vacancy-copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              toast.success("Ссылка скопирована");
            } catch {
              toast.error(
                "Не удалось скопировать ссылку. Скопируйте адрес страницы.",
              );
            }
          }}
        >
          <Copy size={16} />
          Скопировать ссылку
        </button>
      </div>
      <div className="vacancy-layout vacancy-detail-layout">
        <div className="vacancy-detail-main">
          <article className="vacancy-detail-hero">
            <div className="vacancy-detail-eyebrow">
              <span>{specialtyNames[job.specialty] || job.specialty}</span>
              <time dateTime={job.publishedAt}>{vacancyDate(job)}</time>
            </div>
            <h1>{job.title}</h1>
            <p className="vacancy-salary">
              {money(job.min)} — {money(job.max)} ₽
              <span>в месяц · до вычета налогов</span>
            </p>
            <div className="vacancy-category">
              <span>{job.grade}</span>
              <span>{job.employment}</span>
            </div>
            <JobMeta job={job} />
            <h2 className="vacancy-small-heading">Ключевые навыки</h2>
            <div className="vacancy-skill-chips">
              {job.skills.map((skill) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
            <div className="vacancy-detail-actions">
              {employer ? (
                employer.actions(job)
              ) : job.status === "archived" ? (
                <span className="employer-status">Вакансия в архиве</span>
              ) : (
                <ApplyButton application={application} onClick={apply} nav={nav} />
              )}
              {!employer && (
                <SaveJob
                  job={job}
                  saved={saved}
                  busy={busy}
                  onSave={save}
                  full
                />
              )}
              {job.demo && (
                <span className="vacancy-demo-label">
                  Демонстрационная вакансия
                </span>
              )}
            </div>
            {application && (
              <section className="vacancy-response-message">
                <strong>
                  Ваш отклик ·{" "}
                  {new Date(application.createdAt).toLocaleDateString("ru-RU")}
                </strong>
                <p>
                  {application.message ||
                    "Профиль отправлен без сопроводительного сообщения."}
                </p>
              </section>
            )}
          </article>
          <article className="vacancy-description-panel">
            <span className="eyebrow">О РОЛИ И КОМАНДЕ</span>
            <h2>Что предстоит делать</h2>
            <p className="vacancy-description-lead">{job.description}</p>
            <DetailSection
              title={employer ? "Задачи роли" : "Ваши задачи"}
              items={job.responsibilities}
            />
            <DetailSection
              title="Что важно для этой роли"
              items={job.requirements}
            />
            <DetailSection title="Будет преимуществом" items={job.niceToHave} />
            <DetailSection
              title="Что предлагает команда"
              items={job.benefits}
            />
            {job.hiringProcess && (
              <section className="vacancy-detail-section">
                <h2>Как проходит знакомство</h2>
                <p>{job.hiringProcess}</p>
              </section>
            )}
            {!!job.mediaKeys?.length && (
              <section className="vacancy-detail-section">
                <h2>Команда и рабочая атмосфера</h2>
                <div className="company-photo-gallery">
                  {job.mediaKeys.map((key, i) => (
                    <img
                      key={key}
                      src={assetUrl(key)}
                      alt={`Фотография команды ${job.company}, ${i + 1}`}
                    />
                  ))}
                </div>
              </section>
            )}
          </article>
          {similar.length > 0 && (
            <section className="vacancy-similar">
              <h2>Другие роли в этом направлении</h2>
              {similar.map((item) => (
                <button key={item.id} onClick={() => open(item)}>
                  <CompanyLogo job={item} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.company} · {money(item.min)} — {money(item.max)} ₽
                    </small>
                  </span>
                  <ArrowRight size={19} />
                </button>
              ))}
            </section>
          )}
        </div>
        <aside className="vacancy-detail-aside">
          <section className="vacancy-company-panel">
            <CompanyLogo job={job} large />
            <h2>{job.company}</h2>
            {company && (
              <button
                className="employer-link"
                onClick={() => setCompanyOpen(true)}
              >
                Профиль компании <ArrowRight size={16} />
              </button>
            )}
            <p>
              {job.companyDescription ||
                "Компания развивает свою команду и приглашает специалистов для работы над продуктом."}
            </p>
            {job.companySize && (
              <span className="vacancy-company-size">
                <Users size={17} />
                {job.companySize}
              </span>
            )}
            {job.team && (
              <div className="vacancy-team">
                <span>Команда</span>
                <strong>{job.team}</strong>
              </div>
            )}
            <button onClick={companyJobs}>
              Все вакансии компании <span>{companyJobCount}</span>
              <ArrowRight size={17} />
            </button>
          </section>
          {!employer && (
            <section className="vacancy-requirements-note">
              <CheckCircle2 size={22} />
              <h3>Ваши подтверждённые навыки</h3>
              <p>
                {match.matched.length
                  ? match.matched.join(" · ")
                  : "Совпадений пока нет. Сравните свой опыт с требованиями роли."}
              </p>
              <small>
                Самооценка в профиле и результат проверки учитываются отдельно.
              </small>
            </section>
          )}
        </aside>
      </div>
      {company && (
        <Dialog open={companyOpen} onOpenChange={setCompanyOpen}>
          <DialogContent className="app-dialog company-public-dialog">
            <DialogHeader>
              <DialogTitle>Профиль компании</DialogTitle>
              <DialogDescription>
                Команда, продукты и условия работы
              </DialogDescription>
            </DialogHeader>
            <CompanyShowcase company={company} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ApplyButton({
  nav,
  application,
  onClick,
  archived,
}: {
  nav: Navigate;
  application?: JobApplication;
  onClick: () => void;
  archived?: boolean;
}) {
  return application ? (
    <div className="vacancy-applied-actions">
      {application.id && (
        <ChatLaunch role="candidate" applicationId={application.id} nav={nav} />
      )}
      <span
        className={`vacancy-application-status ${application.status === "Отклонён" ? "declined" : ""}`}
        role="status"
      >
        <CheckCircle2 size={17} />
        {application.status === "Отправлен"
          ? "Отклик отправлен"
          : application.status}
      </span>
    </div>
  ) : archived ? (
    <span className="employer-status">Вакансия в архиве</span>
  ) : (
    <button className="btn primary vacancy-apply" onClick={onClick}>
      Откликнуться <ArrowRight size={17} />
    </button>
  );
}
function ApplicationDialog({
  job,
  s,
  act,
  nav,
  close,
}: {
  job: Job;
  s: State;
  act: Action;
  nav: Navigate;
  close: () => void;
}) {
  const [draft, setDraft, meta] = useDraft(`job:apply-${job.id}`, {
    message: "",
  });
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const profileError = applicationProfileError(s.profile);
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !sending) close();
      }}
    >
      <DialogContent
        className="app-dialog vacancy-application-dialog"
        onEscapeKeyDown={(event) => {
          if (sending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (sending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Отклик на вакансию</DialogTitle>
          <DialogDescription>
            Проверьте данные перед отправкой в {job.company}.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!consent || sending || profileError) return;
            setSending(true);
            const result = await act("apply", {
              id: job.id,
              message: draft.message,
              shareContacts: consent,
            });
            setSending(false);
            if (result) {
              setDraft({ message: "" });

              close();
              const application = result.applications.find(
                (a) =>
                  a.jobId === job.id && a.candidateId === result.profile.id,
              );
              if (application?.id) {
                try {
                  const { id } = await chatRequest<{ id: string }>(
                    "candidate",
                    "",
                    { applicationId: application.id },
                  );
                  nav(`/demo/candidate/messages?conversation=${id}`);
                } catch {
                  // The exchange is saved; the conversation remains available in Messages.
                  nav("/demo/candidate/messages");
                }
              }
            }
          }}
        >
          <div className="vacancy-application-role">
            <CompanyLogo job={job} />
            <div>
              <strong>{job.title}</strong>
              <span>
                {job.company} · {money(job.min)} — {money(job.max)} ₽
              </span>
            </div>
          </div>
          <section className="vacancy-application-profile">
            <span className="eyebrow">ВАШ ПРОФИЛЬ</span>
            <strong>{s.profile.name || "Имя не указано"}</strong>
            <p>
              {s.profile.headline ||
                s.profile.roles.join(", ") ||
                s.profile.specialty}
              {s.profile.city && ` · ${s.profile.city}`}
            </p>
            <p>
              {s.profile.email || "Почта не указана"}
              {s.profile.phone && ` · ${s.profile.phone}`}
            </p>
            <div className="vacancy-skill-chips">
              {s.profile.skills.slice(0, 8).map((skill) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
          </section>
          {profileError && (
            <div className="vacancy-filter-error" role="alert">
              {profileError}
              <button
                type="button"
                onClick={() => {
                  close();
                  nav("/demo/candidate/profile");
                }}
              >
                Открыть профиль <ArrowRight size={16} />
              </button>
            </div>
          )}
          <label className="vacancy-application-message">
            <span>
              Сообщение команде <small>необязательно</small>
            </span>
            <textarea
              maxLength={2000}
              value={draft.message}
              onChange={(event) => setDraft({ message: event.target.value })}
              placeholder="Расскажите, почему вам интересна эта роль и какой опыт пригодится команде."
              rows={4}
            />
            <small>{draft.message.length} / 2000</small>
          </label>
          <DraftStatus meta={meta} />
          <label className="vacancy-application-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              Разрешаю передать мой профиль, электронную почту и указанный
              телефон компании «{job.company}» для связи по этой вакансии.
            </span>
          </label>
          <p className="vacancy-application-note">
            <LockKeyhole size={15} />
            {job.demo
              ? "Демо: отклик сохранится в вашем прототипе. Внешним компаниям ничего не отправляется."
              : "Компания получит снимок профиля на момент отправки. Проверку навыков можно пройти отдельно."}
          </p>
          <div className="vacancy-application-footer">
            <button
              type="button"
              className="btn ghost"
              disabled={sending}
              onClick={close}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={!consent || sending || !!profileError}
            >
              {sending ? "Отправляем…" : "Отправить отклик"}
              <Send size={17} />
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
