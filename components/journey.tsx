"use client";
import dynamic from "next/dynamic";
const ProfessionalResults = dynamic(() =>
  import("./professional-assessment").then((m) => m.ProfessionalResults),
);
import { assessmentTracks } from "@/lib/assessment-tracks";
import { useState } from "react";
import { userSettings } from "@/lib/account-settings";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  ShieldCheck,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { State, industries, specialties } from "@/lib/model";
import { Action } from "./registration";
import { Navigate } from "./landing";
import { useDraft, DraftStatus } from "@/hooks/use-draft";
import { Checkbox } from "./ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
} from "./ui/select";
import { Progress } from "./ui/progress";
export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="journey-field">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder="Выберите" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((x) => (
              <SelectItem value={x} key={x}>
                {x}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </label>
  );
}
export function JourneyProgress({ s, nav }: { s: State; nav: Navigate }) {
  if (s.journey === "complete") return null;
  const steps = [
    ["profile", "Профиль"],
    ["assessment", "Проверка уровня"],
    ["results", "Категория"],
  ];
  const idx = s.journey === "profile" ? 0 : 1;
  return (
    <div className="journey-progress">
      <div>
        <span className="eyebrow">ВАШ ПРОФЕССИОНАЛЬНЫЙ ПРОФИЛЬ</span>
        <p>
          Пройдите обязательные этапы — после проверки вы появитесь в подборе.
        </p>
      </div>
      <ol>
        {steps.map(([key, label], i) => (
          <li
            key={key}
            className={i < idx ? "done" : i === idx ? "current" : ""}
          >
            <button
              disabled={i > idx}
              onClick={() => nav(`/demo/candidate/${key}`)}
            >
              <span>{i < idx ? <Check size={14} /> : i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
export function SurveyPage({
  s,
  act,
  nav,
  onboarding = false,
}: {
  s: State;
  act: Action;
  nav: Navigate;
  onboarding?: boolean;
}) {
  const p = s.profile,
    last = s.surveys[0];
  const [d, set, meta] = useDraft("survey", {
    industry: last?.industry || p.industry,
    specialty: p.specialty,
    grade:
      p.claimed === "Intern"
        ? "Junior"
        : ["Junior", "Middle", "Senior"].includes(p.claimed)
          ? p.claimed
          : "Middle",
    roles: p.roles.length ? p.roles : ["Разработчик"],
    experience: p.experience,
    goal: last?.goal || "",
  });
  const [busy, setBusy] = useState(false);
  return (
    <>
      {onboarding && (
        <div className="page-heading">
          <div>
            <span className="eyebrow">ОПРОС · ШАГ 2</span>
            <h1>Найдём ваше направление.</h1>
            <p>
              Расскажите о сфере, специализации и роли. Грейд ниже — ваша
              оценка; подтвердить его предстоит тестом.
            </p>
          </div>
        </div>
      )}
      <div className="survey-layout survey-workspace">
        <form
          className="panel form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await act("survey", d);
            setBusy(false);
            if (r) nav("/demo/candidate/assessment");
          }}
        >
          <header className="survey-form-heading">
            <h2>Ваше направление</h2>
            <p>Выберите, чем хотите заниматься и какой уровень проверить.</p>
          </header>
          <DraftStatus meta={meta} />
          <SelectField
            label="В какой отрасли хотите работать?"
            value={d.industry}
            options={industries}
            onChange={(v) => set({ ...d, industry: v })}
          />
          <div className="form-two">
            <SelectField
              label="Специализация"
              value={d.specialty}
              options={assessmentTracks.map((t) => t.name)}
              onChange={(v) => set({ ...d, specialty: v })}
            />
            <SelectField
              label="Предполагаемый грейд"
              value={d.grade}
              options={["Junior", "Middle", "Senior"]}
              onChange={(v) => set({ ...d, grade: v })}
            />
          </div>
          {!onboarding && (
            <fieldset className="role-choices">
              <legend>Какая роль вам ближе? Можно несколько.</legend>
              {[
                ...new Set([
                  "Разработчик",
                  "Тестировщик",
                  "Аналитик",
                  "Технический лидер",
                  "Участник проектной команды",
                  ...d.roles,
                ]),
              ].map((v) => (
                <label
                  key={v}
                  className={d.roles.includes(v) ? "selected" : ""}
                >
                  <Checkbox
                    checked={d.roles.includes(v)}
                    onCheckedChange={(c) =>
                      set({
                        ...d,
                        roles: c
                          ? [...d.roles, v]
                          : d.roles.filter((x) => x !== v),
                      })
                    }
                  />
                  {v}
                </label>
              ))}
            </fieldset>
          )}
          {!onboarding && (
            <label className="field">
              Опыт в ИТ, лет
              <input
                type="number"
                min={0}
                max={50}
                value={d.experience}
                onChange={(e) =>
                  set({
                    ...d,
                    experience: Math.max(
                      0,
                      Math.min(50, Number(e.target.value) || 0),
                    ),
                  })
                }
              />
              <small>
                Если коммерческого опыта нет, укажите 0. Это не мешает пройти
                проверку.
              </small>
            </label>
          )}
          {!onboarding && (
            <label className="field">
              Какие задачи интересны?{" "}
              <span className="muted">Необязательно</span>
              <textarea
                rows={4}
                value={d.goal}
                onChange={(e) => set({ ...d, goal: e.target.value })}
                placeholder="Например: разработка API, продуктовая команда, работа с данными…"
              />
            </label>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn subtle"
              onClick={() => nav("/demo/candidate/profile")}
            >
              <ArrowLeft size={16} />К профилю
            </button>
            <button className="btn primary" disabled={busy || !d.roles.length}>
              Перейти к проверке
              <ArrowRight size={17} />
            </button>
          </div>
        </form>
        <aside className="editor-aside">
          <div className="panel">
            <ShieldCheck className="purple" size={28} />
            <h3>Как это работает</h3>
            <p>
              Опрос подбирает проверку под ваши интересы. Уровень подтвердит
              профессиональное испытание.
            </p>
          </div>
          <div className="panel">
            <h3>Ваш выбор</h3>
            <p>{d.industry}</p>
            <strong>
              {d.specialty} · {d.grade}
            </strong>
            <p>{d.roles.join(" · ")}</p>
          </div>
        </aside>
      </div>
    </>
  );
}
export function LegacyResultsPage({ s, nav }: { s: State; nav: Navigate }) {
  const [selected, setSelected] = useState(
    s.attempts.filter((a) => !a.formal).find((a) => a.completedAt)?.id || "",
  );
  const a =
    s.attempts
      .filter((a) => !a.formal)
      .find((a) => a.id === selected && a.completedAt) ||
    s.attempts.filter((a) => !a.formal).find((a) => a.completedAt);
  if (!a)
    return (
      <section className="panel results-empty">
        <ShieldCheck size={38} />
        <h2>Ваш результат впереди.</h2>
        <p>
          Выберите специализацию и пройдите проверку уровня, чтобы увидеть
          категорию и сильные стороны.
        </p>
        <button
          className="btn primary"
          onClick={() => nav("/demo/candidate/assessment")}
        >
          Проверить уровень
          <ArrowRight size={17} />
        </button>
      </section>
    );
  return (
    <>
      <div className="result-attempt-toolbar">
        <div>
          <p>
            {new Date(a.completedAt!).toLocaleDateString("ru-RU", {
              timeZone: userSettings(s).timeZone,
            })}{" "}
            · {a.specialty} · заявлен {a.grade}
          </p>
        </div>
        <Select value={a.id} onValueChange={setSelected}>
          <SelectTrigger
            className="result-selector"
            aria-label="Результат попытки"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {s.attempts
                .filter((x) => x.completedAt)
                .map((x) => (
                  <SelectItem value={x.id} key={x.id}>
                    {x.specialty} {x.grade} ·{" "}
                    {new Date(x.completedAt!).toLocaleDateString("ru-RU", {
                      timeZone: userSettings(s).timeZone,
                    })}{" "}
                    · {x.score}%
                  </SelectItem>
                ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="result-summary">
        <div className={`panel result-score ${a.passed ? "pass" : "fail"}`}>
          <span className="eyebrow">ИТОГ ПОПЫТКИ</span>
          <strong>{a.score}%</strong>
          <p>{a.passed ? "Порог 75% пройден" : "Порог 75% пока не пройден"}</p>
        </div>
        <div className="panel result-category">
          <ShieldCheck size={28} className="purple" />
          <h2>{a.categoryAfter || "Категория пока не подтверждена"}</h2>
          <div className="result-grade-grid">
            <div>
              <span>Вы заявили</span>
              <strong>{a.grade}</strong>
            </div>
            <div>
              <span>До проверки</span>
              <strong>{a.previousGrade || "Не подтверждён"}</strong>
            </div>
            <div>
              <span>После проверки</span>
              <strong>{a.categoryAfter || "Не подтверждён"}</strong>
            </div>
          </div>
          <p>
            {a.passed
              ? "Категория присвоена по результату этой проверки."
              : "Грейд не понижен принудительно. Вы можете выбрать другой доступный уровень и пройти новую проверку."}
          </p>
        </div>
      </div>
      <section className="panel competencies">
        <div className="section-heading">
          <div>
            <h2>Результаты по компетенциям</h2>
            <p>Что проверялось и где стоит продолжить практику.</p>
          </div>
        </div>
        {a.competencies?.length ? (
          a.competencies.map((c) => (
            <article className="competency-row" key={c.family}>
              <div>
                <strong>{c.family}</strong>
                <span>
                  {c.correct} из {c.total} ответов верны
                </span>
              </div>
              <Progress value={c.percent} />
              <strong>{c.percent}%</strong>
              <p>{c.feedback}</p>
            </article>
          ))
        ) : (
          <p className="muted">
            Для старой попытки детализация не записывалась. Новые проверки
            сохраняют результаты по каждой компетенции.
          </p>
        )}
        <p className="small-note">
          Это небольшой демонстрационный тест. Результат по одному вопросу не
          доказывает владение всей технологией; банк и пороги требуют экспертной
          калибровки.
        </p>
      </section>
      <div className="next-actions">
        <div className="panel">
          <Clock size={24} className="purple" />
          <h3>Можно выбрать следующий уровень</h3>
          <p>
            Можно сразу выбрать другой заявленный уровень и пройти новую
            профессиональную проверку.
          </p>
          <button
            className="btn outline"
            onClick={() => nav("/demo/candidate/assessment")}
          >
            Настроить следующую проверку
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="panel">
          <CheckCircle2 size={24} className="purple" />
          <h3>
            {s.journey === "complete"
              ? "Вы готовы к предложениям."
              : "Продолжим к вашей категории."}
          </h3>
          <p>
            {s.journey === "complete"
              ? "Проверьте согласие на публикацию профиля. Работодатели увидят категорию и смогут пригласить вас."
              : "Вернитесь к проверке и выберите уровень. Контакты останутся закрытыми."}
          </p>
          <button
            className="btn primary"
            onClick={() =>
              nav(
                s.journey === "complete"
                  ? "/demo/candidate/overview"
                  : "/demo/candidate/assessment",
              )
            }
          >
            {s.journey === "complete" ? "Открыть кабинет" : "К проверке уровня"}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
      <section className="panel survey-history">
        <h2>История опросов</h2>
        {s.surveys.map((x) => (
          <article key={x.id}>
            <span className="mono">
              {new Date(x.createdAt).toLocaleString("ru-RU", {
                timeZone: userSettings(s).timeZone,
              })}
            </span>
            <strong>
              {x.specialty} · {x.grade}
            </strong>
            <p>
              {x.industry} · {x.roles.join(", ")} · опыт {x.experience} лет
            </p>
            {x.goal && <p>{x.goal}</p>}
          </article>
        ))}
      </section>
    </>
  );
}
export { EmailVerification } from "./email-verification";

export function ResultsPage({ s, nav }: { s: State; nav: Navigate }) {
  return <ProfessionalResults s={s} nav={nav} />;
}
