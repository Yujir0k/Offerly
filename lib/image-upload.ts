import sharp from "sharp";
import { RequestSecurityError } from "./request-security";
sharp.cache({ memory: 32, files: 0, items: 20 });
sharp.concurrency(2);
/** Decode raster formats with a pixel limit and strip metadata/embedded payloads. SVG is never accepted. */
export async function safeImage(bytes: Uint8Array) {
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, animated: false, failOn: "warning" }).timeout({ seconds: 7 });
    const meta = await image.metadata();
    if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format) || !meta.width || !meta.height || meta.width > 8000 || meta.height > 8000 || (meta.pages || 1) > 1)
      throw new Error("image");
    return new Uint8Array(await image.rotate().webp({ quality: 90 }).toBuffer());
  } catch { throw new RequestSecurityError("Выберите корректную фотографию JPG, PNG или WebP до 16 мегапикселей", 400); }
}
