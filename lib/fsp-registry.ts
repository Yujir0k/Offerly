import "server-only";

/** Internal adapter contract, not an assertion about an unpublished FSP API. */
export type FspParticipantHistory = {
  participantId: string;
  source: "demo" | "fsp";
  achievements: { id: string; title: string; year: number; place?: number }[];
};
export interface FspRegistryAdapter {
  history(participantId: string): Promise<FspParticipantHistory | null>;
}

export class FspRegistryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Fixed synthetic records only. A typed arbitrary ID never manufactures history. */
export const demoFspRegistry: FspRegistryAdapter = {
  async history(participantId) {
    if (participantId === "FSP-DEMO-1042")
      return {
        participantId,
        source: "demo",
        achievements: [
          {
            id: "demo-team-2025",
            title: "Командный турнир",
            year: 2025,
            place: 2,
          },
        ],
      };
    if (participantId === "FSP-DEMO-1043")
      return { participantId, source: "demo", achievements: [] };
    return null;
  },
};

export async function readFspHistory(demo: boolean, participantId: string) {
  if (!demo)
    throw new FspRegistryError(
      "Реестр достижений ФСП ещё не подключён. Сохранённая история не изменена.",
      503,
    );
  const history = await demoFspRegistry.history(participantId);
  if (!history)
    throw new FspRegistryError(
      "Участник не найден в демореестре. Используйте FSP-DEMO-1042 или FSP-DEMO-1043.",
      404,
    );
  return history;
}

export function fspAchievementLabels(history: FspParticipantHistory) {
  return history.achievements.map(
    (a) =>
      `${a.title} · ${a.year}${a.place ? ` · ${a.place} место` : ""}${history.source === "demo" ? " (демо)" : ""}`,
  );
}
