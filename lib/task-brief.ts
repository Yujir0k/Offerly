import { specialtyName } from "./assessment-tracks";
import { grades, specialties } from './model';
import { skillCatalog } from './suggestion-catalogs';
import { canonicalSkillName, skillOntology } from './skills-ontology';

export type TaskBrief = {
  spec: string;
  grade: string;
  grades?: string[];
  skills: string[];
  desiredSkills: string[];
  salaryMin: string;
  salaryMax: string;
  formats: string[];
  task: 'balanced' | 'operations' | 'product' | 'quality';
  tasks?: TaskFocus[];
  sort: 'Тест + ФСП' | 'По результату теста' | 'По достижениям ФСП';
};
export type TaskFocus = 'operations' | 'product' | 'quality';
export type BriefSignal = { field: string; value: string; quote: string };
export type ParsedBrief = {
  requirements: TaskBrief;
  signals: BriefSignal[];
  warnings: string[];
};
export const emptyTaskBrief: TaskBrief = {
  spec: '',
  grade: '',
  skills: [],
  desiredSkills: [],
  salaryMin: '',
  salaryMax: '',
  formats: [],
  task: 'balanced',
  sort: 'Тест + ФСП',
};
/** Levels are searched independently; an unspecified level includes all known levels. */
export function taskBriefGrades(
  brief: Pick<TaskBrief, 'grade' | 'grades'>,
): string[] {
  return brief.grade
    ? [brief.grade]
    : brief.grades?.length
      ? brief.grades
      : [...grades];
}
/** Resolve legacy single-task briefs and new combinations without client weights. */
export function taskBriefTasks(
  brief: Pick<TaskBrief, 'task' | 'tasks'>,
): TaskFocus[] {
  return brief.tasks?.length
    ? brief.tasks
    : brief.task === 'balanced'
      ? []
      : [brief.task];
}
const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е');
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordPattern = (value: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}_])${escape(normalize(value))}(?![\\p{L}\\p{N}_])`,
    'gu',
  );
const negative = (before: string, after: string) =>
  /(?:без|исключить|не|не\s+(?:нуж\S*|требу\S*|использ\S*|хот\S*|планиру\S*|будем))\s*$/u.test(
    before,
  ) ||
  /не\s+(?:нуж\p{L}*|требу\p{L}*)\s+(?:(?:знание|знать|опыт|работы|с|в|на)\s+){1,4}$/u.test(
    before,
  ) ||
  /^\s*(?:не\s+(?:нуж\S*|требу\S*)|исключаем)/u.test(after);
const directionWords: Record<string, string[]> = {
  Backend: ['backend', 'back-end', 'бэкенд', 'бекенд', 'серверная разработка'],
  Frontend: ['frontend', 'front-end', 'фронтенд', 'фронтэнд', 'веб-интерфейс'],
  'DevOps / SRE': ['devops', 'sre', 'девопс'],
  QA: ['qa', 'тестировщик', 'тестировщика', 'автоматизация тестирования'],
  'Data Engineering': [
    'data engineer',
    'data engineering',
    'инженер данных',
    'инженера данных',
    'etl',
  ],
  'ML Engineer': [
    'ml engineer',
    'машинное обучение',
    'машинного обучения',
    'ml-инженер',
  ],
  'Data Scientist': ['data scientist', 'data science', 'дата сайентист'],
  MLOps: ['mlops', 'млопс'],
  GenAI: ['genai', 'генеративный ии', 'генеративного ии'],
  'Security Engineering / AppSec': [
    'appsec',
    'инженер безопасности',
    'инженера безопасности',
    'безопасность приложений',
    'безопасности приложений',
  ],
  Android: ['android', 'андроид'],
  iOS: ['ios', 'айос'],
  // Remaining direction names are also matched directly from the platform catalog.
};
const directionRules: { spec: string; pattern: RegExp }[] = [
  {
    spec: 'Backend',
    pattern:
      /серверн\p{L}*\s+(?:част\p{L}*|разработ\p{L}*|логик\p{L}*)|(?:разработ\p{L}*|доработ\p{L}*)\s+(?:сервер\p{L}*|api)/gu,
  },
  {
    spec: 'Frontend',
    pattern:
      /(?:пользовательск\p{L}*|веб|web)[ -]?(?:интерфейс\p{L}*)|клиентск\p{L}*\s+(?:част\p{L}*|разработ\p{L}*)/gu,
  },
  {
    spec: 'QA',
    pattern: /тестировщ\p{L}*|инженер\p{L}*\s+по\s+тестирован\p{L}*/gu,
  },
];
const inferredDirections: Record<string, string[]> = {
  Backend: ['FastAPI', 'Django', 'Spring', 'Node.js', 'Laravel'],
  Frontend: ['React', 'Vue.js', 'Angular', 'Next.js', 'Svelte'],
  'DevOps / SRE': ['Terraform', 'Ansible', 'Kubernetes'],
  'Data Engineering': ['Airflow', 'dbt', 'Apache Spark'],
  'ML Engineer': ['PyTorch', 'TensorFlow', 'MLflow'],
  Android: ['Android SDK', 'Kotlin'],
  iOS: ['Swift', 'UIKit'],
};
const taskRules: { task: TaskBrief['task']; pattern: RegExp }[] = [
  {
    task: 'operations',
    pattern:
      /диагност\p{L}*|инцидент\p{L}*|отлад\p{L}*|дебаг\p{L}*|причин\p{L}*\s+(?:ошиб\p{L}*|сбо\p{L}*)|исправ\p{L}*\s+(?:ошиб\p{L}*|баг\p{L}*)|теря\p{L}*\s+(?:обновлен\p{L}*\s+)?(?:статус\p{L}*|заказ\p{L}*|данн\p{L}*|сообщен\p{L}*)|(?:разобрат\p{L}*|разбират\p{L}*)\s+(?:с\s+)?(?:этими\s+)?(?:проблем\p{L}*|сбо\p{L}*|ошиб\p{L}*)|(?:падает|зависает|тормозит|дублируются)(?!\p{L})|устран\p{L}*\s+(?:сбо\p{L}*|ошиб\p{L}*|проблем\p{L}*)/gu,
  },
  {
    task: 'product',
    pattern:
      /проектир\p{L}*|архитектур\p{L}*|нов\p{L}*\s+(?:продукт\p{L}*|сервис\p{L}*|функц\p{L}*|возможност\p{L}*)|развит\p{L}*\s+(?:продукт\p{L}*|сервис\p{L}*)|(?:добав\p{L}*|реализ\p{L}*|внедр\p{L}*)\s+(?:нов\p{L}*\s+)?(?:автоматическ\p{L}*\s+)?(?:распределен\p{L}*|интеграц\p{L}*|функц\p{L}*|возможност\p{L}*|личн\p{L}*\s+кабинет\p{L}*|оплат\p{L}*)/gu,
  },
  {
    task: 'quality',
    pattern:
      /надежн\p{L}*|качеств\p{L}*|регресс\p{L}*|крайн\p{L}*\s+случа\p{L}*|корректност\p{L}*|(?:покры\p{L}*|покрыт\p{L}*)\s+тест\p{L}*|автотест\p{L}*/gu,
  },
];

/** Extract bounded, editable requirements with exact text evidence; never call an LLM. */
export function parseTaskBrief(input: string): ParsedBrief {
  const original = input.slice(0, 3000),
    text = normalize(original);
  const requirements: TaskBrief = structuredClone(emptyTaskBrief);
  const signals: BriefSignal[] = [],
    warnings: string[] = [];
  const signal = (
    field: string,
    value: string,
    start: number,
    length: number,
  ) =>
    signals.push({
      field,
      value,
      quote: original.slice(start, start + length),
    });
  const positiveMatches = (pattern: RegExp) =>
    [...text.matchAll(pattern)].filter(
      (match) =>
        !negative(
          text.slice(Math.max(0, match.index! - 35), match.index),
          text.slice(
            match.index! + match[0].length,
            match.index! + match[0].length + 35,
          ),
        ),
    );
  const directions = new Set<string>();
  for (const spec of [...specialties, ...Object.keys(directionWords)]) {
    for (const alias of directionWords[spec] || [spec]) {
      const match = positiveMatches(wordPattern(alias))[0];
      if (!match) continue;
      directions.add(specialtyName(spec));
      signal('Направление', spec, match.index!, match[0].length);
      break;
    }
  }
  for (const rule of directionRules) {
    const match = positiveMatches(rule.pattern)[0];
    if (!match || directions.has(specialtyName(rule.spec))) continue;
    directions.add(specialtyName(rule.spec));
    signal('Направление', rule.spec, match.index!, match[0].length);
  }
  // Legacy "Data" is not a second direction inside Data Engineering/Data Scientist.
  if (
    directions.has('Data') &&
    [...directions].some((value) => value.startsWith('Data '))
  ) {
    directions.delete('Data');
    for (let index = signals.length - 1; index >= 0; index--)
      if (
        signals[index].field === 'Направление' &&
        signals[index].value === 'Data'
      )
        signals.splice(index, 1);
  }
  const levels = [
    { value: 'Junior', aliases: ['junior', 'джуниор', 'джун', 'джуна'] },
    { value: 'Middle', aliases: ['middle', 'мидл', 'миддл', 'мидла'] },
    { value: 'Senior', aliases: ['senior', 'сеньор', 'синьор', 'сеньора'] },
  ];
  const foundLevels = new Set<string>();
  for (const level of levels) {
    for (const alias of level.aliases) {
      const match = positiveMatches(wordPattern(alias))[0];
      if (!match) continue;
      foundLevels.add(level.value);
      signal('Уровень', level.value, match.index!, match[0].length);
      break;
    }
  }
  if (foundLevels.size === 1) requirements.grade = [...foundLevels][0];
  else if (foundLevels.size > 1) {
    requirements.grades = [...foundLevels];
    warnings.push(
      'Указаны несколько уровней: покажем варианты отдельно по каждому. Общий балл между уровнями не сравниваем.',
    );
  } else
    warnings.push(
      'Уровень не указан: рассматриваем все уровни отдельно. Самостоятельность и стаж не превращаем в подтверждённый грейд.',
    );

  // Longest non-overlapping dictionary matches avoid Java inside JavaScript and SQL inside SQL Server.
  const hits: { name: string; start: number; end: number }[] = [];
  for (const skill of skillCatalog) {
    // Auto-extraction uses the curated technology groups; the general hh skills include
    // professions and soft skills. Those must not become technology requirements.
    if (skill.group === 'Навыки hh.ru') continue;
    for (const alias of [skill.name, ...(skill.aliases || [])]) {
      if (
        (alias.length < 2 && !['C', 'R'].includes(alias)) ||
        !/[a-zа-я+#]/iu.test(alias)
      )
        continue;
      // Short ambiguous abbreviations require their conventional case in the source.
      const matches = [...text.matchAll(wordPattern(alias))];
      for (const match of matches) {
        const start = match.index!,
          quote = original.slice(start, start + match[0].length);
        if (
          alias.length === 1 &&
          (quote !== alias ||
            !/(?:на|язык\S*|стек\s*:)\s*$/u.test(
              text.slice(Math.max(0, start - 25), start),
            ))
        )
          continue;
        if (
          alias.length <= 2 &&
          quote !== alias &&
          quote !== alias.toUpperCase()
        )
          continue;
        hits.push({
          name: canonicalSkillName(skill.name),
          start,
          end: start + match[0].length,
        });
      }
    }
  }
  for (const node of skillOntology) {
    for (const alias of [node.name, ...node.aliases])
      for (const match of text.matchAll(wordPattern(alias)))
        hits.push({
          name: node.name,
          start: match.index!,
          end: match.index! + match[0].length,
        });
  }
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const accepted: typeof hits = [];
  for (const hit of hits) {
    if (
      accepted.some((other) => hit.start < other.end && hit.end > other.start)
    )
      continue;
    accepted.push(hit);
  }
  accepted.sort((a, b) => a.start - b.start);
  for (const hit of accepted) {
    const prefix =
      text
        .slice(Math.max(0, hit.start - 120), hit.start)
        .split(/[;\n!?]|\.(?=\s|$)/u)
        .at(-1) || '';
    const clause = prefix.split(',').at(-1) || '';
    const before =
      /(?:храним|используем|для\s|пишем|разрабатываем|код\p{L}*|опыт\p{L}*|знани\p{L}*|если\s|интересно|желател\p{L}*)/u.test(
        clause,
      )
        ? clause
        : prefix;
    const after = text.slice(hit.end, hit.end + 45);
    const migrations = [
      ...text.matchAll(
        /(?:переходим|мигрируем|переезжаем)\s+с\s+([^;\n]{1,100}?)\s+на\s+/gu,
      ),
    ];
    const sourceMigration = migrations.some(
      (match) =>
        hit.start >= match.index! &&
        hit.end <= match.index! + match[0].length - 3,
    );
    const targetMigration = migrations.some(
      (match) =>
        accepted.find((value) => value.start >= match.index! + match[0].length)
          ?.start === hit.start,
    );
    if (
      negative(before, after) ||
      sourceMigration ||
      /(?:уходим|отказываемся)\s+(?:с|от)\s*$/u.test(before)
    ) {
      signal(
        'Не используем в подборе',
        hit.name,
        hit.start,
        hit.end - hit.start,
      );
      continue;
    }
    const optionalCues = [
      ...before.matchAll(
        /желател\p{L}*|плюсом|необязател\p{L}*|не\s+обязател\p{L}*|в идеале|пригодится|интересно\s+посмотреть|если\s+умеет/gu,
      ),
    ];
    const requiredCues = [
      ...before.matchAll(
        /(?<!не\s)обязател\p{L}*|необходим\p{L}*|требует\p{L}*|требован\p{L}*|знани\p{L}*|(?:код|пишем|разрабатываем)[^.!?;]{0,45}\sна\s*|основн\p{L}*\s+стек\s*[:—-]?\s*|(?:нуж\p{L}*|ищ\p{L}*)[^.!?;]{0,55}\sна\s*$/gu,
      ),
    ];
    const explicitRequiredCues = [
      ...before.matchAll(
        /(?<!не\s)обязател\p{L}*|необходим\p{L}*|требует\p{L}*|требован\p{L}*/gu,
      ),
    ];
    const optional =
      (optionalCues.at(-1)?.index ?? -1) >
        (explicitRequiredCues.at(-1)?.index ?? -1) ||
      /^\s*(?:желател\p{L}*|будет\s+плюсом|пригодится|приветствуется|не\s+обязател\p{L}*|необязател\p{L}*)/u.test(
        after,
      );
    const developerRole =
      /(?:ищем|нуж\p{L}*)\s*$/u.test(before) &&
      /^\s*[-–—]?\s*разработчик\p{L}*/u.test(after);
    const required =
      !optional &&
      (requiredCues.length > 0 || developerRole || targetMigration);
    const values = required ? requirements.skills : requirements.desiredSkills;
    if (!values.includes(hit.name) && values.length < 30) values.push(hit.name);
    signal(
      required ? 'Обязательная технология' : 'Технология для приоритета',
      hit.name,
      hit.start,
      hit.end - hit.start,
    );
  }
  requirements.desiredSkills = requirements.desiredSkills.filter(
    (skill) => !requirements.skills.includes(skill),
  );
  if (!directions.size) {
    const technologies = [
      ...requirements.skills,
      ...requirements.desiredSkills,
    ];
    for (const [spec, skills] of Object.entries(inferredDirections)) {
      const matched = skills.find((skill) => technologies.includes(skill));
      if (matched) directions.add(specialtyName(spec));
    }
    if (directions.size === 1)
      warnings.push(
        'Направление предположено по технологиям. Проверьте его перед подбором.',
      );
  }
  if (directions.size === 1) requirements.spec = [...directions][0];
  else
    warnings.push(
      directions.size
        ? 'В запросе несколько направлений. Выберите одно; кандидатов разных направлений не сравниваем одним баллом.'
        : 'Направление не распознано. Выберите его вручную.',
    );

  for (const [format, pattern] of [
    ['Удалённо', /удален\S*|удаленк\S*|remote/gu],
    ['Гибрид', /гибрид\S*|hybrid/gu],
    ['Офис', /офис\S*|onsite|on-site/gu],
  ] as const) {
    const match = positiveMatches(pattern)[0];
    if (match) {
      requirements.formats.push(format);
      signal('Формат', format, match.index!, match[0].length);
    }
  }
  const counts = taskRules.map((rule) => ({
    ...rule,
    matches: positiveMatches(rule.pattern),
  }));
  const matchedTasks = counts.filter((rule) => rule.matches.length);
  if (matchedTasks.length === 1) requirements.task = matchedTasks[0].task;
  if (matchedTasks.length > 1)
    requirements.tasks = matchedTasks.map((rule) => rule.task as TaskFocus);
  for (const rule of matchedTasks)
    for (const match of rule.matches.slice(0, 3))
      signal('Задачи', rule.task, match.index!, match[0].length);
  if (matchedTasks.length > 1)
    warnings.push(
      'В описании сочетаются несколько задач: учитываем их вместе. Чтобы изменить приоритеты, уточните описание и разберите его заново.',
    );
  if (/только\s+(?:результат\S*\s+)?тест|приоритет\S*\s+тест/u.test(text))
    requirements.sort = 'По результату теста';
  if (/приоритет\S*\s+фсп|сначала\s+фсп/u.test(text))
    requirements.sort = 'По достижениям ФСП';

  if (/\$|usd|eur|€|доллар|евро/u.test(text))
    warnings.push(
      'Указана иностранная валюта. Бюджет не пересчитываем; задайте месячную сумму в рублях.',
    );
  else if (/за\s+проект|разов\S*\s+(?:оплат\S*|бюджет)/u.test(text))
    warnings.push(
      'Оплата за проект не сравнима с месячными ожиданиями. Месячный бюджет не установлен.',
    );
  else {
    const amount = '(\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d{2,7})';
    const unit = '(тыс\\.?|тысяч\\S*|к|k|₽|руб\\S*)';
    const range = new RegExp(
      `(?:от\\s+)?${amount}\\s*${unit}?\\s*(?:[-–—]|до)\\s*${amount}\\s*${unit}`,
      'u',
    ).exec(text);
    const single = new RegExp(
      `(до|от|бюджет(?:\\s+до)?|зарплата(?:\\s+до)?)\\s*[:—-]?\\s*${amount}\\s*${unit}?`,
      'u',
    ).exec(text);
    const number = (value: string, suffix: string | undefined) => {
      const n =
        Number(value.replace(/\s/g, '')) *
        (suffix && /тыс|^[кk]$/u.test(suffix) ? 1000 : 1);
      return n >= 1000 && n <= 10000000 ? String(n) : '';
    };
    if (range) {
      requirements.salaryMin = number(range[1], range[2] || range[4]);
      requirements.salaryMax = number(range[3], range[4]);
      signal(
        'Бюджет',
        `${requirements.salaryMin}–${requirements.salaryMax} ₽/мес`,
        range.index,
        range[0].length,
      );
    } else if (single && (single[3] || /бюджет|зарплат/u.test(single[1]))) {
      const value = number(single[2], single[3]);
      if (single[1] === 'от') requirements.salaryMin = value;
      else requirements.salaryMax = value;
      if (value)
        signal(
          'Бюджет',
          `${single[1]} ${value} ₽/мес`,
          single.index,
          single[0].length,
        );
    }
  }
  if (requirements.skills.length || requirements.desiredSkills.length)
    warnings.push(
      'Проверьте технологии: обязательные ограничивают список, технологии для приоритета только меняют порядок.',
    );
  warnings.push(
    'Свободный текст учитывается только через показанные условия. Город, отрасль, стаж, сроки и прочие нераспознанные требования уточните отдельно.',
  );
  return { requirements, signals, warnings };
}

/** Validate a confirmed brief on the server; discard extra fields and reject unbounded inputs. */
export function validateTaskBrief(raw: unknown): TaskBrief {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Проверьте условия подбора');
  const r = raw as Record<string, unknown>;
  if (
    typeof r.spec !== 'string' ||
    typeof r.grade !== 'string' ||
    !specialties.includes(specialtyName(r.spec)) ||
    (r.grade !== '' && !grades.includes(r.grade))
  )
    throw new Error('Выберите направление и проверьте уровни');
  const selectedGrades = r.grades === undefined ? [] : r.grades;
  if (
    !Array.isArray(selectedGrades) ||
    selectedGrades.length > 3 ||
    selectedGrades.some((v) => typeof v !== 'string' || !grades.includes(v))
  )
    throw new Error('Проверьте уровни');
  if (
    r.grade &&
    selectedGrades.length &&
    !selectedGrades.every((v) => v === r.grade)
  )
    throw new Error('Условия уровней противоречат друг другу');
  const list = (value: unknown): string[] => {
    if (
      !Array.isArray(value) ||
      value.length > 30 ||
      value.some((v) => typeof v !== 'string' || v.length > 100)
    )
      throw new Error('Проверьте список технологий');
    return [
      ...new Set(value.map((v) => canonicalSkillName(v)).filter(Boolean)),
    ];
  };
  const salary = (value: unknown) => {
    if (value === '') return '';
    if (
      typeof value !== 'string' ||
      !/^\d{1,8}$/u.test(value) ||
      Number(value) < 1 ||
      Number(value) > 10000000
    )
      throw new Error('Бюджет: укажите целое число от 1 до 10 000 000 ₽');
    return value;
  };
  const salaryMin = salary(r.salaryMin),
    salaryMax = salary(r.salaryMax);
  if (salaryMin && salaryMax && Number(salaryMin) > Number(salaryMax))
    throw new Error('Бюджет до не может быть меньше суммы от');
  if (
    !Array.isArray(r.formats) ||
    r.formats.length > 3 ||
    r.formats.some((v) => !['Удалённо', 'Гибрид', 'Офис'].includes(v))
  )
    throw new Error('Проверьте формат работы');
  if (
    typeof r.task !== 'string' ||
    !['balanced', 'operations', 'product', 'quality'].includes(r.task)
  )
    throw new Error('Проверьте приоритет компетенций');
  if (
    typeof r.sort !== 'string' ||
    !['Тест + ФСП', 'По результату теста', 'По достижениям ФСП'].includes(
      r.sort,
    )
  )
    throw new Error('Проверьте приоритет результатов');
  const skills = list(r.skills);
  const selectedTasks = r.tasks === undefined ? [] : r.tasks;
  if (
    !Array.isArray(selectedTasks) ||
    selectedTasks.length > 3 ||
    selectedTasks.some((v) => !['operations', 'product', 'quality'].includes(v))
  )
    throw new Error('Проверьте группы задач');
  if (
    r.task !== 'balanced' &&
    selectedTasks.length &&
    !selectedTasks.every((v) => v === r.task)
  )
    throw new Error('Приоритет задач противоречит выбранным группам');
  return {
    spec: specialtyName(String(r.spec)),
    grade: String(r.grade),
    ...(selectedGrades.length
      ? { grades: [...new Set(selectedGrades)] as string[] }
      : {}),
    skills,
    desiredSkills: list(r.desiredSkills).filter(
      (skill) => !skills.includes(skill),
    ),
    salaryMin,
    salaryMax,
    formats: [...new Set(r.formats)] as string[],
    task: r.task as TaskBrief['task'],
    ...(selectedTasks.length
      ? { tasks: [...new Set(selectedTasks)] as TaskFocus[] }
      : {}),
    sort: r.sort as TaskBrief['sort'],
  };
}
