import "server-only";
import { query } from "@/db";
import type { Account } from "./platform";
import {
  FspRegistryError,
  readFspHistory,
  fspAchievementLabels,
} from "./fsp-registry";

/** Called only after local authentication and Origin checks. Does not grant a grade. */
export async function syncDemoFspHistory(account: Account, id: unknown) {
  if (!account.demo)
    throw new FspRegistryError(
      "Демореестр доступен только в демонстрационном аккаунте.",
      403,
    );
  if (typeof id !== "string" || id.length > 80)
    throw new FspRegistryError("Проверьте ID участника.", 400);
  const participantId = id.trim();
  // Resolve before writing: missing/unavailable providers must never erase saved history.
  const history = participantId
    ? await readFspHistory(true, participantId)
    : null;
  const achievements = history ? fspAchievementLabels(history) : [];
  const metadata = history
    ? { source: history.source, syncedAt: new Date().toISOString() }
    : null;
  await query(
    `UPDATE candidate_profiles SET payload=payload || jsonb_build_object(
      'fsp',$2::text,'achievements',$3::jsonb,'fspHistory',$4::jsonb)
      WHERE user_id=$1`,
    [
      account.id,
      participantId || null,
      JSON.stringify(achievements),
      JSON.stringify(metadata),
    ],
  );
  return { participantId: participantId || null, achievements, ...metadata };
}
