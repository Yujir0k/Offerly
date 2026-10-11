import { safeImage } from "@/lib/image-upload";
import { readRequestForm } from "@/lib/request-security";
import { throttle } from "@/lib/auth";
import { bucket } from "@/lib/file-storage";
import {
  workspace,
  save,
  clientState,
  checkOrigin,
  errorResponse,
} from "@/lib/store";

export async function GET() {
  try {
    const { owner, state } = await workspace();
    if (!state.profile.avatarKey?.startsWith(`avatars/${owner}/`) || !bucket)
      return new Response(null, { status: 404 });
    const file = await bucket.get(state.profile.avatarKey);
    if (!file) return new Response(null, { status: 404 });
    return new Response(file.body, {
      headers: {
        "Content-Type": file.httpMetadata?.contentType || "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { owner, state } = await workspace();
    await throttle("upload:image:" + owner, 30, 600);
    if (state.accountDeletedAt) throw new Error("Аккаунт удалён");
    const file = (await readRequestForm(request, 6291456)).get("file");
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024)
      throw new Error("Выберите JPG, PNG или WebP до 5 МБ");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const safeBytes = await safeImage(bytes);
    if (!bucket) throw new Error("Хранилище фотографий недоступно");
    const type = "image/webp";
    const key = `avatars/${owner}/${crypto.randomUUID()}`;
    await bucket.put(key, safeBytes, { httpMetadata: { contentType: type } });
    const previous = state.profile.avatarKey;
    state.profile.avatarKey = key;
    try {
      await save(owner, state);
    } catch (error) {
      await bucket.delete(key);
      throw error;
    }
    if (previous?.startsWith(`avatars/${owner}/`)) await bucket.delete(previous).catch(() => console.error("Replaced avatar cleanup failed"));
    return Response.json(clientState(state, "candidate"));
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const { owner, state } = await workspace();
    const previous = state.profile.avatarKey;
    state.profile.avatarKey = undefined;
    await save(owner, state);
    if (previous?.startsWith(`avatars/${owner}/`)) await bucket.delete(previous).catch(() => console.error("Deleted avatar cleanup failed"));
    return Response.json(clientState(state, "candidate"));
  } catch (e) {
    return errorResponse(e);
  }
}
