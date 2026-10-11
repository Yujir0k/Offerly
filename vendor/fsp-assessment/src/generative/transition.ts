import type { GradeWorkWorld } from './qualitative-runtime.js';

export type TransitionOperation =
  | 'prepare-scope'
  | 'capture-origin'
  | 'apply-local-fix'
  | 'activate-target'
  | 'verify-target'
  | 'discard-origin';

export interface TransitionContract {
  programs: TransitionOperation[][];
  probe: number;
}

export interface TransitionResult {
  functionalContract: boolean;
  compatibleConsumers: boolean;
  rollbackSafe: boolean;
  interruption: number;
  prediction: 'safe' | 'scope' | 'rollback' | 'scope-rollback';
}

/** Execute an ordered transition; a later guard cannot undo an earlier exposure. */
export function executeTransition(
  operations: readonly TransitionOperation[],
  exposedConsumers: number,
): TransitionResult {
  let scopeReady = false;
  let activated = false;
  let originRetained = false;
  let localFixed = false;
  let scopeViolation = false;
  for (const operation of operations) {
    switch (operation) {
      case 'prepare-scope':
        scopeReady = true;
        break;
      case 'capture-origin':
        // A snapshot taken after activation preserves the new state, not origin.
        if (!activated) originRetained = true;
        break;
      case 'apply-local-fix':
        localFixed = true;
        break;
      case 'activate-target':
        if (!scopeReady && exposedConsumers > 0) scopeViolation = true;
        activated = true;
        break;
      case 'discard-origin':
        originRetained = false;
        break;
      case 'verify-target':
        break;
    }
  }
  return {
    functionalContract: localFixed && activated,
    compatibleConsumers: !scopeViolation,
    rollbackSafe: originRetained,
    interruption: scopeViolation ? exposedConsumers : 0,
    prediction: scopeViolation
      ? originRetained
        ? 'scope'
        : 'scope-rollback'
      : originRetained
        ? 'safe'
        : 'rollback',
  };
}

/** Predict the specifically proposed program, independently of the chosen strategy. */
export function transitionPrediction(work: GradeWorkWorld): TransitionResult {
  if (!work.transition || !work.policy) throw new Error('Missing transition contract');
  return executeTransition(
    work.transition.programs[work.transition.probe]!,
    work.policy.oldConsumers,
  );
}

/** Candidate-visible operation semantics; no safety results or scoring keys. */
export function publicTransitionContract(work: GradeWorkWorld) {
  const research = work.policy?.kind === 'research';
  return {
    initialState: research
      ? 'Исходное основание решения сохранено; область применения нового вывода ещё не ограничена подтверждённой популяцией.'
      : 'Исходное состояние доступно; новый контракт ещё не защищён для действующих потребителей.',
    exposedConsumers: work.policy!.oldConsumers,
    targetConsumers: work.policy!.newConsumers,
    semantics: {
      'prepare-scope': research
        ? 'Ограничить новое бизнес-решение популяцией с подтверждённой поддержкой.'
        : 'Подготовить совместимый путь для действующих потребителей до активации нового контракта.',
      'capture-origin':
        'Сохранить основание исходного состояния. После activate-target сохраняется уже новое состояние; это не позволяет вернуться к исходному.',
      'apply-local-fix':
        'Применить функционально корректное локальное исправление из вашего плана.',
      'activate-target': research
        ? 'Применить новое бизнес-решение. Без ранее выполненного prepare-scope оно затрагивает все exposedConsumers за пределами доказанной поддержки.'
        : 'Активировать новый контракт. Без ранее выполненного prepare-scope все exposedConsumers получают несовместимое поведение.',
      'verify-target':
        'Проверить текущее состояние. Проверка не отменяет уже случившееся нарушение и не создаёт основание отката.',
      'discard-origin':
        'Удалить сохранённое основание исходного состояния; после этого возвращение к нему невозможно.',
    },
    guarantees:
      'Нарушение области на любом промежуточном шаге недопустимо. После завершения должно оставаться основание возврата/пересмотра. Операции выполняются ровно в приведённом порядке.',
    predictionScope:
      'Прогноз относится к предложенному для проверки переходу, независимо от выбранной вами стратегии.',
  };
}
