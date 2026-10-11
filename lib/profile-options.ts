import type { Profile } from "./model";
import type { Suggestion } from "./suggestion-catalogs";
const catalog = (group: string, names: string[]): Suggestion[] =>
  names.map((name) => ({ name, group }));
export const professionalDirections = catalog("Направление в IT", [
  "Backend-разработка",
  "Frontend-разработка",
  "Fullstack-разработка",
  "Мобильная разработка",
  "Разработка игр",
  "Встраиваемые системы и IoT",
  "Разработка на 1С",
  "Desktop-разработка",
  "Системное программирование",
  "Машинное обучение и AI",
  "Data Science",
  "Data Engineering",
  "Аналитика данных",
  "BI-аналитика",
  "Системная аналитика",
  "Бизнес-аналитика",
  "Ручное тестирование",
  "Автоматизация тестирования",
  "Тестирование производительности",
  "DevOps",
  "SRE",
  "Облачная инфраструктура",
  "Системное администрирование",
  "Сетевые технологии",
  "Администрирование баз данных",
  "Информационная безопасность",
  "UX/UI-дизайн",
  "Продуктовый дизайн",
  "UX-исследования",
  "Техническая документация",
  "Управление продуктом",
  "Управление проектами",
  "Техническое руководство",
  "Архитектура ПО",
  "Техническая поддержка",
  "Внедрение корпоративных систем",
]);
const directionLabels: Record<string, string> = {
  Backend: "Backend-разработка",
  Frontend: "Frontend-разработка",
  Data: "Машинное обучение и AI",
  QA: "Тестирование",
};
export const professionalDirection = (
  p: Pick<Profile, "professionalDirection" | "specialty">,
) => p.professionalDirection ?? directionLabels[p.specialty] ?? p.specialty;
export const softSkillCatalog = catalog("Гибкие навыки", [
  "Коммуникация",
  "Работа в команде",
  "Критическое мышление",
  "Аналитическое мышление",
  "Решение проблем",
  "Самостоятельность",
  "Ответственность",
  "Управление временем",
  "Приоритизация задач",
  "Адаптивность",
  "Внимание к деталям",
  "Инициативность",
  "Обратная связь",
  "Активное слушание",
  "Аргументация решений",
  "Переговоры",
  "Презентация результатов",
  "Публичные выступления",
  "Эмпатия",
  "Разрешение конфликтов",
  "Лидерство",
  "Наставничество",
  "Делегирование",
  "Организация работы команды",
  "Работа с неопределённостью",
  "Обучаемость",
  "Креативность",
  "Системное мышление",
  "Продуктовое мышление",
  "Ориентация на пользователя",
  "Деловая переписка",
  "Межкультурная коммуникация",
  "Работа в распределённой команде",
  "Устойчивость к стрессу",
]);
export const languageCatalog = catalog("Языки", [
  "Русский",
  "Английский",
  "Немецкий",
  "Французский",
  "Испанский",
  "Итальянский",
  "Китайский",
  "Японский",
  "Корейский",
  "Турецкий",
  "Арабский",
  "Португальский",
  "Польский",
  "Чешский",
  "Нидерландский",
  "Шведский",
  "Норвежский",
  "Финский",
  "Греческий",
  "Иврит",
  "Хинди",
  "Украинский",
  "Белорусский",
  "Казахский",
  "Узбекский",
  "Армянский",
  "Грузинский",
  "Азербайджанский",
  "Татарский",
]);
export const languageLevels = [
  "Родной",
  "A1 — Начальный",
  "A2 — Базовый",
  "B1 — Средний",
  "B2 — Выше среднего",
  "C1 — Продвинутый",
  "C2 — Свободный",
];
export function splitLanguage(value: string) {
  const [language, ...rest] = value.split(/\s+[—–-]\s+/);
  const code = rest.join(" — ").trim();
  return {
    language: language.trim(),
    level:
      languageLevels.find(
        (level) =>
          level === code || (code && level.startsWith(code.split(" ")[0])),
      ) || code,
  };
}
export const formatOptions = ["Удалённо", "Гибрид", "Офис", "Любой"];
export const employmentOptions = [
  "Полная занятость",
  "Частичная занятость",
  "Проектная работа",
  "Стажировка",
];
export const profileGrades = ["Intern", "Junior", "Middle", "Senior", "Lead"];
export const availabilityOptions = [
  "Сразу",
  "В течение двух недель",
  "В течение месяца",
  "Обсудим индивидуально",
];
export function withWorkPreferences<
  T extends Pick<
    Profile,
    | "format"
    | "employment"
    | "formats"
    | "employmentTypes"
    | "availability"
    | "availabilities"
  >,
>(p: T): T {
  const values = (list: string[] | undefined, legacy: string) =>
    Array.isArray(list) && list.join(" · ") === legacy
      ? list
      : legacy
          .split(" · ")
          .map((v) => v.trim())
          .filter(Boolean);
  return {
    ...p,
    formats: values(p.formats, p.format),
    employmentTypes: values(p.employmentTypes, p.employment),
    availabilities: values(p.availabilities, p.availability),
  };
}
export function editWorkPreference<T extends Profile>(
  p: T,
  key: keyof Profile,
  value: unknown,
): T {
  if (key === "formats") {
    const items = value as string[];
    const formats =
      items.at(-1) === "Любой" ? ["Любой"] : items.filter((v) => v !== "Любой");
    return { ...p, formats, format: formats.join(" · ") };
  }
  if (key === "employmentTypes") {
    const employmentTypes = value as string[];
    return { ...p, employmentTypes, employment: employmentTypes.join(" · ") };
  }
  if (key === "availabilities") {
    const availabilities = value as string[];
    return { ...p, availabilities, availability: availabilities.join(" · ") };
  }
  return p;
}
