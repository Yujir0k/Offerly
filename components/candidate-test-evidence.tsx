'use client';
import { ClipboardCheck } from 'lucide-react';
import type { Profile } from '@/lib/model';
import { categoryLabel, dimensionNames } from '@/lib/employer-matching';
import { Badge } from './brand';

const competencyMeaning: Record<string, string> = {
  diagnosis: 'Находит причины ошибок и проверяет гипотезы.',
  correctness:
    'Проверяет, что решение работает правильно и учитывает крайние случаи.',
  engineering_judgment: 'Выбирает решение с учётом требований и ограничений.',
  adaptation: 'Перестраивает решение при изменении условий.',
};
const competencyShortName: Record<string, string> = {
  diagnosis: 'Поиск причин ошибок',
  correctness: 'Корректность решения',
  engineering_judgment: 'Инженерные решения',
  adaptation: 'Адаптация к изменениям',
};
const groupNames: Record<string, string> = {
  'Сильная сторона': 'Сильные стороны',
  Соответствует: 'Соответствует требованиям уровня',
};
const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString('ru-RU') : '';

/** Present only frozen public test evidence; group repeated labels without inventing scores. */
export function CandidateTestEvidence({
  profile: p,
  expanded = false,
  showCompetencies = true,
}: {
  profile: Profile;
  expanded?: boolean;
  showCompetencies?: boolean;
}) {
  const evidence = p.assessmentEvidence;
  const dimensions = evidence?.dimensions || [];
  const labels = [...new Set(dimensions.map((dimension) => dimension.label))];
  return (
    <section
      className="evidence-profile"
      aria-label="Результаты профессионального теста"
    >
      <div className="test-evidence-badges">
        {p.grade ? (
          <Badge>{categoryLabel(p)}</Badge>
        ) : (
          <span className="verify-badge neutral">{categoryLabel(p)}</span>
        )}
        {p.grade && (
          <span
            className="mono evidence-index"
            title="Оценка профессиональных компетенций от 0 до 100. Это не процент правильных ответов и не вероятность найма."
          >
            Результат теста: {p.score} из 100
          </span>
        )}
      </div>
      {evidence && (
        <p className="test-evidence-source">
          <ClipboardCheck size={14} aria-hidden="true" />
          {p.synthetic
            ? 'Симуляция профессионального теста'
            : 'Профессиональный тест'}
          {evidence.confirmedAt && <> · {date(evidence.confirmedAt)}</>}
        </p>
      )}
      {p.synthetic && !evidence && (
        <p className="test-evidence-source">Демонстрационный профиль</p>
      )}
      {!!dimensions.length &&
        showCompetencies &&
        (expanded ? (
          <div className="test-competency-details">
            <h3>Что проверял тест</h3>
            <p className="muted">
              Оценки получены из ответов и решений сценариев профессионального
              теста. Это результаты одной попытки для выбранного направления и
              уровня; заявленные технологии проверяются отдельно.
            </p>
            <dl>
              {dimensions.map((dimension) => (
                <div key={dimension.dimension}>
                  <dt>
                    {dimensionNames[dimension.dimension] || dimension.dimension}
                  </dt>
                  <dd>
                    <p>
                      {competencyMeaning[dimension.dimension] ||
                        'Компетенция профессионального теста.'}
                    </p>
                    <strong>{dimension.label}</strong>
                    {dimension.description && (
                      <small>{dimension.description}</small>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <div
            className="test-competency-summary"
            aria-label="Что показал тест"
          >
            {labels.map((label) => (
              <div className="test-competency-group" key={label}>
                <span>{groupNames[label] || label}</span>
                <span className="test-competency-names">
                  {dimensions
                    .filter((dimension) => dimension.label === label)
                    .map(
                      (dimension) =>
                        competencyShortName[dimension.dimension] ||
                        dimensionNames[dimension.dimension] ||
                        dimension.dimension,
                    )
                    .join(' · ')}
                </span>
              </div>
            ))}
          </div>
        ))}
      {expanded && evidence && (
        <p className="test-evidence-method">
          Методика: {evidence.assessmentVersion || 'Версия не указана'}. Оценка
          компетенций не является процентом правильных ответов или вероятностью
          успешного найма.
        </p>
      )}
      {!showCompetencies && !expanded && evidence && (
        <p className="test-evidence-method">
          Методика: {evidence.assessmentVersion || 'Версия не указана'}
        </p>
      )}
    </section>
  );
}
