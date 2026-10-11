"use client";
import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { comparisonFields, defaultComparisonFields, visibleComparisonFields } from "@/lib/candidate-comparison";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { hiringApi, hiringStages } from "@/lib/hiring-client";
import type { State, Role, Profile } from "@/lib/model";
import { money } from "@/lib/model";
import { userSettings, timeZones } from "@/lib/account-settings";
import { ChatLaunch } from "./chat-launch";
import { FeedbackDialog } from "./feedback-dialog";
import { ChoiceSelect } from "./choice-select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "./ui/dialog";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  EyeOff,
  Search,
  Users,
  Bell,
  X,
  SlidersHorizontal,
} from "lucide-react";
import type { Navigate } from "./landing";

export function SavedSearchTools({
  role,
  filters,
  onApply,
}: {
  role: Role;
  filters: object;
  onApply: (v: any) => void;
}) {
  const [items, setItems] = useState<any[]>([]),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [matches, setMatches] = useState<any>(null),
    [active, setActive] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const [notifications, setNotifications] = useState<Record<string, number>>(
    {},
  );
  async function notify() {
    const r = await hiringApi(role, "search-notifications");
    setNotifications(
      Object.fromEntries(r.items.map((v: any) => [v.id, v.count])),
    );
  }
  async function refresh() {
    try {
      setItems((await hiringApi(role, "searches")).items);
      await notify();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") notify().catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [role]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function page(search: any, n = 1) {
    await run(async () => {
      setMatches(
        await hiringApi(role, "search-matches", { id: search.id, page: n }),
      );
      setActive(search);
      setOpen(true);
    });
  }
  return (
    <div className="hiring-tools">
      <details>
        <summary>
          <Bell size={17} /> Сохранённые поиски и новые совпадения{" "}
          <span>{items.length}</span>
        </summary>
        <div className="hiring-inline">
          <input
            aria-label="Название поиска"
            placeholder="Название поиска"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn outline"
            disabled={busy || !name.trim()}
            onClick={() =>
              run(async () => {
                await hiringApi(role, "search-save", { name, filters });
                setName("");
                await refresh();
              })
            }
          >
            Сохранить текущий поиск
          </button>
        </div>
        {!items.length && (
          <p className="muted">
            Сохраните условия — здесь будут появляться подходящие вакансии или
            кандидаты.
          </p>
        )}
        {items.map((v) => (
          <article className="hiring-search-row" key={v.id}>
            <strong>
              {v.name}
              {notifications[v.id] > 0 && (
                <span className="hiring-pill">{notifications[v.id]} новых</span>
              )}
            </strong>
            <div className="hiring-actions">
              <button
                className="btn outline"
                onClick={() => onApply(v.filters)}
              >
                Применить
              </button>
              <button className="btn outline" onClick={() => page(v)}>
                Совпадения
              </button>
              <button
                className="text-button"
                aria-pressed={v.enabled}
                onClick={() =>
                  run(async () => {
                    await hiringApi(role, "search-update", {
                      id: v.id,
                      enabled: !v.enabled,
                    });
                    await refresh();
                  })
                }
              >
                {v.enabled ? "Слежу за новыми" : "Уведомления выключены"}
              </button>
              <button
                className="text-button"
                onClick={() =>
                  run(async () => {
                    await hiringApi(role, "search-delete", { id: v.id });
                    await refresh();
                  })
                }
              >
                Удалить поиск
              </button>
            </div>
          </article>
        ))}
      </details>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="app-dialog hiring-dialog">
          <DialogHeader>
            <DialogTitle>{active?.name}</DialogTitle>
            <DialogDescription>
              Новые совпадения отмечены на каждой странице. Доступность
              проверяется при открытии.
            </DialogDescription>
          </DialogHeader>
          {matches?.items.map((p: any) => (
            <article className="hiring-search-row" key={p.id}>
              <div>
                <strong>
                  {p.title || p.headline || `${p.specialty} · ${p.grade}`}
                </strong>
                <p>{p.company || `Кандидат #${p.id}`}</p>
              </div>
              {matches.newIds.includes(p.id) && (
                <span className="hiring-pill">Новое</span>
              )}
            </article>
          ))}
          {!matches?.items.length && <p>Пока нет подходящих записей.</p>}
          <div className="hiring-actions">
            <button
              className="btn outline"
              disabled={busy || matches?.page <= 1}
              onClick={() => page(active, matches.page - 1)}
            >
              Назад
            </button>
            <span>
              {matches?.page} /{" "}
              {Math.max(1, Math.ceil((matches?.total || 0) / 20))}
            </span>
            <button
              className="btn outline"
              disabled={busy || matches?.page * 20 >= matches?.total}
              onClick={() => page(active, matches.page + 1)}
            >
              Далее
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await hiringApi(role, "search-seen", {
                    id: active.id,
                    page: matches.page,
                  });
                  setMatches({ ...matches, newIds: [] });
                  await notify();
                })
              }
            >
              Отметить страницу просмотренной
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <FeedbackDialog
        open={!!error}
        onOpenChange={(v) => !v && setError("")}
        message={error}
      />
    </div>
  );
}
export function CandidateCompare({ ids, onClear }: { ids: number[]; onClear: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [selected, setSelected] = useState(defaultComparisonFields);
  const fields = visibleComparisonFields(profiles, selected, differencesOnly);
  if (!ids.length || typeof document === 'undefined') return null;
  return createPortal(<>
    <div className="candidate-compare-dock" role="region" aria-label="Выбранные кандидаты">
      <Users size={19} />
      <span aria-live="polite">Выбрано <b>{ids.length}</b></span>
      <button className="btn primary" disabled={busy || ids.length < 2} onClick={async () => {
        setBusy(true);
        try {
          setProfiles((await hiringApi("employer", "compare", { ids })).items);
          setOpen(true);
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
      }}>{busy ? "Загружаем…" : "Сравнить"}</button>
      <button className="compare-dock-clear" aria-label="Очистить сравнение" title="Очистить сравнение" onClick={() => {setOpen(false);onClear();}}><X size={18} /></button>
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="app-dialog hiring-dialog comparison-dialog comparison-minimal candidate-profile-dialog" overlayClassName="candidate-profile-overlay">
        <DialogHeader>
          <DialogTitle>Сравнение кандидатов</DialogTitle>
          <DialogDescription>Выберите параметры, которые важны для вашей команды.</DialogDescription>
        </DialogHeader>
        <div className="comparison-controls">
          <label className="comparison-differences"><input type="checkbox" checked={differencesOnly} onChange={e=>setDifferencesOnly(e.target.checked)} />Только различия</label>
          <Popover>
            <PopoverTrigger asChild><button className="comparison-fields-button"><SlidersHorizontal size={16} />Параметры <span>{selected.length}</span></button></PopoverTrigger>
            <PopoverContent className="comparison-fields-menu" align="end">
              <div className="comparison-fields-heading"><strong>Показывать в таблице</strong><button onClick={()=>setSelected(comparisonFields.map(f=>f.id))}>Все</button><button onClick={()=>setSelected(defaultComparisonFields)}>Основные</button></div>
              <div className="comparison-field-options">
                {comparisonFields.map(field=><label key={field.id}><input type="checkbox" checked={selected.includes(field.id)} disabled={selected.length===1 && selected.includes(field.id)} onChange={e=>setSelected(current=>e.target.checked?[...current,field.id]:current.filter(id=>id!==field.id))} />{field.label}</label>)}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="comparison-scroll" tabIndex={0} aria-label="Таблица сравнения кандидатов">
          <table style={{ minWidth: 170 + profiles.length * 240 }}><colgroup><col style={{ width: 170 }} />{profiles.map(p=><col key={p.id} style={{ width: 240 }} />)}</colgroup><thead><tr><th scope="col">Параметр</th>{profiles.map(p=><th scope="col" key={p.id}>{p.email ? p.name : `Кандидат #${p.id}`}<span>{p.specialty} · {p.grade || 'Уровень не подтверждён'}</span></th>)}</tr></thead>
            <tbody>{fields.map(field=><tr key={field.id}><th scope="row">{field.label}</th>{profiles.map(p=><td key={p.id}>{field.value(p)}</td>)}</tr>)}</tbody>
          </table>
          {!fields.length && <p className="comparison-empty" role="status">По выбранным параметрам различий нет.</p>}
        </div>
      </DialogContent>
    </Dialog>
    <FeedbackDialog open={!!error} onOpenChange={v=>!v&&setError("")} message={error} />
  </>, document.body);
}

export function AddHiringProcess({
  candidateId,
  needId,
  nav,
}: {
  candidateId: number;
  needId?: string;
  nav: Navigate;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="btn outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await hiringApi("employer", "process-create", {
              candidateId,
              needId,
            });
            nav("/demo/employer/hiring");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Этапы и заметка <ArrowRight size={16} />
      </button>
      <FeedbackDialog
        open={!!error}
        onOpenChange={(v) => !v && setError("")}
        message={error}
      />
    </>
  );
}
export function HiddenCompanies() {
  const [query, setQuery] = useState(""),
    [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () =>
        hiringApi("candidate", "companies", { query })
          .then((r) => !cancelled && setRows(r.items))
          .catch((e) => !cancelled && setError(e.message)),
      250,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
  return (
    <section className="panel hiring-panel">
      <div className="hiring-heading">
        <EyeOff size={22} />
        <div>
          <h2>Скрытые компании</h2>
          <p>
            Эти компании не увидят ваш профиль в каталоге и не смогут отправить
            новое приглашение.
          </p>
        </div>
      </div>
      <label className="hiring-field">
        <span>Найти компанию</span>
        <input
          placeholder="Название компании"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {rows.map((c) => (
        <article className="hiring-search-row" key={c.id}>
          <div>
            <strong>{c.name}</strong>
            <p>
              {c.blocked
                ? "Профиль скрыт"
                : "Профиль доступен по вашим настройкам"}
            </p>
          </div>
          <button
            className="btn outline"
            disabled={busy}
            aria-pressed={c.blocked}
            onClick={async () => {
              setBusy(true);
              try {
                await hiringApi("candidate", "block", {
                  companyId: c.id,
                  blocked: !c.blocked,
                });
                setRows(
                  rows.map((v) =>
                    v.id === c.id ? { ...v, blocked: !v.blocked } : v,
                  ),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {c.blocked ? "Показывать профиль" : "Скрыть профиль"}
          </button>
        </article>
      ))}
      {!rows.length && <p className="muted">Компании не найдены.</p>}
      <p className="hiring-note">
        Уже переданные контакты нельзя отозвать. Существующие диалоги
        сохраняются. Другие аккаунты и юридические лица компании нужно скрывать
        отдельно.
      </p>
      <FeedbackDialog
        open={!!error}
        onOpenChange={(v) => !v && setError("")}
        message={error}
      />
    </section>
  );
}
export function HiringHub({
  s,
  role,
  nav,
}: {
  s: State;
  role: Role;
  nav: Navigate;
}) {
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("processes"),
    [next, setNext] = useState<string | null>(null);
  const expanded = useRef(false);
  async function refresh(before?: string) {
    if (before) expanded.current = true;
    else expanded.current = false;
    const r = await hiringApi(role, "processes", { before });
    setItems((x) => (before ? [...x, ...r.items] : r.items));
    setNext(r.nextBefore);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !expanded.current)
        refresh().catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [role, s.version]);
  async function mutate(type: string, data: any) {
    setBusy(true);
    try {
      await hiringApi(role, type, data);
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="hiring-page">
      <div className="hiring-tabs">
        <button
          className={tab === "processes" ? "active" : ""}
          onClick={() => setTab("processes")}
        >
          {role === "employer" ? "Этапы найма" : "Мои процессы"}
        </button>
        {role === "candidate" && (
          <button
            className={tab === "hidden" ? "active" : ""}
            onClick={() => setTab("hidden")}
          >
            Скрытые компании
          </button>
        )}
        <button onClick={() => refresh().catch((e) => setError(e.message))}>
          Обновить
        </button>
      </div>
      {tab === "hidden" ? (
        <HiddenCompanies />
      ) : (
        <>
          <section className="panel hiring-panel">
            <div className="hiring-heading">
              <CalendarDays size={23} />
              <div>
                <h2>
                  {role === "employer"
                    ? "Следующий шаг для каждого кандидата"
                    : "Знакомства с командами"}
                </h2>
                <p>
                  {role === "employer"
                    ? "Этапы и заметки видны только вашей компании. Встречи согласуются с кандидатом."
                    : "Здесь появятся встречи и короткие задачи компаний после вашего согласия на общение."}
                </p>
              </div>
            </div>
            {!items.length && (
              <div className="hiring-empty">
                <h3>Пока нет активных процессов</h3>
                <p>
                  {role === "employer"
                    ? "Добавьте кандидата из поиска или отправьте приглашение."
                    : "Примите приглашение или откликнитесь на вакансию."}
                </p>
                <button
                  className="btn primary"
                  onClick={() =>
                    nav(
                      `/demo/${role}/${role === "employer" ? "candidates" : "invitations"}`,
                    )
                  }
                >
                  Перейти <ArrowRight size={17} />
                </button>
              </div>
            )}
          </section>
          {items.map((p) => (
            <ProcessCard
              key={p.id}
              p={p}
              role={role}
              s={s}
              nav={nav}
              busy={busy}
              mutate={mutate}
            />
          ))}
          {next && (
            <button
              className="btn outline"
              onClick={() => refresh(next).catch((e) => setError(e.message))}
            >
              Показать ещё
            </button>
          )}
        </>
      )}
      <FeedbackDialog
        open={!!error}
        onOpenChange={(v) => !v && setError("")}
        message={error}
      />
    </div>
  );
}
function ProcessCard({
  p,
  role,
  s,
  nav,
  busy,
  mutate,
}: {
  p: any;
  role: Role;
  s: State;
  nav: Navigate;
  busy: boolean;
  mutate: (t: string, b: any) => Promise<boolean>;
}) {
  const [note, setNote] = useState(p.note || ""),
    [stage, setStage] = useState(p.stage || "saved"),
    [reminder, setReminder] = useState(""),
    [editing, setEditing] = useState(false),
    [meeting, setMeeting] = useState(false),
    [slots, setSlots] = useState(["", "", ""]),
    [duration, setDuration] = useState("30"),
    [zone, setZone] = useState(userSettings(s).timeZone),
    [task, setTask] = useState(false);
  const date = (v: string) =>
    new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
    }).format(new Date(v));
  useEffect(() => {
    if (!editing) {
      setNote(p.note || "");
      setStage(p.stage || "saved");
    }
  }, [p.revision, editing]);
  return (
    <article className="panel hiring-panel">
      <div className="hiring-heading">
        <div>
          <span className="hiring-eyebrow">
            {role === "employer" ? `Кандидат #${p.candidateId}` : p.company}
          </span>
          <h2>{p.title}</h2>
        </div>
        {role === "employer" && (
          <span className="hiring-pill">
            {hiringStages.find((v) => v.value === p.stage)?.label}
          </span>
        )}
      </div>
      {p.chat && (
        <ChatLaunch
          role={role}
          invitationId={p.chat.invitationId || undefined}
          applicationId={p.chat.applicationId || undefined}
          nav={nav}
        />
      )}
      {role === "employer" && (
        <>
          <div className="hiring-two">
            <label className="hiring-field">
              <span>Внутренний этап</span>
              <ChoiceSelect
                label="Внутренний этап"
                value={stage}
                options={hiringStages}
                onChange={(v) => {
                  setStage(v);
                  setEditing(true);
                }}
              />
            </label>
            <label className="hiring-field">
              <span>Напомнить мне · ваш часовой пояс устройства</span>
              <input
                type="datetime-local"
                value={reminder}
                onChange={(e) => {
                  setReminder(e.target.value);
                  setEditing(true);
                }}
              />
            </label>
          </div>
          {p.reminderAt && (
            <p
              className={
                Date.parse(p.reminderAt) <= Date.now() ? "hiring-due" : "muted"
              }
            >
              <Clock3 size={16} /> Напоминание: {date(p.reminderAt)}
            </p>
          )}
          <label className="hiring-field">
            <span>Приватная заметка компании</span>
            <textarea
              maxLength={4000}
              rows={3}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setEditing(true);
              }}
              placeholder="Что обсудить при следующем разговоре"
            />
          </label>
          <div className="hiring-actions">
            <button
              className="btn outline"
              disabled={busy}
              onClick={async () => {
                if (
                  await mutate("process-update", {
                    id: p.id,
                    revision: p.revision,
                    stage,
                    note,
                    reminderAt: reminder
                      ? new Date(reminder).toISOString()
                      : p.reminderAt && Date.parse(p.reminderAt) > Date.now()
                        ? p.reminderAt
                        : null,
                  })
                )
                  setEditing(false);
              }}
            >
              Сохранить изменения
            </button>
            <button
              className="text-button"
              onClick={() => setMeeting(!meeting)}
            >
              Предложить / перенести встречу
            </button>
            <button className="text-button" onClick={() => setTask(!task)}>
              Короткая задача
            </button>
          </div>
        </>
      )}
      {meeting && (
        <div className="hiring-subpanel">
          <h3>Предложить время</h3>
          <p>
            Кандидат выберет один из вариантов. Перенос отменит прежнюю встречу.
          </p>
          <label className="hiring-field">
            <span>Часовой пояс отображения</span>
            <ChoiceSelect
              label="Часовой пояс встречи"
              value={zone}
              onChange={setZone}
              options={timeZones.map((v) => ({ value: v, label: v }))}
            />
          </label>
          <p className="hiring-note">
            Время ниже вводится в часовом поясе вашего устройства. Получатель
            увидит его в своём выбранном поясе.
          </p>
          {slots.map((v, i) => (
            <label className="hiring-field" key={i}>
              <span>
                Вариант {i + 1}
                {i > 0 ? " · необязательно" : ""}
              </span>
              <input
                type="datetime-local"
                value={v}
                onChange={(e) =>
                  setSlots((x) =>
                    x.map((a, j) => (j === i ? e.target.value : a)),
                  )
                }
              />
            </label>
          ))}
          <label className="hiring-field">
            <span>Длительность, минут</span>
            <input
              type="number"
              min={15}
              max={180}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
          <button
            className="btn primary"
            disabled={busy || !slots[0]}
            onClick={async () => {
              if (
                await mutate("meeting-propose", {
                  processId: p.id,
                  slots: slots
                    .filter(Boolean)
                    .map((v) => new Date(v).toISOString()),
                  duration: Number(duration),
                  timeZone: zone,
                })
              )
                setMeeting(false);
            }}
          >
            Отправить варианты
          </button>
        </div>
      )}
      {p.meetings.map((m: any) => (
        <div key={m.id} className="hiring-subpanel">
          <h3>
            {m.status === "confirmed"
              ? "Встреча назначена"
              : m.status === "cancelled"
                ? "Встреча отменена"
                : "Выберите время встречи"}
          </h3>
          <p>
            {m.duration} минут · {zone}
          </p>
          {m.status === "proposed" && (
            <div className="hiring-actions">
              {m.slots.map((slot: string) => (
                <button
                  className="btn outline"
                  key={slot}
                  disabled={
                    busy ||
                    role === "employer" ||
                    Date.parse(slot) <= Date.now()
                  }
                  onClick={() =>
                    mutate("meeting-confirm", {
                      id: m.id,
                      revision: m.revision,
                      slot,
                    })
                  }
                >
                  {date(slot)}
                </button>
              ))}
            </div>
          )}
          {m.selectedAt && <strong>{date(m.selectedAt)}</strong>}
          <div className="hiring-actions">
            {m.status === "confirmed" && (
              <button
                className="btn outline"
                onClick={async () => {
                  try {
                    const r = await hiringApi(role, "meeting-ics", {
                      id: m.id,
                    });
                    const u = URL.createObjectURL(
                      new Blob([r.ics], {
                        type: "text/calendar;charset=utf-8",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = u;
                    a.download = "offerly-interview.ics";
                    a.click();
                    URL.revokeObjectURL(u);
                  } catch {
                    await mutate("meeting-ics", { id: m.id });
                  }
                }}
              >
                Добавить в календарь
              </button>
            )}
            {m.status !== "cancelled" && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  mutate("meeting-cancel", { id: m.id, revision: m.revision })
                }
              >
                Отменить встречу
              </button>
            )}
          </div>
        </div>
      ))}
      {task && (
        <TaskComposer
          processId={p.id}
          busy={busy}
          mutate={mutate}
          close={() => setTask(false)}
        />
      )}
      {p.tasks.map((t: any) => (
        <TaskCard key={t.id} task={t} role={role} busy={busy} mutate={mutate} />
      ))}
    </article>
  );
}
function TaskComposer({
  processId,
  busy,
  mutate,
  close,
}: {
  processId: string;
  busy: boolean;
  mutate: (t: string, b: any) => Promise<boolean>;
  close: () => void;
}) {
  const [title, setTitle] = useState(""),
    [period, setPeriod] = useState("7"),
    [questions, setQuestions] = useState([
      { prompt: "", options: ["", ""], correct: 0 },
    ]);
  return (
    <div className="hiring-subpanel">
      <h3>Регулярная короткая задача</h3>
      <p>
        Отдельная проверка команды. Результат не изменяет категорию Офферли.
      </p>
      <label className="hiring-field">
        <span>Название</span>
        <input
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="hiring-field">
        <span>Период, дней</span>
        <input
          type="number"
          min={1}
          max={90}
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
      </label>
      {questions.map((q, i) => (
        <fieldset key={i}>
          <legend>Вопрос {i + 1}</legend>
          <label className="hiring-field">
            <span>Условие</span>
            <textarea
              maxLength={1000}
              value={q.prompt}
              onChange={(e) =>
                setQuestions((x) =>
                  x.map((v, j) =>
                    j === i ? { ...v, prompt: e.target.value } : v,
                  ),
                )
              }
            />
          </label>
          {q.options.map((o, k) => (
            <label className="hiring-field" key={k}>
              <span>Вариант {k + 1}</span>
              <input
                maxLength={500}
                value={o}
                onChange={(e) =>
                  setQuestions((x) =>
                    x.map((v, j) =>
                      j === i
                        ? {
                            ...v,
                            options: v.options.map((old, l) =>
                              l === k ? e.target.value : old,
                            ),
                          }
                        : v,
                    ),
                  )
                }
              />
            </label>
          ))}
          <label className="hiring-field">
            <span>Правильный вариант</span>
            <ChoiceSelect
              label={`Правильный вариант вопроса ${i + 1}`}
              value={String(q.correct)}
              options={q.options.map((_, k) => ({
                value: String(k),
                label: `Вариант ${k + 1}`,
              }))}
              onChange={(v) =>
                setQuestions((x) =>
                  x.map((old, j) =>
                    j === i ? { ...old, correct: Number(v) } : old,
                  ),
                )
              }
            />
          </label>
          {q.options.length < 5 && (
            <button
              className="text-button"
              onClick={() =>
                setQuestions((x) =>
                  x.map((old, j) =>
                    j === i ? { ...old, options: [...old.options, ""] } : old,
                  ),
                )
              }
            >
              Добавить вариант
            </button>
          )}
        </fieldset>
      ))}
      <div className="hiring-actions">
        {questions.length < 5 && (
          <button
            className="btn outline"
            onClick={() =>
              setQuestions((x) => [
                ...x,
                { prompt: "", options: ["", ""], correct: 0 },
              ])
            }
          >
            Добавить вопрос
          </button>
        )}
        <button
          className="btn primary"
          disabled={busy || !title}
          onClick={async () => {
            if (
              await mutate("task-create", {
                processId,
                title,
                periodDays: Number(period),
                questions,
              })
            )
              close();
          }}
        >
          Назначить задачу
        </button>
      </div>
    </div>
  );
}
function TaskCard({
  task,
  role,
  busy,
  mutate,
}: {
  task: any;
  role: Role;
  busy: boolean;
  mutate: (t: string, b: any) => Promise<boolean>;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  return (
    <div className="hiring-subpanel">
      <h3>{task.title}</h3>
      <p>
        Раз в {task.periodDays} дн. · отдельная задача компании ·{" "}
        {task.active ? "активна" : "остановлена"}
      </p>
      {role === "candidate" &&
        task.active &&
        !task.answered &&
        task.questions.map((q: any) => (
          <label className="hiring-field" key={q.id}>
            <span>{q.prompt}</span>
            <ChoiceSelect
              wrap
              label={q.prompt}
              value={answers[q.id] === undefined ? "" : String(answers[q.id])}
              onChange={(v) => setAnswers((x) => ({ ...x, [q.id]: Number(v) }))}
              options={q.options.map((v: string, i: number) => ({
                value: String(i),
                label: v,
              }))}
            />
          </label>
        ))}
      <div className="hiring-actions">
        {role === "candidate" && task.active && !task.answered && (
          <button
            className="btn primary"
            disabled={
              busy || Object.keys(answers).length < task.questions.length
            }
            onClick={() =>
              mutate("task-answer", {
                id: task.id,
                occurrence: task.occurrence,
                answers,
              })
            }
          >
            Сохранить ответы
          </button>
        )}
        {role === "employer" && task.active && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => mutate("task-stop", { id: task.id })}
          >
            Остановить повторение
          </button>
        )}
      </div>
      {task.history.map((a: any) => (
        <p className="hiring-task-result" key={a.occurrence}>
          {new Date(a.created_at).toLocaleDateString("ru-RU")} · {a.score}% по
          задаче компании
        </p>
      ))}
      <small>
        Эта проверка не подтверждает и не понижает профессиональный грейд.
      </small>
    </div>
  );
}
