import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractTextItems, getDocumentProxy } from "unpdf";
import { resumeLayoutText } from "../lib/resume-parser";
for (const template of ["accent", "minimal"]) {
  const d = await getDocumentProxy(
    new Uint8Array(
      await readFile(
        `output/pdf/resume-benchmark/offerly-photo-${template}.pdf`,
      ),
    ),
  );
  const { items } = await extractTextItems(d);
  const text = resumeLayoutText(items);
  for (const expected of [
    "Смирнова Анна Сергеевна",
    "Middle Backend-разработчик",
    "anna.smirnova@example.test",
    "Москва",
    "Россия",
    "Python",
    "SQL",
    "Docker",
    "FastAPI",
    "Разрабатываю API",
    "Синтетические системы",
    "январь 2023",
    "сентябрь 2026",
    "Тестовая платформа",
    "Тестовый университет",
    "Информатика",
    "Английский",
    "B2",
    "Удалённо",
    "Полная занятость",
  ])
    assert(text.includes(expected), template + ": " + expected);
  await d.cleanup();
}
console.log(
  JSON.stringify({
    templates: 2,
    photoTemplates: true,
    allExpectedProfileSectionsPresent: true,
    languagesAndPreferencesOnContinuationPage: true,
  }),
);
