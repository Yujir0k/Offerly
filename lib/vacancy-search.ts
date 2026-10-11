import type { Job, Profile } from "./model";
import { canonicalSuggestion, skillCatalog } from "./suggestion-catalogs";

export type VacancyFilters = {
  query: string;
  specialty: string;
  grade: string;
  skills: string[];
  industries: string[];
  salaryMin: string;
  salaryMax: string;
  location: string;
  employment: string;
  format: string;
  experience: string;
  company: string;
  companies: string[];
  excludeCompany: boolean;
  sort: string;
  favoritesOnly: boolean;
  page: number;
};
export const emptyVacancyFilters: VacancyFilters = {
  query: "",
  specialty: "",
  grade: "",
  skills: [],
  industries: [],
  salaryMin: "",
  salaryMax: "",
  location: "",
  employment: "",
  format: "",
  experience: "",
  company: "",
  companies: [],
  excludeCompany: false,
  sort: "match",
  favoritesOnly: false,
  page: 1,
};
export const vacancyText = (value: string) =>
  value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim();
const skillKey = (value: string) =>
  vacancyText(canonicalSuggestion(skillCatalog, value));
export function vacancyMatch(job: Job, profile: Profile) {
  const verified = new Set(profile.verified.map(skillKey));
  const matched = job.skills.filter((skill) => verified.has(skillKey(skill)));
  const sameSpecialty = profile.specialty === job.specialty;
  const sameGrade = Boolean(profile.grade && profile.grade === job.grade);
  return {
    matched,
    sameSpecialty,
    sameGrade,
    score:
      (sameSpecialty ? 40 : 0) +
      (sameGrade ? 20 : 0) +
      (job.skills.length ? (matched.length / job.skills.length) * 40 : 0),
  };
}
export function vacancySalaryError(
  filters: Pick<VacancyFilters, "salaryMin" | "salaryMax">,
) {
  for (const value of [filters.salaryMin, filters.salaryMax]) {
    if (value !== "" && (!/^\d+$/.test(value) || Number(value) > 10000000))
      return "Укажите сумму от 0 до 10 000 000 ₽";
  }
  if (
    filters.salaryMin &&
    filters.salaryMax &&
    Number(filters.salaryMin) > Number(filters.salaryMax)
  )
    return "Сумма «до» должна быть не меньше суммы «от»";
  return "";
}
export function searchVacancies(
  jobs: Job[],
  filters: VacancyFilters,
  profile: Profile,
  favorites: string[],
  includeArchived = false,
  includeDraft = false,
) {
  const terms = vacancyText(filters.query).split(/\s+/).filter(Boolean);
  const salaryValid = !vacancySalaryError(filters);
  const selectedSkills = (filters.skills || []).map(skillKey);
  const rows = jobs.filter((job) => {
    if (
      (job.status === "draft" && !includeDraft) ||
      (job.status === "archived" && !includeArchived)
    )
      return false;
    const text = vacancyText(
      [
        job.title,
        job.company,
        job.description,
        job.city,
        job.specialty,
        ...job.skills,
      ].join(" "),
    );
    if (!terms.every((term) => text.includes(term))) return false;
    if (filters.specialty && job.specialty !== filters.specialty) return false;
    if (
      filters.industries?.length &&
      !filters.industries.includes(job.industry || "")
    )
      return false;
    if (filters.grade && job.grade !== filters.grade) return false;
    if (
      selectedSkills.length &&
      !selectedSkills.every((skill) =>
        job.skills.some((value) => skillKey(value) === skill),
      )
    )
      return false;
    if (salaryValid && filters.salaryMin && job.max < Number(filters.salaryMin))
      return false;
    if (salaryValid && filters.salaryMax && job.min > Number(filters.salaryMax))
      return false;
    if (
      filters.location &&
      !vacancyText(`${job.city || ""} ${job.region || ""}`).includes(
        vacancyText(filters.location),
      )
    )
      return false;
    if (filters.employment && job.employment !== filters.employment)
      return false;
    if (filters.format && job.format !== filters.format) return false;
    if (filters.experience === "none" && Number(job.experienceMin || 0) > 0)
      return false;
    if (
      filters.experience === "1-3" &&
      (Number(job.experienceMin || 0) > 3 ||
        Number(job.experienceMax ?? Infinity) < 1)
    )
      return false;
    if (
      filters.experience === "3-6" &&
      (Number(job.experienceMin || 0) > 6 ||
        Number(job.experienceMax ?? Infinity) < 3)
    )
      return false;
    if (
      filters.experience === "6+" &&
      Number(job.experienceMax ?? Infinity) < 6
    )
      return false;
    const companies = filters.companies?.length
      ? filters.companies
      : filters.company
        ? [filters.company]
        : [];
    if (companies.length) {
      const same = companies.some(
        (company) => vacancyText(job.company) === vacancyText(company),
      );
      if (filters.excludeCompany ? same : !same) return false;
    }
    return !filters.favoritesOnly || favorites.includes(job.id);
  });
  return rows.sort((a, b) => {
    const dateOrder =
      Date.parse(b.publishedAt || "1970-01-01") -
      Date.parse(a.publishedAt || "1970-01-01");
    if (filters.sort === "salary-desc")
      return b.max - a.max || dateOrder || a.id.localeCompare(b.id);
    if (filters.sort === "salary-asc")
      return a.min - b.min || dateOrder || a.id.localeCompare(b.id);
    if (filters.sort === "date") return dateOrder || a.id.localeCompare(b.id);
    return (
      vacancyMatch(b, profile).score - vacancyMatch(a, profile).score ||
      dateOrder ||
      a.id.localeCompare(b.id)
    );
  });
}
export function vacancyExperience(job: Job) {
  if (!job.experienceMin) return "Без опыта";
  return job.experienceMax
    ? `${job.experienceMin}–${job.experienceMax} лет опыта`
    : `От ${job.experienceMin} лет опыта`;
}
export function vacancyDate(job: Job) {
  return job.publishedAt
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
      }).format(new Date(job.publishedAt))
    : "Новая вакансия";
}
export function vacancyCount(count: number) {
  const mod = count % 100,
    last = count % 10;
  return `${count} ${mod >= 11 && mod <= 14 ? "вакансий" : last === 1 ? "вакансия" : last >= 2 && last <= 4 ? "вакансии" : "вакансий"}`;
}
