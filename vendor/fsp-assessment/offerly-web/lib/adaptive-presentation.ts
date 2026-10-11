import type { CompetencyDimension, Stage } from '../../src/adaptive/model.js';

export const dimensionNames: Record<CompetencyDimension, string> = {
  diagnosis: 'Диагностика',
  correctness: 'Корректность системы',
  engineering_judgment: 'Инженерные решения',
  adaptation: 'Адаптация к изменениям',
};
export const stageNames: Record<Stage, string> = {
  anchors: 'Короткие инженерные сценарии',
  incident: 'Расследование инцидента',
  review: 'Анализ решения',
  boundary: 'Дополнительная проверка',
};
export const stepNames: Record<string, string> = {
  anchor: 'Короткий сценарий',
  investigate: 'Выбор гипотезы',
  evidence: 'Выбор источников',
  interpret: 'Интерпретация данных',
  cause: 'Причина инцидента',
  remediate: 'Исправление',
  risk: 'Риск решения',
  fix: 'Исправление решения',
  adapt: 'Изменение условий',
  boundary: 'Дополнительное свидетельство',
};
/** Format the claimed grade only; recommendations never become assigned grades. */
export function confirmationTitle(grade: string, confirmed: boolean): string {
  return `${grade.toUpperCase()} ${confirmed ? 'CONFIRMED' : 'ПОКА НЕ ПОДТВЕРЖДЁН'}`;
}
