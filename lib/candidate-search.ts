import { sameSpecialty } from "./assessment-tracks";
import type { Profile, Need } from "./model";
import { rank } from "./model";
import { canonicalSuggestion, skillCatalog } from "./suggestion-catalogs";
export type CandidateFilters = {
  spec: string;
  grade: string;
  query: string;
  stack?: string;
  skills?: string[];
  skillSource?: "declared" | "verified" | "profile" | "any";
  location?: string;
  formats?: string[];
  salaryMin?: string;
  salaryMax?: string;
  experienceMin?: string;
  experienceMax?: string;
  fsp: boolean;
  savedOnly: boolean;
  sort: string;
};
const key = (v: string) =>
  canonicalSuggestion(skillCatalog, v).trim().toLowerCase().replace(/ё/g, "е");
export function candidateFilterError(f: { salaryMin?: string; salaryMax?: string; experienceMin?: string; experienceMax?: string; [key: string]: unknown }) {
  for (const [min, max, limit, label] of [
    [f.salaryMin, f.salaryMax, 10000000, "зарплату"],
    [f.experienceMin, f.experienceMax, 50, "опыт"],
  ] as const) {
    if (
      [min, max].some(
        (v) =>
          v &&
          (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > limit),
      )
    )
      return `Укажите ${label} от 0 до ${limit.toLocaleString("ru-RU")}.`;
    if (min && max && Number(min) > Number(max))
      return "Значение «до» должно быть не меньше значения «от».";
  }
  return "";
}
export function searchCandidates(
  profiles: Profile[],
  f: CandidateFilters,
  saved: number[],
  need: Need,
) {
  const selected = (
    f.skills?.length
      ? f.skills
      : f.stack
          ?.split(",")
          .map((v) => v.trim())
          .filter(Boolean) || []
  ).map(key);
  const error = candidateFilterError(f);
  const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return profiles
    .filter((p) => {
      if (f.spec && f.spec !== "Все" && !sameSpecialty(p.specialty, f.spec)) return false;
      if (f.grade && f.grade !== "Все" && p.grade !== f.grade) return false;
      if (f.fsp && !(p.fsp && p.achievements.length)) return false;
      if (f.savedOnly && !saved.includes(p.id)) return false;
      if (selected.some((skill) => !(f.skillSource === "verified" ? p.verified : [...p.skills, ...p.verified]).some((v) => key(v) === skill)))
        return false;
      const locations = [p.city, p.region, ...p.preferredLocations]
        .join(" ")
        .toLowerCase();
      if (f.location && !locations.includes(f.location.toLowerCase()))
        return false;
      if (
        f.formats?.length &&
        !p.formats?.includes("Любой") &&
        !f.formats.some((v) =>
          (p.formats?.length ? p.formats : [p.format]).includes(v),
        )
      )
        return false;
      if (!error) {
        if (f.salaryMin && p.salaryMax < Number(f.salaryMin)) return false;
        if (f.salaryMax && p.salaryMin > Number(f.salaryMax)) return false;
        if (f.experienceMin && p.experience < Number(f.experienceMin))
          return false;
        if (f.experienceMax && p.experience > Number(f.experienceMax))
          return false;
      }
      return terms.every((term) =>
        `${p.id} ${p.specialty} ${p.headline || ""} ${p.roles.join(" ")} ${p.skills.join(" ")} ${p.verified.join(" ")} ${p.city}`
          .toLowerCase()
          .includes(term),
      );
    })
    .sort((a, b) =>
      f.sort === "По результату теста"
        ? b.score - a.score || a.id - b.id
        : rank(b, need).score - rank(a, need).score || a.id - b.id,
    );
}
