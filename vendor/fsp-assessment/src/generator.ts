import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getTrack } from './catalog.js';
import { random } from './random.js';
import type { Grade, Question, Variant, ToolMode } from './domain.js';
import { generateSpecialized } from './families/registry.js';

function question(
  id: string,
  prompt: string,
  options: string[],
  correct: number,
  skill: string,
  answers: Record<string, string>,
): Question {
  answers[id] = String(correct);
  return {
    id,
    prompt,
    options: options.map((text, index) => ({ id: String(index), text })),
    skill,
    points: 5,
  };
}

/** Creates a reproducible case with public artifacts and a separate answer oracle. */
export function generateLegacyVariant(
  trackId: string,
  grade: Grade,
  seed: number,
  mode: ToolMode = 'local',
): Variant {
  const track = getTrack(trackId);
  const rng = random(seed);
  const answers: Record<string, string> = {};
  const variant: Variant = {
    id: randomUUID(),
    familyId: `${trackId}-${track.lab}-v1`,
    version: '1.0.0',
    seed,
    trackId,
    grade,
    title: `Прими работу ИИ: ${track.focus}`,
    status: 'technical',
    context: `Команда передала результат работы помощника. Требуется проверить его, собрать доказательства и принять решение. Заявленный уровень: ${grade}. Это технически проверенное семейство; человеческая калибровка ещё не выполнена.`,
    questions: [],
    artifacts: [],
    rows: [],
    documents: [],
    queries: [],
    events: [],
    oracle: {
      answers,
      leakedFeature: '',
      validFeatures: [],
      requiredSplit: '',
      eventStrategy: '',
      retrievalPolicy: '',
    },
    complexity: { steps: 4, defects: 1, distractors: 2, rows: 0 },
    stageModes: ['closed', mode, 'docs'],
  };
  if (track.lab === 'classification') {
    const signal = `signal_${Math.floor(rng() * 900 + 100)}`;
    const future = `aggregate_${Math.floor(rng() * 900 + 100)}`;
    const noise = `aux_${Math.floor(rng() * 900 + 100)}`;
    for (let id = 0; id < (grade === 'Junior' ? 180 : grade === 'Middle' ? 360 : 600); id++) {
      const strength = rng() * 2 - 1;
      const label = rng() < 1 / (1 + Math.exp(-5 * strength)) ? 1 : 0;
      variant.rows.push({
        id,
        time: id,
        group: id % 6,
        label,
        values: {
          [signal]: strength,
          [future]: label + (rng() - 0.5) * 0.12,
          [noise]: rng() * 2 - 1,
        },
      });
    }
    variant.oracle.leakedFeature = future;
    variant.oracle.validFeatures = [signal, noise];
    variant.oracle.requiredSplit = trackId === 'cv' ? 'group' : 'time';
    variant.artifacts.push(
      {
        name: 'data-contract.md',
        content: `${signal}: измерение, доступное до прогноза. ${future}: агрегат сформирован после наблюдения целевого результата. ${noise}: технический параметр. group: камера/группа источника. time: момент наблюдения. Целевой признак: label. При внедрении ${future} недоступен.`,
      },
      {
        name: 'ai-report.md',
        content: `Помощник предлагает использовать все признаки и случайное разбиение. Высокое качество считает достаточным для запуска. Проверьте обоснованность вывода. Для ${trackId === 'cv' ? 'новых камер требуется разбиение по группам' : 'будущих наблюдений требуется временное разбиение'}.`,
      },
      {
        name: 'experiment-guide.md',
        content:
          'Лаборатория обучает логистическую регрессию на выбранных признаках. Преобразования рассчитываются только на train. Доступны разбиения random, time, group. Для проверки удалите подозрительный признак и повторите эксперимент.',
      },
    );
    variant.questions.push(
      question(
        'q1',
        'Высокая offline-метрика сама по себе подтверждает готовность к запуску?',
        [
          'Да, если она выше baseline',
          'Нет: нужны корректные условия оценки и соответствие эксплуатации',
          'Да, если результат получен ИИ',
        ],
        1,
        track.skills[0]!,
        answers,
      ),
      question(
        'q2',
        `Какой признак требует исключения из текущего inference-пайплайна?`,
        [signal, future, noise],
        1,
        'data',
        answers,
      ),
      question(
        'q3',
        `Как проверить ${trackId === 'cv' ? 'перенос на новые камеры' : 'качество на будущих наблюдениях'}?`,
        [
          'Случайное разбиение',
          'Оценка на обучающей выборке',
          trackId === 'cv' ? 'Разбиение по группам' : 'Временное разбиение',
        ],
        2,
        'validation',
        answers,
      ),
      question(
        'q4',
        'После удаления недоступного признака качество снизилось. Следующее действие?',
        [
          'Вернуть признак ради метрики',
          'Скрыть снижение',
          'Зафиксировать честную оценку и исследовать допустимые улучшения',
        ],
        2,
        'reasoning',
        answers,
      ),
    );
  } else if (track.lab === 'retrieval') {
    const subjects =
      grade === 'Junior'
        ? ['возврат', 'доставка', 'гарантия']
        : grade === 'Middle'
          ? ['возврат', 'доставка', 'гарантия', 'подписка', 'обмен', 'оплата']
          : [
              'возврат',
              'доставка',
              'гарантия',
              'подписка',
              'обмен',
              'оплата',
              'скидка',
              'самовывоз',
              'кредит',
              'ремонт',
            ];
    for (const [index, subject] of subjects.entries()) {
      const days = Math.floor(rng() * 25 + 5);
      variant.documents.push(
        {
          id: `old-${index}`,
          text: `${subject}: срок ${days + 10} дней. Архивная редакция.`,
          current: false,
        },
        {
          id: `current-${index}`,
          text: `${subject}: срок ${days} дней. Действующая редакция.`,
          current: true,
        },
      );
      variant.queries.push({ text: `Какой срок для ${subject}?`, expectedId: `current-${index}` });
    }
    variant.queries.push(
      { text: 'Какая ставка ипотечного кредита?', expectedId: null },
      { text: 'Как оформить космическую страховку?', expectedId: null },
    );
    variant.oracle.retrievalPolicy = 'current-abstain';
    variant.artifacts.push(
      {
        name: 'ai-report.md',
        content:
          'Помощник предлагает искать во всех версиях документов и отвечать по первому найденному. Архивные редакции остались в индексе. Вопросы вне области документации тоже встречаются.',
      },
      {
        name: 'quality-contract.md',
        content:
          'Ответ должен ссылаться на действующий источник. Для неподдержанного вопроса нужен отказ от утверждения. Проверяем точность источников, покрытие поддержанных вопросов и корректность отказов.',
      },
      {
        name: 'lab-guide.md',
        content:
          'Это детерминированная retrieval-симуляция без генерации ответов LLM. Политики: all, current, current-abstain. topK: 1–5. После эксперимента результаты можно воспроизвести.',
      },
    );
    variant.questions.push(
      question(
        'q1',
        'Что необходимо включить в оценочную выборку?',
        [
          'Только вопросы с ответами',
          'Только короткие вопросы',
          'Поддержанные и неподдержанные вопросы, разные версии источников',
        ],
        2,
        'evaluation',
        answers,
      ),
      question(
        'q2',
        'Какой источник подходит для ответа о действующей политике?',
        ['Архивный, если он найден первым', 'Действующий и релевантный', 'Любой длинный документ'],
        1,
        'retrieval',
        answers,
      ),
      question(
        'q3',
        'Что делать, если документация не содержит ответа?',
        [
          'Сообщить об отсутствии подтверждения',
          'Выдать правдоподобный ответ',
          'Использовать архивный текст',
        ],
        0,
        'reasoning',
        answers,
      ),
      question(
        'q4',
        'Как сравнивать два варианта retrieval?',
        [
          'По одному удачному ответу',
          'По единому набору вопросов и сегментам качества',
          'По числу токенов в ответе',
        ],
        1,
        'evaluation',
        answers,
      ),
    );
  } else {
    for (
      let entity = 0;
      entity < (grade === 'Junior' ? 3 : grade === 'Middle' ? 6 : 10);
      entity++
    ) {
      const value = Math.floor(rng() * 900 + 100);
      const updates = grade === 'Senior' ? [1, 5, 3, 4, 2] : [1, 3, 2];
      for (const [position, version] of updates.entries()) {
        const event = {
          id: `event-${entity}-${version}`,
          entity: `object-${entity}`,
          version,
          value: value + version * 17,
          arrival: entity * 4 + position,
        };
        variant.events.push(event);
        if (position === 1) variant.events.push({ ...event, arrival: entity * 4 + 3 });
      }
    }
    variant.oracle.eventStrategy = 'versioned';
    variant.artifacts.push(
      {
        name: 'delivery-contract.md',
        content:
          'Доставка at-least-once. События могут повторяться и приходить вне порядка версии. Объект должен хранить значение максимальной версии. Повтор не должен создавать дополнительный эффект.',
      },
      {
        name: 'ai-change.md',
        content: `Предложение помощника: применять каждое событие по мере прихода. Сценарий: ${track.focus}. Проверьте порядок, повторы и итоговое состояние.`,
      },
      {
        name: 'lab-guide.md',
        content:
          'Симулятор воспроизводит поток. Стратегии: arrival — по приходу; dedupe — убрать повторы; versioned — повторы и максимальная версия. Этап изменения условий проверяет новый порядок доставки.',
      },
    );
    variant.questions.push(
      question(
        'q1',
        'Какие случаи входят в стратегию проверки?',
        ['Только последовательный поток', 'Повторы и нарушение порядка', 'Только пустой поток'],
        1,
        'reliability',
        answers,
      ),
      question(
        'q2',
        'Достаточно ли убрать повторы для правильного итогового состояния?',
        ['Да', 'Нет: старое событие может перезаписать новое', 'Да, при длинном таймауте'],
        1,
        'data',
        answers,
      ),
      question(
        'q3',
        'По какому признаку выбирать актуальное состояние?',
        ['По последней доставке', 'По длине сообщения', 'По версии объекта'],
        2,
        'reliability',
        answers,
      ),
      question(
        'q4',
        'Какая проверка подтверждает устойчивость решения?',
        [
          'Один успешный запуск',
          'Повтор и перестановка потока с проверкой инвариантов',
          'Положительный отзыв помощника',
        ],
        1,
        'experiments',
        answers,
      ),
    );
  }
  // Rotate option order without changing semantics or exposing the correct answer.
  for (const question of variant.questions) {
    const correctText = question.options.find((option) => option.id === answers[question.id])!.text;
    for (let i = question.options.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [question.options[i], question.options[j]] = [question.options[j]!, question.options[i]!];
    }
    question.options = question.options.map((option, index) => ({
      id: String(index),
      text: option.text,
    }));
    answers[question.id] = question.options.find((option) => option.text === correctText)!.id;
  }
  if (seed % 4 === 0) {
    const report = variant.artifacts.find(
      (artifact) => artifact.name === 'ai-report.md' || artifact.name === 'ai-change.md',
    );
    if (report)
      report.content = variant.rows.length
        ? `Помощник исключил недоступный агрегат и использовал ${variant.oracle.requiredSplit === 'group' ? 'групповое' : 'временное'} разбиение. Он предлагает проверить допустимые признаки и оценить последствия запуска. Подтвердите или опровергните это предложение экспериментом.`
        : variant.documents.length
          ? 'Помощник предлагает актуальные источники и отказ при отсутствии подтверждения. Проверьте, выполняются ли требования на предоставленной выборке.'
          : 'Помощник предлагает устранять повторы и применять только максимальную версию объекта. Проверьте корректность на данном потоке и после изменения порядка.';
  }
  variant.complexity.rows =
    variant.rows.length || variant.documents.length || variant.events.length;
  return variant;
}
/** Creates a specialization-specific family; legacy cases remain readable and executable. */
export function generateVariant(
  trackId: string,
  grade: Grade,
  seed: number,
  mode: ToolMode = 'local',
  familyId?: string,
): Variant {
  getTrack(trackId);
  return generateSpecialized(trackId, grade, seed, mode, familyId);
}

/** Ignore IDs, seeds and shuffled positions when checking whether actual tasks repeat. */
export function variantFingerprint(variant: Variant): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        familyId: variant.familyId,
        data: variant.lab?.data,
        changedData: variant.oracle.specialized?.changedData,
        questions: variant.questions
          .map((question) => ({
            prompt: question.prompt,
            scenario: question.scenario,
            options: question.options.map((option) => option.text).sort(),
          }))
          .sort((a, b) => a.prompt.localeCompare(b.prompt)),
      }),
    )
    .digest('hex');
}

/** Refuse to issue an exact task repeat, including a random-seed collision across candidates. */
export function generateUniqueVariant(
  trackId: string,
  grade: Grade,
  mode: ToolMode,
  previous: Variant[],
  familyId?: string,
  nextSeed: () => number = () => randomBytes(4).readUInt32LE(),
): Variant {
  const used = new Set(previous.filter((item) => item.trackId === trackId).map(variantFingerprint));
  for (let attempt = 0; attempt < 12; attempt++) {
    const variant = generateVariant(trackId, grade, nextSeed(), mode, familyId);
    if (!used.has(variantFingerprint(variant))) return variant;
  }
  throw new Error('Не удалось создать новый вариант; повторное задание не выдано');
}

/** Removes hidden answers and calibration internals from candidate-visible material. */
export function publicVariant(
  variant: Variant,
  stage = 0,
): Omit<Variant, 'oracle' | 'queries' | 'seed'> & { queries: { text: string }[] } {
  const { oracle: _oracle, seed: _seed, queries, ...visible } = variant;
  return {
    ...visible,
    ...(variant.lab && stage === 2 && variant.oracle.specialized
      ? { lab: { ...variant.lab, data: variant.oracle.specialized.changedData } }
      : {}),
    queries: queries.map(({ text }) => ({ text })),
  };
}
