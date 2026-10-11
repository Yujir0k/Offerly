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

type SavedSearch<T extends object> = { id: string; name: string; enabled: boolean; filters: T };
type SavedMatches = { items: { id: string | number; title?: string; headline?: string; specialty?: string; grade?: string; company?: string }[]; newIds: (string | number)[]; page: number; total: number };
export function SavedSearchTools<T extends object>({
  role,
  filters,
  onApply,
}: {
  role: Role;
  filters: T;
  onApply: (v: T) => void;
}) {
  const [items, setItems] = useState<SavedSearch<T>[]>([]),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [matches, setMatches] = useState<SavedMatches | null>(null),
    [active, setActive] = useState<SavedSearch<T> | null>(null),
    [busy, setBusy] = useState(false);
  const [notifications, setNotifications] = useState<Record<string, number>>(
    {},
  );
  async function notify() {
    const r = await hiringApi<{ items: { id: string; count: number }[] }>(role, "search-notifications");
    setNotifications(
      Object.fromEntries(r.items.map((v) => [v.id, v.count])),
    );
  }
  async function refresh() {
    try {
      setItems((await hiringApi<{ items: SavedSearch<T>[] }>(role, "searches")).items);
      await notify();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return refresh(); });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") notify().catch(() => {});
    }, 60000);
    return () => { active = false; clearInterval(timer); };
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
  async function page(search: SavedSearch<T> | null, n = 1) {
    if (!search) return;
    await run(async () => {
      setMatches(
        await hiringApi<SavedMatches>(role, "search-matches", { id: search.id, page: n }),
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
          {matches?.items.map((p) => (
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
              disabled={busy || !matches || matches.page <= 1}
              onClick={() => matches && page(active, matches.page - 1)}
            >
              Назад
            </button>
            <span>
              {matches?.page} /{" "}
              {Math.max(1, Math.ceil((matches?.total || 0) / 20))}
            </span>
            <button
              className="btn outline"
              disabled={busy || !matches || matches.page * 20 >= matches.total}
              onClick={() => matches && page(active, matches.page + 1)}
            >
              Далее
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await hiringApi(role, "search-seen", {
                    id: active?.id,
                    page: matches?.page,
                  });
                  setMatches(current => current ? { ...current, newIds: [] } : current);
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
          setProfiles((await hiringApi<{ items: Profile[] }>("employer", "compare", { ids })).items);
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

export function HiddenCompanies() {
  const [query, setQuery] = useState(""),
    [rows, setRows] = useState<{id: string; name: string; blocked: boolean}[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () =>
        hiringApi<{ items: {id: string; name: string; blocked: boolean}[] }>("candidate", "companies", { query })
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
