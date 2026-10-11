import type { Need, Profile } from './model';
import { skillCatalog } from './suggestion-catalogs';
import {
  canonicalSkillName,
  skillAlternatives,
  skillOntology,
} from './skills-ontology';

export type MatchReasons = {
  stack_summary: string;
  grade_status: string;
  fsp_achievement: string | null;
  budget_fit: string;
};

export type CompetitionResult = {
  id: string;
  title: string;
  date: string;
  discipline: string;
  specialties: string[];
  skills: string[];
  result: 'participation' | 'prize' | 'winner';
  team: boolean;
  source: 'verified' | 'demo' | 'claimed';
};
export type AssessmentEvidence = {
  confirmedAt?: string;
  assessmentVersion?: string;
  scoringConfigVersion?: string;
  dimensions: { dimension: string; label: string; description: string }[];
};
export type Ranking = {
  policyVersion: string;
  group: number;
  mode: string;
  value: number;
  test: number;
  sport: number;
  skills: number;
  matched: string[];
  verified: string[];
  unknown: string[];
  desiredMatched: string[];
  events: (CompetitionResult & { relevance: number })[];
  reasons: string[];
  questions: string[];
};
export const taskOptions = [
  { value: 'balanced', label: 'Все компетенции одинаково важны' },
  { value: 'operations', label: 'Диагностика и исправление ошибок' },
  { value: 'product', label: 'Проектирование и развитие продукта' },
  { value: 'quality', label: 'Качество и надёжность решения' },
];
export const dimensionNames: Record<string, string> = {
  diagnosis: 'Диагностика',
  correctness: 'Корректность',
  engineering_judgment: 'Инженерные решения',
  adaptation: 'Адаптация',
};
const tasks: Record<string, Record<string, number>> = {
  balanced: {
    diagnosis: 1,
    correctness: 1,
    engineering_judgment: 1,
    adaptation: 1,
  },
  operations: {
    diagnosis: 3,
    correctness: 3,
    engineering_judgment: 1,
    adaptation: 1,
  },
  product: {
    diagnosis: 1,
    correctness: 1,
    engineering_judgment: 3,
    adaptation: 3,
  },
  quality: {
    diagnosis: 2,
    correctness: 3,
    engineering_judgment: 2,
    adaptation: 1,
  },
};
/** Canonical skill keys shared by filters and the server ranking policy. */
export function skillKey(value: string) {
  return canonicalSkillName(value).trim().toLowerCase().replace(/ё/g, 'е');
}
/** Build bounded, server-owned context; no client supplied weights are accepted. */
export function matchingContext(raw: Record<string, unknown>, need?: Need) {
  const list = (v: unknown): string[] =>
    Array.isArray(v)
      ? [
          ...new Set(
            v
              .filter((x): x is string => typeof x === 'string')
              .slice(0, 30)
              .map((x) => canonicalSkillName(x))
              .filter(Boolean),
          ),
        ]
      : [];
  const skills = list(raw.skills).length
    ? list(raw.skills)
    : typeof raw.stack === 'string'
      ? list(raw.stack.split(','))
      : [];
  const task =
    typeof raw.task === 'string' && tasks[raw.task]
      ? raw.task
      : need?.task || 'balanced';
  const selectedTasks = Array.isArray(raw.tasks)
    ? raw.tasks
    : need?.taskBrief?.tasks || [];
  const taskGroups = [
    ...new Set(
      selectedTasks.filter(
        (value): value is string =>
          typeof value === 'string' &&
          ['operations', 'product', 'quality'].includes(value),
      ),
    ),
  ].slice(0, 3);
  const priorities = taskGroups.length ? taskGroups : [task];
  const weights = Object.fromEntries(
    Object.keys(tasks.balanced).map((dimension) => [
      dimension,
      priorities.reduce(
        (sum, value) => sum + (tasks[value]?.[dimension] || 1),
        0,
      ) / priorities.length,
    ]),
  );
  const aliases: Record<string, string> = {};
  const desiredSkills = list([
    ...(need?.desiredSkills || []),
    ...list(raw.desiredSkills),
  ]).filter(
    (skill) =>
      !skills.some((required) => skillKey(required) === skillKey(skill)),
  );
  const wanted = new Set(
    [...skills, ...desiredSkills].flatMap(skillAlternatives).map(skillKey),
  );
  for (const entry of skillCatalog) {
    const canonical = entry.name.trim().toLowerCase().replace(/ё/g, 'е');
    if (!wanted.has(canonical)) continue;
    for (const alias of [entry.name, ...(entry.aliases || [])]) {
      aliases[alias.trim().toLowerCase().replace(/ё/g, 'е')] = canonical;
    }
  }
  for (const node of skillOntology)
    if (node.technologies.length === 1 && wanted.has(skillKey(node.name)))
      for (const alias of node.aliases)
        aliases[alias.toLowerCase().replace(/ё/g, 'е')] = skillKey(node.name);
  const alternatives = Object.fromEntries(
    [...skills, ...desiredSkills].map((value) => [
      skillKey(value),
      skillAlternatives(value).map(skillKey),
    ]),
  );
  return {
    specialty: String(raw.spec || need?.specialty || ''),
    grade: String(raw.grade || need?.grade || ''),
    skills,
    desiredSkills,
    task: taskGroups.length > 1 ? 'mixed' : taskGroups[0] || task,
    tasks: taskGroups,
    weights,
    mode:
      raw.sort === 'По результату теста'
        ? 'test'
        : raw.sort === 'По достижениям ФСП'
          ? 'fsp'
          : 'balanced',
    aliases,
    alternatives,
    salaryMin: String(raw.salaryMin || ''),
    salaryMax: String(raw.salaryMax || ''),
  };
}

/** Describe the exact search evidence; partial salary overlap is never called a full fit. */
export function matchReasons(
  profile: Profile,
  metrics: Pick<
    Ranking,
    'matched' | 'verified' | 'unknown' | 'events' | 'mode' | 'sport'
  >,
  context: ReturnType<typeof matchingContext>,
): MatchReasons {
  const format = (value: number) => value.toLocaleString('ru-RU');
  const min = Number(context.salaryMin) || 0;
  const max = Number(context.salaryMax) || Infinity;
  const budget = `${min ? format(min) : 'не ограничен'} — ${Number.isFinite(max) ? format(max) : 'не ограничен'} ₽/мес`;
  const expectations = `${format(profile.salaryMin)} — ${format(profile.salaryMax)} ₽/мес`;
  const relevant = metrics.events.filter((event) => event.relevance > 0);
  const achievements = relevant.map(
    (event) =>
      `${event.result === 'winner' ? 'Победитель' : event.result === 'prize' ? 'Призёр' : 'Участник'}: ${event.title} · ${event.discipline}${event.source === 'demo' ? ' (демонстрационные данные)' : ''}`,
  );
  return {
    stack_summary: context.skills.length
      ? `Найдено ${metrics.matched.length} из ${context.skills.length} обязательных технологий (${context.skills.join(', ')}). Отдельно проверено: ${metrics.verified.length}.`
      : 'Обязательные технологии не заданы.',
    grade_status: profile.grade
      ? `Грейд ${profile.grade} подтверждён платформенным тестированием (${profile.score}/100).${profile.synthetic ? ' Результат симуляции.' : ''}`
      : `Грейд ${profile.claimed || 'не указан'} заявлен; тестом не подтверждён.`,
    fsp_achievement: achievements.length
      ? `${achievements.join('; ')}. ${metrics.mode === 'test' ? 'В режиме приоритета теста не влияет на порядок.' : `Бонус ФСП в текущем режиме: ${format(metrics.sport * (metrics.mode === 'fsp' ? 100 : 25))} балла.`}`
      : null,
    budget_fit:
      !min && !Number.isFinite(max)
        ? `Бюджет не задан. Ожидания кандидата: ${expectations}.`
        : profile.salaryMax < min || profile.salaryMin > max
          ? `Ожидания кандидата (${expectations}) не пересекаются с бюджетом (${budget}).`
          : profile.salaryMin >= min && profile.salaryMax <= max
            ? `Ожидания кандидата (${expectations}) полностью укладываются в бюджет (${budget}).`
            : `Ожидания кандидата (${expectations}) частично пересекаются с бюджетом (${budget}); сумму нужно согласовать.`,
  };
}
/** Explain the exact components used by SQL, without exposing assessment keys. */
export function explainRanking(
  profile: Profile,
  metrics: Omit<Ranking, 'reasons' | 'questions'>,
  context: ReturnType<typeof matchingContext>,
): Ranking {
  const reasons = [
    profile.grade
      ? `${profile.specialty} · ${profile.grade} подтверждён`
      : `${profile.claimed || 'Уровень'} заявлен, подтверждённого уровня пока нет`,
  ];
  if (context.mode !== 'fsp') {
    if (
      profile.assessmentEvidence?.dimensions.length &&
      (context.task !== 'balanced' || context.tasks.length > 0)
    ) {
      const important = profile.assessmentEvidence.dimensions.filter(
        (d) => (context.weights[d.dimension] || 1) > 1,
      );
      reasons.push(
        `Для выбранных задач: ${important.map((d) => `${dimensionNames[d.dimension] || d.dimension} — ${d.label.toLowerCase()}`).join('; ')}`,
      );
    } else
      reasons.push(
        profile.grade
          ? context.mode === 'test'
            ? `Результат теста: ${profile.score} из 100. Сортировка по убыванию балла; направление и уровень указаны отдельно`
            : `Результат теста: ${profile.score} из 100. Сравниваем кандидатов одного направления, уровня и версии теста`
          : 'Подтверждений по испытанию пока нет',
      );
  }
  if (metrics.verified.length)
    reasons.push(`Проверенные технологии: ${metrics.verified.join(', ')}`);
  const claimed = metrics.matched.filter((v) => !metrics.verified.includes(v));
  if (claimed.length)
    reasons.push(
      `Из профиля кандидата: ${claimed.join(', ')} — отдельно не проверены`,
    );
  if (metrics.desiredMatched?.length)
    reasons.push(
      `Желательные технологии из профиля: ${metrics.desiredMatched.join(', ')}`,
    );
  if (context.mode !== 'test') {
    const relevant = metrics.events.filter((e) => e.relevance > 0);
    reasons.push(
      relevant.length
        ? `ФСП: ${relevant.map((e) => `${e.title} · ${e.relevance === 1 ? 'совпадает направление' : e.relevance === 0.75 ? 'совпадают технологии' : 'общая история участия'}`).join('; ')}`
        : 'Релевантные соревнования ФСП не подтверждены; ID сам по себе не даёт бонус',
    );
  }
  const questions = metrics.unknown.map(
    (skill) =>
      `Уточнить опыт с ${skill}: в профиле и проверенных навыках нет сведений.`,
  );
  if (!profile.assessmentEvidence?.dimensions.length)
    questions.push(
      'Нет результатов по отдельным компетенциям. Общая оценка не показывает конкретную сильную сторону.',
    );
  if (profile.achievements.length && !metrics.events.length)
    questions.push(
      'У истории ФСП нет структурированных подтверждений направления и результата; она не участвует в рейтинге.',
    );
  return { ...metrics, reasons, questions };
}
/** Honest category wording for cards, comparisons and invitations. */
export function categoryLabel(profile: Profile) {
  return profile.grade
    ? `${profile.grade} подтверждён`
    : `${profile.claimed || 'Уровень'} заявлен · не подтверждён`;
}

/** Explain an actual ordering of comparable selected profiles using server metrics. */
export function explainComparison(profiles: Profile[], sort: string): string[] {
  if (profiles.length < 2) return [];
  if (
    !['Тест + ФСП', 'По результату теста', 'По достижениям ФСП'].includes(sort)
  )
    return [
      'Порядок выбран по дате или зарплате. Свидетельства кандидатов можно сопоставить в таблице.',
    ];
  const [first, ...others] = profiles;
  return others.map((other) => {
    const a = first.ranking,
      b = other.ranking;
    const sameCategory =
      first.specialty === other.specialty && first.grade === other.grade;
    const sameVersion =
      sort === 'По достижениям ФСП' ||
      !first.grade ||
      (!!first.assessmentEvidence?.assessmentVersion &&
        first.assessmentEvidence.assessmentVersion ===
          other.assessmentEvidence?.assessmentVersion &&
        first.assessmentEvidence.scoringConfigVersion ===
          other.assessmentEvidence?.scoringConfigVersion);
    if (!a || !b || !sameCategory || !sameVersion)
      return `#${first.id} и #${other.id}: результаты теста несопоставимы — разные категории или версии. Сопоставляйте компетенции и условия работы.`;
    if (a.value === b.value)
      return `#${first.id} и #${other.id}: по выбранному режиму равны. Порядок не означает преимущество одного кандидата.`;
    const parts: string[] = [];
    const add = (name: string, left: number, right: number) => {
      if (Math.abs(left - right) < 0.00001) return;
      parts.push(`${name} ${left > right ? 'выше' : 'ниже'}`);
    };
    if (a.mode !== 'fsp')
      add('свидетельства испытания под выбранные задачи', a.test, b.test);
    if (a.mode === 'balanced')
      add('совпадение технологий с учётом источника', a.skills, b.skills);
    if (a.mode !== 'test')
      add('релевантные результаты соревнований', a.sport, b.sport);
    return `#${first.id} выше #${other.id} в текущей выдаче: ${parts.join('; ')}. Это объяснение порядка, а не прогноз успешного найма.`;
  });
}
