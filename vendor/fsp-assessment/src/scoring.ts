import { getTrack } from './catalog.js';
import type { Assessment, AssessmentResult, Evidence, Need } from './domain.js';
import { evaluateEngineering } from './engineering.js';
import { evaluateExpress } from './express.js';

/** Scores reproducible evidence; open recommendations remain subject to expert review. */
export function evaluate(assessment: Assessment): AssessmentResult {
  if (assessment.variant.engineering?.version === 'express-v1') return evaluateExpress(assessment);
  if (assessment.variant.engineering) return evaluateEngineering(assessment);
  const variant = assessment.variant;
  const track = getTrack(variant.trackId);
  const evidence: Evidence[] = [];
  let theory = 0;
  for (const question of variant.questions) {
    const correct = assessment.answers[question.id] === variant.oracle.answers[question.id];
    theory += correct ? question.points : 0;
    evidence.push({
      skillId: question.skill,
      score: correct ? 40 : 0,
      source: question.id,
      explanation: correct
        ? 'Теоретический сигнал; сам по себе не подтверждает практическую компетенцию'
        : 'Ответ требует пересмотра',
    });
  }
  const valid = (stage: number) => {
    const last = assessment.experiments.filter((experiment) => experiment.stage === stage).at(-1);
    return last && Object.values(last.checks).every(Boolean) ? last : undefined;
  };
  const main = valid(1);
  const changed = valid(2);
  const score = theory + (main ? 40 : 0) + (changed ? 30 : 0);
  const measured =
    variant.lab?.measuredSkills ??
    track.skills.filter((skill) =>
      (variant.rows.length
        ? ['validation', 'experiments', 'data']
        : variant.documents.length
          ? ['retrieval', 'evaluation', 'cost']
          : ['reliability', 'data']
      ).includes(skill),
    );
  for (const skill of measured)
    evidence.push({
      skillId: skill,
      score: main && changed ? 100 : main ? 55 : 0,
      source: [main?.id, changed?.id].filter(Boolean).join(','),
      explanation:
        changed && main
          ? 'Инварианты подтверждены в двух условиях симуляции; вывод ограничен этим семейством'
          : main
            ? 'Подтверждение получено только в исходных условиях'
            : 'Нет эксперимента, выполняющего обязательные ограничения',
    });
  evidence.push({
    skillId: 'communication',
    score: 0,
    source: 'recommendation',
    explanation:
      'Открытая рекомендация ожидает экспертной проверки; длина и стиль текста не оцениваются автоматически',
  });
  const passed = score >= 75 && Boolean(main && changed);
  const recommendationPresent = assessment.recommendation.trim().length >= 20;
  return {
    score,
    proposedGrade: passed ? variant.grade : null,
    status:
      passed && recommendationPresent
        ? 'provisional'
        : passed
          ? 'review_required'
          : 'not_confirmed',
    evidence,
    rubricVersion: 'evidence-v4',
    feedback: [
      main
        ? 'Получен корректный воспроизводимый основной эксперимент.'
        : 'Нужно подтвердить решение экспериментом с соблюдением ограничений.',
      changed
        ? 'Решение проверено после изменения условий.'
        : 'Изменённые условия пока не проверены корректно.',
      'Грейд предварительный: семейство не прошло человеческую калибровку.',
      'Открытую рекомендацию должен проверить эксперт. Итоговые профессиональные выводы ограничены покрытием этих симуляций.',
    ],
  };
}

/** Explains matching using available evidence, keeping missing skills distinct from failures. */
export function matchNeed(
  need: Need,
  results: AssessmentResult[],
): { score: number; covered: string[]; missing: string[]; explanation: string } {
  const best = new Map<string, number>();
  for (const result of results)
    if (
      [
        'evidence-v2',
        'evidence-v3',
        'evidence-v4',
        'engineering-v1',
        'evidence-1',
        'information-2',
      ].includes(result.rubricVersion)
    )
      for (const item of result.evidence)
        if (item.source !== 'recommendation')
          best.set(item.skillId, Math.max(best.get(item.skillId) ?? 0, item.score));
  const relevant = [...new Set([...need.required, ...Object.keys(need.weights)])];
  const covered = relevant.filter((skill) => (best.get(skill) ?? 0) >= 70);
  const missing = need.required.filter((skill) => !covered.includes(skill));
  const total = relevant.reduce((sum, skill) => sum + (need.weights[skill] ?? 1), 0);
  const score = total
    ? Math.round(
        relevant.reduce(
          (sum, skill) => sum + (best.get(skill) ?? 0) * (need.weights[skill] ?? 1),
          0,
        ) / total,
      )
    : 0;
  return {
    score,
    covered,
    missing,
    explanation: `Покрыто ${covered.length} компетенций; обязательных пробелов: ${missing.length}. Непроверенные навыки указаны отдельно. Грейд и сведения ФСП не заменяют доказательства.`,
  };
}
