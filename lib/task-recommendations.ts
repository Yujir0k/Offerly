import type { Profile } from './model';
import { dimensionNames } from './employer-matching';
import type { TaskBrief } from './task-brief';
import { matchesSkill } from './skills-ontology';

export type RecommendationLane = {
  key: 'main' | 'operations' | 'product' | 'quality' | 'budget' | 'fsp';
  title: string;
  items: Profile[];
};
export type TaskRecommendation = {
  profile: Profile;
  angles: string[];
  reasons: string[];
  questions: string[];
};
export type RecommendationResult = {
  requirements: TaskBrief;
  total: number;
  examined: number;
  recommendations: TaskRecommendation[];
  relaxations: { skill: string; total: number; added: number }[];
  method: string;
  groups: { grade: string; total: number; examined: number }[];
};
const dimensions: Record<string, string[]> = {
  operations: ['diagnosis', 'correctness'],
  product: ['engineering_judgment', 'adaptation'],
  quality: ['correctness', 'engineering_judgment'],
};
/** Frozen evidence only: a claimed grade or unfinished result cannot imply a strength. */
export function strongDimensions(profile: Profile): string[] {
  return profile.grade
    ? (profile.assessmentEvidence?.dimensions || [])
        .filter((dimension) => dimension.label === 'Сильная сторона')
        .map((dimension) => dimension.dimension)
    : [];
}
/** Key used to avoid claiming superiority across grades or different assessment methods. */
export function comparableProfileKey(profile: Profile): string {
  return [
    profile.specialty,
    profile.grade || 'unconfirmed',
    profile.assessmentEvidence?.assessmentVersion || 'unknown',
    profile.assessmentEvidence?.scoringConfigVersion || 'unknown',
  ].join('|');
}
const relevantEvents = (profile: Profile) =>
  profile.ranking?.events.filter(
    (event) =>
      event.relevance > 0 && ['verified', 'demo'].includes(event.source),
  ) || [];

/** Assemble a small set of alternatives; merge repeated choices instead of inventing differences. */
export function selectTaskRecommendations(
  lanes: RecommendationLane[],
  brief: TaskBrief,
  limit = 6,
): TaskRecommendation[] {
  const selected = new Map<number, { profile: Profile; angles: string[] }>();
  const add = (profile: Profile, title: string) => {
    const item = selected.get(profile.id);
    if (item) {
      if (!item.angles.includes(title)) item.angles.push(title);
    } else if (selected.size < limit)
      selected.set(profile.id, { profile, angles: [title] });
  };
  const main = lanes.find((lane) => lane.key === 'main');
  if (main?.items[0]) add(main.items[0], main.title);
  for (const lane of lanes.filter((entry) => entry.key !== 'main')) {
    const suitable = lane.items.filter((profile) => {
      if (lane.key === 'fsp') return relevantEvents(profile).length > 0;
      if (lane.key === 'budget')
        return Number.isFinite(profile.salaryMin) && profile.salaryMin > 0;
      return strongDimensions(profile).some((dimension) =>
        dimensions[lane.key]?.includes(dimension),
      );
    });
    // Choose within the first comparable category/method returned by the catalog.
    // A tied candidate does not receive a claim that they are better than another.
    const key = suitable[0] && comparableProfileKey(suitable[0]);
    const group = suitable.filter(
      (profile) => comparableProfileKey(profile) === key,
    );
    const choice = group[0];
    if (choice) add(choice, lane.title);
  }
  for (const profile of main?.items || []) {
    if (selected.size >= 3) break;
    if (!selected.has(profile.id))
      add(profile, 'Альтернатива по вашему запросу');
  }
  return [...selected.values()].map(({ profile, angles }) => {
    const reasons: string[] = [],
      questions: string[] = [];
    const strong = strongDimensions(profile);
    const strengths = strong.filter((dimension) => dimension in dimensionNames);
    if (strengths.length)
      reasons.push(
        `В тесте сильные стороны: ${strengths.map((dimension) => dimensionNames[dimension]).join(', ')}.`,
      );
    else if (profile.grade)
      reasons.push(
        `Тест подтвердил ${profile.specialty} · ${profile.grade}; выраженную сильную сторону для выбранных задач не утверждаем.`,
      );
    else
      questions.push(
        'Уровень заявлен в профиле и не подтверждён тестом. Уточните решения на практическом примере.',
      );
    const alternatives = [...selected.values()]
      .map((item) => item.profile)
      .filter((other) => other.id !== profile.id);
    if (
      profile.grade &&
      profile.assessmentEvidence?.assessmentVersion &&
      profile.assessmentEvidence.scoringConfigVersion
    ) {
      const sameMethod = alternatives.filter(
        (other) =>
          comparableProfileKey(other) === comparableProfileKey(profile),
      );
      for (const dimension of strengths.slice(0, 2)) {
        const different = sameMethod.find((other) =>
          other.assessmentEvidence?.dimensions.some(
            (d) => d.dimension === dimension && d.label === 'Соответствует',
          ),
        );
        if (different)
          reasons.push(
            `${dimensionNames[dimension]}: «Сильная сторона»; у кандидата #${different.id} — «Соответствует». Сравнение по одной категории и версии теста.`,
          );
      }
    }
    const reference = main?.items[0];
    if (
      reference &&
      reference.id !== profile.id &&
      profile.salaryMin < reference.salaryMin
    ) {
      reasons.push(
        `Нижняя граница ожиданий на ${(reference.salaryMin - profile.salaryMin).toLocaleString('ru-RU')} ₽ ниже, чем у первого варианта #${reference.id}. Итоговую сумму нужно согласовать.`,
      );
    }
    const all = [...profile.skills, ...profile.verified];
    const desiredMatched = brief.desiredSkills.filter((skill) =>
      matchesSkill(skill, all),
    );
    if (brief.skills.length)
      reasons.push(
        `Обязательные технологии указаны: ${brief.skills.join(', ')}.`,
      );
    if (desiredMatched.length)
      reasons.push(
        `Совпадают технологии для приоритета: ${desiredMatched.join(', ')}.`,
      );
    const wanted = [...brief.skills, ...desiredMatched];
    const unchecked = wanted.filter(
      (skill) => !matchesSkill(skill, profile.verified),
    );
    if (unchecked.length)
      questions.push(
        `Технологии из профиля отдельно не проверены: ${unchecked.join(', ')}. Попросите пример использования.`,
      );
    const missing = brief.desiredSkills.filter(
      (skill) => !matchesSkill(skill, all),
    );
    if (missing.length)
      questions.push(
        `В профиле не указаны ${missing.join(', ')}. Это вопрос для разговора, а не доказательство отсутствия навыка.`,
      );
    if (brief.salaryMax) {
      reasons.push(
        `Ожидания от ${profile.salaryMin.toLocaleString('ru-RU')} ₽/мес укладываются в предел ${Number(brief.salaryMax).toLocaleString('ru-RU')} ₽.`,
      );
      if (profile.salaryMax > Number(brief.salaryMax))
        questions.push(
          'Верхняя граница ожиданий выше бюджета. Уточните приемлемую сумму до приглашения.',
        );
    } else
      reasons.push(
        `Зарплатные ожидания: ${profile.salaryMin.toLocaleString('ru-RU')}–${profile.salaryMax.toLocaleString('ru-RU')} ₽/мес.`,
      );
    const events = relevantEvents(profile);
    if (events.length && brief.sort !== 'По результату теста') {
      reasons.push(
        `Релевантные соревнования: ${events.length}; по направлению — ${events.filter((event) => event.relevance === 1).length}.`,
      );
      if (events.some((event) => event.team))
        questions.push(
          'Есть командный результат соревнования. Уточните личный вклад кандидата.',
        );
      if (events.some((event) => event.source === 'demo'))
        questions.push(
          'Сведения о соревнованиях демонстрационные; реальный реестр ФСП ещё не подключён.',
        );
    }
    questions.push(
      'Обсудите похожую задачу: ограничения, выбранное решение и проверку результата.',
    );
    return { profile, angles, reasons, questions };
  });
}
