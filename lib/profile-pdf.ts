import { professionalDirection } from "@/lib/profile-options";
import type { Profile } from "./model";

export type ResumeTemplate = "accent" | "minimal";
type PdfAssets = {
  regular: string;
  bold: string;
  logo?: string;
  photo?: string;
};
const purple = "#402FFF",
  ink = "#1B1C21",
  muted = "#666473";
function base64(bytes: Uint8Array) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
async function raster(source: string): Promise<string> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, 512, 512);
  return canvas.toDataURL("image/png");
}
export async function loadPdfAssets(p: Profile): Promise<PdfAssets> {
  const fonts = await Promise.all(
    ["Regular", "Bold"].map(async (weight) => {
      const response = await fetch(`/fonts/Manrope-${weight}.ttf`);
      if (!response.ok) throw new Error("Не удалось загрузить шрифт резюме");
      return base64(new Uint8Array(await response.arrayBuffer()));
    }),
  );
  const logo = await raster("/brand/original.svg").catch(() => undefined);
  const photo = p.avatarKey
    ? await raster(
        `/api/avatar?v=${encodeURIComponent(p.avatarKey.split("/").pop()!)}`,
      ).catch(() => undefined)
    : undefined;
  return { regular: fonts[0], bold: fonts[1], logo, photo };
}
/** Selectable text, semantic blocks and measured page breaks on both templates. */
export async function createProfilePdf(
  p: Profile,
  template: ResumeTemplate,
  assets: PdfAssets,
) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  for (const [weight, data] of [
    ["normal", assets.regular],
    ["bold", assets.bold],
  ]) {
    pdf.addFileToVFS(`Manrope-${weight}.ttf`, data);
    pdf.addFont(`Manrope-${weight}.ttf`, "Manrope", weight);
  }
  pdf.setProperties({
    title: `${p.name || "Кандидат"} - резюме Офферли`,
    author: p.name,
    creator: "Офферли",
  });
  const accent = template === "accent",
    left = 17,
    width = 176,
    bottom = 277;
  let y = 20;
  const clean = (s: string) => s.replace(/[–—‑]/g, "-").replace(/\u0000/g, "");
  const font = (size = 10.2, bold = false, color = ink) => {
    pdf.setFont("Manrope", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(color);
  };
  const lines = (value: string, w = width, size = 10.2, bold = false) => {
    font(size, bold);
    return pdf.splitTextToSize(clean(value), w) as string[];
  };
  function brand(top: number, dark = false) {
    if (assets.logo) pdf.addImage(assets.logo, "PNG", left, top, 8, 8);
    font(12, true, dark ? "#FFFFFF" : ink);
    pdf.text("Офферли", assets.logo ? 29 : left, top + 4);
    font(7, false, dark ? "#CFC6E6" : muted);
    pdf.text("Дело найдёт.", assets.logo ? 29 : left, top + 8);
  }
  function newPage() {
    pdf.addPage();
    pdf.setFillColor(purple);
    pdf.rect(0, 0, 210, 2, "F");
    brand(10);
    font(8, false, muted);
    pdf.text(lines(p.name, 110, 8)[0] || "", 193, 17, { align: "right" });
    y = 34;
  }
  function ensure(h: number) {
    if (y + h > bottom) newPage();
  }
  function text(
    value: string,
    size = 10.2,
    bold = false,
    color = ink,
    gap = 3,
    x = left,
    w = width,
  ) {
    const rows = lines(value, w, size, bold),
      lh = size * 0.3528 * 1.45;
    for (const row of rows) {
      ensure(lh);
      font(size, bold, color);
      pdf.text(row, x, y);
      y += lh;
    }
    y += gap;
  }
  function section(title: string, reserve = 20) {
    ensure(22 + reserve);
    y += 4;
    pdf.setFillColor("#F1EEFF");
    pdf.roundedRect(left, y - 4, width, 10, 2, 2, "F");
    pdf.setFillColor(purple);
    pdf.roundedRect(left, y - 4, 1.2, 10, 0.6, 0.6, "F");
    font(13, true, ink);
    pdf.text(title, left + 4, y + 2);
    y += 15;
  }
  function chips(values: string[], light = false) {
    const size = 8.5,
      lineHeight = 3.9,
      padding = 3.2;
    let x = left,
      rowH = 7.5;
    for (const value of values.filter((v) => v.trim())) {
      const rows = lines(value, width - padding * 2, size, true);
      font(size, true);
      const chipW = Math.min(
        width,
        Math.max(...rows.map((row) => pdf.getTextWidth(row))) + padding * 2,
      );
      const h = Math.max(7.5, rows.length * lineHeight + 3.6);
      if (x + chipW > left + width + 0.01) {
        y += rowH + 2;
        x = left;
        rowH = 7.5;
      }
      if (y + h > bottom) {
        newPage();
        x = left;
        rowH = 7.5;
      }
      const top = y - 3;
      pdf.setFillColor(light ? "#F1F0F4" : "#E9E3FF");
      pdf.roundedRect(x, top, chipW, h, 1.8, 1.8, "F");
      rows.forEach((row, i) => {
        font(size, true, light ? ink : "#35256E");
        pdf.text(
          row,
          x + chipW / 2,
          top + h / 2 + (i - (rows.length - 1) / 2) * lineHeight,
          { align: "center", baseline: "middle" },
        );
      });
      x += chipW + 2;
      rowH = Math.max(rowH, h);
    }
    y += rowH + 4;
  }
  // PDF text lines often reflect wrapping, not paragraphs. Join wraps but keep actual bullets and blank lines.
  function paragraphs(value: string) {
    const records: string[][] = [];
    let current: string[] = [];
    for (const row of value.replace(/\r/g, "").split("\n")) {
      if (!row.trim()) {
        if (current.length) records.push(current);
        current = [];
        continue;
      }
      if (/^\s*[•●▪*-]\s/.test(row) && current.length) {
        records.push(current);
        current = [];
      }
      current.push(row.trim());
    }
    if (current.length) records.push(current);
    return records;
  }
  function narrative(value: string, records = false) {
    for (const rows of paragraphs(value)) {
      if (records || /^\s*[•●▪*-]\s/.test(rows[0])) {
        const title = rows[0].replace(/^\s*[•●▪*-]\s*/, "");
        const titleH = lines(title, width - 5, 10.5, true).length * 5.4;
        const detailH =
          rows.length > 1
            ? lines(rows.slice(1).join(" "), width - 5).length * 5.3
            : 0;
        ensure(Math.min(90, titleH + detailH + 10));
        pdf.setFillColor(purple);
        pdf.circle(left + 1, y - 1, 1, "F");
        text(title, 10.5, true, ink, 2, left + 5, width - 5);
        if (rows.length > 1)
          text(
            rows.slice(1).join(" "),
            10.2,
            false,
            ink,
            4,
            left + 5,
            width - 5,
          );
      } else {
        const sentences = rows
          .join(" ")
          .match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [rows.join(" ")];
        let paragraph = "";
        for (const sentence of sentences) {
          if (paragraph.length > 300) {
            text(paragraph.trim(), 10.2, false, ink, 4);
            paragraph = "";
          }
          paragraph += sentence;
        }
        if (paragraph) text(paragraph.trim(), 10.2, false, ink, 4);
      }
    }
  }
  const headingW = assets.photo ? 133 : width;
  const nameRows = lines(p.name || "Ваше имя", headingW, 23, true);
  const role = p.headline || p.roles.join(" · ") || professionalDirection(p);
  const roleRows = lines(role, headingW, 12, true);
  const headerH = Math.max(
    68,
    31 + nameRows.length * 10 + roleRows.length * 6 + 8,
  );
  if (accent) {
    pdf.setFillColor(ink);
    pdf.rect(0, 0, 210, headerH, "F");
    pdf.setFillColor(purple);
    pdf.rect(0, headerH - 2, 210, 2, "F");
  } else {
    pdf.setFillColor(purple);
    pdf.rect(0, 0, 210, 2, "F");
  }
  brand(11, accent);
  y = 35;
  for (const row of nameRows) {
    font(23, true, accent ? "#FFFFFF" : ink);
    pdf.text(row, left, y);
    y += 10;
  }
  for (const row of roleRows) {
    font(12, true, accent ? "#C9BCFF" : purple);
    pdf.text(row, left, y);
    y += 6;
  }
  font(8.5, false, accent ? "#D6CFE5" : muted);
  pdf.text(
    {
      active: "Ищу работу",
      open: "Рассматриваю предложения",
      paused: "Не ищу работу",
    }[p.jobStatus || "open"],
    left,
    y + 1,
  );
  if (assets.photo) pdf.addImage(assets.photo, "PNG", 157, 26, 36, 36);
  y = headerH + 9;
  text([p.city, p.country].filter(Boolean).join(", "), 9.5, true, ink, 1);
  text([p.email, p.phone].filter(Boolean).join("  ·  "), 9.5, false, muted, 3);
  section("Профессиональные навыки", 18);
  if (p.skills.length) chips(p.skills);
  else text("Навыки пока не указаны", 10, false, muted);
  if (p.bio) {
    section("О себе");
    narrative(p.bio);
  }
  const work = p.workHistory.filter((w) => w.company.trim() || w.role.trim());
  if (work.length) {
    section("Опыт работы", 36);
    for (const w of work) {
      ensure(30);
      text(w.role || w.company, 12, true, ink, 1);
      if (w.role && w.company) text(w.company, 10, true, purple, 1);
      const date = (v: string) => {
        if (!/^\d{4}-\d{2}$/.test(v)) return v;
        return new Intl.DateTimeFormat("ru", {
          month: "long",
          year: "numeric",
        }).format(new Date(Number(v.slice(0, 4)), Number(v.slice(5)) - 1, 1));
      };
      text(
        [date(w.start), w.current ? "По настоящее время" : date(w.end)]
          .filter(Boolean)
          .join(" - "),
        9,
        false,
        muted,
        3,
      );
      if (w.description) narrative(w.description);
      y += 3;
    }
  }
  if (p.projects) {
    const first = paragraphs(p.projects)[0]?.[0] || "";
    section(
      "Проекты и достижения",
      Math.min(
        90,
        lines(first, width - 5, 10.5, true).length * 5.4 +
          lines(paragraphs(p.projects)[0]?.slice(1).join(" ") || "", width - 5)
            .length *
            5.3 +
          10,
      ),
    );
    narrative(p.projects, true);
  }
  if (p.education) {
    const rawRows = p.education.split("\n").filter((v) => v.trim());
    const rows: string[] = [];
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (
        /университет|институт|академи|university|college/i.test(row) &&
        /Российской$/.test(row) &&
        rawRows[i + 1]?.startsWith("Федерации")
      )
        rows.push(row + " " + rawRows[++i]);
      else rows.push(row);
    }
    section(
      "Образование и курсы",
      Math.min(
        100,
        rows.reduce(
          (height, row) => height + lines(row, width, 11).length * 5.7 + 2,
          0,
        ),
      ),
    );
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const bold =
        /университет|институт|колледж|академи|школа|university|college/i.test(
          row,
        ) && !/факультет|кафедра/i.test(row);
      if (bold) ensure(18);
      text(row, bold ? 11 : 10.2, bold, bold ? ink : muted, bold ? 2 : 1);
    }
    y += 4;
  }
  section("Пожелания к работе");
  text([p.format, p.employment, p.availability].filter(Boolean).join(" · "));
  if (p.salaryMin || p.salaryMax)
    text(
      `${p.salaryMin ? p.salaryMin.toLocaleString("ru-RU") : "По договорённости"}${p.salaryMax ? " - " + p.salaryMax.toLocaleString("ru-RU") : ""} ₽ в месяц`,
      11,
      true,
      purple,
    );
  if (p.preferredLocations.length)
    text(`Желаемые локации: ${p.preferredLocations.join(", ")}`);
  if (p.relocation) text("Рассматриваю переезд", 10, false, muted);
  if (p.languages.length) {
    section("Языки", 12);
    p.languages.forEach((v) => text(v, 10.2, false, ink, 2));
  }
  if (p.softSkills.length) {
    section("Сильные стороны", 12);
    chips(p.softSkills, true);
  }
  if (p.links.length) {
    section("Портфолио и ссылки");
    p.links.forEach((v) => text(v, 9.5, false, purple, 2));
  }
  if (p.grade || p.verified.length) {
    section("Результаты проверки в прототипе");
    if (p.grade) text(`${p.specialty} · ${p.grade}`, 11, true);
    if (p.verified.length) chips(p.verified);
    text(
      "Результаты демонстрируют механику проверки Офферли.",
      8.5,
      false,
      muted,
    );
  }
  if (p.notes) {
    section("Дополнительные сведения");
    narrative(p.notes);
  }
  for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
    pdf.setPage(page);
    pdf.setDrawColor("#E4DFEE");
    pdf.line(left, 284, 193, 284);
    font(7, false, muted);
    pdf.text("Резюме составлено в Офферли", left, 290);
    pdf.text(`${page} / ${pdf.getNumberOfPages()}`, 193, 290, {
      align: "right",
    });
  }
  return pdf;
}
export async function downloadResume(
  p: Profile,
  template: ResumeTemplate = "accent",
) {
  const pdf = await createProfilePdf(p, template, await loadPdfAssets(p));
  pdf.save(`offerly-resume-${p.id}-${template}.pdf`);
}
