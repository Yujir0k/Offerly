import { getResolvedPDFJS } from "unpdf";
import type { getDocumentProxy } from "unpdf";
type PDFDocumentProxy = Awaited<ReturnType<typeof getDocumentProxy>>;
export type ResumePhoto = {
  pixels: string;
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  page: number;
};
type Matrix = [number, number, number, number, number, number];
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
/** Candidate photographs, not face recognition. Always require visual confirmation. */
export async function extractResumePhotos(
  doc: PDFDocumentProxy,
): Promise<ResumePhoto[]> {
  const { OPS } = await getResolvedPDFJS();
  const candidates: Array<{ photo: ResumePhoto; score: number }> = [];
  for (
    let pageNumber = 1;
    pageNumber <= Math.min(doc.numPages, 2);
    pageNumber++
  ) {
    const page = await doc.getPage(pageNumber),
      ops = await page.getOperatorList();
    let matrix: Matrix = [1, 0, 0, 1, 0, 0];
    const stack: Matrix[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < ops.fnArray.length; i++) {
      const op = ops.fnArray[i],
        args = ops.argsArray[i];
      if (op === OPS.save) {
        stack.push([...matrix]);
        continue;
      }
      if (op === OPS.restore) {
        matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
        continue;
      }
      if (op === OPS.transform) {
        matrix = multiply(matrix, args as Matrix);
        continue;
      }
      if (op !== OPS.paintImageXObject && op !== OPS.paintInlineImageXObject)
        continue;
      const key = typeof args[0] === "string" ? args[0] : `inline:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const image =
        op === OPS.paintInlineImageXObject
          ? args[0]
          : await new Promise<any>((resolve) =>
              (key.startsWith("g_") ? page.commonObjs : page.objs).get(
                key,
                resolve,
              ),
            );
      if (
        !image?.data ||
        image.width < 120 ||
        image.height < 120 ||
        image.width * image.height > 4_000_000
      )
        continue;
      const ratio = image.width / image.height,
        channels = image.data.length / (image.width * image.height);
      if (ratio < 0.48 || ratio > 1.65 || ![1, 3, 4].includes(channels))
        continue;
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y]) => [
        matrix[0] * x + matrix[2] * y + matrix[4],
        matrix[1] * x + matrix[3] * y + matrix[5],
      ]);
      const displayWidth =
        Math.max(...corners.map((c) => c[0])) -
        Math.min(...corners.map((c) => c[0]));
      const displayHeight =
        Math.max(...corners.map((c) => c[1])) -
        Math.min(...corners.map((c) => c[1]));
      const [left, bottom, right, top] = page.view,
        pageWidth = right - left,
        pageHeight = top - bottom;
      const upper =
        (Math.max(...corners.map((c) => c[1])) - bottom) / pageHeight;
      // Ignore small logos, backgrounds, page scans and diagrams occupying most of a page.
      if (
        displayWidth < 40 ||
        displayHeight < 40 ||
        displayWidth * displayHeight > pageWidth * pageHeight * 0.32
      )
        continue;
      const scale = Math.min(1, 512 / Math.max(image.width, image.height)),
        width = Math.round(image.width * scale),
        height = Math.round(image.height * scale);
      const bytes = new Uint8Array(width * height * channels);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          for (let c = 0; c < channels; c++)
            bytes[(y * width + x) * channels + c] =
              image.data[
                (Math.floor(y / scale) * image.width + Math.floor(x / scale)) *
                  channels +
                  c
              ];
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      candidates.push({
        photo: {
          pixels: btoa(binary),
          width,
          height,
          channels: channels as 1 | 3 | 4,
          page: pageNumber,
        },
        score: upper * 3 + (pageNumber === 1 ? 2 : 0) + (ratio <= 1.15 ? 1 : 0),
      });
    }
  }
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => c.photo);
}
