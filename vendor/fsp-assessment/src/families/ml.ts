import { random } from '../random.js';
import type { LabData, LabRow } from '../domain.js';
import {
  choice,
  level,
  mean,
  num,
  numeric,
  quantile,
  select,
  value,
  type Family,
  type Theory,
} from './core.js';

const theory = (
  prompt: string,
  correct: string,
  wrong: string,
  other: string,
  skill: string,
): Theory => ({ prompt, options: [correct, wrong, other], correct: 0, skill });
const yesNo = (id: string, label: string) =>
  select(id, label, [
    ['no', 'Нет'],
    ['yes', 'Да'],
  ]);
const data = (rows: LabRow[], parameters: LabData['parameters']): LabData => ({ rows, parameters });
const thresholdValues = [0.2, 0.4, 0.6, 0.8];

function profit(
  rows: LabRow[],
  threshold: number,
  gain: number,
  loss: number,
): { profit: number; recall: number; precision: number } {
  let total = 0;
  let tp = 0;
  let fp = 0;
  let positives = 0;
  for (const row of rows) {
    const label = num(row, 'label');
    positives += label;
    if (num(row, 'probability') >= threshold) {
      total += label ? gain : -loss;
      tp += label;
      fp += 1 - label;
    }
  }
  return {
    profit: total,
    recall: tp / Math.max(1, positives),
    precision: tp / Math.max(1, tp + fp),
  };
}
const dsCost: Family = {
  id: 'ds-decision-cost',
  trackId: 'data-science',
  title: 'Порог модели: утечка, стоимость ошибок и временная проверка',
  skills: ['validation', 'experiments', 'data'],
  build(grade, seed) {
    const rng = random(seed);
    const n = 50 + level(grade) * 20;
    const gain = 20 + Math.floor(rng() * 20);
    const loss = 8 + Math.floor(rng() * 25);
    const rows = Array.from({ length: n }, (_, index) => {
      const probability = rng();
      return {
        time: index,
        probability,
        future: rng(),
        label: rng() < probability ? 1 : 0,
        group: index % 2,
      };
    });
    for (const row of rows) row.future = row.label;
    const make = (input: LabRow[]) => {
      const best = Math.max(
        ...thresholdValues.map(
          (threshold) =>
            profit(input.slice(Math.floor(input.length * 0.65)), threshold, gain, loss).profit,
        ),
      );
      return data(input, {
        gain,
        loss,
        minProfit: best - Math.max(1, gain * 0.1),
        cutoff: Math.floor(input.length * 0.65),
      });
    };
    return {
      data: make(rows),
      changedData: make(
        rows.map((row) => ({
          ...row,
          probability: Math.max(0.01, num(row, 'probability') - 0.13),
        })),
      ),
      controls: [
        select('score', 'Источник прогноза', [
          ['future', 'Агрегат после исхода'],
          ['probability', 'Вероятность на момент решения'],
        ]),
        select('split', 'Проверочная выборка', [
          ['random', 'Чередующиеся наблюдения'],
          ['time', 'Последний временной интервал'],
        ]),
        numeric('threshold', 'Порог решения', thresholdValues),
      ],
      contract: `Вероятность доступна до исхода; future появляется после исхода. Оценка проводится на последнем интервале. Польза TP=${gain}, стоимость FP=${loss}. Минимальная допустимая прибыль и граница интервала указаны в parameters.`,
      change:
        'Вероятности на новом интервале снизились на 0,13. Пересмотрите порог с тем же контрактом стоимости.',
      rubric: [
        'Доступность признаков до исхода',
        'Честное временное сравнение',
        'Фактическая прибыль',
      ],
      theory: [
        theory(
          'Какой результат можно использовать для выбора порога?',
          'Прибыль на корректном проверочном интервале',
          'Accuracy на обучении',
          'Максимальное число положительных решений',
          'evaluation',
        ),
        theory(
          'Как проверить будущие наблюдения?',
          'Выделить последний временной интервал',
          'Перемешать весь период',
          'Включить будущие агрегаты',
          'validation',
        ),
        theory(
          'Почему оптимальный порог может измениться?',
          'Изменились данные или стоимость ошибок',
          'Изменился порядок строк',
          'Порог всегда равен 0,5',
          'reasoning',
        ),
        theory(
          'Когда будущий агрегат допустим?',
          'Только если он фактически доступен на момент решения',
          'При высокой корреляции',
          'Если его предложил ИИ',
          'data',
        ),
      ],
    };
  },
  run(input, plan) {
    const rows =
      choice(plan, 'split') === 'time'
        ? input.rows.slice(num(input.parameters, 'cutoff'))
        : input.rows.filter((_row, index) => index % 2 === 0);
    const selected = rows.map((row) => ({
      ...row,
      probability:
        choice(plan, 'score') === 'future' ? num(row, 'future') : num(row, 'probability'),
    }));
    const output = profit(
      selected,
      value(plan, 'threshold'),
      num(input.parameters, 'gain'),
      num(input.parameters, 'loss'),
    );
    return {
      metrics: output,
      checks: {
        pointInTime: choice(plan, 'score') === 'probability',
        temporalValidation: choice(plan, 'split') === 'time',
        businessOutcome: output.profit >= num(input.parameters, 'minProfit'),
      },
      explanation:
        'Прибыль, precision и recall пересчитаны по выбранным решениям; высокий результат с будущим агрегатом не принимается.',
    };
  },
};

const dsSegments: Family = {
  id: 'ds-segment-thresholds',
  trackId: 'data-science',
  title: 'Качество по сегментам: единый порог скрывает потери',
  skills: ['evaluation', 'experiments', 'data'],
  build(grade, seed) {
    const rng = random(seed + 19);
    const rows: LabRow[] = [];
    for (let segment = 0; segment < 2; segment++)
      for (let i = 0; i < 40 + level(grade) * 15; i++) {
        const p = rng();
        rows.push({ segment, probability: p, label: rng() < p ? 1 : 0 });
      }
    const make = (changed: boolean) => {
      const gain0 = changed ? 15 : 40;
      const loss0 = changed ? 30 : 8;
      const gain1 = changed ? 50 : 12;
      const loss1 = changed ? 6 : 35;
      const best = [0, 1].map((segment) =>
        Math.max(
          ...thresholdValues.map(
            (threshold) =>
              profit(
                rows.filter((row) => row.segment === segment),
                threshold,
                segment ? gain1 : gain0,
                segment ? loss1 : loss0,
              ).profit,
          ),
        ),
      );
      return data(rows, { gain0, loss0, gain1, loss1, minProfit: best[0]! + best[1]! - 1 });
    };
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        select('policy', 'Пороговая политика', [
          ['shared', 'Один порог'],
          ['segmented', 'Порог по сегменту'],
        ]),
        numeric('threshold0', 'Порог сегмента 0', thresholdValues),
        numeric('threshold1', 'Порог сегмента 1', thresholdValues),
      ],
      contract:
        'В каждом сегменте различаются стоимость TP и FP. Сравнивайте итоговую пользу на всей фиксированной выборке. Для единого порога используется threshold0. Стоимости и допустимая польза заданы в parameters.',
      change:
        'Стоимость ошибок по сегментам поменялась. Повторите оптимизацию, не подменяя итоговую пользу средней accuracy.',
      rubric: [
        'Вычисление по каждому сегменту',
        'Соблюдение заданной функции пользы',
        'Повторная оценка после изменения стоимости',
      ],
      theory: [
        theory(
          'Что скрывает высокая средняя accuracy?',
          'Плохое качество или потери в отдельном сегменте',
          'Любые ошибки автоматически исправляются',
          'Она определяет пользу при любых затратах',
          'evaluation',
        ),
        theory(
          'Когда разные пороги обоснованы?',
          'При разных допустимых ограничениях и стоимости решений',
          'Всегда по названию группы',
          'Только ради красивой метрики',
          'reasoning',
        ),
        theory(
          'Какие данные нужны для сравнения?',
          'Исходы и стоимость ошибок по сегментам',
          'Только итоговый accuracy',
          'Число признаков',
          'data',
        ),
        theory(
          'Как реагировать на новую стоимость ошибок?',
          'Пересчитать решения и эффект',
          'Оставить пороги навсегда',
          'Скрыть сегмент с потерями',
          'experiments',
        ),
      ],
    };
  },
  run(input, plan) {
    const results = [0, 1].map((segment) =>
      profit(
        input.rows.filter((row) => row.segment === segment),
        value(
          plan,
          choice(plan, 'policy') === 'shared' || segment === 0 ? 'threshold0' : 'threshold1',
        ),
        num(input.parameters, `gain${segment}`),
        num(input.parameters, `loss${segment}`),
      ),
    );
    const total = results[0]!.profit + results[1]!.profit;
    return {
      metrics: {
        totalProfit: total,
        segment0Profit: results[0]!.profit,
        segment1Profit: results[1]!.profit,
        segment0Recall: results[0]!.recall,
        segment1Recall: results[1]!.recall,
      },
      checks: { requiredUtility: total >= num(input.parameters, 'minProfit') },
      explanation:
        'Результат рассчитан из фактических TP/FP, а не из названия выбранной политики. Несколько планов могут быть допустимы.',
    };
  },
};

const mlSkew: Family = {
  id: 'mle-serving-contract',
  trackId: 'ml-engineering',
  title: 'Training-serving skew: преобразования, пропуски и версия артефакта',
  skills: ['delivery', 'validation', 'data'],
  build(grade, seed) {
    const rng = random(seed);
    const trainMean = 4 + rng() * 3;
    const trainScale = 1.5 + rng();
    const median = trainMean + 0.4;
    const rows = Array.from({ length: 20 + level(grade) * 12 }, (_, index) => ({
      id: index,
      raw: index % 7 === 0 ? null : trainMean + (rng() - 0.5) * 8,
    }));
    return {
      data: data(rows, { trainMean, trainScale, median, bias: -0.15, expectedVersion: 3 }),
      changedData: data(
        rows.map((row) => ({ ...row, raw: row.raw === null ? null : row.raw + 1.1 })),
        { trainMean, trainScale, median, bias: -0.15, expectedVersion: 3 },
      ),
      controls: [
        select('normalization', 'Нормализация inference', [
          ['batch', 'Статистики текущего batch'],
          ['training', 'Сохранённые train-статистики'],
          ['none', 'Без нормализации'],
        ]),
        select('missing', 'Обработка пропуска', [
          ['zero', 'Ноль'],
          ['median', 'Сохранённая train-медиана'],
        ]),
        select('version', 'Версия модели', [
          ['latest', 'Последняя в реестре'],
          ['pinned', 'Версия из контракта'],
        ]),
      ],
      contract:
        'Версия 3 использует (x-trainMean)/trainScale + bias; пропуск заменяется train-медианой. Решение положительно при score>=0. Проверочный контракт не меняется при сдвиге потока. latest имеет другой bias (+0,9).',
      change:
        'Входные измерения увеличились на 1,1; сохранённый preprocessing и версия контракта остались прежними.',
      rubric: [
        'Паритет train/inference',
        'Детерминированная обработка пропусков',
        'Воспроизводимая версия',
      ],
      theory: [
        theory(
          'Где брать параметры preprocessing при inference?',
          'Из сохранённого обучающего артефакта',
          'Из каждого нового batch',
          'Из последнего ответа модели',
          'delivery',
        ),
        theory(
          'Почему batch-нормализация входа опасна здесь?',
          'Ответ зависит от соседних запросов',
          'Она всегда быстрее',
          'Она гарантирует паритет',
          'validation',
        ),
        theory(
          'Как воспроизвести пропуск?',
          'Использовать сохранённое правило обработки',
          'Подставить любой ноль',
          'Удалить запрос без фиксации',
          'data',
        ),
        theory(
          'Что включить в версию релиза?',
          'Модель и преобразования с контрактом',
          'Только имя файла',
          'Только дату',
          'delivery',
        ),
      ],
    };
  },
  run(input, plan) {
    const p = input.parameters;
    const present = input.rows.filter((row) => row.raw !== null).map((row) => num(row, 'raw'));
    const batchMean = mean(present);
    const batchScale = Math.sqrt(mean(present.map((item) => (item - batchMean) ** 2))) || 1;
    let mismatch = 0;
    let maxError = 0;
    for (const row of input.rows) {
      const expectedX = row.raw === null ? num(p, 'median') : num(row, 'raw');
      const expected = (expectedX - num(p, 'trainMean')) / num(p, 'trainScale') + num(p, 'bias');
      const x =
        row.raw === null
          ? choice(plan, 'missing') === 'median'
            ? num(p, 'median')
            : 0
          : num(row, 'raw');
      const normalized =
        choice(plan, 'normalization') === 'training'
          ? (x - num(p, 'trainMean')) / num(p, 'trainScale')
          : choice(plan, 'normalization') === 'batch'
            ? (x - batchMean) / batchScale
            : x;
      const predicted = normalized + (choice(plan, 'version') === 'pinned' ? num(p, 'bias') : 0.9);
      mismatch += expected >= 0 !== predicted >= 0 ? 1 : 0;
      maxError = Math.max(maxError, Math.abs(predicted - expected));
    }
    return {
      metrics: {
        predictionMismatches: mismatch,
        maxScoreError: maxError,
        requests: input.rows.length,
      },
      checks: { numericalParity: maxError < 1e-9, decisionParity: mismatch === 0 },
      explanation:
        'Preprocessing и score действительно пересчитаны для каждого запроса, включая пропуски.',
    };
  },
};

const mlBatching: Family = {
  id: 'mle-batching-precision',
  trackId: 'ml-engineering',
  title: 'Inference: batch, очередь и точность квантования',
  skills: ['cost', 'delivery', 'experiments'],
  build(grade, seed) {
    const rng = random(seed);
    const rows = Array.from({ length: 20 + level(grade) * 15 }, (_, index) => ({
      arrival: index * 0.22,
      signal: rng() * 2 - 1,
    }));
    const make = (rows: LabRow[]) =>
      data(rows, { maxP95: 15 + level(grade) * 10, maxWork: rows.length * 2.1, maxRmse: 0.006 });
    return {
      data: make(rows),
      changedData: make(rows.map((row) => ({ ...row, arrival: row.arrival * 0.35 }))),
      controls: [
        numeric('batch', 'Максимальный batch', [1, 4, 8]),
        numeric('wait', 'Ожидание batch, мс', [0, 2, 4]),
        select('precision', 'Точность вычислений', [
          ['fp32', 'FP32'],
          ['int8', 'INT8'],
        ]),
      ],
      contract:
        'Симулятор очереди считает ожидание, время вычислений и work units. INT8 округляет signal к сетке 1/127. FP32: 2+0,3*n мс и 4*n+2 units; INT8: 0,8+0,08*n мс и n+2 units. Порог качества и ресурсы заданы в parameters.',
      change: 'Запросы приходят в 2,86 раза чаще. Проверьте очередь и p95 без изменения SLA.',
      rubric: [
        'Задержка с учётом очереди',
        'Числовая ошибка квантования',
        'Ресурсная эффективность',
      ],
      theory: [
        theory(
          'Что входит в пользовательскую задержку?',
          'Ожидание и выполнение запроса',
          'Только время ядра',
          'Только размер batch',
          'delivery',
        ),
        theory(
          'Как проверять квантование?',
          'Измерить ошибку и качество на данных',
          'Считать INT8 всегда равным FP32',
          'Проверить имя формата',
          'validation',
        ),
        theory(
          'Чем опасен большой batch?',
          'Он может увеличить ожидание и p95',
          'Он всегда уменьшает p95',
          'Он исключает очередь',
          'cost',
        ),
        theory(
          'Что проверять после изменения нагрузки?',
          'SLA и очередь на новом потоке',
          'Только старую среднюю задержку',
          'Только первый запрос',
          'experiments',
        ),
      ],
    };
  },
  run(input, plan) {
    const batch = value(plan, 'batch');
    const wait = value(plan, 'wait');
    const low = choice(plan, 'precision') === 'int8';
    let clock = 0;
    let work = 0;
    const latency: number[] = [];
    const errors: number[] = [];
    for (let start = 0; start < input.rows.length;) {
      const first = num(input.rows[start]!, 'arrival');
      let end = start + 1;
      while (
        end < input.rows.length &&
        end - start < batch &&
        num(input.rows[end]!, 'arrival') <= first + wait
      )
        end++;
      const dispatch = Math.max(
        clock,
        end - start === batch ? num(input.rows[end - 1]!, 'arrival') : first + wait,
      );
      clock = dispatch + (low ? 0.8 + 0.08 * (end - start) : 2 + 0.3 * (end - start));
      work += (low ? 1 : 4) * (end - start) + 2;
      for (let index = start; index < end; index++) {
        const x = num(input.rows[index]!, 'signal');
        latency.push(clock - num(input.rows[index]!, 'arrival'));
        errors.push((x - (low ? Math.round(x * 127) / 127 : x)) ** 2);
      }
      start = end;
    }
    const p95 = quantile(latency, 0.95);
    const rmse = Math.sqrt(mean(errors));
    return {
      metrics: { p95, workUnits: work, rmse, requests: input.rows.length },
      checks: {
        latencySla: p95 <= num(input.parameters, 'maxP95'),
        resourceSla: work <= num(input.parameters, 'maxWork'),
        qualitySla: rmse <= num(input.parameters, 'maxRmse'),
      },
      explanation:
        'Очередь проиграна по arrival-времени; квантование применено к самим значениям. Это модель ресурсов, не измерение реального GPU.',
    };
  },
};

const canary: Family = {
  id: 'mlops-canary-rollback',
  trackId: 'mlops',
  title: 'Canary: сегментный SLO и обоснованный откат',
  skills: ['delivery', 'reliability', 'evaluation'],
  build(grade, seed) {
    const rng = random(seed);
    const make = (bad: boolean) =>
      data(
        Array.from({ length: 2 + level(grade) }, (_, segment) => ({
          segment,
          requests: segment ? 40 + Math.floor(rng() * 20) : 1800,
          errors: segment === 1 && bad ? 8 : 0,
          p95: segment === 1 && bad ? 320 : 80 + rng() * 20,
        })),
        { maxErrorRate: 0.03, maxP95: 180 },
      );
    const healthy = seed % 3 === 0;
    return {
      data: make(!healthy),
      changedData: make(healthy),
      controls: [
        select('scope', 'Область SLO', [
          ['aggregate', 'Весь трафик одной цифрой'],
          ['segments', 'Каждый критичный сегмент'],
        ]),
        select('decision', 'Решение о релизе', [
          ['continue', 'Продолжить canary'],
          ['rollback', 'Откатить релиз'],
        ]),
        yesNo('pinned', 'Зафиксировать версию и план восстановления'),
      ],
      contract:
        'SLO обязателен для каждого критичного сегмента: ошибки <=3%, p95<=180 мс. Откат нужен при нарушении хотя бы одного SLO. Здоровый релиз продолжает canary. Решение должно иметь фиксированную версию восстановления.',
      change:
        'Поступило новое окно canary с изменившимся состоянием сегментов. Пересмотрите решение.',
      rubric: [
        'Отдельные критичные сегменты',
        'Решение по фактическому SLO',
        'Воспроизводимый откат',
      ],
      theory: [
        theory(
          'Что может скрыть агрегированная метрика?',
          'Деградацию малой критичной группы',
          'Все сегменты автоматически учтены',
          'Отсутствие старой версии',
          'evaluation',
        ),
        theory(
          'Когда нужен откат по этому контракту?',
          'Когда нарушен SLO критичного сегмента',
          'Всегда после обновления',
          'Только при падении сервера',
          'delivery',
        ),
        theory(
          'Что фиксировать до canary?',
          'Версию и способ восстановления',
          'Только имя автора',
          'Только средний accuracy',
          'reliability',
        ),
        theory(
          'Когда допустимо продолжить canary?',
          'Когда все обязательные SLO выполнены',
          'Когда ошибок много, но группа мала',
          'Когда ИИ рекомендует запуск',
          'reasoning',
        ),
      ],
    };
  },
  run(input, plan) {
    const bad = input.rows.some(
      (row) =>
        num(row, 'errors') / num(row, 'requests') > num(input.parameters, 'maxErrorRate') ||
        num(row, 'p95') > num(input.parameters, 'maxP95'),
    );
    const errors = input.rows.reduce((sum, row) => sum + num(row, 'errors'), 0);
    const requests = input.rows.reduce((sum, row) => sum + num(row, 'requests'), 0);
    return {
      metrics: {
        aggregateErrorRate: errors / requests,
        worstSegmentErrorRate: Math.max(
          ...input.rows.map((row) => num(row, 'errors') / num(row, 'requests')),
        ),
        worstP95: Math.max(...input.rows.map((row) => num(row, 'p95'))),
      },
      checks: {
        criticalCoverage: choice(plan, 'scope') === 'segments',
        appropriateDecision: choice(plan, 'decision') === (bad ? 'rollback' : 'continue'),
        recoverableRelease: choice(plan, 'pinned') === 'yes',
      },
      explanation:
        'Решение сверено с фактическими SLO каждого сегмента. Автоматическое отклонение любого релиза тоже может быть ошибкой.',
    };
  },
};

const featureStore: Family = {
  id: 'mlops-point-in-time',
  trackId: 'mlops',
  title: 'Feature Store: point-in-time join, TTL и задержка источника',
  skills: ['data', 'delivery', 'validation'],
  build(grade, seed) {
    const rng = random(seed);
    const rows: LabRow[] = [];
    for (let entity = 0; entity < 4 + level(grade) * 3; entity++) {
      const prediction = 100 + entity * 3;
      for (const delta of [-40, -12, 8])
        rows.push({
          entity,
          prediction,
          featureTime: prediction + delta,
          recordedAt: prediction + delta + 2,
          feature: Math.floor(rng() * 200),
        });
    }
    const sourceRows = rows.filter(
      (row) =>
        !(
          row.entity === 3 + level(grade) * 3 &&
          num(row, 'featureTime') === num(row, 'prediction') - 12
        ),
    );
    const make = (changed: boolean) =>
      data(
        sourceRows.map((row) => ({
          ...row,
          recordedAt: num(row, 'recordedAt') + (changed ? 5 : 0),
        })),
        { maxAge: 30, minCoverage: 0.75 },
      );
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        select('join', 'Способ join', [
          ['latest', 'Последняя запись сущности'],
          ['asof', 'Запись, доступная к моменту прогноза'],
        ]),
        numeric('ttl', 'TTL признака, минуты', [5, 15, 30, 60]),
        select('missing', 'Если доступного признака нет', [
          ['future', 'Взять ближайший будущий'],
          ['abstain', 'Зафиксировать отсутствие'],
        ]),
      ],
      contract:
        'Запись допустима, если featureTime и recordedAt не позже prediction, а возраст <=maxAge. При отсутствии записи нужно явно зафиксировать пропуск. Покрытие не ниже minCoverage.',
      change:
        'Источник начал записывать сведения на 5 минут позже. Проверяйте recordedAt вместе с featureTime.',
      rubric: ['Отсутствие будущих сведений', 'TTL и полнота', 'Явная обработка пропуска'],
      theory: [
        theory(
          'Какие времена важны при историческом join?',
          'Время события и фактической доступности',
          'Только время последней записи',
          'Только время запуска теста',
          'data',
        ),
        theory(
          'Что означает TTL?',
          'Максимальный допустимый возраст признака',
          'Минимальный размер batch',
          'Количество классов',
          'delivery',
        ),
        theory(
          'Можно ли заполнить пропуск будущим значением?',
          'Нет, если оно недоступно на момент прогноза',
          'Да при высокой accuracy',
          'Да для любой истории',
          'validation',
        ),
        theory(
          'Почему replay должен быть историческим?',
          'Чтобы воспроизвести доступную тогда информацию',
          'Чтобы использовать новые записи',
          'Чтобы увеличить датасет',
          'experiments',
        ),
      ],
    };
  },
  run(input, plan) {
    const entities = [...new Set(input.rows.map((row) => row.entity))];
    let future = 0;
    let stale = 0;
    let found = 0;
    for (const entity of entities) {
      const records = input.rows.filter((row) => row.entity === entity);
      const prediction = num(records[0]!, 'prediction');
      const permitted = records
        .filter(
          (row) =>
            choice(plan, 'join') === 'latest' ||
            (num(row, 'featureTime') <= prediction && num(row, 'recordedAt') <= prediction),
        )
        .filter((row) => prediction - num(row, 'featureTime') <= value(plan, 'ttl'))
        .sort((a, b) => num(b, 'featureTime') - num(a, 'featureTime'));
      const selected =
        permitted[0] ?? (choice(plan, 'missing') === 'future' ? records.at(-1) : undefined);
      if (!selected) continue;
      found++;
      future +=
        num(selected, 'featureTime') > prediction || num(selected, 'recordedAt') > prediction
          ? 1
          : 0;
      stale += prediction - num(selected, 'featureTime') > num(input.parameters, 'maxAge') ? 1 : 0;
    }
    return {
      metrics: { futureLeaks: future, staleFeatures: stale, coverage: found / entities.length },
      checks: {
        temporalIntegrity: future === 0,
        freshFeatures: stale === 0,
        sufficientCoverage: found / entities.length >= num(input.parameters, 'minCoverage'),
        explicitMissing: choice(plan, 'missing') === 'abstain',
      },
      explanation:
        'Для каждой сущности выполнен временной join с проверкой момента записи и возраста.',
    };
  },
};

const ragTrust: Family = {
  id: 'llm-retrieval-trust',
  trackId: 'llm',
  title: 'RAG: устаревший документ, недоверенный источник и prompt injection',
  skills: ['retrieval', 'evaluation', 'data'],
  build(grade, seed) {
    const rng = random(seed);
    const rows: LabRow[] = [];
    for (let query = 0; query < 3 + level(grade); query++) {
      rows.push(
        {
          query,
          document: `verified-${query}`,
          relevance: 0.8 + rng() * 0.05,
          current: true,
          trusted: true,
          injection: query === 0,
        },
        {
          query,
          document: `archive-${query}`,
          relevance: 0.99,
          current: false,
          trusted: true,
          injection: false,
        },
        {
          query,
          document: `external-${query}`,
          relevance: 1,
          current: true,
          trusted: false,
          injection: true,
        },
      );
    }
    const make = (changed: boolean) =>
      data(
        rows.map((row) => ({
          ...row,
          injection: row.injection || (changed && row.document === 'archive-0'),
        })),
        { queries: 3 + level(grade) },
      );
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        yesNo('currentOnly', 'Оставить только актуальные документы'),
        yesNo('trustedOnly', 'Оставить только разрешённые источники'),
        select('instructions', 'Инструкции внутри источника', [
          ['execute', 'Выполнять'],
          ['data', 'Считать недоверенными данными'],
        ]),
      ],
      contract:
        'Для ответа нужен актуальный разрешённый источник. Текст источника не меняет системные правила. Retrieval выбирает максимальную relevance после фильтров.',
      change:
        'В архивном документе появился текст с инструкцией раскрыть данные. Проверяйте границы доверия независимо от положения в выдаче.',
      rubric: [
        'Версии источников',
        'Происхождение доказательств',
        'Обработка внедрённых инструкций',
      ],
      theory: [
        theory(
          'Как обращаться с инструкцией в найденном документе?',
          'Как с недоверенными данными',
          'Как с системной командой',
          'Как с разрешением пользователя',
          'retrieval',
        ),
        theory(
          'Гарантирует ли relevance достоверность?',
          'Нет, нужны происхождение и актуальность',
          'Да, если значение максимально',
          'Да для длинного текста',
          'evaluation',
        ),
        theory(
          'Что проверять в RAG-оценке?',
          'Источник, актуальность и границы доверия',
          'Только длину ответа',
          'Только температуру модели',
          'data',
        ),
        theory(
          'Как проверять защиту от injection?',
          'На атакующих и обычных материалах',
          'Только на успешных ответах',
          'Скрыть весь текст документов',
          'experiments',
        ),
      ],
    };
  },
  run(input, plan) {
    let correct = 0;
    let injections = 0;
    let missing = 0;
    const count = num(input.parameters, 'queries');
    for (let query = 0; query < count; query++) {
      const selected = input.rows
        .filter(
          (row) =>
            row.query === query &&
            (choice(plan, 'currentOnly') !== 'yes' || row.current) &&
            (choice(plan, 'trustedOnly') !== 'yes' || row.trusted),
        )
        .sort((a, b) => num(b, 'relevance') - num(a, 'relevance'))[0];
      if (!selected) {
        missing++;
        continue;
      }
      correct += selected.current && selected.trusted ? 1 : 0;
      injections += selected.injection && choice(plan, 'instructions') === 'execute' ? 1 : 0;
    }
    return {
      metrics: {
        correctSources: correct,
        injectionExecutions: injections,
        missing,
        sourceAccuracy: correct / count,
      },
      checks: {
        sourceContract: correct === count,
        noInstructionExecution: injections === 0 && choice(plan, 'instructions') === 'data',
      },
      explanation:
        'Источники ранжированы после выбранных фильтров; модель не вызывается и выполнение внедрённых инструкций только моделируется.',
    };
  },
};

const grounding: Family = {
  id: 'llm-grounding-abstention',
  trackId: 'llm',
  title: 'Оценка ответов: доказательство, отказ и расход контекста',
  skills: ['evaluation', 'cost', 'retrieval'],
  build(grade, seed) {
    const rng = random(seed);
    const rows = Array.from({ length: 12 + level(grade) * 6 }, (_, index) => {
      const known = index % 4 !== 0;
      const fact = Math.floor(rng() * 100);
      return {
        known,
        fact: known ? fact : null,
        proposed: index % 5 === 0 ? fact + 1 : fact,
        confidence: known ? 0.8 : 0.95,
        cited: index % 5 !== 0,
        contextTokens: 120 + Math.floor(rng() * 50),
      };
    });
    const make = (changed: boolean) =>
      data(
        rows.map((row, index) => ({
          ...row,
          proposed: changed && index % 3 === 0 ? row.proposed + 2 : row.proposed,
        })),
        { maxTokens: rows.length * 220 },
      );
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        select('acceptance', 'Приёмка предложенного ответа', [
          ['confidence', 'По уверенности модели'],
          ['evidence', 'По совпадению с подтверждённым фактом и ссылке'],
        ]),
        select('unknown', 'Неподдержанный вопрос', [
          ['answer', 'Выдать предложение модели'],
          ['abstain', 'Сообщить об отсутствии основания'],
        ]),
        numeric('contextCopies', 'Количество копий контекста', [1, 2, 3]),
      ],
      contract:
        'Ответ принимается только при известном факте, точном совпадении proposed=fact и наличии ссылки. Остальные случаи требуют отказа. confidence не является доказательством. Повтор контекста увеличивает token units, но не добавляет сведений.',
      change:
        'Часть предложенных числовых ответов изменилась при прежних источниках. Повторите оценку grounding.',
      rubric: ['Проверка конкретного утверждения', 'Корректные отказы', 'Ресурсная эффективность'],
      theory: [
        theory(
          'Уверенность модели подтверждает факт?',
          'Нет, нужно проверяемое основание',
          'Да при confidence>0,9',
          'Да для сильной модели',
          'evaluation',
        ),
        theory(
          'Когда следует отказаться от утверждения?',
          'Когда нет поддерживающего источника',
          'Когда ответ короткий',
          'Когда вопрос сложный независимо от данных',
          'retrieval',
        ),
        theory(
          'Что даёт копирование того же контекста?',
          'Дополнительный расход без новых доказательств',
          'Гарантию достоверности',
          'Независимую проверку',
          'cost',
        ),
        theory(
          'Как проверить числовое утверждение?',
          'Сопоставить с фактом источника',
          'Проверить уверенный тон',
          'Проверить количество токенов',
          'reasoning',
        ),
      ],
    };
  },
  run(input, plan) {
    let falseAccept = 0;
    let trueAccept = 0;
    let correctRefusal = 0;
    let missed = 0;
    let tokens = 0;
    for (const row of input.rows) {
      const supported = row.known && row.proposed === row.fact && row.cited;
      const accepted = !row.known
        ? choice(plan, 'unknown') === 'answer'
        : choice(plan, 'acceptance') === 'evidence'
          ? Boolean(supported)
          : num(row, 'confidence') > 0.7;
      if (accepted) {
        if (supported) trueAccept++;
        else falseAccept++;
      } else if (supported) missed++;
      else correctRefusal++;
      tokens += num(row, 'contextTokens') * value(plan, 'contextCopies');
    }
    return {
      metrics: {
        falseAccept,
        trueAccept,
        correctRefusal,
        missedSupported: missed,
        tokenUnits: tokens,
      },
      checks: {
        factualAcceptance: falseAccept === 0,
        supportedCoverage: missed === 0,
        tokenEfficiency: tokens <= num(input.parameters, 'maxTokens'),
      },
      explanation:
        'Проверены утверждения и ссылки на уровне каждого ответа. Token units — расчёт сценария, не списание по API-ключу.',
    };
  },
};

function iou(a: LabRow, b: LabRow): number {
  const intersection =
    Math.max(0, Math.min(num(a, 'x2'), num(b, 'x2')) - Math.max(num(a, 'x1'), num(b, 'x1'))) *
    Math.max(0, Math.min(num(a, 'y2'), num(b, 'y2')) - Math.max(num(a, 'y1'), num(b, 'y1')));
  const area = (row: LabRow) =>
    (num(row, 'x2') - num(row, 'x1')) * (num(row, 'y2') - num(row, 'y1'));
  return intersection / Math.max(1e-9, area(a) + area(b) - intersection);
}
const detection: Family = {
  id: 'cv-detection-nms',
  trackId: 'cv',
  title: 'Детекция: IoU, NMS по классам и precision/recall',
  skills: ['evaluation', 'experiments', 'validation'],
  build(grade, seed) {
    const rng = random(seed);
    const rows: LabRow[] = [];
    for (let image = 0; image < 2 + level(grade); image++)
      for (let cls = 0; cls < 2; cls++) {
        const x = rng() * 10;
        const box = { image, cls, x1: x, y1: 0, x2: x + 20, y2: 20 };
        rows.push(
          { ...box, kind: 'truth', score: 1 },
          { ...box, kind: 'prediction', score: 0.82 },
          { ...box, x1: x + 1, x2: x + 21, kind: 'prediction', score: 0.72 },
          { ...box, x1: 60, x2: 80, kind: 'prediction', score: 0.2 },
        );
      }
    const make = (changed: boolean) =>
      data(
        rows.map((row) => ({
          ...row,
          score:
            row.kind === 'prediction' && num(row, 'score') > 0.7
              ? num(row, 'score') - (changed ? 0.15 : 0)
              : num(row, 'score'),
        })),
        { matchIou: 0.5, minPrecision: 0.99, minRecall: 0.99 },
      );
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        numeric('confidence', 'Порог confidence', [0.1, 0.5, 0.8]),
        numeric('nmsIou', 'IoU для NMS', [0.3, 0.6, 0.95]),
        select('scope', 'Подавление пересечений', [
          ['global', 'Все классы вместе'],
          ['classwise', 'Отдельно по классу'],
        ]),
      ],
      contract:
        'Оценка требует однозначного соответствия детекции ground truth того же класса при IoU>=0,5. Дубликаты дают FP. Объекты разных классов могут перекрываться. Минимальные precision и recall заданы в parameters.',
      change:
        'Confidence качественных детекций снизился на 0,15. Повторно подберите фильтрацию, сохраняя precision и recall.',
      rubric: ['Геометрический IoU', 'Правильное подавление дубликатов', 'Оценка TP/FP/FN'],
      theory: [
        theory(
          'Как учитывать две детекции одного объекта?',
          'Одно соответствие TP, лишние детекции FP',
          'Обе считать TP',
          'Игнорировать дубликаты после метрики',
          'evaluation',
        ),
        theory(
          'Почему NMS должен учитывать класс?',
          'Разные классы могут геометрически перекрываться',
          'Класс не влияет на оценку',
          'Для увеличения batch',
          'validation',
        ),
        theory(
          'Что означает FN?',
          'Объект ground truth не найден',
          'Лишняя детекция',
          'Дубликат ответа',
          'evaluation',
        ),
        theory(
          'Что проверять при изменении confidence?',
          'Precision и recall вместе',
          'Только число боксов',
          'Только старый порог',
          'experiments',
        ),
      ],
    };
  },
  run(input, plan) {
    const truths = input.rows.filter((row) => row.kind === 'truth');
    const predictions = input.rows
      .filter((row) => row.kind === 'prediction' && num(row, 'score') >= value(plan, 'confidence'))
      .sort((a, b) => num(b, 'score') - num(a, 'score'));
    const kept: LabRow[] = [];
    for (const box of predictions)
      if (
        !kept.some(
          (prior) =>
            prior.image === box.image &&
            (choice(plan, 'scope') === 'global' || prior.cls === box.cls) &&
            iou(prior, box) > value(plan, 'nmsIou'),
        )
      )
        kept.push(box);
    const matched = new Set<number>();
    let tp = 0;
    for (const box of kept) {
      const index = truths.findIndex(
        (truth, position) =>
          !matched.has(position) &&
          truth.image === box.image &&
          truth.cls === box.cls &&
          iou(truth, box) >= num(input.parameters, 'matchIou'),
      );
      if (index >= 0) {
        matched.add(index);
        tp++;
      }
    }
    const precision = tp / Math.max(1, kept.length);
    const recall = tp / truths.length;
    return {
      metrics: { tp, fp: kept.length - tp, fn: truths.length - tp, precision, recall },
      checks: {
        preciseDetections: precision >= num(input.parameters, 'minPrecision'),
        completeDetections: recall >= num(input.parameters, 'minRecall'),
      },
      explanation:
        'NMS и одно-к-одному сопоставление боксов выполнены геометрически, а не по названию выбранной стратегии.',
    };
  },
};

const cameras: Family = {
  id: 'cv-camera-shortcut',
  trackId: 'cv',
  title: 'Перенос между камерами: shortcut и nearest-centroid классификатор',
  skills: ['validation', 'data', 'experiments'],
  build(grade, seed) {
    const rng = random(seed);
    const rows: LabRow[] = [];
    const cameraCount = 2 + level(grade);
    for (let camera = 0; camera < cameraCount; camera++)
      for (let index = 0; index < 24; index++) {
        const label = index % 2;
        rows.push({
          camera,
          label,
          foreground: label + (rng() - 0.5) * 0.3,
          background: (camera === cameraCount - 1 ? 1 - label : label) + (rng() - 0.5) * 0.1,
        });
      }
    const make = (changed: boolean) =>
      data(
        rows.map((row) => ({
          ...row,
          background: changed ? 1 - num(row, 'background') : num(row, 'background'),
        })),
        { heldoutCamera: cameraCount - 1, minAccuracy: 0.95 },
      );
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        select('features', 'Признаки классификатора', [
          ['background', 'Фон'],
          ['foreground', 'Объект'],
          ['both', 'Объект и фон'],
        ]),
        select('split', 'Проверка переноса', [
          ['random', 'Чередующиеся кадры всех камер'],
          ['camera', 'Отложенная камера'],
        ]),
        select('augmentation', 'Инвариантное преобразование', [
          ['none', 'Без преобразования'],
          ['mask-background', 'Маскировать фон'],
        ]),
      ],
      contract:
        'Foreground — признак объекта, background — признак окружения. Задача: перенос на heldoutCamera. Симулятор действительно обучает centroid для двух классов на train и считает accuracy на test.',
      change: 'Корреляция фона и класса изменилась. Сохраняйте проверку на отложенной камере.',
      rubric: ['Разделение по доменам', 'Контроль shortcut', 'Фактическое качество классификатора'],
      theory: [
        theory(
          'Что проверяет случайный split всех камер?',
          'Он может не проверить перенос на новую камеру',
          'Гарантирует domain generalization',
          'Заменяет оценку на новой камере',
          'validation',
        ),
        theory(
          'Что такое shortcut в этом сценарии?',
          'Использование корреляции фона вместо признака объекта',
          'Короткий код обучения',
          'Уменьшение batch',
          'data',
        ),
        theory(
          'Как проверить пользу маскирования?',
          'Сравнить на отложенном домене',
          'Только на train',
          'По названию augmentation',
          'experiments',
        ),
        theory(
          'Как трактовать падение на новой камере?',
          'Исследовать перенос и распределения',
          'Игнорировать новую камеру',
          'Добавить её в train и назвать тестом',
          'reasoning',
        ),
      ],
    };
  },
  run(input, plan) {
    const heldout = num(input.parameters, 'heldoutCamera');
    const train = input.rows.filter((row, index) =>
      choice(plan, 'split') === 'camera' ? row.camera !== heldout : index % 3 !== 0,
    );
    const test = input.rows.filter((row, index) =>
      choice(plan, 'split') === 'camera' ? row.camera === heldout : index % 3 === 0,
    );
    const featureKeys =
      choice(plan, 'features') === 'both'
        ? ['foreground', 'background']
        : [choice(plan, 'features')];
    const vector = (row: LabRow) =>
      featureKeys.map((key) =>
        key === 'background' && choice(plan, 'augmentation') === 'mask-background'
          ? 0
          : num(row, key),
      );
    const centers = [0, 1].map((label) =>
      featureKeys.map((_key, feature) =>
        mean(train.filter((row) => row.label === label).map((row) => vector(row)[feature]!)),
      ),
    );
    let correct = 0;
    for (const row of test) {
      const distances = centers.map((center) =>
        vector(row).reduce((sum, item, index) => sum + (item - center[index]!) ** 2, 0),
      );
      if ((distances[1]! < distances[0]! ? 1 : 0) === row.label) correct++;
    }
    const accuracy = correct / test.length;
    return {
      metrics: { accuracy, trainFrames: train.length, testFrames: test.length },
      checks: {
        heldoutDomain: choice(plan, 'split') === 'camera',
        transferQuality: accuracy >= num(input.parameters, 'minAccuracy'),
      },
      explanation:
        'Центроиды обучены на выбранной train-части. Качество считается на фактически отложенных кадрах.',
    };
  },
};

function ndcg(rows: LabRow[], k: number, key: string): number {
  const gain = (items: LabRow[]) =>
    items
      .slice(0, k)
      .reduce(
        (sum, row, index) => sum + (2 ** num(row, 'relevance') - 1) / Math.log2(index + 2),
        0,
      );
  const ranked = [...rows].sort((a, b) => num(b, key) - num(a, key));
  const ideal = [...rows].sort((a, b) => num(b, 'relevance') - num(a, 'relevance'));
  return gain(ranked) / Math.max(1e-9, gain(ideal));
}
const rankQuality: Family = {
  id: 'ranking-ndcg-availability',
  trackId: 'ranking',
  title: 'Ранжирование: NDCG, недоступные товары и будущий feedback',
  skills: ['evaluation', 'validation', 'data'],
  build(grade, seed) {
    const rng = random(seed);
    const rows: LabRow[] = [];
    for (let query = 0; query < 2 + level(grade); query++)
      for (let item = 0; item < 8; item++) {
        const relevance = item < 4 ? 3 - (item % 3) : 0;
        rows.push({
          query,
          item,
          relevance,
          score: relevance + rng() * 0.1,
          futureScore: relevance + 10,
          available: item !== 0,
          staleScore: rng() * 4,
        });
      }
    const make = (changed: boolean) =>
      data(
        rows.map((row) => ({
          ...row,
          available: changed && row.item === 1 ? false : Boolean(row.available),
        })),
        { minNdcg: 0.95, k: 3 },
      );
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        select('score', 'Сигнал ранжирования', [
          ['staleScore', 'Непроверенный старый score'],
          ['score', 'Доступный score'],
          ['futureScore', 'Feedback после показа'],
        ]),
        yesNo('availability', 'Фильтровать недоступные товары'),
        select('grouping', 'Расчёт метрики', [
          ['global', 'Одна общая выдача'],
          ['query', 'NDCG отдельно по запросам'],
        ]),
      ],
      contract:
        'Считать NDCG@3 по каждому запросу среди доступных товаров. futureScore появляется после показа. Наличие недоступных товаров в выдаче запрещено.',
      change:
        'Товар с item=1 стал недоступен. Пересчитайте выдачу и идеальную нормировку по оставшимся товарам.',
      rubric: ['Listwise-метрика', 'Доступность товаров', 'Временная корректность сигнала'],
      theory: [
        theory(
          'Как нормировать NDCG?',
          'На идеальную выдачу того же запроса и набора',
          'На общую сумму всех товаров',
          'На число признаков',
          'evaluation',
        ),
        theory(
          'Можно ли использовать feedback после показа?',
          'Только если он доступен до нового решения; здесь нет',
          'Всегда для offline-метрики',
          'Если NDCG высокий',
          'validation',
        ),
        theory(
          'Как учитывать удалённый товар?',
          'Исключить из выдачи и допустимого набора оценки',
          'Оставить ради relevance',
          'Скрыть только в отчёте',
          'data',
        ),
        theory(
          'Почему метрика считается по запросам?',
          'Порядок выдачи имеет смысл внутри запроса',
          'Для большего числа строк',
          'Это не влияет на результат',
          'evaluation',
        ),
      ],
    };
  },
  run(input, plan) {
    const queries = [...new Set(input.rows.map((row) => row.query))];
    let unavailable = 0;
    const scores: number[] = [];
    for (const query of queries) {
      const all = input.rows.filter((row) => row.query === query);
      const eligible =
        choice(plan, 'availability') === 'yes' ? all.filter((row) => row.available) : all;
      const top = [...eligible]
        .sort((a, b) => num(b, choice(plan, 'score')) - num(a, choice(plan, 'score')))
        .slice(0, num(input.parameters, 'k'));
      unavailable += top.filter((row) => !row.available).length;
      scores.push(ndcg(eligible, num(input.parameters, 'k'), choice(plan, 'score')));
    }
    const result = mean(scores);
    return {
      metrics: { meanNdcg: result, unavailableInTop: unavailable, queries: queries.length },
      checks: {
        rankingQuality: result >= num(input.parameters, 'minNdcg'),
        inventoryIntegrity: unavailable === 0,
        pointInTime: choice(plan, 'score') !== 'futureScore',
        queryMetric: choice(plan, 'grouping') === 'query',
      },
      explanation: 'DCG и идеальная DCG вычислены по ранжированным спискам каждого запроса.',
    };
  },
};

const ips: Family = {
  id: 'ranking-off-policy-ips',
  trackId: 'ranking',
  title: 'Оценка новой политики по логам: propensity и overlap',
  skills: ['evaluation', 'experiments', 'validation'],
  build(grade, seed) {
    const rng = random(seed);
    const rows: LabRow[] = [];
    const groups = 2 + level(grade);
    let expected = 0;
    for (let group = 0; group < groups; group++) {
      const p = group % 2 ? 0.2 : 0.8;
      const reward = 0.25 + rng() * 0.5;
      expected += reward / groups;
      for (let i = 0; i < 10; i++)
        rows.push({ group, chosen: i < p * 10, propensity: p, reward: i < p * 10 ? reward : 0 });
    }
    const make = (changed: boolean) =>
      data(
        rows.map((row) => ({ ...row, reward: num(row, 'reward') * (changed ? 0.75 : 1) })),
        { expected: expected * (changed ? 0.75 : 1), maxError: 1e-9 },
      );
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        select('estimator', 'Оценка целевой политики', [
          ['naive', 'Средняя награда выбранных'],
          ['ips', 'IPS по propensity'],
        ]),
        numeric('clip', 'Максимальный importance weight', [1, 3, 10]),
        yesNo('overlap', 'Проверить ненулевую вероятность целевого действия'),
      ],
      contract:
        'Целевая политика всегда выбирает logged action с chosen=true. Группы равновесны. IPS = sum(chosen*reward/propensity)/число всех наблюдений. Контрольная полная оценка expected дана для проверки расчёта; clipping меняет оценку.',
      change:
        'Награда каждого поддержанного действия уменьшилась на 25%. Пересчитайте оценку при тех же propensity.',
      rubric: ['Коррекция logging bias', 'Правильная нормировка', 'Overlap и влияние clipping'],
      theory: [
        theory(
          'Что исправляет IPS?',
          'Неравную вероятность выбора действия в логах',
          'Любую утечку автоматически',
          'Отсутствие данных о propensity',
          'evaluation',
        ),
        theory(
          'Почему нельзя среднее только по выбранным?',
          'Выборка смещена logging-политикой',
          'Она всегда слишком большая',
          'Потому что так короче код',
          'validation',
        ),
        theory(
          'Что делает clipping?',
          'Ограничивает вес, но может внести смещение',
          'Гарантирует несмещённость',
          'Создаёт новые наблюдения',
          'experiments',
        ),
        theory(
          'Что означает отсутствие overlap?',
          'Нет надёжной оценки неподдержанного действия',
          'Действие оптимально',
          'Можно заменить propensity нулём',
          'reasoning',
        ),
      ],
    };
  },
  run(input, plan) {
    const chosen = input.rows.filter((row) => row.chosen);
    const estimate =
      choice(plan, 'estimator') === 'naive'
        ? mean(chosen.map((row) => num(row, 'reward')))
        : input.rows.reduce(
            (sum, row) =>
              sum +
              (row.chosen
                ? num(row, 'reward') * Math.min(value(plan, 'clip'), 1 / num(row, 'propensity'))
                : 0),
            0,
          ) / input.rows.length;
    const weights = chosen.map((row) => Math.min(value(plan, 'clip'), 1 / num(row, 'propensity')));
    const ess =
      weights.reduce((sum, item) => sum + item, 0) ** 2 /
      Math.max(
        1e-9,
        weights.reduce((sum, item) => sum + item ** 2, 0),
      );
    const error = Math.abs(estimate - num(input.parameters, 'expected'));
    return {
      metrics: { estimate, absoluteError: error, effectiveSampleSize: ess },
      checks: {
        estimatorAccuracy: error <= num(input.parameters, 'maxError'),
        overlapVerified:
          choice(plan, 'overlap') === 'yes' &&
          input.rows.every((row) => num(row, 'propensity') > 0),
      },
      explanation:
        'Importance weights, нормировка и ESS рассчитаны по самим логам. Это синтетическая контролируемая оценка, не доказательство качества реального recommender.',
    };
  },
};

function interval(differences: number[]): { delta: number; lower: number; upper: number } {
  const delta = mean(differences);
  const variance =
    differences.length > 1
      ? differences.reduce((sum, item) => sum + (item - delta) ** 2, 0) / (differences.length - 1)
      : 0;
  const radius = 2.5 * Math.sqrt(variance / Math.max(1, differences.length));
  return { delta, lower: delta - radius, upper: delta + radius };
}
const ablation: Family = {
  id: 'research-paired-ablation',
  trackId: 'research',
  title: 'Ablation: парные seed, разброс и выбор удачного запуска',
  skills: ['experiments', 'validation', 'evaluation'],
  build(grade, seed) {
    const rng = random(seed);
    const effect = seed % 3 === 0 ? -0.01 : 0.025;
    const rows = Array.from({ length: 4 + level(grade) * 4 }, (_, index) => {
      const baseline = 0.65 + rng() * 0.12;
      return { seed: index, baseline, treatment: baseline + effect + (rng() - 0.5) * 0.004 };
    });
    const make = (changed: boolean) =>
      data(
        rows.map((row) => ({ ...row, treatment: row.treatment + (changed ? -effect - 0.008 : 0) })),
        { minSeeds: 4, critical: 2.5 },
      );
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        select('sample', 'Какие запуски сравнить', [
          ['best', 'Лучший treatment-run'],
          ['all-paired', 'Все парные seed'],
        ]),
        select('uncertainty', 'Учёт неопределённости', [
          ['none', 'Только средний эффект'],
          ['interval', 'Интервал по парным разностям'],
        ]),
        select('claim', 'Вывод об улучшении', [
          ['yes', 'Улучшение подтверждено'],
          ['no', 'Положительное улучшение не подтверждено'],
        ]),
      ],
      contract:
        'Разности treatment-baseline считаются внутри seed. Используем заданную консервативную границу mean ± 2,5*SE как учебный критерий, не универсальную статистическую гарантию. Улучшение заявляется, только если нижняя граница >0.',
      change:
        'Новая ablation-серия убрала преимущество. Проверьте, сохраняется ли первоначальное утверждение.',
      rubric: ['Парность и полная серия', 'Неопределённость', 'Вывод по результату'],
      theory: [
        theory(
          'Зачем одинаковые seed для пары?',
          'Контролировать вариативность сравнения',
          'Гарантировать улучшение',
          'Выбрать лучший запуск',
          'experiments',
        ),
        theory(
          'Почему нельзя выбрать только удачный run?',
          'Возникает смещение выбора',
          'Он всегда медленный',
          'Это уменьшает параметры',
          'validation',
        ),
        theory(
          'Как трактовать интервал, пересекающий ноль?',
          'Не заявлять подтверждённое положительное улучшение по этому критерию',
          'Считать среднее достаточным',
          'Удалить неудачные seed',
          'evaluation',
        ),
        theory(
          'Что должна менять ablation?',
          'Изолируемый компонент при прочих сопоставимых условиях',
          'Всё сразу',
          'Только название модели',
          'reasoning',
        ),
      ],
    };
  },
  run(input, plan) {
    const all = input.rows.map((row) => num(row, 'treatment') - num(row, 'baseline'));
    const selected = choice(plan, 'sample') === 'best' ? [Math.max(...all)] : all;
    const result = interval(selected);
    const shouldClaim = interval(all).lower > 0;
    return {
      metrics: { ...result, runs: selected.length },
      checks: {
        fullPairedSeries: selected.length === input.rows.length,
        uncertaintyReported: choice(plan, 'uncertainty') === 'interval',
        justifiedClaim: choice(plan, 'claim') === (shouldClaim ? 'yes' : 'no'),
      },
      explanation:
        'Эффект и SE вычислены по парным разностям. Граница 2,5*SE — явно заданный учебный критерий.',
    };
  },
};

const computeParity: Family = {
  id: 'research-compute-parity',
  trackId: 'research',
  title: 'Исследование: compute-confound и сопоставимый baseline',
  skills: ['experiments', 'evaluation', 'cost'],
  build(grade, seed) {
    const rng = random(seed);
    const effect = seed % 2 ? 0.015 : -0.012;
    const rows: LabRow[] = [];
    for (let block = 0; block < 3 + level(grade); block++)
      for (const budget of [1, 4]) {
        const baseline = 0.6 + budget * 0.025 + rng() * 0.005;
        rows.push({ block, budget, baseline, proposed: baseline + effect });
      }
    const make = (changed: boolean) =>
      data(
        rows.map((row) => ({
          ...row,
          proposed: num(row, 'proposed') + (changed ? -effect - 0.01 : 0),
        })),
        { tolerance: 1e-9 },
      );
    return {
      data: make(false),
      changedData: make(true),
      controls: [
        select('comparison', 'Сравнение baseline', [
          ['confounded', 'Proposed при budget=4 против baseline при budget=1'],
          ['matched', 'Внутри одинакового block и budget'],
        ]),
        yesNo('reportCompute', 'Указать compute и все блоки'),
        select('claim', 'Вывод', [
          ['yes', 'Улучшение метода подтверждено'],
          ['no', 'Преимущество метода не подтверждено'],
        ]),
      ],
      contract:
        'Эффект метода оценивается внутри одинаковых block и compute-budget. Все блоки включаются. Положительный эффект после контроля compute позволяет заявить преимущество в этой синтетической серии.',
      change:
        'Новый эксперимент при равном compute дал отрицательную разность. Пересмотрите вывод.',
      rubric: ['Сопоставимый compute', 'Полный отчёт', 'Причинно ограниченный вывод'],
      theory: [
        theory(
          'Что смешивает неравный compute?',
          'Эффект метода и эффект ресурсов',
          'Только названия файлов',
          'Не влияет на качество',
          'cost',
        ),
        theory(
          'Как сравнивать методы здесь?',
          'Внутри одинакового блока и бюджета',
          'Лучший proposed с худшим baseline',
          'Только новые запуски',
          'experiments',
        ),
        theory(
          'Что включить в исследовательский отчёт?',
          'Все блоки, ресурсы и ограничения',
          'Только положительный результат',
          'Только среднюю accuracy',
          'evaluation',
        ),
        theory(
          'Что означает отрицательный matched-эффект?',
          'В этой серии преимущество не подтверждено',
          'Нужно сменить название метода',
          'Можно скрыть baseline',
          'reasoning',
        ),
      ],
    };
  },
  run(input, plan) {
    const matched = mean(input.rows.map((row) => num(row, 'proposed') - num(row, 'baseline')));
    const estimate =
      choice(plan, 'comparison') === 'matched'
        ? matched
        : mean(input.rows.filter((row) => row.budget === 4).map((row) => num(row, 'proposed'))) -
          mean(input.rows.filter((row) => row.budget === 1).map((row) => num(row, 'baseline')));
    return {
      metrics: {
        estimatedEffect: estimate,
        controlledEffect: matched,
        confoundingBias: estimate - matched,
      },
      checks: {
        comparableCompute: Math.abs(estimate - matched) <= num(input.parameters, 'tolerance'),
        completeReport: choice(plan, 'reportCompute') === 'yes',
        appropriateClaim: choice(plan, 'claim') === (matched > 0 ? 'yes' : 'no'),
      },
      explanation: 'Посчитаны matched-разности и смещение сравнения разных compute-бюджетов.',
    };
  },
};

export const mlFamilies: Family[] = [
  dsCost,
  dsSegments,
  mlSkew,
  mlBatching,
  canary,
  featureStore,
  ragTrust,
  grounding,
  detection,
  cameras,
  rankQuality,
  ips,
  ablation,
  computeParity,
];
