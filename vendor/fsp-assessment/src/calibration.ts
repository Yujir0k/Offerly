export interface Observation {
  id: string;
  participant: string;
  familyId: string;
  variantId: string;
  expertGrade: number;
  predictedGrade: number;
  score: number;
  seconds: number;
  condition: 'standard' | 'exposed' | 'ai-only';
}

/** Computes descriptive pilot measures without representing synthetic runs as human calibration. */
export function calibrationReport(observations: Observation[]): Record<string, unknown> {
  const humans = observations.filter((row) => row.condition !== 'ai-only');
  const standard = humans.filter((row) => row.condition === 'standard');
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const participants = new Map<string, Observation[]>();
  for (const row of standard) {
    const key = `${row.familyId}:${row.participant}`;
    participants.set(key, [...(participants.get(key) ?? []), row]);
  }
  const paired = [...participants.values()].filter(
    (rows) => new Set(rows.map((row) => row.variantId)).size >= 2,
  );
  const repeatAgreement = mean(
    paired.map((rows) =>
      rows.every((row) => row.predictedGrade === rows[0]!.predictedGrade) ? 1 : 0,
    ),
  );
  const variantIds = [...new Set(standard.map((row) => row.variantId))];
  const byVariant = variantIds.map((id) => ({
    variantId: id,
    n: standard.filter((row) => row.variantId === id).length,
    scoreByExpertLevel: [0, 1, 2, 3].map((level) => ({
      level,
      mean: mean(
        standard
          .filter((row) => row.variantId === id && row.expertGrade === level)
          .map((row) => row.score),
      ),
    })),
  }));
  return {
    humanObservations: humans.length,
    participants: new Set(standard.map((row) => row.participant)).size,
    participantFamilyGroups: participants.size,
    expertAgreement: mean(standard.map((row) => (row.expertGrade === row.predictedGrade ? 1 : 0))),
    falsePromotion: mean(standard.map((row) => (row.predictedGrade > row.expertGrade ? 1 : 0))),
    falseRejection: mean(standard.map((row) => (row.predictedGrade < row.expertGrade ? 1 : 0))),
    repeatPairs: paired.length,
    repeatAgreement,
    byVariant,
    standardMean: mean(standard.map((row) => row.score)),
    exposedMean: mean(humans.filter((row) => row.condition === 'exposed').map((row) => row.score)),
    aiOnlyMean: mean(
      observations.filter((row) => row.condition === 'ai-only').map((row) => row.score),
    ),
    byFamily:
      new Set(observations.map((row) => row.familyId)).size > 1
        ? Object.fromEntries(
            [...new Set(observations.map((row) => row.familyId))].map((familyId) => [
              familyId,
              calibrationReport(observations.filter((row) => row.familyId === familyId)),
            ]),
          )
        : undefined,
    status: 'pilot',
    warning:
      'Описательная статистика. Группы должны быть рандомизированы и сопоставимы; разница средних сама по себе не доказывает причинный эффект. Для сертификации нужны экспертная проверка, достаточная выборка и отдельная валидация.',
  };
}
