import { splitPersonalName } from "./personal-name";
import { type Profile, industries } from "./model";
import {
  skillCatalog,
  canonicalSuggestion,
  normalizeSuggestion,
} from "./suggestion-catalogs";
export type ResumeTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
};
/** Reconstruct physical rows and preserve large gaps between chips/columns. */
export function resumeLayoutText(
  pages: ResumeTextItem[][],
  pageTops?: number[],
): string {
  const firstTop =
    pageTops?.[0] ?? Math.max(0, ...(pages[0] || []).map((i) => i.y));
  const repeatedHeader = new Set(
    (pages[0] || [])
      .filter((i) => i.y >= firstTop - 130)
      .map((i) => i.str.trim()),
  );
  return pages
    .map((items, pageIndex) => {
      const rows: ResumeTextItem[][] = [];
      for (const item of items
        .filter(
          (i) =>
            i.str.trim() &&
            !(
              pageIndex > 0 &&
              pageTops !== undefined &&
              i.y >= pageTops[pageIndex] - 64 &&
              repeatedHeader.has(i.str.trim())
            ),
        )
        .sort((a, b) => b.y - a.y || a.x - b.x)) {
        const row = rows.find(
          (r) =>
            Math.abs(r[0].y - item.y) <
            Math.max(2, Math.min(r[0].fontSize, item.fontSize) * 0.22),
        );
        if (row) row.push(item);
        else rows.push([item]);
      }
      return rows
        .map((row) =>
          row
            .sort((a, b) => a.x - b.x)
            .map((item, i, sorted) => {
              const prev = sorted[i - 1],
                gap = prev ? item.x - prev.x - prev.width : 0;
              return (
                (i
                  ? gap > Math.max(8, item.fontSize * 0.9)
                    ? "\t"
                    : gap < 0.8
                      ? ""
                      : " "
                  : "") + item.str.trim()
              );
            })
            .join(""),
        )
        .join("\n");
    })
    .join("\n");
}
const header =
  /^(?:Образование(?: и курсы)?|Education|Навыки|Профессиональные навыки|Skills|Ключевые навыки|Дополнительная информация|Additional information|Дополнительные сведения|Additional notes|Примечания|Заметки|Notes|Обо мне|О себе|About me|About|Опыт работы.*|Work experience|Work|Желаемая должность и зарплата|Desired position.*|Проекты(?: и достижения)?|Projects?(?: experience)?|Пожелания к работе|Знание языков|Languages|Языки|Ключевые достижения)\s*[:—-]?\s*$/i;
const cleanField = (value: string) =>
  value
    .replace(/\t+/g, " ")
    .replace(/[ \u00a0]+/g, " ")
    .replace(/ +([,.;:)])/g, "$1")
    .replace(/([(-]) +(?=[\p{L}\p{N}])/gu, "$1")
    .trim();
const unique = (values: string[]) => [
  ...new Map(values.map((v) => [normalizeSuggestion(v), v])).values(),
];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function parseResume(text: string): Partial<Profile> {
  const lines = text
    .replace(/\r/g, "")
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/ABOUT(?=[A-Z])/g, "ABOUT\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(
      (x) =>
        x &&
        !/Резюме обновлено|Resume updated|Резюме составлено в|•\s*Резюме\s*обновлено/i.test(
          x,
        ),
    );
  const clean = lines.join("\n");
  const labelled = (name: string) =>
    clean
      .match(new RegExp(`(?:^|\\n)(?:${name})\\s*[:—]\\s*([^\\n]+)`, "i"))?.[1]
      ?.trim();
  const section = (name: RegExp) => {
    const start = lines.findIndex((x) => name.test(x));
    if (start < 0) return "";
    const result: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      if (header.test(lines[i])) break;
      result.push(lines[i]);
    }
    return result.join("\n");
  };
  const labelledBlock = (name: string) => {
    const pattern = new RegExp(`^(?:${name})\\s*[:—]\\s*(.*)$`, "i");
    const start = lines.findIndex((line) => pattern.test(line));
    if (start < 0) return "";
    const values = [lines[start].replace(pattern, "$1")];
    for (let i = start + 1; i < lines.length; i++) {
      if (
        header.test(lines[i]) ||
        /^https?:\/\//i.test(lines[i]) ||
        /^[\p{L} ]{2,35}\s*:\s*/u.test(lines[i])
      )
        break;
      values.push(lines[i]);
    }
    return values.join("\n").trim();
  };
  const sectionBoundary = (line: string) =>
    header.test(line) ||
    /^(?:Образование(?: и курсы)?|Education|Обо мне|О себе|About me|Projects?|Проекты|Языки|Languages|Компания|Должность|Начало|Окончание|Обязанности|Тип занятости|Формат работы)\s*[:—]/i.test(
      line,
    );
  const name =
    labelled("ФИО|Имя и фамилия|Full name|Name") ||
    lines
      .slice(0, 6)
      .map(cleanField)
      .find(
        (x) =>
          /^[А-ЯЁA-Z][а-яёa-z-]+\s+[А-ЯЁA-Z][а-яёa-z-]+(?:\s+[А-ЯЁA-Z][а-яёa-z-]+)?$/.test(
            x,
          ) &&
          !/developer|engineer|designer|university|work experience|test university|synthetic/i.test(
            x,
          ),
      );
  const email = clean.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/)?.[0];
  const phone =
    clean.match(
      /(?:\+7|8)[\s(\-]*\d{3}[\s)\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/,
    )?.[0] || clean.match(/\+\d{1,3}[\s(-]*\d[\d\s()-]{7,20}\d/)?.[0]?.trim();
  const cityRaw = labelled(
    "Проживает|Город(?: проживания)?|Место проживания|Location|Based in|City",
  );
  const inferredCity = lines
    .slice(0, 12)
    .flatMap((line) => line.split(/\t/))
    .find((line) =>
      /^[\p{L} .-]+,\s*(?:Россия|Russia|RU|United Kingdom|UK|United States|USA|Germany)$/iu.test(
        line,
      ),
    );
  const city = (cityRaw || inferredCity)
    ?.split(/[,;\t]/)[0]
    ?.replace(/^г\.\s*/i, "")
    .trim();
  const title =
    labelled("Желаемая должность|Desired position|Headline") ||
    section(/^Желаемая должность и зарплата$|^Desired position.*$/i)
      .split("\n")
      .find((x) => x && !/^\d/.test(x)) ||
    lines
      .slice(0, 10)
      .find((x) =>
        /(?:разработчик|инженер|scientist|engineer|developer|designer|аналитик|тестировщик)/i.test(
          x,
        ),
      );
  const roleSource = cleanField(title || "").replace(
    /\.\s+\d+\s+years?.*$/i,
    "",
  );
  const roles = roleSource ? [roleSource.slice(0, 100)] : [];
  const specialty =
    /\bML\b|машинн|data scien|дата.?сайент|аналитик данных/i.test(roleSource)
      ? "Data"
      : /frontend|фронтенд/i.test(roleSource)
        ? "Frontend"
        : /backend|бэкенд/i.test(roleSource)
          ? "Backend"
          : /тестировщик|\bQA\b/i.test(roleSource)
            ? "QA"
            : undefined;
  const claimed = clean.match(/\b(Junior|Middle|Senior)\b/i)?.[1];
  const grade = claimed
    ? claimed[0].toUpperCase() + claimed.slice(1).toLowerCase()
    : undefined;
  // Explicit chips include unknown technologies; matches elsewhere require word boundaries.
  const skillRows: string[] = [];
  let inSkills = false,
    inLanguages = false;
  for (const line of lines) {
    if (
      /^(?:Навыки|Профессиональные навыки|Ключевые навыки|Skills)(?:\s*[:—]\s*|\t|$)/i.test(
        line,
      )
    ) {
      inSkills = true;
      inLanguages = false;
      const rest = line.replace(
        /^(?:Навыки|Профессиональные навыки|Ключевые навыки|Skills)\s*[:—]?\s*/i,
        "",
      );
      if (rest) skillRows.push(rest);
      continue;
    }
    if (!inSkills) continue;
    if (/^(?:Знание языков|Языки|Languages)(?:\t|\s*[:—]|$)/i.test(line)) {
      inLanguages = true;
      continue;
    }
    if (sectionBoundary(line)) {
      inSkills = false;
      continue;
    }
    if (!inLanguages) skillRows.push(line);
  }
  const explicit = skillRows
    .flatMap((row) => row.split(/\t+|[,;•]|\s{2,}/))
    .map(cleanField)
    .flatMap((value) => {
      if (
        skillCatalog.some((item) =>
          [item.name, ...(item.aliases || [])].some(
            (alias) =>
              normalizeSuggestion(alias) === normalizeSuggestion(value),
          ),
        )
      )
        return [value];
      // A plain text list can have only spaces. Longest known phrases win; retain unknown leftovers.
      const terms = skillCatalog
        .flatMap((item) => [item.name, ...(item.aliases || [])])
        .filter((term) => term.length >= 2)
        .sort((a, b) => b.length - a.length);
      let remaining = value;
      const found: string[] = [];
      for (const term of terms) {
        const re = new RegExp(
          `(?<![\\p{L}\\p{N}_])${escape(term)}(?![\\p{L}\\p{N}_])`,
          "iu",
        );
        if (re.test(remaining)) {
          found.push(term);
          remaining = remaining.replace(re, " ");
        }
      }
      return found.length >= 2
        ? [...found, ...(remaining.trim() ? [remaining.trim()] : [])]
        : [value];
    })
    .filter((v) => v.length >= 1 && v.length <= 100);
  const known = skillCatalog
    .filter((item) =>
      [item.name, ...(item.aliases || [])].some(
        (word) =>
          word.length >= 2 &&
          new RegExp(
            `(?<![\\p{L}\\p{N}_])${escape(word)}(?![\\p{L}\\p{N}_])`,
            "iu",
          ).test(clean),
      ),
    )
    .map((i) => i.name);
  const skills = unique(
    explicit.length
      ? explicit.map((v) => canonicalSuggestion(skillCatalog, v))
      : known,
  ).slice(0, 80);
  const languageLines = lines.filter((x) =>
    /^(?:Русский|Английский|Немецкий|Французский|Испанский|Китайский|Russian|English|German|French|Spanish|Chinese)\s*[—–:-]/i.test(
      x,
    ),
  );
  const languages = unique(
    [
      ...(labelled("Языки|Знание языков|Languages") || "").split(/[,;]/),
      ...languageLines,
      ...lines
        .filter((x) => /^(?:Знание языков|Языки|Languages)\t/i.test(x))
        .map((x) => x.replace(/^[^\t]+\t/, "")),
    ]
      .map(cleanField)
      .filter(Boolean),
  );
  const education =
    labelledBlock("Образование|Education") ||
    section(/^Образование(?: и курсы)?$|^Education$/i);
  const about =
    labelledBlock("Обо мне|О себе|About me|About") ||
    section(/^Обо мне$|^О себе$|^About me$|^About$/i) ||
    section(/^Дополнительная информация$|^Additional information$/i).replace(
      /^(?:Обо мне|About me)\s*\t?\s*/i,
      "",
    );
  const achievementAt = about.search(
    /(?:КЛЮЧЕВЫЕ ДОСТИЖЕНИЯ|KEY ACHIEVEMENTS)\s*:/i,
  );
  const bio = cleanField(
    achievementAt >= 0 ? about.slice(0, achievementAt) : about,
  );
  const notes =
    labelledBlock(
      "Дополнительные сведения|Примечания|Заметки|Additional notes|Notes",
    ) ||
    section(
      /^Дополнительные сведения$|^Примечания$|^Заметки$|^Additional notes$|^Notes$/i,
    );
  const projects =
    section(/^Проекты(?: и достижения)?$|^Projects?(?: experience)?$/i) ||
    (achievementAt >= 0
      ? about.slice(achievementAt).trim()
      : section(/^Ключевые достижения\s*:$/i));
  const employmentRaw = labelled("Тип занятости|Employment type"),
    formatRaw = labelled("Формат работы|Work format");
  const format = formatRaw
    ? /удал[её]н|remote/i.test(formatRaw) && /гибрид|hybrid/i.test(formatRaw)
      ? "Любой"
      : /удал[её]н|remote/i.test(formatRaw)
        ? "Удалённо"
        : /гибрид|hybrid/i.test(formatRaw)
          ? "Гибрид"
          : /месте работодателя|office/i.test(formatRaw)
            ? "Офис"
            : undefined
    : undefined;
  const employment = employmentRaw
    ? /полная|full.time/i.test(employmentRaw)
      ? "Полная занятость"
      : /частичная|part.time/i.test(employmentRaw)
        ? "Частичная занятость"
        : /стажир|intern/i.test(employmentRaw)
          ? "Стажировка"
          : undefined
    : undefined;
  const relocation = /не готов[а]? к переезду|not willing to relocate/i.test(
    clean,
  )
    ? false
    : /готов[а]? к переезду|willing to relocate/i.test(clean)
      ? true
      : undefined;
  const softSkills = [
    "Коммуникация",
    "Работа в команде",
    "Критическое мышление",
    "Самостоятельность",
    "Лидерство",
    "Управление временем",
    "Наставничество",
  ].filter((w) => new RegExp(escape(w), "i").test(clean));
  const englishExperience = clean.match(
    /(\d+(?:[.,]\d+)?)\s+years?\s+(?:of\s+)?experience/i,
  )?.[1];
  const experience =
    clean.match(
      /(?:опыт|стаж)(?:\s+работы)?\s*[:—-]?\s*(\d+(?:[.,]\d+)?)\s*(?:лет|год)/i,
    )?.[1] || englishExperience;
  const links = unique(clean.match(/https?:\/\/[^\s<>)]+/g) || []);
  const statedIndustry = labelled("Отрасль|Индустрия");
  const industry =
    statedIndustry &&
    industries.find((x) =>
      statedIndustry.toLowerCase().includes(x.toLowerCase()),
    );
  const company = labelled("Компания"),
    position = labelled("Должность"),
    start = labelled("Начало"),
    end = labelled("Окончание");
  let workHistory =
    company && position
      ? [
          {
            id: crypto.randomUUID(),
            company,
            role: position,
            start: /^\d{4}-\d{2}$/.test(start || "") ? start! : "",
            end: /^\d{4}-\d{2}$/.test(end || "") ? end! : "",
            current: !!end && /настоящее|сейчас/i.test(end),
            description: labelled("Обязанности") || "",
          },
        ]
      : undefined;
  // Common single-record exports: company + role + month range. Ambiguous records stay in preview for manual correction.
  if (!workHistory) {
    const workLines = section(/^Опыт работы$|^Work experience$|^Work$/i)
      .split("\n")
      .filter(Boolean);
    const rolePattern =
      /developer|engineer|designer|scientist|разработчик|инженер|аналитик|тестировщик|\bQA\b/i;
    const roleAt = workLines.findIndex((line) => rolePattern.test(line));
    const dateAt = workLines.findIndex(
      (line) => /(?:19|20)\d{2}/.test(line) && /[-–—]/.test(line),
    );
    if (roleAt >= 0 && dateAt >= 0 && Math.abs(dateAt - roleAt) <= 2) {
      const parts = workLines[roleAt].split(/\t+/);
      const comma = parts[0].indexOf(",");
      const roleText = comma >= 0 ? parts[0].slice(0, comma) : parts[0];
      const companyText =
        comma >= 0
          ? parts[0].slice(comma + 1).trim()
          : workLines[roleAt === 0 ? 1 : roleAt - 1];
      const months = [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ];
      const ruMonths = [
        "январ",
        "феврал",
        "март",
        "апрел",
        "май",
        "июн",
        "июл",
        "август",
        "сентябр",
        "октябр",
        "ноябр",
        "декабр",
      ];
      const dates = [
        ...workLines[dateAt].matchAll(/([\p{L}]+),?\s+((?:19|20)\d{2})/gu),
      ].map((match) => {
        const token = match[1].toLowerCase();
        const month = months.findIndex((m) => token.startsWith(m));
        const index =
          month >= 0 ? month : ruMonths.findIndex((m) => token.startsWith(m));
        return index >= 0
          ? `${match[2]}-${String(index + 1).padStart(2, "0")}`
          : "";
      });
      if (
        companyText &&
        !rolePattern.test(companyText) &&
        !/(?:19|20)\d{2}/.test(companyText)
      )
        workHistory = [
          {
            id: crypto.randomUUID(),
            company: cleanField(companyText),
            role: cleanField(roleText),
            start: dates[0] || "",
            end: dates[1] || "",
            current: /present|настоящее|сейчас/i.test(workLines[dateAt]),
            description: workLines.slice(dateAt + 1).join("\n"),
          },
        ];
    }
  }
  return {
    ...(name && splitPersonalName(name)),
    ...(email && { email }),
    ...(phone && { phone }),
    ...(city && { city }),
    ...(roles.length && { roles, headline: roleSource }),
    ...(specialty && { specialty }),
    ...(grade && { claimed: grade }),
    ...(skills.length && { skills }),
    ...(softSkills.length && { softSkills }),
    ...(languages.length && { languages }),
    ...(education && {
      education: cleanField(education).replace(
        /^Неоконченное высшее\n(\d{4})\n([\s\S]*)/,
        (_, year, rest) =>
          `Неоконченное высшее · ${year}\n${rest.replace(/(?:^|\n)Неоконченное\n/g, "\n").replace(/(?:^|\n)высшее(?=\n|$)/g, "")}`,
      ),
    }),
    ...(bio && { bio }),
    ...(notes && { notes }),
    ...(projects && { projects: projects.replace(/\t/g, " ") }),
    ...(employment && { employment }),
    ...(format && { format }),
    ...(relocation !== undefined && { relocation }),
    ...(links.length && { links }),
    ...(industry && { industry }),
    ...(experience !== undefined && {
      experience: Number(experience.replace(",", ".")),
    }),
    ...(workHistory && { workHistory }),
  };
}
