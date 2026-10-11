// Public track labels only; generator/rubrics never belong in the browser.
export const assessmentTracks = [
  { id: "backend", name: "Backend" },
  { id: "frontend", name: "Frontend" },
  { id: "devops-sre", name: "DevOps / SRE" },
  { id: "qa-automation", name: "QA / QA Automation" },
  { id: "data-engineering", name: "Data Engineering" },
  { id: "ml-engineer", name: "ML Engineer" },
  { id: "data-scientist", name: "Data Scientist / Applied ML" },
  { id: "mlops", name: "MLOps / ML Platform Engineer" },
  { id: "genai", name: "GenAI / LLM Engineer" },
  { id: "android", name: "Android" },
  { id: "ios", name: "iOS" },
  { id: "security-appsec", name: "Security Engineering / AppSec" },
];
export function assessmentTrackId(name: string) {
  return (
    assessmentTracks.find((t) => t.name === name)?.id ||
    (
      {
        QA: "qa-automation",
        Data: "data-engineering",
        "Data Scientist": "data-scientist",
        MLOps: "mlops",
        GenAI: "genai",
      } as Record<string, string>
    )[name] ||
    "backend"
  );
}

export const assessmentProfileSpecialties = [
  ...assessmentTracks.map((t) => t.name),
  "QA",
  "Data Scientist",
  "MLOps",
  "GenAI",
];

/** Stable public taxonomy shared by all product flows; aliases read legacy data. */
export function specialtyId(value: string): string | null {
  const v = value.trim().toLowerCase();
  const direct = assessmentTracks.find(t => t.id === v || t.name.toLowerCase() === v);
  if (direct) return direct.id;
  return ({qa: "qa-automation", data: "data-engineering", "data scientist": "data-scientist", mlops: "mlops", genai: "genai"} as Record<string,string>)[v] || null;
}
export function specialtyName(value: string) {
  return assessmentTracks.find(t => t.id === specialtyId(value))?.name || value;
}
export function sameSpecialty(a: string, b: string) {
  return (specialtyId(a) || a) === (specialtyId(b) || b);
}
export function recommendSpecialties(description: string, skills: string[] = []) {
  const text = [description, ...skills].join(" ").toLowerCase();
  const signals: Record<string, RegExp> = {
    backend: /backend|бэкенд|бэкен|сервер|fastapi|django|api|java|golang/,
    frontend: /frontend|фронтенд|react|vue|angular|интерфейс|css/,
    "devops-sre": /devops|sre|kubernetes|terraform|инфраструктур|ci\/cd/,
    "qa-automation": /qa|тестирован|pytest|selenium|playwright/,
    "data-engineering": /хранилищ|пайплайн|airflow|etl|spark|data engineer/,
    "ml-engineer": /ml engineer|pytorch|обучени.*модел|машинн.*обучени/,
    "data-scientist": /data scien|статистик|эксперимент|анализ данных/,
    mlops: /mlops|mlflow|доставк.*модел|мониторинг.*модел/,
    genai: /llm|genai|rag|генератив/,
    android: /android|kotlin/, ios: /ios|swift/,
    "security-appsec": /security|appsec|безопасност|уязвимост/,
  };
  return assessmentTracks.filter(t => signals[t.id]?.test(text)).slice(0, 3);
}
