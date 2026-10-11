import type { Plan } from '../domain.js';
import { resultLabel } from '../../offerly-web/lib/assessment-presentation.js';
import type { Family, Fixture, Theory } from './core.js';

export const processQuestions: Theory[] = [
  {
    prompt:
      'Два решения сравнивали на разных наборах входных данных. Как сделать сравнение воспроизводимым?',
    options: [
      'Зафиксировать одинаковые данные, условия и критерии для обоих решений',
      'Выбрать решение с лучшим отдельным запуском',
      'Усреднить результаты без учёта различий данных',
    ],
    correct: 0,
    skill: 'experiments',
  },
  {
    prompt:
      'Средняя метрика улучшилась, но один обязательный критерий нарушен. Какой вывод обоснован?',
    options: [
      'Решение не принято: обязательный критерий требует исправления и повторной проверки',
      'Улучшения средней метрики достаточно для приёмки',
      'Убрать нарушенный критерий из отчёта',
    ],
    correct: 0,
    skill: 'validation',
  },
  {
    prompt:
      'После изменения условий ранее успешный план перестал проходить проверку. С чего начать расследование?',
    options: [
      'Сопоставить изменённые условия с нарушенными критериями и проверить гипотезу отдельно',
      'Повторять запуск до первого успешного результата',
      'Вернуть старый отчёт как доказательство',
    ],
    correct: 0,
    skill: 'reasoning',
  },
  {
    prompt:
      'В отчёте ИИ нет входных данных и конфигурации эксперимента. Чего не хватает для независимой проверки?',
    options: [
      'Воспроизводимого запуска с зафиксированными входами, настройками и результатом',
      'Более уверенной формулировки вывода',
      'Скриншота итоговой оценки без настроек',
    ],
    correct: 0,
    skill: 'experiments',
  },
  {
    prompt: 'Проверки прошли на предоставленной выборке. Как корректно описать границы вывода?',
    options: [
      'Указать проверенные условия, непроверенные риски и необходимые проверки перед внедрением',
      'Гарантировать корректность на любых будущих данных',
      'Указать только итоговую оценку без ограничений',
    ],
    correct: 0,
    skill: 'reasoning',
  },
  {
    prompt:
      'Для исправления одновременно изменили несколько настроек. Как выяснить причину улучшения?',
    options: [
      'Сравнить контролируемые эксперименты с отдельными изменениями',
      'Назначить причиной последнее изменение в списке',
      'Считать все изменения одинаково необходимыми',
    ],
    correct: 0,
    skill: 'experiments',
  },
  {
    prompt:
      'Коллега предлагает убрать неудобные строки из тестовых данных после неудачного запуска. Как поступить?',
    options: [
      'Сохранить исходную проверку и отдельно обосновать допустимость исключения по контракту',
      'Исключить строки, чтобы получить успешную оценку',
      'Заменить исходный результат результатом на сокращённых данных',
    ],
    correct: 0,
    skill: 'data',
  },
  {
    prompt:
      'Эксперимент подтвердил ошибку в предложенном плане. Что включить в передачу решения эксперту?',
    options: [
      'Исходную гипотезу, воспроизводимый контрпример, исправление и повторную проверку',
      'Только мнение о качестве автора плана',
      'Только исправленные настройки без исходной ошибки',
    ],
    correct: 0,
    skill: 'reasoning',
  },
];

/** Describe decisions using the same labels a candidate sees in the laboratory. */
export function describePlan(fixture: Fixture, plan: Plan): string {
  return fixture.controls
    .map((control) => {
      const value = plan[control.id];
      const label = (item: string | number) =>
        control.options.find((option) => option.value === String(item))?.label ?? String(item);
      return `${control.label}: ${Array.isArray(value) ? value.map(label).join(', ') || 'ничего не выбрано' : label(value as string | number)}`;
    })
    .join('\n');
}

/** Extend authored fundamentals with actual case decisions and independently verified traces. */
export function extendedTheory(family: Family, fixture: Fixture, rng: () => number): Theory[] {
  // Build a bounded public configuration space; do not require or publish a hidden answer plan.
  let space: Plan[] = [{}];
  for (const control of fixture.controls) {
    const values =
      control.type === 'number'
        ? control.values
        : control.type === 'multiselect'
          ? Array.from({ length: 2 ** control.options.length }, (_, mask) =>
              control.options
                .filter((_, index) => mask & (1 << index))
                .map((option) => option.value),
            )
          : control.options.map((option) => option.value);
    space = space.flatMap((plan) => values.map((value) => ({ ...plan, [control.id]: value })));
    if (space.length > 4096) throw new Error('Пространство теории превышает лимит');
  }
  const pick = <T>(items: T[]): T => items[Math.floor(rng() * items.length)]!;
  const shuffle = <T>(items: T[]): T[] =>
    items
      .map((value) => ({ value, order: rng() }))
      .sort((a, b) => a.order - b.order)
      .map(({ value }) => value);
  const evaluated = space.map((plan) => ({ plan, result: family.run(fixture.data, plan) }));
  const valid = evaluated
    .filter(({ result }) => Object.values(result.checks).every(Boolean))
    .map(({ plan }) => plan);
  const invalid = evaluated
    .filter(({ result }) => !Object.values(result.checks).every(Boolean))
    .map(({ plan }) => plan);
  const applied: Theory[] = [];
  for (const stage of [0, 1]) {
    const correct = pick(valid);
    const wrong = shuffle(invalid).slice(0, 2);
    if (!correct || wrong.length < 2) throw new Error('Недостаточно различных решений для теории');
    applied.push({
      prompt:
        stage === 0
          ? 'Какая конфигурация выполняет все условия этого варианта?'
          : 'Какая замена плана устранит нарушения контракта?',
      scenario:
        stage === 0
          ? fixture.contract
          : `Коллега проверил план:\n${describePlan(fixture, pick(invalid))}\n\nПроверка не прошла. Условия приёмки:\n${fixture.contract}`,
      options: [correct, ...wrong].map((plan) => describePlan(fixture, plan)),
      correct: 0,
      skill: family.skills[stage % family.skills.length]!,
    });
  }
  const failedPlan = pick(invalid);
  const result = family.run(fixture.data, failedPlan);
  const failed = Object.entries(result.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => resultLabel(name));
  applied.push({
    prompt: 'Какое заключение следует передать на приёмку по этому отчёту?',
    scenario: `Кейс «${family.title}». Конфигурация:\n${describePlan(fixture, failedPlan)}\n\nДиагностика:\n${Object.entries(
      result.checks,
    )
      .map(([name, passed]) => `${resultLabel(name)} — ${passed ? 'выполнено' : 'нарушено'}`)
      .join('\n')}`,
    options: [
      `Приёмка заблокирована: ${failed.join(', ')}. Нужны исправление и повторная проверка`,
      'План можно принять, так как эксперимент удалось запустить',
      'Приёмка подтверждена: нарушения не влияют на обязательные критерии',
    ],
    correct: 0,
    skill: family.skills[0]!,
  });
  const process = shuffle(processQuestions).slice(0, 3);
  // Fundamentals retain their wording; applied tasks and the additional selection vary per seed.
  return shuffle([...fixture.theory, ...applied, ...process]);
}
