'use client';
import {
  useRef,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
  type RefObject,
} from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { specialties, grades } from '@/lib/model';
import { specialtyLabels } from '@/lib/employer-profile';
import {
  defaultCandidateFilters,
  candidateFilterCount,
  type CandidateFilters,
} from '@/lib/employer-search';
import { skillCatalog } from '@/lib/suggestion-catalogs';
import { EmployerField, EmployerSelect } from './employer-ui';
import { SuggestionTags } from './suggestion-picker';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';

const orderOptions = [
  { value: 'Тест + ФСП', label: 'Сортировка: тест + ФСП' },
  { value: 'По результату теста', label: 'Сначала результаты теста' },
  { value: 'По достижениям ФСП', label: 'Сначала достижения ФСП' },
  { value: 'По дате подтверждения', label: 'Сначала свежие результаты' },
  { value: 'По зарплате', label: 'Сначала меньше зарплата' },
];

/** Ordering changes priority while leaving exclusion to explicit filters. */
export function CandidateOrder({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className="market-sort"
      title="Меняет порядок списка. Кандидаты без теста или соревнований остаются в поиске."
    >
      <EmployerSelect
        label="Сортировка кандидатов"
        value={value}
        onChange={onChange}
        options={orderOptions}
      />
    </div>
  );
}

function FilterPopover({
  label,
  active,
  container,
  children,
}: {
  label: string;
  active: boolean;
  container?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={`market-filter-button ${active ? 'active' : ''}`}>
          {label}
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={container}
        align="start"
        avoidCollisions
        collisionPadding={12}
        className="market-filter-popover"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Marketplace-style quick filters; a single favourite toggle and compact ordering share the same catalog state. */
export function CandidateQuickFilters({
  f,
  onChange,
  openAdvanced,
}: {
  f: CandidateFilters;
  onChange: Dispatch<SetStateAction<CandidateFilters>>;
  openAdvanced: () => void;
}) {
  const technologiesContainer = useRef<HTMLDivElement>(null);
  function set<K extends keyof CandidateFilters>(
    key: K,
    value: CandidateFilters[K],
  ) {
    onChange((current) => ({ ...current, [key]: value }));
  }
  const count = candidateFilterCount(f);
  const advancedCount = candidateFilterCount({
    ...f,
    spec: 'Все',
    grade: 'Все',
    grades: [],
    skills: [],
    location: '',
    formats: [],
    salaryMin: '',
    salaryMax: '',
  });
  return (
    <div className="candidate-market-filters">
      <div className="market-filter-row">
        <div className={`market-select ${f.spec !== 'Все' ? 'active' : ''}`}>
          <EmployerSelect
            label="Направление кандидата"
            value={f.spec}
            onChange={(value) => set('spec', value)}
            options={[
              { value: 'Все', label: 'Направление' },
              ...specialties.map((value) => ({
                value,
                label: specialtyLabels[value] || value,
              })),
            ]}
          />
        </div>
        <div
          className={`market-select ${f.grade !== 'Все' || f.grades?.length ? 'active' : ''}`}
        >
          <EmployerSelect
            label="Уровень кандидата"
            value={f.grades?.length ? 'selected-levels' : f.grade}
            onChange={(value) =>
              onChange((current) => ({ ...current, grade: value, grades: [] }))
            }
            options={[
              ...(f.grades?.length
                ? [{ value: 'selected-levels', label: f.grades.join(' / ') }]
                : []),
              { value: 'Все', label: 'Уровень' },
              ...grades,
            ]}
          />
        </div>
        <FilterPopover
          label={
            f.skills.length ? `Технологии · ${f.skills.length}` : 'Технологии'
          }
          active={!!f.skills.length}
          container={technologiesContainer}
        >
          <EmployerField
            label="Обязательные технологии"
            hint="Ищем все выбранные технологии. Можно ввести своё название и нажать Enter."
          >
            <SuggestionTags
              id="candidate-quick-technologies"
              portalContainer={technologiesContainer}
              value={f.skills}
              onChange={(value) => set('skills', value)}
              catalog={skillCatalog}
              maxSelected={30}
            />
          </EmployerField>
        </FilterPopover>
        <FilterPopover label={f.location || 'Город'} active={!!f.location}>
          <EmployerField label="Город или регион">
            <input
              aria-label="Город или регион кандидата"
              placeholder="Любой город"
              value={f.location}
              onChange={(event) => set('location', event.target.value)}
            />
          </EmployerField>
        </FilterPopover>
        <div className={`market-select ${f.formats.length ? 'active' : ''}`}>
          <EmployerSelect
            label="Формат работы кандидата"
            value={f.formats[0] || ''}
            onChange={(value) => set('formats', value ? [value] : [])}
            options={[
              { value: '', label: 'Формат работы' },
              'Удалённо',
              'Гибрид',
              'Офис',
            ]}
          />
        </div>
        <FilterPopover
          label={f.salaryMin || f.salaryMax ? 'Зарплата · задана' : 'Зарплата'}
          active={!!(f.salaryMin || f.salaryMax)}
        >
          <p className="market-filter-title">Зарплатные ожидания, ₽/мес</p>
          <div className="candidate-filter-grid">
            <EmployerField label="От">
              <input
                type="number"
                min={0}
                max={10000000}
                aria-label="Зарплата от"
                placeholder="Любая"
                value={f.salaryMin}
                onChange={(event) => set('salaryMin', event.target.value)}
              />
            </EmployerField>
            <EmployerField label="До">
              <input
                type="number"
                min={0}
                max={10000000}
                aria-label="Зарплата до"
                placeholder="Любая"
                value={f.salaryMax}
                onChange={(event) => set('salaryMax', event.target.value)}
              />
            </EmployerField>
          </div>
          <p className="market-filter-hint">
            Показываем кандидатов, чей диапазон пересекается с вашим бюджетом.
          </p>
        </FilterPopover>
        <button className="market-filter-button" onClick={openAdvanced}>
          <SlidersHorizontal size={14} />
          Ещё фильтры
          {advancedCount > 0 && (
            <span className="market-filter-count">{advancedCount}</span>
          )}
        </button>
      </div>
      {(count > 0 || f.savedOnly) && (
        <div className="market-active-filters">
          {f.skills.map((skill) => (
            <button
              key={skill}
              className="candidate-condition"
              aria-label={'Убрать технологию ' + skill}
              onClick={() =>
                set(
                  'skills',
                  f.skills.filter((value) => value !== skill),
                )
              }
            >
              {skill}
              <X size={12} />
            </button>
          ))}
          <button
            className="market-reset"
            onClick={() =>
              onChange({ ...defaultCandidateFilters, query: f.query })
            }
          >
            Сбросить фильтры
          </button>
        </div>
      )}
    </div>
  );
}
