import { safeImage } from "@/lib/image-upload";
import { readRequestForm } from "@/lib/request-security";
import { throttle } from "@/lib/auth";
import { readRequestJson } from "@/lib/request-security";
import { query } from "@/db";
import { currentAccount } from "@/lib/auth";
import { bucket } from "@/lib/file-storage";
import { ownsJob } from "@/lib/job-applications";
import {
  workspace,
  save,
  clientState,
  checkOrigin,
  errorResponse,
} from "@/lib/store";
export async function GET(request: Request) {
  try {
    const account = await currentAccount();
    if (!account) throw new Error("AUTH");
    const key = new URL(request.url).searchParams.get("key") || "";
    if (!key.startsWith("company-media/") || key.length > 300)
      return new Response(null, { status: 404 });
    const {
      rows: [allowed],
    } = await query(
      `SELECT 1 FROM companies c JOIN users u ON u.id=c.owner_id WHERE c.scope=$1 AND u.deleted_at IS NULL AND (
      EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(c.payload->'media','[]')) m WHERE m->>'key'=$2)
      OR EXISTS(SELECT 1 FROM jobs j WHERE j.company_id=c.id AND (j.status='published' OR EXISTS(SELECT 1 FROM company_memberships cm WHERE cm.company_id=c.id AND cm.user_id=$3)) AND (j.payload->'mediaKeys' ? $2 OR position($4 in coalesce(j.payload->>'logo',''))>0))) LIMIT 1`,
      [account.scope, key, account.id, encodeURIComponent(key)],
    );
    if (!allowed || !bucket) return new Response(null, { status: 404 });
    const file = await bucket.get(key);
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
    const { owner, state } = await workspace({ allOwnedJobs: true });
    await throttle("upload:image:" + owner, 30, 600);
    const form = await readRequestForm(request, 6291456);
    if (form.get("role") !== "employer" || state.accountDeletedAt)
      throw new Error("Загрузка доступна только в кабинете работодателя");
    const kind = String(form.get("kind"));
    if (!["logo", "cover", "gallery"].includes(kind))
      throw new Error("Выберите назначение фотографии");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024)
      throw new Error("Выберите JPG, PNG или WebP до 5 МБ");
    if ((state.company.media?.length || 0) >= 30)
      throw new Error("Медиатека заполнена. Удалите ненужные фотографии.");
    if (
      kind === "gallery" &&
      (state.company.media || []).filter((m) => m.kind === "gallery").length >=
        8
    )
      throw new Error("Можно добавить до восьми фотографий компании");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const safeBytes = await safeImage(bytes);
    if (!bucket) throw new Error("Хранилище фотографий недоступно");
    const key = `company-media/${owner}/${crypto.randomUUID()}`;
    await bucket.put(key, safeBytes, {
      httpMetadata: {
        contentType: "image/webp",
      },
    });
    const previousKeys = (state.company.media || [])
      .filter((m) => kind !== "gallery" && m.kind === kind)
      .map((m) => m.key);
    state.company.media = [
      ...(state.company.media || []).filter(
        (m) => kind === "gallery" || m.kind !== kind,
      ),
      {
        key,
        kind: kind as "logo" | "cover" | "gallery",
        name: file.name.slice(0, 150),
      },
    ];
    if (kind === "logo") state.company.logoKey = key;
    if (kind === "cover") state.company.coverKey = key;
    try {
      await save(owner, state);
    } catch (e) {
      await bucket.delete(key);
      throw e;
    }
    for (const oldKey of previousKeys)
      if (
        !state.jobs.some(
          (job) =>
            job.mediaKeys?.includes(oldKey) ||
            job.logo?.includes(encodeURIComponent(oldKey)),
        )
      )
        await bucket.delete(oldKey);
    return Response.json({
      ...clientState(state, "employer"),
      uploadedKey: key,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const { owner, state } = await workspace({ allOwnedJobs: true });
    const body = (await readRequestJson(request, 6000)) as { role?: string; key?: string };
    const key = body.key || "";
    if (body.role !== "employer" || state.accountDeletedAt)
      throw new Error("Доступно только работодателю");
    if (
      !key.startsWith(`company-media/${owner}/`) ||
      !state.company.media?.some((m) => m.key === key)
    )
      throw new Error("Фотография недоступна");
    state.company.media = state.company.media.filter((m) => m.key !== key);
    if (state.company.logoKey === key) state.company.logoKey = undefined;
    if (state.company.coverKey === key) state.company.coverKey = undefined;
    for (const job of state.jobs)
      if (ownsJob(job, state)) {
        job.mediaKeys = job.mediaKeys?.filter((value) => value !== key);
        if (job.logo?.includes(encodeURIComponent(key))) job.logo = undefined;
      }
    await save(owner, state);
    const used = state.jobs.some(
      (j) =>
        j.mediaKeys?.includes(key) || j.logo?.includes(encodeURIComponent(key)),
    );
    if (!used && bucket) await bucket.delete(key);
    return Response.json(clientState(state, "employer"));
  } catch (e) {
    return errorResponse(e);
  }
}
