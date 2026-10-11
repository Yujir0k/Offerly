import { assessmentTracks, specialtyName, sameSpecialty } from "./assessment-tracks";
import { withPersonalName } from "./personal-name";
import { withWorkPreferences } from "./profile-options";
import { demoVacancies, enrichVacancies } from "./vacancy-catalog";
import { demoTracks } from './demo-tracks';
export type Role = "candidate" | "employer";
export type Profile = {
  demonstration?: boolean;
  demoAvatar?: string;
  fspConnection?: {
    provider: 'demo';
    participantId: string;
    participantName: string;
    status: 'synced' | 'empty' | 'unavailable';
    syncedAt?: string;
  };
  synthetic?: {
    dataset: string;
    key: string;
    method: 'engine-simulation';
    engineVersion: string;
  };
  assessmentEvidence?: import('./employer-matching').AssessmentEvidence;
  competitionResults?: import('./employer-matching').CompetitionResult[];
  ranking?: import('./employer-matching').Ranking;
  match_reasons?: import('./employer-matching').MatchReasons;
  canMessage?: boolean;
  id: number;
  name: string;
  firstName?: string;
  lastName?: string;
  patronymic?: string;
  initials: string;
  avatarKey?: string;
  headline?: string;
  jobStatus?: "active" | "open" | "paused";
  specialty: string;
  professionalDirection?: string;
  grade: string | null;
  claimed: string;
  skills: string[];
  verified: string[];
  score: number;
  city: string;
  country: string;
  region: string;
  preferredLocations: string[];
  relocation: boolean;
  format: string;
  formats?: string[];
  experience: number;
  salaryMin: number;
  salaryMax: number;
  bio: string;
  email: string;
  phone: string;
  fsp: string | null;
  achievements: string[];
  fspHistory?: { source: "demo" | "fsp"; syncedAt: string } | null;
  visible: boolean;
  consent: boolean;
  lastGradeChange: string | null;
  resumeKey?: string;
  freshAt?: string;
  industry: string;
  preferredIndustries?: string[];
  roles: string[];
  softSkills: string[];
  languages: string[];
  education: string;
  notes: string;
  links: string[];
  workHistory: WorkEntry[];
  projects: string;
  employment: string;
  employmentTypes?: string[];
  availability: string;
  availabilities?: string[];
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
  declineReason?: string;
  needId?: string;
  match?: { score: number; matched: string[]; reasons: string[] };
  source?: {
    id?: string;
    kind: 'task' | 'vacancy';
    title: string;
    specialty: string;
    grades: string[];
    skills: string[];
    salaryMin?: number;
    salaryMax?: number;
    formats: string[];
  };
  companyId?: string;
  id: string;
  candidateId: number;
  title: string;
  company: string;
  description: string;
  min: number;
  max: number;
  contact: string;
  status: "sent" | "viewed" | "accepted" | "declined" | "cancelled";
  updatedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  readAt?: string;
  respondedAt?: string;
  format?: string;
  city?: string;
  grade?: string;
  skills?: string[];
};
export type Need = {
  taskBrief?: import('./task-brief').TaskBrief;
  task?: string;
  desiredSkills?: string[];
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
  formal?: boolean;
  result?: import("../vendor/fsp-assessment/src/adaptive/model").CandidateResult;
  assessmentVersion?: string;
  scoringConfigVersion?: string;
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
export type Job = Need & {
  status?: "draft" | "published" | "archived";
  updatedAt?: string;
  mediaKeys?: string[];
  hiringProcess?: string;
  industry?: string;
  company: string;
  companyId?: string;
  employerOwned?: boolean;
  logo?: string;
  city?: string;
  region?: string;
  employment?: string;
  experienceMin?: number;
  experienceMax?: number;
  publishedAt?: string;
  companyDescription?: string;
  companySize?: string;
  team?: string;
  responsibilities?: string[];
  requirements?: string[];
  benefits?: string[];
  niceToHave?: string[];
  demo?: boolean;
};
export type JobApplication = {
  id?: string;
  jobId: string;
  candidateId?: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  message?: string;
  candidate?: Omit<Profile, "resumeKey" | "avatarKey">;
};
export type CompanyMedia = {
  key: string;
  kind: "logo" | "cover" | "gallery";
  name: string;
};
export type CompanyProfile = {
  demonstration?: boolean;
  id: string;
  name: string;
  description: string;
  website: string;
  email: string;
  tagline?: string;
  industry?: string;
  size?: string;
  city?: string;
  founded?: number;
  mission?: string;
  products?: string;
  culture?: string;
  values?: string[];
  benefits?: string[];
  technologies?: string[];
  hiringProcess?: string;
  contactName?: string;
  phone?: string;
  updatedAt?: string;
  logoKey?: string;
  coverKey?: string;
  media?: CompanyMedia[];
};
export type State = {
  /** Internal server policy input. Stripped from every client response. */
  blockedCandidateIds?: number[];
  catalogStats?: {
    market: number;
    opportunities: number;
    recent: number;
    published: number;
    draft: number;
    archived: number;
  };
  auth?: { demo: boolean; userId: string };
  // Transient delivery preview, only returned by local development email-request.
  emailSent?: boolean;
  emailResendAt?: string;
  emailDeliveryError?: string;
  emailDelivery?: { previewCode?: string; inboxUrl?: string };
  emailChange?: {
    id: string;
    stage: "old-code" | "new-code";
    email: string;
    delivery: { previewCode?: string; inboxUrl?: string };
  };
  companies?: CompanyProfile[];
  settings?: import("./account-settings").UserSettings;
  accountDeletedAt?: string;
  version: number;
  role: Role;
  onboarded: boolean;
  profile: Profile;
  company: CompanyProfile;
  candidates: Profile[];
  invitations: Invitation[];
  needs: Need[];
  jobs: Job[];
  favoriteJobs: string[];
  applications: JobApplication[];
  attempts: Attempt[];
  saved: number[];
  notifications: boolean;
  taskAnswer: string;
  journey: "profile" | "survey" | "assessment" | "complete";
  surveys: Survey[];
  emailVerification: {
    email: string;
    status: "unverified" | "verified";
    verifiedAt?: string;
  };
};
export const industries = [
  "Разработка цифровых продуктов",
  "Финтех",
  "E-commerce",
  "Промышленность",
  "Образование",
  "Медицина",
  "Госуслуги",
  "IT-услуги и интеграция",
  "Облачные сервисы и инфраструктура",
  "Телекоммуникации",
  "Игры и развлечения",
  "Кибербезопасность",
  "Транспорт и логистика",
  "Ритейл",
  "Медиа и реклама",
  "Энергетика",
  "Строительство и недвижимость",
  "Туризм и гостиничный бизнес",
  "Агропромышленность",
  "Наука и исследования",
  "HR и подбор персонала",
  "Консалтинг",
  "Другая отрасль",
];
export const specialties = assessmentTracks.map(t => t.name);
export const grades = ["Junior", "Middle", "Senior"];
export const money = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
export function initialState(): State {
  const p: Profile = {
    id: 1042,
    name: "Алексей Крылов",
    initials: "АК",
    specialty: "Backend",
    grade: "Middle",
    claimed: "Middle",
    skills: ["Python", "SQL", "FastAPI"],
    verified: ["Python", "SQL", "FastAPI"],
    score: 86,
    city: "Москва",
    country: "Россия",
    region: "",
    preferredLocations: [],
    relocation: false,
    format: "Удалённо",
    experience: 3,
    salaryMin: 180000,
    salaryMax: 230000,
    bio: "Разрабатываю API и сервисы на Python. Люблю понятные архитектурные решения и команды, в которых делятся опытом.",
    email: "candidate1042@example.test",
    phone: "+7 000 000-00-42",
    fsp: "FSP-DEMO-1042",
    achievements: ["Командный турнир · 2025 · 2 место (демо)"],
    visible: true,
    consent: true,
    lastGradeChange: null,
    industry: "Разработка цифровых продуктов",
    roles: ["Разработчик"],
    softSkills: [],
    languages: [],
    education: "",
    notes: "",
    links: [],
    workHistory: [],
    projects: "",
    employment: "Полная занятость",
    availability: "В течение месяца",
  };
  const rows = [
    [
      "МД",
      "Мария Дёмина",
      "Backend",
      "Middle",
      "Казань",
      4,
      ["Python", "PostgreSQL", "Docker"],
      82,
      null,
    ],
    [
      "ИС",
      "Иван Смирнов",
      "Backend",
      "Middle",
      "Москва",
      3,
      ["Python", "Django", "SQL"],
      77,
      null,
    ],
    [
      "ЕС",
      "Елена Соколова",
      "Frontend",
      "Middle",
      "Санкт-Петербург",
      3,
      ["TypeScript", "React", "CSS"],
      89,
      "FSP-DEMO-1045",
    ],
    [
      "ДВ",
      "Даниил Волков",
      "Backend",
      "Senior",
      "Москва",
      6,
      ["Python", "SQL", "Redis"],
      93,
      "FSP-DEMO-1046",
    ],
    [
      "АП",
      "Анна Павлова",
      "QA",
      "Junior",
      "Тверь",
      0,
      ["Python", "SQL", "Pytest"],
      75,
      null,
    ],
    [
      "НМ",
      "Никита Морозов",
      "Data",
      "Middle",
      "Екатеринбург",
      3,
      ["Python", "SQL", "Pandas"],
      84,
      null,
    ],
  ];
  const candidates = rows.map((r, i) => ({
    ...p,
    id: 1043 + i,
    initials: r[0] as string,
    name: r[1] as string,
    specialty: specialtyName(r[2] as string),
    grade: r[3] as string,
    claimed: r[3] as string,
    city: r[4] as string,
    experience: r[5] as number,
    skills: r[6] as string[],
    verified: r[6] as string[],
    score: r[7] as number,
    fsp: r[8] as string | null,
    achievements: r[8]
      ? ["Участник соревнования · демонстрационные данные"]
      : [],
    email: `candidate${1043 + i}@example.test`,
    phone: `+7 000 000-00-${43 + i}`,
    bio: "Создаю надёжные продукты, работаю с командой и развиваю профессиональные навыки.",
  }));
  const need = {
    id: "need-backend",
    title: "Backend Middle для продуктовой команды",
    specialty: "Backend",
    grade: "Middle",
    skills: ["Python", "SQL"],
    description:
      "Разработка API продуктовой платформы, интеграции с сервисами и работа с PostgreSQL. Нужен специалист, который умеет объяснять свои решения.",
    min: 180000,
    max: 230000,
    format: "Удалённо",
  };
  return {
    version: 0,
    role: "candidate",
    onboarded: false,
    profile: p,
    company: {
      id: "orion",
      name: "Команда Орион",
      description:
        "Развиваем цифровые продукты и даём инженерам свободу в решениях.",
      website: "",
      email: "team@example.test",
    },
    candidates,
    invitations: [
      {
        id: "invite-seed",
        candidateId: 1042,
        title: "Backend-разработчик",
        company: "Команда Орион",
        description: need.description,
        min: 180000,
        max: 230000,
        contact: "team@example.test",
        status: "sent",
        createdAt: new Date().toISOString(),
      },
    ],
    needs: [need],
    jobs: structuredClone(demoVacancies).map(j=>({...j,specialty:specialtyName(j.specialty)})),
    applications: [],
    favoriteJobs: [],
    attempts: [],
    saved: [],
    notifications: true,
    taskAnswer: "",
    journey: "complete",
    surveys: [],
    emailVerification: { email: p.email, status: "unverified" },
  };
}
/** Historical fixture scoring; the live employer catalog uses offerly_candidate_rank. */
export function rank(p: Profile, n: Need) {
  const key = (v: string) => v.trim().toLowerCase().replace(/ё/g, "е");
  const required = [...new Set(n.skills.map(key))];
  const matched = n.skills.filter((s) =>
    p.verified.some((v) => key(v) === key(s)),
  );
  const declared = n.skills.filter(
    (s) =>
      !matched.some((v) => key(v) === key(s)) &&
      p.skills.some((v) => key(v) === key(s)),
  );
  const exact = sameSpecialty(p.specialty, n.specialty) && p.grade === n.grade;
  const skillScore = required.length
    ? ((new Set(matched.map(key)).size +
        new Set(declared.map(key)).size * 0.5) /
        required.length) *
      30
    : 30;
  const score = Math.round(
    (exact ? 50 : 0) +
      skillScore +
      Math.max(0, Math.min(100, p.score)) * 0.15 +
      (p.fsp && p.achievements.length ? 5 : 0),
  );
  return {
    score,
    matched,
    declared,
    reasons: [
      `${p.specialty} ${p.grade ?? "не подтверждён"}`,
      matched.length
        ? `Подтверждены ${matched.join(" и ")}`
        : "Нужные навыки пока не подтверждены",
      ...(declared.length
        ? [`Указаны в профиле: ${declared.join(", ")} — требуют проверки`]
        : []),
      p.fsp && p.achievements.length
        ? "Есть история участия ФСП"
        : "Без истории ФСП — участие не обязательно",
    ],
  };
}

export function normalizeState(s: State): State {
  const defaults = {
    headline: "",
    jobStatus: "open" as const,
    country: "",
    region: "",
    preferredLocations: [],
    relocation: false,
    industry: "Разработка цифровых продуктов",
    roles: [],
    softSkills: [],
    languages: [],
    education: "",
    notes: "",
    links: [],
    workHistory: [],
    projects: "",
    employment: "Полная занятость",
    availability: "В течение месяца",
  };
  s.profile = withWorkPreferences(
    withPersonalName({ ...defaults, ...s.profile }),
  );
  s.candidates = s.candidates.map((p) =>
    withWorkPreferences(withPersonalName({ ...defaults, ...p })),
  );
  s.profile.specialty = specialtyName(s.profile.specialty);
  s.candidates = s.candidates.map(p => ({...p, specialty: specialtyName(p.specialty)}));
  s.needs = s.needs.map(n => ({...n, specialty: specialtyName(n.specialty)}));
  s.jobs = s.jobs.map(j => ({...j, specialty: specialtyName(j.specialty)}));
  s.surveys ||= [];
  s.journey ||= "complete";
  s.emailVerification ||= { email: s.profile.email, status: "unverified" };
  s.company.id ||= "orion";
  s.jobs = s.auth
    ? s.jobs.map((job) => ({
        industry: "",
        city: "",
        employment: "Полная занятость",
        experienceMin: 0,
        ...job,
      }))
    : enrichVacancies(s.jobs);
  s.favoriteJobs = Array.isArray(s.favoriteJobs)
    ? [...new Set(s.favoriteJobs)].filter((id) =>
        s.jobs.some((job) => job.id === id),
      )
    : [];
  return s;
}
export function nextGradeDate(p: Profile) {
  return p.lastGradeChange
    ? new Date(Date.parse(p.lastGradeChange) + 90 * 86400000)
    : null;
}
