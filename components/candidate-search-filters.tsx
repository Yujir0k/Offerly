'use client';
import { useRef, type Dispatch, type SetStateAction } from 'react';
import type { Need } from '@/lib/model';
import { skillCatalog } from '@/lib/suggestion-catalogs';
import {
  defaultCandidateFilters,
  type CandidateFilters,
} from '@/lib/employer-search';
import { EmployerField, EmployerSelect } from './employer-ui';
import { SuggestionTags } from './suggestion-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/** Compact, explained search settings; priorities change order and restrictions are explicit. */
export function CandidateSearchFilters({
  open,
  onOpenChange,
  f,
  onChange,
  needs,
  chooseNeed,
  total,
  loading,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  f: CandidateFilters;
  onChange: Dispatch<SetStateAction<CandidateFilters>>;
  needs: Pick<Need, 'id' | 'title'>[];
  chooseNeed: (id: string) => void;
  total: number;
  loading: boolean;
  error: string;
}) {
  const popupContainer = useRef<HTMLDivElement>(null);
  function set<K extends keyof CandidateFilters>(
    key: K,
    value: CandidateFilters[K],
  ) {
    onChange((current) => ({ ...current, [key]: value }));
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={popupContainer}
        className="app-dialog candidate-filter-dialog"
      >
        <DialogHeader>
          <DialogTitle>Дополнительные фильтры</DialogTitle>
          <DialogDescription>
            Задайте требования к тесту и соревнованиям. Технологии для
            приоритета и важные компетенции меняют порядок, остальные условия
            ограничивают список.
          </DialogDescription>
        </DialogHeader>
        <div className="candidate-filter-body">
          <section className="candidate-filter-section">
            <h3>Навыки, тест и опыт</h3>
            <div className="candidate-filter-extra-body">
              <EmployerField
                label="Технологии для приоритета"
                hint="Кандидаты с этими технологиями будут выше. Отсутствие навыка не исключит человека из списка. Можно добавить любое название."
              >
                <SuggestionTags
                  id="candidate-desired-technologies"
                  portalContainer={popupContainer}
                  value={f.desiredSkills}
                  onChange={(value) => set('desiredSkills', value)}
                  catalog={skillCatalog}
                  maxSelected={30}
                />
              </EmployerField>
              <label className="matching-check">
                <input
                  type="checkbox"
                  checked={f.skillSource === 'verified'}
                  disabled={!f.skills.length}
                  onChange={(e) =>
                    set(
                      'skillSource',
                      e.target.checked ? 'verified' : 'profile',
                    )
                  }
                />
                <span>
                  Обязательные технологии должны быть отдельно проверены
                  <small>
                    Обычно ищем по резюме. Этот фильтр оставляет только
                    отдельные подтверждения технологий; тест уровня сам по себе
                    их не выдаёт.
                  </small>
                </span>
              </label>
              <div className="candidate-filter-grid">
                <EmployerField label="Подтверждение уровня">
                  <EmployerSelect
                    label="Подтверждение уровня"
                    value={f.confirmation}
                    onChange={(value) => set('confirmation', value)}
                    options={[
                      { value: 'all', label: 'Все, подтверждённые выше' },
                      {
                        value: 'confirmed',
                        label: 'Только с подтверждённым уровнем',
                      },
                      {
                        value: 'unconfirmed',
                        label: 'Только без подтверждения',
                      },
                    ]}
                  />
                </EmployerField>
                <EmployerField
                  label="Результат теста не ниже"
                  hint="Оставит только подтверждённые результаты от этого значения. Оценка компетенций от 0 до 100; сравниваем в одном направлении и уровне."
                >
                  <input
                    aria-label="Минимальный результат теста"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="Любой результат"
                    value={f.testMin}
                    onChange={(e) => set('testMin', e.target.value)}
                  />
                </EmployerField>
              </div>
              <div className="candidate-filter-grid">
                <EmployerField label="Опыт от, лет">
                  <input
                    aria-label="Опыт от, лет"
                    type="number"
                    min={0}
                    max={50}
                    value={f.experienceMin}
                    onChange={(e) => set('experienceMin', e.target.value)}
                  />
                </EmployerField>
                <EmployerField label="До, лет">
                  <input
                    aria-label="Опыт до, лет"
                    type="number"
                    min={0}
                    max={50}
                    value={f.experienceMax}
                    onChange={(e) => set('experienceMax', e.target.value)}
                  />
                </EmployerField>
              </div>
              <h4>История соревнований ФСП</h4>
              <label className="matching-check">
                <input
                  type="checkbox"
                  checked={f.fsp}
                  onChange={(e) => set('fsp', e.target.checked)}
                />
                <span>Показывать только кандидатов с историей ФСП</span>
              </label>
              <label className="matching-check">
                <input
                  type="checkbox"
                  checked={f.relevantFsp}
                  onChange={(e) => set('relevantFsp', e.target.checked)}
                />
                <span>
                  Показывать только с соревнованиями по выбранному направлению
                </span>
              </label>
              <EmployerField label="Дисциплина соревнования">
                <EmployerSelect
                  label="Дисциплина соревнования"
                  value={f.discipline}
                  onChange={(value) => set('discipline', value)}
                  options={[
                    { value: '', label: 'Любая' },
                    'Продуктовое программирование',
                    'Программирование алгоритмическое',
                    'Программирование систем информационной безопасности',
                    'Программирование робототехники',
                    'Программирование БАС',
                    'Продуктовая разработка',
                    'Алгоритмическое программирование',
                    'Кибербезопасность',
                    'Анализ данных',
                  ]}
                />
              </EmployerField>
            </div>
          </section>
          {!!needs.length && (
            <details className="candidate-filter-section candidate-filter-extra">
              <summary>Использовать подборку или вакансию</summary>
              <div className="candidate-filter-extra-body">
                <EmployerField label="Подборка или ваша вакансия">
                  <EmployerSelect
                    label="Подборка для поиска"
                    value={f.needId}
                    onChange={chooseNeed}
                    options={[
                      { value: '', label: 'Без подборки' },
                      ...needs.map((n) => ({ value: n.id, label: n.title })),
                    ]}
                  />
                </EmployerField>
              </div>
            </details>
          )}
        </div>
        {error && (
          <p className="matching-error" role="alert">
            {error}
          </p>
        )}
        <footer className="candidate-filter-footer">
          <button
            className="btn secondary"
            onClick={() =>
              onChange({ ...defaultCandidateFilters, savedOnly: f.savedOnly })
            }
          >
            Сбросить условия
          </button>
          <button
            className="btn primary"
            disabled={!!error}
            onClick={() => onOpenChange(false)}
          >
            {loading ? 'Обновляем список…' : `Показать кандидатов · ${total}`}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
