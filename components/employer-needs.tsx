"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";
import type { Need, State } from "@/lib/model";
import { grades, money, specialties } from "@/lib/model";
import { taskOptions } from "@/lib/employer-matching";
import {
  taskBriefGrades,
  taskBriefTasks,
  emptyTaskBrief,
} from "@/lib/task-brief";
import { skillCatalog } from "@/lib/suggestion-catalogs";
import type { Action } from "./registration";
import type { Navigate } from "./landing";
import { Tags } from "./brand";
import { EmployerField, EmployerSelect } from "./employer-ui";
import { SuggestionTags } from "./suggestion-picker";
import { TaskRecommendations } from "./task-recommendations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

/** Saved needs with explicit required/desired technologies and competency priorities. */
export function EmployerNeeds({
  s,
  act,
  nav,
}: {
  s: State;
  act: Action;
  nav: Navigate;
}) {
  const [editing, setEditing] = useState<Need | "new" | null>(null),
    [deleting, setDeleting] = useState<Need | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskNeed, setTaskNeed] = useState<Need | undefined>();
  const [manualRequest, setManualRequest] = useState(0);
  const appliedLink = useRef(false);
  useEffect(() => {
    if (appliedLink.current) return;
    const id = new URLSearchParams(window.location.search).get("need");
    const need = s.needs.find((item) => item.id === id);
    if (!id) {
      appliedLink.current = true;
      return;
    }
    if (!need) return;
    const timer = setTimeout(() => {
      setTaskNeed(need);
      appliedLink.current = true;
    }, 0);
    return () => clearTimeout(timer);
  }, [s.needs]);
  return (
    <>
      <TaskRecommendations
        key={
          taskNeed ? `${taskNeed.id}:${JSON.stringify(taskNeed)}` : "new-task"
        }
        initialNeed={taskNeed}
        manualRequest={manualRequest}
        onCreateManually={() => { setTaskNeed(undefined); setManualRequest((value) => value + 1); }}
        s={s}
        act={act}
        nav={nav}
      />
      {taskNeed && (
        <button
          className="employer-button"
          onClick={() => setTaskNeed(undefined)}
        >
          Описать другую задачу
        </button>
      )}
      <div className="needs-grid">
        {s.needs.map((need) => (
          <article className="panel need-card" key={need.id}>
            <h2>{need.title}</h2>
            <p>{need.description}</p>
            <strong>
              {need.specialty} ·{" "}
              {need.taskBrief
                ? taskBriefGrades(need.taskBrief).join(" / ")
                : need.grade}
            </strong>
            <p>
              {need.taskBrief && taskBriefTasks(need.taskBrief).length > 1
                ? taskBriefTasks(need.taskBrief)
                    .map(
                      (value) =>
                        taskOptions.find((option) => option.value === value)
                          ?.label,
                    )
                    .join(" · ")
                : taskOptions.find((task) => task.value === need.task)?.label ||
                  "Универсальный профиль"}
            </p>
            <small>Обязательные технологии</small>
            <Tags items={need.skills} />
            {!!need.desiredSkills?.length && (
              <>
                <small>Желательные технологии</small>
                <Tags items={need.desiredSkills} />
              </>
            )}
            <strong>
              {need.taskBrief
                ? need.taskBrief.salaryMin || need.taskBrief.salaryMax
                  ? `${need.taskBrief.salaryMin ? `от ${money(Number(need.taskBrief.salaryMin))}` : ""} ${need.taskBrief.salaryMax ? `до ${money(Number(need.taskBrief.salaryMax))}` : ""} ₽/мес`
                  : "Бюджет не ограничен"
                : `${money(need.min)} — ${money(need.max)} ₽/мес`}
            </strong>
            <p>{need.taskBrief?.formats.join(" · ") || need.format}</p>
            <button
              className="btn primary full"
              onClick={() => {
                setTaskNeed(need);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Подобрать под задачу
              <ArrowRight size={17} />
            </button>
            <div className="matching-actions">
              <button
                className="btn subtle"
                onClick={() => nav(`/demo/employer/candidates?need=${need.id}`)}
              >
                Открыть поиск
              </button>
              <button className="btn subtle" onClick={() => setEditing(need)}>
                <Pencil size={15} />
                Изменить
              </button>
              <button className="btn subtle" onClick={() => setDeleting(need)}>
                <Trash2 size={15} />
                Удалить
              </button>
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <NeedEditor
          key={editing === "new" ? "new" : editing.id}
          need={editing === "new" ? undefined : editing}
          act={act}
          onSaved={(updated) => {
            if (taskNeed?.id === updated.id) setTaskNeed(updated);
          }}
          close={() => setEditing(null)}
        />
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent className="app-dialog">
          <DialogHeader>
            <DialogTitle>Удалить подборку?</DialogTitle>
            <DialogDescription>
              {deleting?.title}. Приглашения и переписка сохранятся.
            </DialogDescription>
          </DialogHeader>
          <div className="matching-actions">
            <button className="btn secondary" onClick={() => setDeleting(null)}>
              Отмена
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (await act("need-delete", { id: deleting?.id }))
                    setDeleting(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Удалить
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
function NeedEditor({
  need,
  act,
  close,
  onSaved,
}: {
  need?: Need;
  act: Action;
  close: () => void;
  onSaved: (need: Need) => void;
}) {
  const [specialty, setSpecialty] = useState(need?.specialty || "Backend"),
    [grade, setGrade] = useState(need?.grade || "Middle");
  const [skills, setSkills] = useState(need?.skills || []),
    [desiredSkills, setDesiredSkills] = useState(need?.desiredSkills || []);
  const [task, setTask] = useState(need?.task || "balanced");
  const [selectedGrades, setSelectedGrades] = useState(
    need?.taskBrief
      ? taskBriefGrades(need.taskBrief)
      : [need?.grade || "Middle"],
  );
  const [selectedFormats, setSelectedFormats] = useState(
    need?.taskBrief?.formats ||
      (need?.format && need.format !== "Любой" ? [need.format] : []),
  );
  const [format, setFormat] = useState(need?.format || "Удалённо");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="app-dialog employer-need-dialog">
        <DialogHeader>
          <DialogTitle>
            {need ? "Изменить подборку" : "Подборка под задачи команды"}
          </DialogTitle>
          <DialogDescription>
            Выберите категорию, условия и приоритет. Технологии и специальное
            описание задач необязательны.
          </DialogDescription>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            const data = Object.fromEntries(new FormData(event.currentTarget));
            try {
              const updated = await act("need", {
                ...data,
                id: need?.id,
                specialty,
                grade,
                format,
                task,
                skills: skills.join(", "),
                desiredSkills: desiredSkills.join(", "),
                ...(need?.taskBrief
                  ? {
                      taskBrief: {
                        ...emptyTaskBrief,
                        ...need.taskBrief,
                        spec: specialty,
                        grade: selectedGrades[0] || grade,
                        grades: selectedGrades,
                        skills,
                        desiredSkills,
                        task,
                        tasks: task === need.taskBrief.task ? need.taskBrief.tasks : task === "balanced" ? [] : [task],
                        salaryMin: String(data.min),
                        salaryMax: String(data.max),
                        formats: selectedFormats,
                      },
                    }
                  : {}),
              });
              if (updated) {
                const saved = updated.needs.find(
                  (item) => item.id === need?.id,
                );
                if (saved) onSaved(saved);
                close();
              } else
                setError(
                  "Не удалось сохранить. Проверьте условия и повторите.",
                );
            } finally {
              setBusy(false);
            }
          }}
        >
          <EmployerField label="Название">
            <input
              name="title"
              required
              maxLength={200}
              defaultValue={need?.title}
              placeholder="Backend в команду платформы"
            />
          </EmployerField>
          <EmployerField label="Задачи и контекст" hint="По желанию">
            <textarea
              name="description"
              rows={4}
              maxLength={3000}
              defaultValue={need?.description}
              placeholder="Что предстоит делать человеку…"
            />
          </EmployerField>
          <div className="form-two">
            <EmployerField label="Специализация">
              <EmployerSelect
                label="Специализация подборки"
                value={specialty}
                onChange={setSpecialty}
                options={specialties}
              />
            </EmployerField>
            <EmployerField label="Грейд">
              {need?.taskBrief ? (
                <div className="need-choice-group">
                  {grades.map((value) => (
                    <label key={value}>
                      <input
                        type="checkbox"
                        checked={selectedGrades.includes(value)}
                        disabled={
                          selectedGrades.length === 1 &&
                          selectedGrades.includes(value)
                        }
                        onChange={(event) =>
                          setSelectedGrades((current) =>
                            event.target.checked
                              ? [...current, value]
                              : current.filter((item) => item !== value),
                          )
                        }
                      />
                      {value}
                    </label>
                  ))}
                </div>
              ) : (
                <EmployerSelect
                  label="Грейд подборки"
                  value={grade}
                  onChange={setGrade}
                  options={grades}
                />
              )}
            </EmployerField>
          </div>
          <EmployerField
            label="Обязательные технологии"
            hint="Должны быть указаны в профиле или проверены"
          >
            <SuggestionTags
              id="need-required-skills"
              catalog={skillCatalog}
              value={skills}
              onChange={setSkills}
            />
          </EmployerField>
          <EmployerField
            label="Желательные технологии"
            hint="Не исключают кандидата из выдачи"
          >
            <SuggestionTags
              id="need-desired-skills"
              catalog={skillCatalog}
              value={desiredSkills}
              onChange={setDesiredSkills}
            />
          </EmployerField>
          <div className="form-two">
            <EmployerField label="Зарплата от, ₽/мес">
              <input
                name="min"
                type="number"
                required
                min={1}
                max={10000000}
                defaultValue={need?.min || 180000}
              />
            </EmployerField>
            <EmployerField label="До, ₽/мес">
              <input
                name="max"
                type="number"
                required
                min={1}
                max={10000000}
                defaultValue={need?.max || 230000}
              />
            </EmployerField>
          </div>
          <EmployerField label="Приоритет задач">
            <EmployerSelect
              label="Приоритет подборки"
              value={task}
              onChange={setTask}
              options={taskOptions}
            />
          </EmployerField>
          <EmployerField label="Формат">
            {need?.taskBrief ? (
              <div className="need-choice-group">
                {["Удалённо", "Гибрид", "Офис"].map((value) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      checked={selectedFormats.includes(value)}
                      onChange={(event) =>
                        setSelectedFormats((current) =>
                          event.target.checked
                            ? [...current, value]
                            : current.filter((item) => item !== value),
                        )
                      }
                    />
                    {value}
                  </label>
                ))}
              </div>
            ) : (
              <EmployerSelect
                label="Формат подборки"
                value={format}
                onChange={setFormat}
                options={["Любой", "Удалённо", "Гибрид", "Офис"]}
              />
            )}
          </EmployerField>
          {error && (
            <p className="matching-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary full" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить подборку"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
