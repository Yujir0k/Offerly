import type {
  AssessmentSession,
  SessionView,
} from "../vendor/fsp-assessment/src/adaptive/model";
export type EditableAssessmentSession = AssessmentSession & {
  retakePolicy?: typeof import("./assessment-retakes").retakePolicy;
  interactionRevision?: number;
  reviewCursor?: { item: number; step: number };
  answerRevisions?: {
    at: string;
    itemId: string;
    stepId: string;
    removed: AssessmentSession["responses"];
  }[];
};
export function assessmentNavigation(session: EditableAssessmentSession) {
  return session.items.flatMap((item, itemIndex) =>
    item.variant.steps.map((step, stepIndex) => {
      const answered = session.responses.some(
        (r) => r.itemId === item.variant.id && r.stepId === step.id,
      );
      const current =
        session.state === "active" &&
        (session.reviewCursor ?? session.cursor).item === itemIndex &&
        (session.reviewCursor ?? session.cursor).step === stepIndex;
      const independent =
        item.stage === "anchors" &&
        item.variant.steps.length === 1 &&
        session.items[session.cursor.item]?.stage === "anchors";
      return {
        itemId: item.variant.id,
        stepId: step.id,
        stage: item.stage,
        label: `Задание ${stepIndex + 1}`,
        selected: current,
        status: answered ? "answered" : current ? "current" : "pending",
        available:
          session.state === "active" &&
          (answered ||
            current ||
            (session.cursor.item === itemIndex &&
              session.cursor.step === stepIndex) ||
            independent),
      };
    }),
  );
}
export function navigateIndependent(
  session: EditableAssessmentSession,
  itemId: string,
  stepId: string,
  now: number,
) {
  const target = assessmentNavigation(session).find(
    (n) => n.itemId === itemId && n.stepId === stepId,
  );
  if (!target?.available)
    throw new Error("Этот шаг откроется после предыдущего");
  const item = session.items.findIndex((i) => i.variant.id === itemId);
  const cursor = {
    item,
    step: session.items[item]!.variant.steps.findIndex((s) => s.id === stepId),
  };
  if (target.status === "answered") {
    session.reviewCursor = cursor;
    return;
  }
  delete session.reviewCursor;
  session.cursor = cursor;
  session.stepStartedAt = new Date(now).toISOString();
}
/** Only re-order single-step independent anchors. Linked cases and adaptive decisions remain native. */
export function restorePendingAnchor(
  session: AssessmentSession,
  wasAnchor: boolean,
  now: number,
) {
  if (!wasAnchor || session.state !== "active") return;
  const pending = session.items.findIndex(
    (i) =>
      i.stage === "anchors" &&
      i.variant.steps.some(
        (step) =>
          !session.responses.some(
            (r) => r.itemId === i.variant.id && r.stepId === step.id,
          ),
      ),
  );
  const item =
    pending >= 0
      ? pending
      : session.items.findIndex((i) => i.stage !== "anchors");
  if (item >= 0) {
    session.cursor = { item, step: 0 };
    session.stepStartedAt = new Date(now).toISOString();
  }
}
export type NavigableSessionView = SessionView & {
  result: (NonNullable<SessionView["result"]> & {timeoutSummary?: import("./assessment-timeout").TimeoutSummary}) | null;
  navigation?: ReturnType<typeof assessmentNavigation>;
  interactionRevision?: number;
  savedAnswer?: {
    optionId: string;
    execution?: import("../vendor/fsp-assessment/src/domain").Plan;
  };
  revisionResetCount?: number;
  methodVersion?: string;
  scoringVersion?: string;
};

/** Withdraw before editing, so progress and scoring have a single source of truth.
 * Linked later steps are invalidated; observed evidence and elapsed time are never erased.
 */
export function reopenAnswer(
  session: EditableAssessmentSession,
  itemId: string,
  stepId: string,
  now: number,
) {
  if (session.state !== "active" || now >= Date.parse(session.deadlineAt))
    throw new Error("Завершённую проверку нельзя изменить");
  if ((session.answerRevisions?.length ?? 0) >= 100)
    throw new Error("Достигнут предел изменений этой попытки");
  const itemIndex = session.items.findIndex((i) => i.variant.id === itemId);
  const stepIndex =
    session.items[itemIndex]?.variant.steps.findIndex((s) => s.id === stepId) ??
    -1;
  if (
    itemIndex < 0 ||
    stepIndex < 0 ||
    !session.responses.some((r) => r.itemId === itemId && r.stepId === stepId)
  )
    throw new Error("Сохранённый ответ не найден");
  const onlyAnchor =
    session.items[itemIndex]!.stage === "anchors" &&
    session.items[session.cursor.item]?.stage === "anchors";
  const invalidated = new Set(
    session.items.flatMap((item, i) =>
      item.variant.steps.flatMap((step, j) =>
        (
          onlyAnchor
            ? i === itemIndex && j === stepIndex
            : i > itemIndex || (i === itemIndex && j >= stepIndex)
        )
          ? [`${item.variant.id}/${step.id}`]
          : [],
      ),
    ),
  );
  const removed = session.responses.filter((r) =>
    invalidated.has(`${r.itemId}/${r.stepId}`),
  );
  session.answerRevisions = [
    ...(session.answerRevisions || []),
    {
      at: new Date(now).toISOString(),
      itemId,
      stepId,
      removed: structuredClone(removed),
    },
  ];
  session.responses = session.responses.filter(
    (r) => !invalidated.has(`${r.itemId}/${r.stepId}`),
  );
  session.contributions = session.responses.flatMap((r) => r.contributions);
  // Previously exposed boundary questions stay in exposure history, but selection is recalculated natively.
  session.items = session.items.filter(
    (item, i) => item.stage !== "boundary" || i <= itemIndex,
  );
  session.cursor = { item: itemIndex, step: stepIndex };
  session.stepStartedAt = new Date(now).toISOString();
  delete session.reviewCursor;
}
export function revisionResetCount(
  session: EditableAssessmentSession,
  itemId: string,
  stepId: string,
) {
  const clone = structuredClone(session);
  clone.answerRevisions = [];
  reopenAnswer(clone, itemId, stepId, Date.parse(session.startedAt));
  return session.responses.length - clone.responses.length;
}
