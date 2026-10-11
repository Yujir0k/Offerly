import { modeledFspStatus } from './fsp-status.js';

export type Role = 'candidate' | 'employer';
export type Profile = {
  assessmentIdentity?: string;
  gradeProvisional?: boolean;
  gradeReviewRequired?: boolean;
  confirmation?: {
    status: 'confirmed' | 'not_confirmed';
    claimed: string;
    specialty: string;
    sessionId: string;
    at: string;
    score: number;
    retryAt: string | null;
  };
  categories?: {
    specialty: string;
    grade: string;
    score: number;
    at: string;
    levelChangedAt?: string;
    sessionId: string;
    reviewStatus?: 'pending' | 'approved' | 'needs_revision';
  }[];
  evidence?: {
    skillId: string;
    name: string;
    track: string;
    score: number;
    at: string;
    assessmentId: string;
    familyId: string;
    companyOnly: boolean;
  }[];
  id: number;
  name: string;
  initials: string;
  specialty: string;
  grade: string | null;
  claimed: string;
  skills: string[];
  verified: string[];
  score: number;
  city: string;
  format: string;
  experience: number;
  salaryMin: number;
  salaryMax: number;
  bio: string;
  email: string;
  phone: string;
  fsp: string | null;
  fspVerification?: import('../../src/domain.js').FspStatus | null;
  achievements: string[];
  visible: boolean;
  consent: boolean;
  lastGradeChange: string | null;
  resumeKey?: string;
  freshAt?: string;
  industry: string;
  roles: string[];
  softSkills: string[];
  languages: string[];
  education: string;
  links: string[];
  workHistory: WorkEntry[];
  projects: string;
  employment: string;
  availability: string;
};
export type WorkEntry = {
  id: string;
  company: string;
  role: string;
  start: string;
  end: string;
  current: boolean;
  description: string;
};
export type Survey = {
  id: string;
  createdAt: string;
  industry: string;
  specialty: string;
  grade: string;
  roles: string[];
  experience: number;
  goal: string;
};
export type Competency = {
  family: string;
  correct: number;
  total: number;
  percent: number;
  feedback: string;
};
export type Invitation = {
  id: string;
  candidateId: number;
  title: string;
  company: string;
  description: string;
  min: number;
  max: number;
  contact: string;
  status: 'sent' | 'viewed' | 'accepted' | 'declined';
  createdAt: string;
};
export type Need = {
  platformNeedId?: string;
  competencyRequired?: string[];
  competencyWeights?: Record<string, number>;
  assessmentFamilies?: string[];
  toolMode?: string;
  id: string;
  title: string;
  specialty: string;
  grade: string;
  skills: string[];
  description: string;
  min: number;
  max: number;
  format: string;
};
export type Attempt = {
  provisional?: boolean;
  trackId?: string;
  familyId?: string;
  needId?: string | null;
  sessionId?: string;
  expertReview?: { decision: string; notes: string; at: string } | null;
  id: string;
  specialty: string;
  grade: string;
  questions: Question[];
  answers: Record<string, string>;
  score?: number;
  passed?: boolean;
  completedAt?: string;
  createdAt: string;
  competencies?: Competency[];
  previousGrade?: string | null;
  categoryAfter?: string | null;
  surveyId?: string;
};
export type Question = {
  id: string;
  family: string;
  prompt: string;
  options?: string[];
  code?: string;
};
export type Job = Need & { company: string };
export type State = {
  version: number;
  role: Role;
  onboarded: boolean;
  profile: Profile;
  company: {
    name: string;
    description: string;
    website: string;
    email: string;
  };
  candidates: Profile[];
  invitations: Invitation[];
  needs: Need[];
  jobs: Job[];
  applications: { jobId: string; status: string; createdAt: string }[];
  attempts: Attempt[];
  saved: number[];
  notifications: boolean;
  taskAnswer: string;
  journey: 'profile' | 'survey' | 'assessment' | 'complete';
  surveys: Survey[];
  emailVerification: {
    email: string;
    status: 'unverified' | 'verified';
    verifiedAt?: string;
  };
};
export const industries = [
  'Разработка цифровых продуктов',
  'Финтех',
  'E-commerce',
  'Промышленность',
  'Образование',
  'Медицина',
  'Госуслуги',
  'Другая отрасль',
];
export const specialties = [
  'Backend',
  'Frontend',
  'Data',
  'QA',
  'Data Scientist · табличные данные',
  'ML Engineer',
  'MLOps / ML Platform',
  'NLP / LLM Engineer',
  'Computer Vision',
  'Recommendation / Ranking',
  'Research ML',
  'Data Engineer',
  'QA / SDET',
  'DevOps / SRE',
  'Аналитик данных',
];
export const grades = ['Junior', 'Middle', 'Senior'];
export const money = (n: number) => new Intl.NumberFormat('ru-RU').format(n);
export function initialState(): State {
  const p: Profile = {
    id: 1042,
    name: 'Алексей Крылов',
    initials: 'АК',
    specialty: 'Backend',
    grade: 'Middle',
    claimed: 'Middle',
    skills: ['Python', 'SQL', 'FastAPI'],
    verified: ['Python', 'SQL', 'FastAPI'],
    score: 86,
    city: 'Москва',
    format: 'Удалённо',
    experience: 3,
    salaryMin: 180000,
    salaryMax: 230000,
    bio: 'Разрабатываю API и сервисы на Python. Люблю понятные архитектурные решения и команды, в которых делятся опытом.',
    email: 'candidate1042@example.test',
    phone: '+7 000 000-00-42',
    fsp: 'FSP-DEMO-1042',
    fspVerification: modeledFspStatus('FSP-DEMO-1042'),
    achievements: ['Командный турнир · 2025 · 2 место (демо)'],
    visible: true,
    consent: true,
    lastGradeChange: null,
    industry: 'Разработка цифровых продуктов',
    roles: ['Разработчик'],
    softSkills: [],
    languages: [],
    education: '',
    links: [],
    workHistory: [],
    projects: '',
    employment: 'Полная занятость',
    availability: 'В течение месяца',
  };
  const rows = [
    [
      'МД',
      'Мария Дёмина',
      'Backend',
      'Middle',
      'Казань',
      4,
      ['Python', 'PostgreSQL', 'Docker'],
      82,
      null,
    ],
    ['ИС', 'Иван Смирнов', 'Backend', 'Middle', 'Москва', 3, ['Python', 'Django', 'SQL'], 77, null],
    [
      'ЕС',
      'Елена Соколова',
      'Frontend',
      'Middle',
      'Санкт-Петербург',
      3,
      ['TypeScript', 'React', 'CSS'],
      89,
      'FSP-DEMO-1045',
    ],
    [
      'ДВ',
      'Даниил Волков',
      'Backend',
      'Senior',
      'Москва',
      6,
      ['Python', 'SQL', 'Redis'],
      93,
      'FSP-DEMO-1046',
    ],
    ['АП', 'Анна Павлова', 'QA', 'Junior', 'Тверь', 0, ['Python', 'SQL', 'Pytest'], 75, null],
    [
      'НМ',
      'Никита Морозов',
      'Data',
      'Middle',
      'Екатеринбург',
      3,
      ['Python', 'SQL', 'Pandas'],
      84,
      null,
    ],
  ];
  const candidates = rows.map((r, i) => ({
    ...p,
    id: 1043 + i,
    initials: r[0] as string,
    name: r[1] as string,
    specialty: r[2] as string,
    grade: r[3] as string,
    claimed: r[3] as string,
    city: r[4] as string,
    experience: r[5] as number,
    skills: r[6] as string[],
    verified: r[6] as string[],
    score: r[7] as number,
    fsp: r[8] as string | null,
    fspVerification: modeledFspStatus(r[8] as string | null),
    achievements: r[8] ? ['Участник соревнования · демонстрационные данные'] : [],
    email: `candidate${1043 + i}@example.test`,
    phone: `+7 000 000-00-${43 + i}`,
    bio: 'Создаю надёжные продукты, работаю с командой и развиваю профессиональные навыки.',
  }));
  const need = {
    id: 'need-backend',
    title: 'Backend Middle для продуктовой команды',
    specialty: 'Backend',
    grade: 'Middle',
    skills: ['Python', 'SQL'],
    description:
      'Разработка API продуктовой платформы, интеграции с сервисами и работа с PostgreSQL. Нужен специалист, который умеет объяснять свои решения.',
    min: 180000,
    max: 230000,
    format: 'Удалённо',
  };
  return {
    version: 0,
    role: 'candidate',
    onboarded: false,
    profile: p,
    company: {
      name: 'Команда Орион',
      description: 'Развиваем цифровые продукты и даём инженерам свободу в решениях.',
      website: '',
      email: 'team@example.test',
    },
    candidates,
    invitations: [
      {
        id: 'invite-seed',
        candidateId: 1042,
        title: 'Backend-разработчик',
        company: 'Команда Орион',
        description: need.description,
        min: 180000,
        max: 230000,
        contact: 'team@example.test',
        status: 'sent',
        createdAt: new Date().toISOString(),
      },
    ],
    needs: [need],
    jobs: [
      {
        ...need,
        id: 'job-backend',
        title: 'Backend-разработчик',
        company: 'Команда Орион',
      },
      {
        ...need,
        id: 'job-frontend',
        title: 'Frontend-разработчик',
        specialty: 'Frontend',
        skills: ['TypeScript', 'React'],
        company: 'Команда Орион',
        min: 160000,
        max: 210000,
      },
    ],
    applications: [],
    attempts: [],
    saved: [],
    notifications: true,
    taskAnswer: '',
    journey: 'complete',
    surveys: [],
    emailVerification: { email: p.email, status: 'unverified' },
  };
}
export function rank(p: Profile, n: Need) {
  const failed =
    p.confirmation?.status === 'not_confirmed' &&
    p.confirmation.specialty === canonicalSpecialty(n.specialty);
  const fspBonus = Boolean(
    p.fspVerification?.id === p.fsp && (p.fspVerification?.verified || p.fspVerification?.modeled),
  );
  const adjust = (score: number) =>
    Math.min(100, Math.round(score * (failed ? 0.8 : 1) * (fspBonus ? 1.2 : 1)));
  const rankingReasons = [
    ...(failed ? ['Грейд не подтверждён: рейтинг соответствия ×0,8'] : []),
    ...(fspBonus
      ? ['Достижения ФСП: рейтинг соответствия +20%']
      : ['История ФСП отсутствует — без штрафа']),
  ];
  const matched = n.skills.filter((s) =>
    p.verified.some((v) => v.toLowerCase() === s.toLowerCase()),
  );
  const category = p.categories?.find(
    (item) =>
      item.specialty === canonicalSpecialty(n.specialty) &&
      item.grade === n.grade &&
      item.reviewStatus !== 'needs_revision',
  );
  const exact =
    (!failed &&
      !p.gradeReviewRequired &&
      canonicalSpecialty(p.specialty) === canonicalSpecialty(n.specialty) &&
      p.grade === n.grade) ||
    (!failed && Boolean(category));
  if (n.competencyRequired?.length) {
    const relevant = [
      ...new Set([...n.competencyRequired, ...Object.keys(n.competencyWeights || {})]),
    ];
    const evidence = (p.evidence || []).filter(
      (item) => item.track === canonicalSpecialty(n.specialty),
    );
    const best = (skill: string) =>
      Math.max(0, ...evidence.filter((item) => item.skillId === skill).map((item) => item.score));
    const total = relevant.reduce((sum, skill) => sum + (n.competencyWeights?.[skill] ?? 1), 0);
    const coverage = total
      ? relevant.reduce(
          (sum, skill) => sum + best(skill) * (n.competencyWeights?.[skill] ?? 1),
          0,
        ) / total
      : 0;
    const covered = n.competencyRequired.filter((skill) => best(skill) >= 75);
    const missing = n.competencyRequired.filter((skill) => !covered.includes(skill));
    return {
      score: adjust(coverage * 0.8 + (exact ? 15 : 0)),
      matched: covered.map((skill) => competencyNames[skill] || skill),
      reasons: [
        ...rankingReasons,
        exact
          ? `Совпадает категория ${canonicalSpecialty(n.specialty)} ${n.grade}`
          : 'Заявленная категория пока не подтверждена полной сессией',
        `Соответствие компетенций: ${Math.round(coverage)}% с учётом ваших приоритетов`,
        covered.length
          ? `Есть доказательства: ${covered.map((skill) => competencyNames[skill] || skill).join(', ')}`
          : 'По выбранным компетенциям пока нет доказательств',
        missing.length
          ? `Ещё не проверено: ${missing.map((skill) => competencyNames[skill] || skill).join(', ')}`
          : 'Все обязательные компетенции покрыты',
        'Технологии резюме отображаются отдельно от результатов практики',
      ],
    };
  }
  const score = adjust(
    (exact ? 50 : 0) +
      (n.skills.length ? (matched.length / n.skills.length) * 30 : 30) +
      p.score * 0.15,
  );
  return {
    score,
    matched,
    reasons: [
      ...rankingReasons,
      `${p.specialty} ${p.grade ?? 'не подтверждён'}`,
      matched.length ? `Подтверждены ${matched.join(' и ')}` : 'Нужные навыки пока не подтверждены',
      fspBonus
        ? p.fspVerification?.modeled
          ? 'Демонстрационная история ФСП · модель данных'
          : 'Подтверждённая история ФСП'
        : 'Без истории ФСП — участие не обязательно',
    ],
  };
}

export const competencyNames: Record<string, string> = {
  validation: 'Валидация и доказательства',
  experiments: 'Эксперименты',
  data: 'Качество данных',
  reliability: 'Надёжность',
  delivery: 'Эксплуатация',
  retrieval: 'Retrieval и источники',
  evaluation: 'Оценка качества',
  cost: 'Ресурсы и стоимость',
  reasoning: 'Профессиональное рассуждение',
  communication: 'Передача результата',
};

/** Historical labels resolve to the same category as the current specialization catalog. */
export function canonicalSpecialty(specialty: string): string {
  return (
    ({ Data: 'Data Scientist · табличные данные', QA: 'QA / SDET' } as Record<string, string>)[
      specialty
    ] || specialty
  );
}

export function normalizeState(s: State): State {
  const defaults = {
    industry: 'Разработка цифровых продуктов',
    roles: [],
    softSkills: [],
    languages: [],
    education: '',
    links: [],
    workHistory: [],
    projects: '',
    employment: 'Полная занятость',
    availability: 'В течение месяца',
  };
  s.profile = { ...defaults, ...s.profile };
  if (!s.profile.fspVerification) s.profile.fspVerification = modeledFspStatus(s.profile.fsp);
  s.candidates = s.candidates.map((p) => ({ ...defaults, ...p }));
  s.surveys ||= [];
  s.journey ||= 'complete';
  s.emailVerification ||= { email: s.profile.email, status: 'unverified' };
  return s;
}
export function nextGradeDate(p: Profile) {
  return p.lastGradeChange ? new Date(Date.parse(p.lastGradeChange) + 90 * 86400000) : null;
}
