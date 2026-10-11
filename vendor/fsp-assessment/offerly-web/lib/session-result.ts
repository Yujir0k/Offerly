import type { Assessment, AssessmentSession, AssessmentResult } from '../../src/domain.js';

/** A general level requires the full program; company sessions produce only company evidence. */
export function sessionResult(
  session: AssessmentSession,
  assessments: Assessment[],
): AssessmentResult | null {
  if (
    session.assessmentIds.length < (session.needId || session.format === 'express-v1' ? 1 : 2) ||
    new Set(session.assessmentIds).size !== session.assessmentIds.length
  )
    return null;
  const members = session.assessmentIds.map((id) => assessments.find((item) => item.id === id));
  if (
    members.some(
      (item) =>
        !item?.result ||
        item.state !== 'submitted' ||
        item.candidateId !== session.candidateId ||
        item.variant.trackId !== session.trackId ||
        item.variant.grade !== session.grade,
    )
  )
    return null;
  if (new Set(members.map((item) => item!.variant.familyId)).size !== members.length) return null;
  const results = members.map((item) => item!.result!);
  if (session.format === 'express-v1') {
    if (results.length !== 1 || results[0]!.rubricVersion !== 'express-v1') return null;
    return {
      ...results[0]!,
      proposedGrade: session.needId ? null : results[0]!.score >= 70 ? session.grade : null,
    };
  }
  if (results.some((result) => result.rubricVersion === 'engineering-v1')) {
    const scored = results.filter((result) => result.maturity).map((result) => result.maturity!);
    const mean = (
      key: 'rootCauseAccuracy' | 'edgeCaseHandling' | 'strategyQuality' | 'theoryAccuracy',
    ) => Math.round(scored.reduce((total, item) => total + item[key], 0) / scored.length);
    const assessed = results.every((result) => result.proposedGrade === session.grade)
      ? session.grade
      : null;
    const ai = scored.filter((item) => item.aiEfficiency !== null);
    return {
      score: Math.round(
        results.reduce((sum, result) => sum + (result.score / (result.maxScore || 90)) * 100, 0) /
          results.length,
      ),
      maxScore: 100,
      proposedGrade: session.needId ? null : assessed,
      status: assessed ? 'provisional' : 'not_confirmed',
      maturity: {
        rootCauseAccuracy: mean('rootCauseAccuracy'),
        edgeCaseHandling: mean('edgeCaseHandling'),
        strategyQuality: mean('strategyQuality'),
        theoryAccuracy: mean('theoryAccuracy'),
        aiIterations: scored.reduce((sum, item) => sum + item.aiIterations, 0),
        aiDepth: Math.max(...scored.map((item) => item.aiDepth)),
        aiEfficiency: ai.length
          ? Math.round(ai.reduce((sum, item) => sum + item.aiEfficiency!, 0) / ai.length)
          : null,
      },
      evidence: results.flatMap((result) => result.evidence),
      rubricVersion: 'engineering-v1',
      feedback: [
        'Каждый обязательный кейс должен подтвердить заявленный уровень. Другой грейд автоматически не присваивается.',
        'Теория 15%, локализация 35%, стратегия 25%, стресс-сценарий 25%.',
        ...new Set(results.flatMap((result) => result.feedback)),
      ],
    };
  }
  const passed =
    results.every((result) => result.proposedGrade === session.grade) &&
    members.every((item) => item?.expertReview?.decision !== 'needs_revision');
  return {
    score: Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length),
    proposedGrade: !session.needId && passed ? session.grade : null,
    status: passed ? 'provisional' : 'not_confirmed',
    evidence: results.flatMap((result) => result.evidence),
    rubricVersion: 'evidence-v4',
    feedback: [
      `Завершено ${members.length} разных кейса программы. Каждый кейс оценён отдельно.`,
      session.needId
        ? 'Результат предназначен для компании и не меняет общий уровень.'
        : 'Уровень предварительный до экспертной проверки и калибровки программы.',
      ...results
        .flatMap((result) => result.feedback)
        .filter((text, index, all) => all.indexOf(text) === index),
    ],
  };
}

/** Rechecking the same level does not restart the waiting period for a level change. */
export function latestLevelChange(
  sessions: AssessmentSession[],
): { grade: AssessmentSession['grade']; at: string } | null {
  let result: { grade: AssessmentSession['grade']; at: string } | null = null;
  for (const session of [...sessions].sort((a, b) =>
    (a.submittedAt || a.createdAt).localeCompare(b.submittedAt || b.createdAt),
  )) {
    if (!result || result.grade !== session.grade)
      result = { grade: session.grade, at: session.submittedAt || session.createdAt };
  }
  return result;
}
