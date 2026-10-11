import { readRequestForm } from "@/lib/request-security";
import { throttle } from "@/lib/auth";
import { bucket } from "@/lib/file-storage";
import { parseResumeIsolated } from "@/lib/resume-worker";
import { workspace, save, errorResponse, checkOrigin } from "@/lib/store";
export async function GET(request: Request) {
  try {
    const { owner, state } = await workspace();
    if (state.accountDeletedAt) throw new Error("Аккаунт удалён");
    const key = state.profile.resumeKey;
    if (!key?.startsWith(`resumes/${owner}/`) || !bucket)
      return Response.json(
        { error: "Резюме ещё не загружено" },
        { status: 404 },
      );
    const stored = await bucket.get(key);
    if (!stored || !stored.size)
      return Response.json(
        {
          error:
            "Файл недоступен. Загрузите PDF повторно — данные профиля сохранятся.",
        },
        { status: 404 },
      );
    const filename = (
      stored.customMetadata?.filename || "Загруженное резюме.pdf"
    ).replace(/[\r\n]/g, "");
    if (new URL(request.url).searchParams.has("info"))
      return Response.json(
        { filename, size: stored.size },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    return new Response(stored.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="resume.pdf"; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, "%27")}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const { owner, state } = await workspace();
    await throttle("upload:resume:" + owner, 10, 600);
    if (state.accountDeletedAt) throw new Error("Аккаунт удалён");
    const form = await readRequestForm(r, 11534336);
    let file = form.get("file");
    const reparse = form.get("reparse") === "true";
    if (reparse) {
      if (!state.profile.resumeKey?.startsWith(`resumes/${owner}/`) || !bucket)
        throw new Error("Сначала загрузите резюме");
      const stored = await bucket.get(state.profile.resumeKey);
      if (!stored) throw new Error("Файл не найден. Загрузите его повторно.");
      if (!stored.size)
        throw new Error(
          "Ранее загруженный файл сохранился пустым. Загрузите PDF повторно — данные профиля сохранятся.",
        );
      file = new File(
        [await stored.arrayBuffer()],
        stored.customMetadata?.filename || "Загруженное резюме.pdf",
        { type: "application/pdf" },
      );
    }
    if (
      !(file instanceof File) ||
      file.size > 10 * 1024 * 1024 ||
      file.size === 0
    )
      throw new Error("Загрузите PDF до 10 МБ");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
      throw new Error("Поддерживается только PDF");
    const { content, parsed, photos } = await parseResumeIsolated(bytes);
    if (!content.trim())
      throw new Error(
        "В PDF нет текстового слоя. Заполните профиль вручную или загрузите текстовый PDF.",
      );
    const key = `resumes/${owner}/${crypto.randomUUID()}.pdf`;
    if (!bucket) throw new Error("Хранилище файлов недоступно");
    if (!reparse) {
      await bucket.put(key, bytes, {
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: { filename: file.name.slice(0, 200) },
      });
      const previous = state.profile.resumeKey;
      state.profile.resumeKey = key;
      try {
        await save(owner, state);
      } catch (error) {
        await bucket.delete(key);
        throw error;
      }
      if (previous?.startsWith(`resumes/${owner}/`)) await bucket.delete(previous).catch(() => console.error("Replaced resume cleanup failed"));
    }
    return Response.json({
      filename: file.name,
      ...parsed,
      parsed,
      photos,
      warnings: [
        "Проверьте распознанные поля. Отсутствующие сведения заполните вручную.",
        "Уровень из резюме — только предполагаемый грейд, он не подтверждает категорию.",
      ],
      excerpt: content.slice(0, 1200),
      note: "Проверьте найденные данные перед сохранением. Грейд подтверждается отдельно тестом.",
    });
  } catch (e) {
    return errorResponse(e);
  }
}
