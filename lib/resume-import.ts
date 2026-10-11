import type { Profile, State } from "./model";
import type { ResumePhoto } from "./resume-photo";
export const resumeFieldLabels: Record<string, string> = {
  name: "ФИО",
  email: "Почта",
  phone: "Телефон",
  city: "Город проживания",
  country: "Страна проживания",
  region: "Регион",
  headline: "Профессиональный заголовок",
  roles: "Профессия и роли",
  specialty: "Специализация",
  skills: "Навыки и технологии",
  claimed: "Предполагаемый грейд",
  softSkills: "Софт-скиллы",
  experience: "Стаж, лет",
  education: "Образование",
  languages: "Языки",
  bio: "О себе",
  projects: "Проекты и достижения",
  notes: "Дополнительные сведения",
  links: "Ссылки",
  workHistory: "Места работы",
  industry: "Отрасль",
  employment: "Занятость",
  format: "Формат работы",
  relocation: "Готовность к переезду",
};
export function resumeFieldText(value: unknown): string {
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value))
    return value
      .map((item) =>
        typeof item === "object" && item
          ? `${item.company} · ${item.role}\n${item.description || ""}`
          : String(item),
      )
      .join(" · ");
  return String(value ?? "");
}
export function photoPreview(photo: ResumePhoto): string {
  const raw = atob(photo.pixels),
    canvas = document.createElement("canvas");
  canvas.width = photo.width;
  canvas.height = photo.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось подготовить фото");
  const rgba = new Uint8ClampedArray(photo.width * photo.height * 4);
  for (let i = 0; i < photo.width * photo.height; i++) {
    rgba[i * 4] = raw.charCodeAt(i * photo.channels);
    rgba[i * 4 + 1] = raw.charCodeAt(
      i * photo.channels + (photo.channels === 1 ? 0 : 1),
    );
    rgba[i * 4 + 2] = raw.charCodeAt(
      i * photo.channels + (photo.channels === 1 ? 0 : 2),
    );
    rgba[i * 4 + 3] = photo.channels === 4 ? raw.charCodeAt(i * 4 + 3) : 255;
  }
  ctx.putImageData(new ImageData(rgba, photo.width, photo.height), 0, 0);
  return canvas.toDataURL("image/png");
}
export async function importResumePhoto(preview: string): Promise<State> {
  // The preview is a locally generated PNG. Decode it directly: fetching a data URL
  // would needlessly require connect-src data: in the site's security policy.
  const encoded = preview.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)?.[1];
  if (!encoded || encoded.length > 8 * 1024 * 1024) throw new Error("Не удалось подготовить фото");
  const raw = atob(encoded), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const blob = new Blob([bytes], {type: "image/png"}), form = new FormData();
  form.set("file", blob, "resume-photo.png");
  const response = await fetch("/api/avatar", { method: "POST", body: form });
  const state = (await response.json()) as State & { error?: string };
  if (!response.ok) throw new Error(state.error || "Не удалось перенести фото");
  return state;
}
export type ResumeImportResponse = {
  error?: string;
  filename: string;
  parsed: Partial<Profile>;
  photos?: ResumePhoto[];
  warnings?: string[];
};
