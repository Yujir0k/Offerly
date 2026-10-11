import { specialtyName } from "./assessment-tracks";
import { formatPhone, phoneError } from "./phone";
import type { CompanyProfile, Job, State, Invitation } from "./model";
import { salaryRangeError } from "./salary-range";
import {
  profileGrades,
  formatOptions,
  employmentOptions,
} from "./profile-options";
import { specialties } from "./model";
import { demoTracks } from './demo-tracks';
export const companySizes = [
  "1–10 человек",
  "11–50 человек",
  "51–200 человек",
  "201–500 человек",
  "501–1000 человек",
  "Более 1000 человек",
];
export const specialtyLabels: Record<string, string> = {
  ...Object.fromEntries(
    demoTracks.map((track) => [
      track.specialty,
      track.direction === 'Машинное обучение и AI' ||
      track.direction === 'Мобильная разработка'
        ? track.specialty
        : track.direction,
    ]),
  ),
  Backend: "Backend-разработка",
  Frontend: "Frontend-разработка",
  Data: "Данные и машинное обучение",
  QA: "Тестирование",
};
export const assetUrl = (key?: string) =>
  key ? `/api/company-media?key=${encodeURIComponent(key)}` : undefined;
export const invitationOwned = (i: Invitation, s: State) =>
  i.companyId ? i.companyId === s.company.id : i.company === s.company.name;
export const publishedJob = (j: Job) => !j.status || j.status === "published";
export const lines = (value: unknown, max = 30) =>
  Array.isArray(value)
    ? value
        .filter((v) => typeof v === "string")
        .map((v) => v.trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, max)
    : typeof value === "string"
      ? value
          .split(/\n/)
          .map((v) => v.trim().slice(0, 300))
          .filter(Boolean)
          .slice(0, max)
      : [];
const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
function url(value: unknown) {
  const v = text(value, 300);
  if (!v) return "";
  try {
    const u = new URL(v);
    if (["http:", "https:"].includes(u.protocol)) return u.href;
  } catch {
    // URL parsers expose different technical messages across runtimes.
  }
  throw new Error("Укажите полный адрес сайта, например https://company.ru.");
}
export function companyWebsiteError(value: unknown) {
  try {
    url(value);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}
export function cleanCompany(
  b: Record<string, any>,
  current: CompanyProfile,
): CompanyProfile {
  const name = text(b.name, 150),
    email = text(b.email ?? current.email, 200);
  if (!name) throw new Error("Укажите название компании.");
  if (!/^\S+@\S+\.\S+$/.test(email))
    throw new Error("Укажите корректную почту компании.");
  const phone = formatPhone(text(b.phone, 50));
  const phoneIssue = phoneError(phone);
  if (phoneIssue) throw new Error(phoneIssue);
  const founded =
    b.founded !== undefined && b.founded !== null && b.founded !== ""
      ? Number(b.founded)
      : undefined;
  if (
    founded !== undefined &&
    (!Number.isInteger(founded) ||
      founded < 1800 ||
      founded > new Date().getFullYear())
  )
    throw new Error("Проверьте год основания компании.");
  return {
    ...current,
    name,
    email,
    website: url(b.website),
    description: text(b.description, 6000),
    tagline: text(b.tagline, 200),
    industry: text(b.industry, 160),
    size: text(b.size, 100),
    city: text(b.city, 160),
    founded,
    mission: text(b.mission, 2500),
    products: text(b.products, 5000),
    culture: text(b.culture, 5000),
    values: lines(b.values, 12),
    benefits: lines(b.benefits, 20),
    technologies: lines(b.technologies, 30),
    contactName: text(b.contactName, 120),
    phone,
    hiringProcess: text(b.hiringProcess, 3000),
    updatedAt: new Date().toISOString(),
  };
}
export function cleanJob(b: Record<string, any>, s: State, current?: Job): Job {
  const status = b.status === "draft" ? "draft" : "published";
  const title = text(b.title, 200),
    description = text(b.description, 6000);
  if (status === "published") {
    if (!s.company.name || !/^\S+@\S+\.\S+$/.test(s.company.email))
      throw new Error("Сначала заполните название и почту компании.");
    if (!title || !description)
      throw new Error("Добавьте название вакансии и описание роли.");
    const error = salaryRangeError(b.min, b.max);
    if (error) throw new Error(error);
  }
  b = {...b, specialty: specialtyName(String(b.specialty || ""))};
  if (!specialties.includes(b.specialty) || !profileGrades.includes(b.grade))
    throw new Error("Выберите направление и уровень вакансии.");
  if (!formatOptions.filter((v) => v !== "Любой").includes(b.format))
    throw new Error("Выберите формат работы.");
  const employment = b.employment || "Полная занятость";
  const city = text(b.city, 160);
  if (status === "published" && b.format !== "Удалённо" && !city)
    throw new Error("Укажите город для офисного или гибридного формата.");
  if (!employmentOptions.includes(employment))
    throw new Error("Выберите тип занятости.");
  const skillInput = Array.isArray(b.skills)
    ? b.skills
    : typeof b.skills === "string"
      ? b.skills.split(",")
      : [];
  const skills = lines(skillInput, 40);
  if (status === "published" && !skills.length)
    throw new Error("Укажите хотя бы один профессиональный навык.");
  const number = (v: any) =>
    Number.isFinite(Number(v)) ? Math.max(0, Math.min(10000000, Number(v))) : 0;
  const experienceMin = Number(b.experienceMin) || 0,
    experienceMax =
      b.experienceMax === "" || b.experienceMax === undefined
        ? undefined
        : Number(b.experienceMax);
  if (
    !Number.isFinite(experienceMin) ||
    experienceMin < 0 ||
    experienceMin > 50 ||
    (experienceMax !== undefined &&
      (!Number.isFinite(experienceMax) ||
        experienceMax < experienceMin ||
        experienceMax > 50))
  )
    throw new Error(
      "Укажите опыт от 0 до 50 лет; верхняя граница не меньше нижней.",
    );
  const mediaKeys = lines(b.mediaKeys, 4);
  if (mediaKeys.some((key) => !s.company.media?.some((m) => m.key === key)))
    throw new Error("Выберите фотографии из медиатеки своей компании.");
  return {
    ...current,
    id: current?.id || crypto.randomUUID(),
    title: title || "Новая вакансия",
    description,
    specialty: b.specialty,
    grade: b.grade,
    format: b.format,
    employment,
    skills,
    min: number(b.min),
    max: number(b.max),
    experienceMin,
    experienceMax,
    industry: s.company.industry,
    city,
    team: text(b.team, 160),
    responsibilities: lines(b.responsibilities),
    requirements: lines(b.requirements),
    niceToHave: lines(b.niceToHave),
    benefits: lines(b.benefits),
    hiringProcess: text(b.hiringProcess, 3000),
    mediaKeys,
    status,
    company: s.company.name,
    companyId: s.company.id,
    companyDescription: s.company.description,
    companySize: s.company.size,
    logo: assetUrl(s.company.logoKey),
    employerOwned: true,
    demo: false,
    publishedAt:
      status === "published"
        ? current?.publishedAt || new Date().toISOString()
        : undefined,
    updatedAt: new Date().toISOString(),
  };
}
