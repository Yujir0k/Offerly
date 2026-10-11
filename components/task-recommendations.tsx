"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Search, Sparkles } from "lucide-react";
import type { Need, Profile, State } from "@/lib/model";
import { grades, money, specialties } from "@/lib/model";
import { taskOptions } from "@/lib/employer-matching";
import { candidateOrderOptions } from "@/lib/employer-search";
import {
  emptyTaskBrief,
  validateTaskBrief,
  taskBriefGrades,
  type ParsedBrief,
  type TaskBrief,
} from "@/lib/task-brief";
import type { RecommendationResult } from "@/lib/task-recommendations";
import { CandidateProfileDialog } from "./candidate-profile-dialog";
import { skillCatalog } from "@/lib/suggestion-catalogs";
import { DraftStatus, useDraft } from "@/hooks/use-draft";
import type { Action } from "./registration";
import type { Navigate } from "./landing";
import { EmployerField, EmployerSelect } from "./employer-ui";
import { SuggestionTags } from "./suggestion-picker";
import { CandidateCard } from "./candidate-card";
import { InviteDialog } from "./invite-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

const examples = [
  "Нужен Backend Middle на Python. Обязательно SQL, желательно Redis. Разбирать инциденты и находить причины ошибок. Удалённо, бюджет до 230 тыс. ₽ в месяц.",
  "Frontend Middle: проектировать новый личный кабинет на React. Желательно TypeScript. Удалённо или гибрид, до 210 тыс. рублей в месяц.",
  "Нужен QA Senior для качества и надёжности платёжного сервиса. Обязательно Python, желательно SQL. Регрессионные проверки и крайние случаи. До 270 тыс. ₽ в месяц.",
];
const savedRequirements = (need?: Need): TaskBrief | null =>
  need
    ? need.taskBrief || {
        ...emptyTaskBrief,
        spec: need.specialty,
        grade: need.grade,
        skills: need.skills,
        desiredSkills: need.desiredSkills || [],
        task: (need.task || "balanced") as TaskBrief["task"],
        salaryMin: String(need.min),
        salaryMax: String(need.max),
        formats: need.format === "Любой" ? [] : [need.format],
      }
    : null;

/** Transparent task-to-candidate workflow with an editable interpretation before server ranking. */
export function TaskRecommendations({
  s,
  act,
  nav,
  initialNeed,
  onCreateManually,
  manualRequest,
}: {
  s: State;
  act: Action;
  nav: Navigate;
  initialNeed?: Need;
  onCreateManually: () => void;
  manualRequest: number;
}) {
  const [draft, setDraft, meta] = useDraft("task:employer-description-v1", {
    text: "",
    requirements: null as TaskBrief | null,
  });
  const [savedText, setSavedText] = useState(initialNeed?.description || "");
  const text = initialNeed ? savedText : draft.text;
  const sourceQuery = initialNeed
    ? `&need=${encodeURIComponent(initialNeed.id)}`
    : "";
  const [title, setTitle] = useState(initialNeed?.title || "");
  const [parsed, setParsed] = useState<ParsedBrief | null>(null);
  const [localRequirements, setLocalRequirements] = useState<TaskBrief | null>(
    savedRequirements(initialNeed),
  );
  const requirements = initialNeed
    ? localRequirements
    : draft.requirements || null;
  const setRequirements = (
    next: TaskBrief | null | ((current: TaskBrief | null) => TaskBrief | null),
  ) => {
    if (initialNeed) setLocalRequirements(next);
    else
      setDraft((current) => ({
        ...current,
        requirements:
          typeof next === "function"
            ? next(current.requirements || null)
            : next,
      }));
  };
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const [view, setView] = useState<Profile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [invite, setInvite] = useState<Profile | null>(null);
  const [explanation, setExplanation] = useState<
    RecommendationResult["recommendations"][number] | null
  >(null);
  const activeNeed: Need = initialNeed || {
    id: "",
    title: "Подбор по задаче",
    specialty: result?.requirements.spec || "",
    grade: result?.requirements.grade || "",
    skills: result?.requirements.skills || [],
    description: text,
    min: Number(result?.requirements.salaryMin) || 1,
    max: Number(result?.requirements.salaryMax) || 10000000,
    format: result?.requirements.formats[0] || "Любой",
  };

  const requestId = useRef(0);
  const resultsRef = useRef<HTMLElement>(null);
  const conditionsRef = useRef<HTMLDivElement>(null);
  const appliedManual = useRef(0);
  const scrollToConditions = useRef(false);
  useEffect(() => {
    if (!manualRequest || appliedManual.current === manualRequest || meta.status === "loading") return;
    appliedManual.current = manualRequest;
    requestId.current++;
    scrollToConditions.current = true;
    setDraft({ text: "", requirements: { ...emptyTaskBrief } });
    setTitle("");
    setParsed(null);
    setResult(null);
    setError("");
    setSaved(false);
    setBusy(false);
    setAnalysing(false);
  }, [manualRequest, meta.status, setDraft]);
  useEffect(() => {
    if (!requirements || !scrollToConditions.current) return;
    scrollToConditions.current = false;
    const frame = requestAnimationFrame(() => conditionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [requirements]);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const field = descriptionRef.current;
    if (!field) return;
    const resize = () => {
      field.style.height = "auto";
      const borderHeight = field.offsetHeight - field.clientHeight;
      field.style.height = `${field.scrollHeight + borderHeight}px`;
    };
    resize();
    let width = field.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = field.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      resize();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [text]);
  useEffect(() => {
    if (result)
      resultsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  }, [result]);
  const inputText = (value: string) => {
    requestId.current++;
    if (initialNeed) {
      setSavedText(value);
      setLocalRequirements(null);
    } else
      setDraft((current) => ({ ...current, text: value, requirements: null }));
    setParsed(null);
    setResult(null);
    setError("");
    setSaved(false);
    setBusy(false);
    setAnalysing(false);
  };
  const change = (patch: Partial<TaskBrief>) => {
    setRequirements((current) => current && { ...current, ...patch });
    setResult(null);
    setSaved(false);
    setError("");
  };
  const analyse = async () => {
    if (text.trim().length < 10) {
      setError("Опишите задачу хотя бы в одном предложении.");
      return;
    }
    const id = ++requestId.current;
    setAnalysing(true);
    setError("");
    try {
      const response = await fetch("/api/task-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "employer", text }),
        signal: AbortSignal.timeout(20000),
      });
      const interpretation = await response.json();
      if (!response.ok)
        throw new Error(interpretation.error || "Не удалось разобрать задачу");
      if (requestId.current !== id) return;
      scrollToConditions.current = true;
      setParsed(interpretation as ParsedBrief);
      setRequirements(interpretation.requirements);
      setResult(null);
      setSaved(false);
    } catch (error) {
      if (requestId.current === id)
        setError(error instanceof Error ? error.message : "Повторите разбор");
    } finally {
      if (requestId.current === id) setAnalysing(false);
    }
  };
  const generate = async () => {
    let brief: TaskBrief;
    try {
      brief = validateTaskBrief(requirements);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Проверьте условия");
      return;
    }
    const id = ++requestId.current;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "employer", requirements: brief }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Не удалось подобрать кандидатов");
      if (requestId.current === id) setResult(data as RecommendationResult);
    } catch (e) {
      if (requestId.current === id)
        setError(e instanceof Error ? e.message : "Повторите подбор");
    } finally {
      if (requestId.current === id) setBusy(false);
    }
  };
  return (
    <section
      className="task-match-workspace"
      aria-label="Подбор по описанию задачи"
    >
      <div className="employer-panel task-brief-entry">
        <span className="task-step">
          <Sparkles size={16} /> Подбор по задаче
        </span>
        <h2>Расскажите, кого и для чего ищете</h2>
        <p className="muted">
          Опишите задачи, технологии и условия. Мы покажем, как поняли запрос, и
          предложим несколько вариантов с основаниями выбора.
        </p>
        <label className="sr-only" htmlFor="task-description">
          Описание задачи команды
        </label>
        <textarea
          ref={descriptionRef}
          id="task-description"
          rows={6}
          maxLength={3000}
          value={text}
          disabled={!initialNeed && meta.status === "loading"}
          onChange={(event) => inputText(event.target.value)}
          placeholder="Например: нужен Backend Middle на Python, чтобы находить причины сбоев и развивать API. Обязательно SQL. Удалённо, до 230 тыс. ₽/мес."
        />
        <div className="task-entry-actions">
          <button
            className="employer-button primary"
            disabled={
              busy || analysing || (!initialNeed && meta.status === "loading")
            }
            onClick={analyse}
          >
            {analysing ? "Разбираем задачу…" : "Разобрать задачу"}{" "}
            <ArrowRight size={16} />
          </button>
          <button className="employer-button" onClick={onCreateManually}>Создать вручную</button>
        </div>
        <details className="task-examples">
          <summary>Попробовать пример</summary>
          <div>
            {examples.map((example, index) => (
              <button
                className="employer-button"
                key={example}
                onClick={() => inputText(example)}
              >
                {
                  [
                    "Backend · инциденты",
                    "Frontend · новый продукт",
                    "QA · надёжность",
                  ][index]
                }
              </button>
            ))}
          </div>
        </details>
        {!initialNeed && <DraftStatus meta={meta} />}
      </div>
      {requirements && (
        <div ref={conditionsRef} className="employer-panel task-interpretation">
          <span className="task-step">1 · Проверьте условия</span>
          <h2>
            {parsed
              ? "Как мы поняли запрос"
              : initialNeed
                ? "Условия сохранённой подборки"
                : "Условия задачи"}
          </h2>
          <p className="muted">
            Направление, уровень, обязательные технологии, формат и бюджет
            ограничивают список. Остальное меняет приоритет. Поправьте условия
            перед подбором.
          </p>
          {parsed && (
          <details className="task-extraction">
              <summary>Что нашли в тексте · {parsed.signals.length}</summary>
              <ul>
                {parsed.signals.map((signal, index) => (
                  <li key={`${signal.field}-${index}`}>
                    <span>«{signal.quote}»</span>
                    <span>
                      → {signal.field}:{" "}
                      {taskOptions.find((task) => task.value === signal.value)
                        ?.label || signal.value}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {parsed && (
            <div className="task-notices">
              {parsed.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
          <fieldset
            disabled={busy || saving || analysing}
            className="task-conditions"
          >
            <div className="form-two">
              <EmployerField label="Направление">
                <EmployerSelect
                  label="Направление для подбора"
                  value={requirements.spec}
                  onChange={(value) => change({ spec: value })}
                  options={[
                    { value: "", label: "Выберите направление" },
                    ...specialties.map((value) => ({ value, label: value })),
                  ]}
                />
              </EmployerField>
              <EmployerField
                label="Уровни кандидатов"
                hint="Можно выбрать несколько. Результаты разных уровней показываем отдельно."
              >
                <div className="task-format-options">
                  {grades.map((grade) => {
                    const selected = taskBriefGrades(requirements);
                    return (
                      <label key={grade}>
                        <input
                          type="checkbox"
                          aria-label={`Уровень ${grade}`}
                          checked={selected.includes(grade)}
                          disabled={
                            selected.length === 1 && selected.includes(grade)
                          }
                          onChange={(event) => {
                            const values = event.target.checked
                              ? [...selected, grade]
                              : selected.filter((value) => value !== grade);
                            change({
                              grade: values.length === 1 ? values[0] : "",
                              grades:
                                values.length > 1 && values.length < 3
                                  ? values
                                  : [],
                            });
                          }}
                        />
                        {grade}
                      </label>
                    );
                  })}
                </div>
              </EmployerField>
            </div>
            <div className="form-two">
              <EmployerField
                label="Обязательные технологии"
                hint="Каждый тег обязателен; в группе «или» достаточно одной технологии. Нажмите на тег, чтобы сделать его приоритетным."
              >
                <SuggestionTags
                  id="task-required-skills"
                  transferLabel="Сделать приоритетной"
                  onTransfer={(skill) =>
                    change({
                      skills: requirements.skills.filter(
                        (value) => value !== skill,
                      ),
                      desiredSkills: [...requirements.desiredSkills, skill],
                    })
                  }
                  catalog={skillCatalog}
                  value={requirements.skills}
                  onChange={(value) =>
                    change({
                      skills: value,
                      desiredSkills: requirements.desiredSkills.filter(
                        (skill) => !value.includes(skill),
                      ),
                    })
                  }
                />
              </EmployerField>
              <EmployerField
                label="Технологии для приоритета"
                hint="Меняют порядок, не исключают кандидатов. Нажмите на тег, чтобы сделать его обязательным."
              >
                <SuggestionTags
                  id="task-desired-skills"
                  transferLabel="Сделать обязательной"
                  onTransfer={(skill) =>
                    change({
                      desiredSkills: requirements.desiredSkills.filter(
                        (value) => value !== skill,
                      ),
                      skills: [...requirements.skills, skill],
                    })
                  }
                  catalog={skillCatalog}
                  value={requirements.desiredSkills}
                  onChange={(value) =>
                    change({
                      desiredSkills: value.filter(
                        (skill) => !requirements.skills.includes(skill),
                      ),
                    })
                  }
                />
              </EmployerField>
            </div>
            <div className="form-two">
              <EmployerField
                label="Бюджет от, ₽/мес"
                hint="Можно оставить пустым"
              >
                <input
                  aria-label="Бюджет от"
                  type="number"
                  min={1}
                  max={10000000}
                  value={requirements.salaryMin}
                  onChange={(event) =>
                    change({ salaryMin: event.target.value })
                  }
                />
              </EmployerField>
              <EmployerField
                label="Бюджет до, ₽/мес"
                hint="Подойдут пересекающиеся зарплатные ожидания"
              >
                <input
                  aria-label="Бюджет до"
                  type="number"
                  min={1}
                  max={10000000}
                  value={requirements.salaryMax}
                  onChange={(event) =>
                    change({ salaryMax: event.target.value })
                  }
                />
              </EmployerField>
            </div>
            <EmployerField
              label="Формат работы"
              hint="Без выбора — любой; несколько вариантов работают как «или»"
            >
              <div className="task-format-options">
                {["Удалённо", "Гибрид", "Офис"].map((format) => (
                  <label key={format}>
                    <input
                      type="checkbox"
                      aria-label={format}
                      checked={requirements.formats.includes(format)}
                      onChange={(event) =>
                        change({
                          formats: event.target.checked
                            ? [...requirements.formats, format]
                            : requirements.formats.filter(
                                (value) => value !== format,
                              ),
                        })
                      }
                    />
                    {format}
                  </label>
                ))}
              </div>
            </EmployerField>
            <EmployerField label="Что учитывать в первую очередь">
              <EmployerSelect
                label="Приоритет результатов для подбора"
                value={requirements.sort}
                onChange={(value) =>
                  change({ sort: value as TaskBrief["sort"] })
                }
                options={candidateOrderOptions.slice(0, 3)}
              />
            </EmployerField>
          </fieldset>
          <div className="task-entry-actions">
            <button
              className="employer-button primary"
              disabled={busy || saving || analysing}
              onClick={generate}
            >
              <Search size={16} />
              {busy ? "Подбираем кандидатов…" : "Подобрать по этим условиям"}
            </button>
            <span className="muted">
              Без теста и без соревнований тоже можно попасть в список.
            </span>
          </div>
        </div>
      )}
      {error && (
        <p className="matching-error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="muted">
          Проверяем результаты теста, условия и релевантность соревнований…
        </p>
      )}
      {result && (
        <section
          ref={resultsRef}
          className="task-results"
          aria-label="Рекомендации по задаче"
        >
          <div className="task-results-heading">
            <div>
              <span className="task-step">2 · Рассмотрите варианты</span>
              <h2>Кого стоит рассмотреть</h2>
              <p className="muted">
                Под условия подходят {result.total}. В подборке{" "}
                {result.recommendations.length}; просмотрено уникальных
                профилей: {result.examined}.
              </p>
            </div>
            <button
              className="employer-button"
              onClick={() =>
                nav(
                  `/demo/employer/candidates?taskFilters=${encodeURIComponent(JSON.stringify(result.requirements))}${sourceQuery}`,
                )
              }
            >
              Все подходящие <ArrowRight size={16} />
            </button>
          </div>
          {result.groups.length > 1 && (
            <p className="muted">
              Варианты разделены по уровню. Junior, Middle и Senior не
              сравниваем общим баллом; порядок групп не означает преимущество.
            </p>
          )}
          {result.groups
            .filter((group) => !group.total)
            .map((group) => (
              <p key={group.grade} className="muted">
                {group.grade}: под эти условия кандидатов пока нет.
              </p>
            ))}
          {!result.recommendations.length && (
            <div className="employer-panel employer-empty">
              <h3>Под эти условия кандидатов пока нет</h3>
              <p>
                Измените бюджет, формат или обязательные технологии выше.
                Условия автоматически не снимаем.
              </p>
              {result.relaxations.map((item) => (
                <button
                  key={item.skill}
                  className="employer-button"
                  onClick={() =>
                    change({
                      skills: requirements!.skills.filter(
                        (skill) => skill !== item.skill,
                      ),
                      desiredSkills: [
                        ...requirements!.desiredSkills,
                        item.skill,
                      ],
                    })
                  }
                >
                  Сделать {item.skill} желательной · появится ещё {item.added}
                </button>
              ))}
            </div>
          )}
          <div className="task-recommendation-grid candidate-catalog-page">
            {result.recommendations.map(
              ({ profile, angles, reasons, questions }, index) => (
                <Fragment key={profile.id}>
                  {result.groups.length > 1 &&
                    (index === 0 ||
                      (result.recommendations[index - 1].profile.grade ||
                        result.recommendations[index - 1].profile.claimed) !==
                        (profile.grade || profile.claimed)) && (
                      <div className="task-level-heading">
                        <h3>{profile.grade || profile.claimed}</h3>
                        <p className="muted">
                          Подходят по условиям:{" "}
                          {
                            result.groups.find(
                              (group) =>
                                group.grade ===
                                (profile.grade || profile.claimed),
                            )?.total
                          }
                        </p>
                      </div>
                    )}
                  <CandidateCard
                    p={profile}
                    n={activeNeed}
                    s={s}
                    act={act}
                    nav={nav}
                    onView={() => {
                      setView(profile);
                      setProfileOpen(true);
                    }}
                    onInvite={() => setInvite(profile)}
                    onExplain={() =>
                      {setExplanation({ profile, angles, reasons, questions }); setExplanationOpen(true);}
                    }
                    onSearch={() =>
                      nav(
                        `/demo/employer/candidates?candidate=${profile.id}&view=card${sourceQuery}`,
                      )
                    }
                  />
                </Fragment>
              ),
            )}
          </div>
          <details className="task-method">
            <summary>Как составлена подборка</summary>
            <p>{result.method}</p>
            <p>
              Первые варианты — по выбранному приоритету. Дополнительные — с
              сильной стороной в тесте, подходящими ожиданиями или релевантными
              соревнованиями. Один человек может подходить сразу по нескольким
              основаниям. Эти основания объединены в одной карточке.
            </p>
          </details>
          <div className="employer-panel task-save">
            <EmployerField label="Название подборки">
              <input
                aria-label="Название подборки"
                maxLength={200}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setSaved(false);
                }}
                placeholder={`${result.requirements.spec} · ${taskBriefGrades(result.requirements).join(" / ")} · задачи команды`}
              />
            </EmployerField>
            <button
              className="employer-button"
              disabled={saving || saved}
              onClick={async () => {
                setSaving(true);
                setError("");
                try {
                  const r = result.requirements;
                  const ok = await act("need", {
                    id: initialNeed?.id,
                    title:
                      title.trim() ||
                      `${r.spec} · ${taskBriefGrades(r).join(" / ")} · задачи команды`,
                    description: text,
                    specialty: r.spec,
                    grade: r.grade,
                    skills: r.skills.join(", "),
                    desiredSkills: r.desiredSkills.join(", "),
                    task: r.task,
                    min: Number(r.salaryMin) || 1,
                    max: Number(r.salaryMax) || 10000000,
                    format: r.formats.length === 1 ? r.formats[0] : "Любой",
                    taskBrief: r,
                  });
                  if (ok) setSaved(true);
                  else
                    setError(
                      "Не удалось сохранить подборку. Повторите попытку.",
                    );
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving
                ? "Сохраняем…"
                : saved
                  ? "Подборка сохранена"
                  : "Сохранить задачу и условия"}
            </button>
            <small className="muted">
              При следующем открытии кандидаты подбираются заново.
            </small>
          </div>
        </section>
      )}
      <CandidateProfileDialog
        view={view}
        open={profileOpen}
        onOpenChange={setProfileOpen}
        activeNeed={activeNeed}
        onInvite={(profile) => {
          setProfileOpen(false);
          setInvite(profile);
        }}
      />
      <InviteDialog
        p={invite}
        n={activeNeed}
        company={s.company}
        act={act}
        close={() => setInvite(null)}
      />
      <Dialog
        open={explanationOpen}
        onOpenChange={(open) => {
          setExplanationOpen(open);
        }}
      >
        <DialogContent className="app-dialog candidate-explanation-dialog">
          <DialogHeader>
            <DialogTitle>
              Почему выбран кандидат #{explanation?.profile.id}
            </DialogTitle>
            <DialogDescription>
              Основания подбора по вашей задаче
            </DialogDescription>
          </DialogHeader>
          <div className="task-angles">
            {explanation?.angles.map((angle) => (
              <span key={angle}>{angle}</span>
            ))}
          </div>
          <ul className="task-reasons">
            {explanation?.reasons.map((reason) => (
              <li key={reason}>
                <Check size={16} />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
          {!!explanation?.questions.length && (
            <section className="candidate-explanation-questions">
              <h3>Что уточнить</h3>
              <ul>
                {explanation.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </section>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
