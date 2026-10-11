'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Heart,
  Check,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  MessageSquare,
  Search,
  X,
} from 'lucide-react';
import type { Need, Profile, State } from '@/lib/model';
import { money } from '@/lib/model';
import {
  categoryLabel,
  dimensionNames,
  explainComparison,
} from '@/lib/employer-matching';
import { useCatalog } from '@/hooks/use-catalog';
import { useDraft, DraftStatus } from '@/hooks/use-draft';
import { candidateFilterError } from '@/lib/candidate-search';
import {
  defaultCandidateFilters as defaults,
  candidateOrderLabel,
} from '@/lib/employer-search';
import type { Action } from './registration';
import { validateTaskBrief, type TaskBrief } from '@/lib/task-brief';
import type { Navigate } from './landing';
import { Tags } from './brand';
import { EmployerField, EmployerSelect } from './employer-ui';
import { CandidateSearchFilters } from './candidate-search-filters';
import {
  CandidateQuickFilters,
  CandidateOrder,
} from './candidate-quick-filters';
import { CandidateTestEvidence as Evidence } from './candidate-test-evidence';
import { CHAT_LOCKED_MESSAGE } from '@/lib/conversation-types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString('ru-RU') : 'Дата не указана';
function Reasons({
  profile: p,
  compact = false,
}: {
  profile: Profile;
  compact?: boolean;
}) {
  const displayReason = (reason: string) => {
    if (!compact) return reason;
    if (reason.startsWith('ФСП:')) {
      const events =
        p.ranking?.events.filter((event) => event.relevance > 0) || [];
      const byDirection = events.filter(
        (event) => event.relevance === 1,
      ).length;
      const byTechnology = events.filter(
        (event) => event.relevance === 0.75,
      ).length;
      const relevance = byDirection
        ? `По выбранному направлению: ${byDirection}.`
        : byTechnology
          ? `Совпадают нужные технологии: ${byTechnology}.`
          : 'Выберите направление или технологии для оценки релевантности.';
      return `Соревнования ФСП: ${events.length}. ${relevance}`;
    }
    if (reason.startsWith('Релевантные соревнования ФСП'))
      return 'Соревнования ФСП: нет подтверждённых результатов.';
    return reason;
  };
  return (
    <div className="ranking-reasons">
      {p.ranking?.reasons
        .filter(
          (reason, index) =>
            !compact || (index > 0 && !reason.startsWith('Результат теста:')),
        )
        .map((reason) => (
          <p key={reason}>
            <Check size={15} />
            <span>{displayReason(reason)}</span>
          </p>
        ))}
      {!!p.ranking?.questions.length && (
        <details>
          <summary>Что уточнить · {p.ranking.questions.length}</summary>
          {p.ranking.questions.map((q) => (
            <p key={q}>{q}</p>
          ))}
        </details>
      )}
    </div>
  );
}
function Competitions({ profile: p }: { profile: Profile }) {
  const events = p.ranking?.events || [];
  return (
    <div className="competition-list">
      {p.fspConnection && (
        <p className="muted">
          Демонстрационный реестр ФСП ID · {date(p.fspConnection.syncedAt)}
          {p.fspConnection.status === 'unavailable'
            ? ' · обновление недоступно, показаны сохранённые результаты'
            : p.fspConnection.status === 'empty'
              ? ' · истории соревнований пока нет'
              : ''}
        </p>
      )}
      {events.length ? (
        events.map((event) => (
          <article key={event.id}>
            <strong>{event.title}</strong>
            <p>
              {event.discipline} · {date(event.date)} ·{' '}
              {event.team ? 'Командное участие' : 'Личное участие'}
            </p>
            <p>
              {event.result === 'winner'
                ? 'Победа'
                : event.result === 'prize'
                  ? 'Призовое место'
                  : 'Участие'}{' '}
              ·{' '}
              {event.source === 'demo'
                ? 'Демонстрационные данные'
                : 'Подтверждённый источник'}
            </p>
            <p>
              {event.relevance === 1
                ? 'Релевантно направлению'
                : event.relevance === 0.75
                  ? 'Есть совпадение технологий'
                  : event.relevance > 0
                    ? 'Общая история участия'
                    : 'Для этой потребности совпадений нет'}
            </p>
            <Tags items={event.skills} />
            {event.team && (
              <small>
                Личный вклад в командный результат отдельно не подтверждён.
              </small>
            )}
          </article>
        ))
      ) : (
        <p className="muted">
          Структурированных подтверждений соревнований нет. ФСП ID без
          результатов не повышает место.
        </p>
      )}
      {!!p.achievements.length && !events.length && (
        <p>История без детализации: {p.achievements.join('; ')}</p>
      )}
    </div>
  );
}

/** Employer search with optional needs and one server-owned ranking/explanation policy. */
export function EmployerCandidates({
  s,
  act,
  nav,
}: {
  s: State;
  act: Action;
  nav: Navigate;
}) {
  const [f, setF, meta] = useDraft('catalog:employer-v2', defaults);
  const signature = JSON.stringify(f);
  const [pageState, setPageState] = useState(1),
    [filtersOpen, setFiltersOpen] = useState(false);
  const [pageSignature, setPageSignature] = useState(signature);
  const page = pageSignature === signature ? pageState : 1;
  const setPage = (value: number) => {
    setPageSignature(signature);
    setPageState(value);
  };
  const [view, setView] = useState<Profile | null>(null),
    [invite, setInvite] = useState<Profile | null>(null);
  const [selected, setSelected] = useState<number[]>([]),
    [compareOpen, setCompareOpen] = useState(false);
  const [comparison, setComparison] = useState<Profile[]>([]),
    [compareError, setCompareError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [selectedProfiles, setSelectedProfiles] = useState(
    new Map<number, Profile>(),
  );
  const needs = useMemo(() => [
    ...s.needs,
    ...s.jobs.filter((j) => j.companyId === s.company.id),
  ], [s.needs, s.jobs, s.company.id]);
  const need = needs.find((n) => n.id === f.needId);
  const appliedQuery = useRef(false);
  const chooseNeed = useCallback((value: string) => {
    const n = needs.find((n) => n.id === value);
    if (n?.taskBrief) {
      setF({ ...defaults, ...n.taskBrief, grade: n.taskBrief.grade || 'Все', needId: value });
      return;
    }
    setF((current) => ({
      ...current,
      needId: value,
      spec: n?.specialty || 'Все',
      grade: n?.grade || 'Все',
      skills: n?.skills || [],
      desiredSkills: n?.desiredSkills || [],
      stack: '',
      salaryMin: n ? String(n.min) : '',
      salaryMax: n ? String(n.max) : '',
      formats: n && n.format !== 'Любой' ? [n.format] : [],
      task: n?.task || 'balanced',
      tasks: [],
      grades: [],
    }));
  }, [needs, setF]);
  useEffect(() => {
    if (meta.status === 'loading' || appliedQuery.current) return;
    const timer = setTimeout(() => {
    appliedQuery.current = true;
    const params = new URLSearchParams(window.location.search);
    const taskFilters = params.get('taskFilters');
    let linkedFilters = { ...defaults };
    if (taskFilters) {
      try { const brief = validateTaskBrief(JSON.parse(taskFilters)); linkedFilters = { ...defaults, ...brief, grade: brief.grade || 'Все', needId: params.get('need') || '', taskOrigin: true }; }
      catch { setFeedback('Не удалось применить условия из ссылки. Использован обычный поиск.'); }
      setF(linkedFilters);
    }
    const linkedCandidate = params.get('candidate');
    if (linkedCandidate && /^\d{1,10}$/.test(linkedCandidate)) {
      setF({ ...linkedFilters, query: linkedCandidate });
      return;
    }
    const linkedComparison = (params.get('compare') || '').split(',').filter((id) => /^\d{1,10}$/.test(id)).map(Number).filter((id) => id <= 2147483647);
    if (linkedComparison.length >= 2) {
      setSelected([...new Set(linkedComparison)].slice(0, 4));
      setCompareOpen(true);
      return;
    }
    const demoCandidate = params.get('fspDemoCandidate');
    if (s.auth?.demo && demoCandidate && /^\d+$/.test(demoCandidate)) {
      setF({
        ...defaults,
        spec: 'Backend',
        grade: 'Middle',
        query: demoCandidate,
        sort: 'По достижениям ФСП',
      });
      return;
    }
    const id = params.get('need');
    if (params.get('favorites') === '1') {
      setF({ ...defaults, savedOnly: true });
      return;
    }
    // Draft hydration is external state; an explicit URL need overrides the saved draft once.
    if (id && needs.some((n) => n.id === id)) chooseNeed(id);
    }, 0);
    return () => clearTimeout(timer);
  }, [meta.status, s.auth?.demo, needs, chooseNeed, setF]);
  const catalog = useCatalog<Profile>(
    'candidates',
    f,
    'employer',
    page,
    'market',
    s,
  );
  const openedLinkedCandidate = useRef(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('candidate');
    if (openedLinkedCandidate.current || !id || f.query !== id || !catalog.isCurrentData) return;
    const profile = catalog.data?.items.find((item) => item.id === Number(id));
    if (!profile) return;
    const timer = setTimeout(() => { openedLinkedCandidate.current = true; setView(profile); }, 0);
    return () => clearTimeout(timer);
  }, [catalog.data, catalog.isCurrentData, f.query]);
  const rows = catalog.data?.items || [],
    total = catalog.data?.total || 0;
  const error =
    candidateFilterError(f) ||
    (f.testMin &&
    (!Number.isFinite(Number(f.testMin)) ||
      Number(f.testMin) < 0 ||
      Number(f.testMin) > 100)
      ? 'Укажите результат теста от 0 до 100.'
      : '');
  const set = (
    key: keyof typeof defaults,
    value: string | boolean | string[],
  ) => setF((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (!compareOpen) return;
    const controller = new AbortController();
    async function load() {
      try {
        const query = new URLSearchParams({
          role: 'employer',
          filters: JSON.stringify({
            ids: selected,
            sort: f.sort,
            task: f.task,
            tasks: f.tasks || [],
            needId: f.needId,
            rankSpec: f.spec,
            rankGrade: f.grade,
            desiredSkills: [...f.skills, ...f.desiredSkills],
            savedOnly: false,
            suggestRelaxations: false,
          }),
          page: '1',
        });
        const response = await fetch(`/api/catalog/candidates?${query}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error || 'Не удалось загрузить сравнение');
        setComparison(body.items);
      } catch (error) {
        if ((error as Error).name !== 'AbortError')
          setCompareError((error as Error).message);
      }
    }
    void load();
    return () => controller.abort();
  }, [compareOpen, selected, f, s]);
  const toggle = (profile: Profile) => {
    if (selected.includes(profile.id)) {
      setSelectedProfiles((current) => {
        const next = new Map(current);
        next.delete(profile.id);
        return next;
      });
      setSelected((current) => current.filter((id) => id !== profile.id));
      setFeedback(`Кандидат #${profile.id} убран из сравнения.`);
    } else if (selected.length < 4) {
      setSelectedProfiles((current) =>
        new Map(current).set(profile.id, profile),
      );
      setSelected((current) => [...current, profile.id]);
      setFeedback(
        `Кандидат #${profile.id} добавлен к сравнению.${selected.length === 0 ? ' Выберите ещё одного кандидата.' : ' Откройте сравнение внизу экрана.'}`,
      );
    }
  };
  async function favourite(profile: Profile) {
    const wasSaved = s.saved.includes(profile.id);
    if (await act('saved', { id: profile.id }))
      setFeedback(
        `Кандидат #${profile.id} ${wasSaved ? 'убран из избранного' : 'добавлен в избранное'}.`,
      );
  }
  const message = (id: number) =>
    nav(`/demo/employer/messages?candidate=${id}`);
  const groupTitle = (p: Profile) =>
    `${p.specialty} · ${p.grade || 'Уровень не подтверждён'}`;
  const renderCard = (p: Profile, index: number) => (
    <div key={p.id}>
      {(index === 0 || groupTitle(rows[index - 1]) !== groupTitle(p)) && (
        <p className="candidate-group-label">{groupTitle(p)}</p>
      )}
      <article
        className={`candidate-card enhanced-candidate-card market-candidate-card ${selected.includes(p.id) ? 'candidate-selected' : ''}`}
      >
        <div className="candidate-card-body">
          <div className="candidate-card-heading">
            <div className={`candidate-avatar avatar-${p.id % 4}`}>
              {p.initials || '#'}
            </div>
            <div className="candidate-heading-text">
              <div className="candidate-caption">
                <span>Кандидат #{p.id}</span>
              </div>
              <h2>{p.headline || `${p.specialty}-специалист`}</h2>
            </div>
          </div>
          <Evidence profile={p} />
          {!!p.verified.length && (
            <div>
              <small>Проверенные технологии</small>
              <Tags items={p.verified} />
            </div>
          )}
          <div>
            <small>Технологии из профиля</small>
            <Tags items={p.skills.slice(0, 8)} />
          </div>
          <p className="candidate-salary">
            {money(p.salaryMin)} — {money(p.salaryMax)} ₽/мес · {p.format} ·{' '}
            {p.city}
          </p>
          <p className="muted">
            {p.experience
              ? `Опыт: ${p.experience} лет`
              : 'Без коммерческого опыта'}{' '}
            · {p.availabilities?.join(', ') || p.availability}
          </p>
          <Reasons profile={p} compact />
        </div>
        <div className="candidate-actions">
          <button className="btn secondary" onClick={() => setView(p)}>
            Подробнее
          </button>
          <button
            className="btn primary"
            onClick={() => setInvite(p)}
            disabled={s.invitations.some(
              (i) =>
                i.companyId === s.company.id &&
                i.candidateId === p.id &&
                ['sent', 'viewed'].includes(i.status),
            )}
          >
            Предложить работу
          </button>
          <button
            className={`btn secondary candidate-favourite ${s.saved.includes(p.id) ? 'saved' : ''}`}
            aria-pressed={s.saved.includes(p.id)}
            onClick={() => void favourite(p)}
          >
            <Heart
              size={17}
              fill={s.saved.includes(p.id) ? 'currentColor' : 'none'}
            />
            {s.saved.includes(p.id) ? 'В избранном' : 'В избранное'}
          </button>
          <button
            className={`btn subtle ${selected.includes(p.id) ? 'is-selected' : ''}`}
            aria-pressed={selected.includes(p.id)}
            disabled={!selected.includes(p.id) && selected.length >= 4}
            onClick={() => toggle(p)}
          >
            <GitCompareArrows size={16} />
            {selected.includes(p.id)
              ? 'Добавлен к сравнению'
              : 'Добавить к сравнению'}
          </button>
          <button
            className="btn secondary candidate-message"
            disabled={!p.canMessage}
            title={!p.canMessage ? CHAT_LOCKED_MESSAGE : undefined}
            onClick={() => message(p.id)}
          >
            <MessageSquare size={16} />
            {p.canMessage ? 'Написать' : 'Чат после приглашения'}
          </button>
        </div>
      </article>
    </div>
  );
  return (
    <>
      <div className="vacancies-page candidate-catalog-page enhanced-search">
        <div className="vacancy-layout">
          <div className="vacancy-results">
            <section
              className="vacancy-search-panel candidate-search-toolbar"
              aria-label="Поиск кандидатов"
            >
              <div className="vacancy-search-row">
                <label className="vacancy-search-input">
                  <Search size={19} />
                  <input
                    aria-label="Поиск кандидатов"
                    placeholder="Технология, направление, город или ID"
                    value={f.query}
                    onChange={(e) => set('query', e.target.value)}
                  />
                </label>
                <CandidateOrder
                  value={f.sort}
                  onChange={(value) => set('sort', value)}
                />
                <button
                  className={`market-filter-button market-favourite ${f.savedOnly ? 'active' : ''}`}
                  aria-pressed={f.savedOnly}
                  onClick={() => set('savedOnly', !f.savedOnly)}
                >
                  <Heart
                    size={16}
                    fill={f.savedOnly ? 'currentColor' : 'none'}
                  />
                  Избранное{s.saved.length > 0 && <> · {s.saved.length}</>}
                </button>
                <span className="market-result-count" role="status">
                  {catalog.loading ? 'Обновляем…' : `Найдено ${total}`}
                </span>
              </div>

              <p
                className="candidate-search-announcement sr-only"
                role="status"
                aria-live="polite"
              >
                {feedback}
              </p>
              <DraftStatus meta={meta} />
            </section>
            {catalog.error && (
              <p className="matching-error" role="alert">
                {catalog.error}
              </p>
            )}
            {!!catalog.data?.relaxations?.length && (
              <section className="search-relaxations">
                <strong>Можно расширить подборку</strong>
                <p>
                  Остальные условия сохранятся. Эти варианты пересекаются между
                  собой.
                </p>
                {catalog.data.relaxations.map((item) => (
                  <button
                    className="btn secondary"
                    key={item.skill}
                    onClick={() =>
                      setF((current) => ({
                        ...current,
                        skills: current.skills.filter(
                          (skill) => skill !== item.skill,
                        ),
                        desiredSkills: [
                          ...new Set([...current.desiredSkills, item.skill]),
                        ],
                      }))
                    }
                  >
                    Не требовать {item.skill}, но учитывать в приоритете · ещё{' '}
                    {item.added}
                  </button>
                ))}
              </section>
            )}
            {!!selected.length && (
              <div
                className="comparison-bar"
                aria-label="Выбранные кандидаты для сравнения"
              >
                <div className="comparison-selection">
                  <strong>Сравнение · {selected.length} из 4</strong>
                  <span>
                    {selected.length === 1
                      ? 'Выберите ещё одного кандидата'
                      : 'Выбрано несколько кандидатов — откройте сравнение'}
                  </span>
                  <div className="comparison-people">
                    {selected.map((id) => (
                      <button
                        className="comparison-person"
                        key={id}
                        aria-label={'Убрать кандидата #' + id + ' из сравнения'}
                        onClick={() => {
                          const p = selectedProfiles.get(id);
                          if (p) toggle(p);
                        }}
                      >
                        #{id} · {selectedProfiles.get(id)?.specialty}
                        <X size={13} />
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  className="comparison-open"
                  disabled={selected.length < 2}
                  onClick={() => {
                    setCompareError('');
                    setComparison([]);
                    setCompareOpen(true);
                  }}
                >
                  <GitCompareArrows size={17} />
                  {selected.length < 2
                    ? 'Нужно выбрать двоих'
                    : 'Сравнить кандидатов · ' + selected.length}
                </button>
                <button
                  className="comparison-clear"
                  onClick={() => {
                    setSelectedProfiles(new Map());
                    setSelected([]);
                    setFeedback('Список сравнения очищен.');
                  }}
                >
                  Очистить
                </button>
              </div>
            )}
            <div
              className={`candidate-list ${catalog.loading ? 'catalog-pending' : ''}`}
              aria-busy={catalog.loading}
            >
              {rows.map(renderCard)}
              {!catalog.loading && !rows.length && (
                <div className="employer-panel employer-empty">
                  <h2>По этим условиям кандидатов нет</h2>
                  <p>
                    Попробуйте изменить условия или убрать одну из обязательных
                    технологий.
                  </p>
                  <button
                    className="btn secondary"
                    onClick={() => setF(defaults)}
                  >
                    Сбросить фильтры
                  </button>
                </div>
              )}
            </div>
            {total > 20 && (
              <div className="catalog-pagination">
                <button
                  className="btn secondary"
                  disabled={page <= 1 || catalog.loading}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={16} />
                  Назад
                </button>
                <span>
                  Страница {catalog.data?.page || page} из{' '}
                  {Math.ceil(total / 20)}
                </span>
                <button
                  className="btn secondary"
                  disabled={page >= Math.ceil(total / 20) || catalog.loading}
                  onClick={() => setPage(page + 1)}
                >
                  Далее
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
          <aside className="vacancy-filters matching-filter-rail"><h2>Условия подбора</h2><CandidateQuickFilters f={f} onChange={setF} openAdvanced={() => setFiltersOpen(true)} /><button className="btn secondary" onClick={()=>setF(defaults)}>Сбросить условия</button></aside>
        </div>
      </div>
      <CandidateSearchFilters
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        f={f}
        onChange={setF}
        needs={needs}
        chooseNeed={chooseNeed}
        total={total}
        loading={catalog.loading}
        error={error || catalog.error}
      />
      <Dialog
        open={!!view}
        onOpenChange={(open) => {
          if (!open) setView(null);
        }}
      >
        <DialogContent className="app-dialog candidate-evidence-dialog">
          <DialogHeader>
            <DialogTitle>Кандидат #{view?.id}</DialogTitle>
            <DialogDescription>
              {view?.specialty} · сведения и основания подбора
            </DialogDescription>
          </DialogHeader>
          {view && (
            <>
              <Evidence profile={view} expanded />
              <Reasons profile={view} />
              <h3>Технологии из профиля · самоописание</h3>
              <Tags items={view.skills} />
              <p>{view.bio}</p>
              <h3>Соревнования ФСП</h3>
              <Competitions profile={view} />
              <h3>Контакты</h3>
              {view.email ? (
                <p>
                  {view.email} · {view.phone || 'Телефон не указан'}
                </p>
              ) : (
                <p>Откроются после принятия приглашения или отклика.</p>
              )}
              <div className="matching-actions">
                <button
                  className="btn primary"
                  onClick={() => {
                    setInvite(view);
                    setView(null);
                  }}
                >
                  Предложить работу
                </button>
                {
                  <button
                    className="btn secondary"
                    disabled={!view.canMessage}
                    title={!view.canMessage ? CHAT_LOCKED_MESSAGE : undefined}
                    onClick={() => message(view.id)}
                  >
                    {view.canMessage ? 'Написать или отправить задачу' : 'Чат после принятия приглашения'}
                  </button>
                }
              </div>
              {!view.canMessage && <p className="muted">{CHAT_LOCKED_MESSAGE}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="app-dialog comparison-dialog">
          <DialogHeader>
            <DialogTitle>Сравнение кандидатов</DialogTitle>
            <DialogDescription>
              {need?.title || 'Выбранные кандидаты'} ·{' '}
              {candidateOrderLabel(f.sort)}. Свидетельства, условия и вопросы
              для интервью.
            </DialogDescription>
          </DialogHeader>
          {compareError && <p role="alert">{compareError}</p>}
          {!comparison.length && !compareError && (
            <p role="status">Загружаем сравнение…</p>
          )}
          {comparison.length > 0 && (
            <>
              <div className="ranking-reasons">
                {explainComparison(comparison, f.sort).map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
              </div>
              <p className="muted">
                Разные категории и версии испытаний сопоставляйте по содержанию,
                их оценки напрямую не сравнимы. Выбранные кандидаты остаются в
                сравнении при смене фильтров; скрытые или удалённые профили
                недоступны.
              </p>
              <div className="comparison-scroll">
                <table className="candidate-comparison">
                  <thead>
                    <tr>
                      <th>Критерий</th>
                      {comparison.map((p) => (
                        <th key={p.id}>
                          Кандидат #{p.id}
                          <br />
                          {p.specialty}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>Категория и проверка</th>
                      {comparison.map((p) => (
                        <td key={p.id}>
                          <Evidence profile={p} showCompetencies={false} />
                        </td>
                      ))}
                    </tr>
                    {Object.entries(dimensionNames).map(([key, label]) => (
                      <tr key={key}>
                        <th>{label}</th>
                        {comparison.map((p) => (
                          <td key={p.id}>
                            {p.assessmentEvidence?.dimensions.find(
                              (d) => d.dimension === key,
                            )?.label || 'Нет отдельных свидетельств'}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <th>Технологии из профиля</th>
                      {comparison.map((p) => (
                        <td key={p.id}>
                          <Tags items={p.skills} />
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th>Проверенные технологии</th>
                      {comparison.map((p) => (
                        <td key={p.id}>
                          {p.verified.join(', ') || 'Не проверялись отдельно'}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th>Условия</th>
                      {comparison.map((p) => (
                        <td key={p.id}>
                          {money(p.salaryMin)}–{money(p.salaryMax)} ₽<br />
                          {p.format} · {p.city}
                          <br />
                          {p.availability}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th>ФСП и релевантность</th>
                      {comparison.map((p) => (
                        <td key={p.id}>
                          <Competitions profile={p} />
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th>Почему в подборке и что уточнить</th>
                      {comparison.map((p) => (
                        <td key={p.id}>
                          <Reasons profile={p} />
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th>Следующий шаг</th>
                      {comparison.map((p) => (
                        <td key={p.id}>
                          <button
                            className="btn primary"
                            onClick={() => {
                              setCompareOpen(false);
                              setInvite(p);
                            }}
                          >
                            Пригласить
                          </button>
                          {
                            <button
                              className="btn subtle"
                              disabled={!p.canMessage}
                              title={!p.canMessage ? CHAT_LOCKED_MESSAGE : undefined}
                              onClick={() => message(p.id)}
                            >
                              {p.canMessage ? 'Написать' : 'Чат после приглашения'}
                            </button>
                          }
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {invite && (
        <InvitationComposer
          key={`${invite.id}:${need?.id || 'quick'}`}
          profile={invite}
          need={need}
          taskBrief={f.taskOrigin && f.spec !== 'Все' ? { spec: f.spec, grade: f.grade === 'Все' ? '' : f.grade, grades: f.grades, skills: f.skills, desiredSkills: f.desiredSkills, salaryMin: f.salaryMin, salaryMax: f.salaryMax, formats: f.formats, task: f.task as TaskBrief['task'], tasks: f.tasks as TaskBrief['tasks'], sort: (['Тест + ФСП', 'По результату теста', 'По достижениям ФСП'].includes(f.sort) ? f.sort : 'Тест + ФСП') as TaskBrief['sort'] } : undefined}
          company={s.company}
          act={act}
          close={() => setInvite(null)}
        />
      )}
    </>
  );
}

function InvitationComposer({
  profile: p,
  need,
  taskBrief,
  company,
  act,
  close,
}: {
  profile: Profile;
  need?: Need;
  taskBrief?: TaskBrief;
  company: State['company'];
  act: Action;
  close: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState(need?.format || p.format || 'Удалённо');
  const [error, setError] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="app-dialog invitation-compose-dialog">
        <DialogHeader>
          <DialogTitle>Предложение кандидату #{p.id}</DialogTitle>
          <DialogDescription>
            {categoryLabel(p)}. Условия будут видны до согласия на общение.
          </DialogDescription>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            const data = Object.fromEntries(new FormData(event.currentTarget));
            try {
              const result = await act('invite', {
                ...data,
                candidateId: p.id,
                format,
                grade: need?.grade || p.grade || p.claimed,
                skills: need?.skills || [],
                needId: need?.id,
                taskBrief,
              });
              if (result) close();
              else
                setError(
                  'Предложение не отправлено. Проверьте сообщение об ошибке и повторите.',
                );
            } finally {
              setBusy(false);
            }
          }}
        >
          <EmployerField label="Название роли">
            <input
              name="title"
              required
              maxLength={200}
              defaultValue={need?.title || `${p.specialty}-специалист`}
            />
          </EmployerField>
          <EmployerField label="Предложение и почему заинтересовал кандидат">
            <textarea
              name="description"
              required
              rows={5}
              maxLength={3000}
              defaultValue={`${need?.description || 'Приглашаем обсудить задачи нашей команды.'}\n\n${p.ranking?.reasons.slice(0, 2).join('\n') || ''}`}
            />
          </EmployerField>
          <div className="form-two">
            <EmployerField label="Зарплата от, ₽/мес">
              <input
                name="min"
                required
                type="number"
                min={1}
                max={10000000}
                defaultValue={need?.min || p.salaryMin}
              />
            </EmployerField>
            <EmployerField label="До, ₽/мес">
              <input
                name="max"
                required
                type="number"
                min={1}
                max={10000000}
                defaultValue={need?.max || p.salaryMax}
              />
            </EmployerField>
          </div>
          <EmployerField label="Формат работы">
            <EmployerSelect
              label="Формат предложения"
              value={format}
              onChange={setFormat}
              options={['Удалённо', 'Гибрид', 'Офис']}
            />
          </EmployerField>
          <EmployerField label="Город команды">
            <input name="city" maxLength={100} />
          </EmployerField>
          <EmployerField label="Контакт вашей команды">
            <input name="contact" required defaultValue={company.email} />
          </EmployerField>
          <p className="muted">
            Личные контакты и чат откроются после принятия предложения или самостоятельного отклика. Зарплатные ожидания кандидата:{' '}
            {money(p.salaryMin)}–{money(p.salaryMax)} ₽.
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="btn primary full" disabled={busy}>
            {busy ? 'Отправляем…' : 'Отправить предложение'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
