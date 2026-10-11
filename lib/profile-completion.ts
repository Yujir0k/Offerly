import type { Profile } from "./model";
import { phoneError } from "./phone";
import { salaryRangeError } from "./salary-range";
export function profileCompletion(profile: Profile) {
  const required = [
    {
      key: "name",
      label: "Имя и фамилия",
      done: profile.name.trim().length >= 2,
    },
    {
      key: "email",
      label: "Электронная почта",
      done: /^\S+@\S+\.\S+$/.test(profile.email),
    },
    {
      key: "skills",
      label: "Технологии",
      done: profile.skills.some((value) => value.trim()),
    },
    {
      key: "roles",
      label: "Профессия или роль",
      done: profile.roles.some((value) => value.trim()),
    },
    { key: "city", label: "Город", done: !!profile.city.trim() },
    {
      key: "salary",
      label: "Зарплатные ожидания",
      done: !salaryRangeError(profile.salaryMin, profile.salaryMax),
    },
    {
      key: "consent",
      label: "Согласие на участие в подборе",
      done: profile.consent,
    },
  ];
  const optional = [
    phoneError(profile.phone) ? "" : profile.phone,
    profile.bio,
    profile.education,
    profile.projects,
    profile.languages.filter(Boolean).join(),
    profile.links.filter(Boolean).join(),
  ];
  const completed = required.filter((field) => field.done).length;
  const optionalFields = [
    {
      key: "phone",
      label: "Телефон",
      done: !!profile.phone.trim() && !phoneError(profile.phone),
    },
    { key: "bio", label: "О себе", done: !!profile.bio.trim() },
    {
      key: "education",
      label: "Образование",
      done: !!profile.education.trim(),
    },
    { key: "projects", label: "Проекты", done: !!profile.projects.trim() },
    {
      key: "languages",
      label: "Языки",
      done: profile.languages.some((v) => !!v.trim()),
    },
    {
      key: "links",
      label: "Ссылки и портфолио",
      done: profile.links.some((v) => !!v.trim()),
    },
  ];
  return {
    required,
    completed,
    optionalFields,
    ready: completed === required.length,
    percent: Math.round(
      ((completed + optional.filter((value) => value.trim()).length) /
        (required.length + optional.length)) *
        100,
    ),
  };
}
