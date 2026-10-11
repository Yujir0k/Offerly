import { extractResumePhotos } from "./resume-photo";
import { cityCatalog } from "./suggestion-catalogs";
import { parseResume, resumeLayoutText } from "./resume-parser";
import { extractTextItems, getDocumentProxy } from "unpdf";
export async function extractResume(bytes: Uint8Array) {
    const doc = await getDocumentProxy(bytes.slice(), {
      maxImageSize: 4_000_000,
      // Passed through to PDF.js; unpdf's narrow public type omits this supported safety option.
      ...{ isEvalSupported: false },
    });
    try {
    if (doc.numPages > 40) throw new Error("Загрузите резюме до 40 страниц");
    const { items } = await extractTextItems(doc);
    const pageTops = await Promise.all(
      Array.from({ length: doc.numPages }, (_, i) =>
        doc.getPage(i + 1).then((page) => page.view[3]),
      ),
    );
    const content = resumeLayoutText(items, pageTops);
    const parsed = parseResume(content);
    const place = parsed.city
      ? cityCatalog.find((item) => item.name === parsed.city)
      : undefined;
    if (place?.group.startsWith("Россия")) {
      parsed.country = "Россия";
      parsed.region =
        place.group.split(" · ")[1] ||
        (parsed.city === "Москва" || parsed.city === "Санкт-Петербург"
          ? parsed.city
          : "");
    }
    let photos: Awaited<ReturnType<typeof extractResumePhotos>> = [];
    try {
      photos = await extractResumePhotos(doc);
    } catch {
      /* Unsupported image encoding must not prevent text import. */
    }
    if (content.length > 250000) throw new Error("Слишком большой текст резюме");
    return { content, parsed, photos };
    } finally { await doc.cleanup(); }
}
