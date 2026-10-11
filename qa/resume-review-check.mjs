import { readFile, writeFile } from "node:fs/promises";
import { jsPDF } from "jspdf";
const pdf = new jsPDF();
pdf.addFileToVFS(
  "JetBrains.ttf",
  (await readFile("public/fonts/JetBrainsMono-Regular.ttf")).toString("base64"),
);
pdf.addFont("JetBrains.ttf", "JetBrains", "normal");
pdf.setFont("JetBrains");
pdf.setFontSize(11);
pdf.text(
  [
    "ФИО: Тестовый Кандидат",
    "Backend-разработчик · Middle",
    "Опыт: 3 года",
    "review@example.test",
    "+7 000 000-00-42",
    "Python, SQL, FastAPI",
    "Работа в команде, коммуникация, наставничество",
    "Языки: Русский, Английский B2",
    "Образование: Учебный университет",
    "https://example.test/portfolio",
    "Компания: Учебная команда",
    "Должность: Backend-разработчик",
    "Начало: 2024-01",
    "Окончание: сейчас",
    "Обязанности: API и транзакции",
  ],
  15,
  20,
);
const bytes = new Uint8Array(pdf.output("arraybuffer"));
await writeFile("qa/fixtures/resume-review-fixture.pdf", bytes);
const base = "http://127.0.0.1:5173";
const login = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const form = new FormData();
form.set(
  "file",
  new File([bytes], "resume-review-fixture.pdf", { type: "application/pdf" }),
);
const response = await fetch(base + "/api/resume", {
  method: "POST",
  headers: { Cookie: cookie, Origin: base },
  body: form,
});
const data = await response.json();
if (!response.ok) throw Error(JSON.stringify(data));
const p = data.parsed;
const checks = {
  name: p.name === "Тестовый Кандидат",
  contacts: p.email === "review@example.test" && p.phone.includes("000"),
  grade: p.claimed === "Middle",
  role: p.roles.includes("Разработчик"),
  experience: p.experience === 3,
  skills: p.skills.includes("FastAPI"),
  softSkills: p.softSkills.includes("Наставничество"),
  education: p.education === "Учебный университет",
  languages: p.languages.includes("Английский B2"),
  links: p.links[0] === "https://example.test/portfolio",
  work:
    p.workHistory[0].current && p.workHistory[0].company === "Учебная команда",
  noConfirmedGrade: !p.grade,
  reviewWarnings: data.warnings.length > 0,
  noEducationAsIndustry: !p.industry,
};
if (Object.values(checks).some((v) => !v))
  throw Error(JSON.stringify({ checks, data }));
await writeFile(
  "qa/results/latest/resume-review-results.json",
  JSON.stringify({ passed: Object.keys(checks).length, checks }, null, 2),
);
console.log(
  JSON.stringify({ passed: Object.keys(checks).length, checks }, null, 2),
);
