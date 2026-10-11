import { Attempt, Question, Competency } from "./model";
// Same competency blueprint across variants. Answer keys never leave the server.
const banks: Record<
  string,
  Array<{
    family: string;
    variants: Array<{ prompt: string; options: string[]; correct: string }>;
  }>
> = {
  Backend: [
    {
      family: "Python",
      variants: [
        {
          prompt: "Что вернёт len({1, 1, 2, 3})?",
          options: ["3", "4", "2", "Ошибка"],
          correct: "3",
        },
        {
          prompt: "Что вернёт len({2, 2, 4, 4, 6})?",
          options: ["2", "3", "5", "Ошибка"],
          correct: "3",
        },
      ],
    },
    {
      family: "SQL",
      variants: [
        {
          prompt:
            "Как выбрать отделы с количеством сотрудников больше 5 после группировки?",
          options: [
            "HAVING COUNT(*) > 5",
            "WHERE COUNT(*) > 5",
            "ORDER BY COUNT(*) > 5",
            "LIMIT 5",
          ],
          correct: "HAVING COUNT(*) > 5",
        },
        {
          prompt:
            "Как выбрать категории с количеством товаров больше 10 после GROUP BY?",
          options: [
            "WHERE COUNT(*) > 10",
            "LIMIT 10",
            "HAVING COUNT(*) > 10",
            "ORDER BY 10",
          ],
          correct: "HAVING COUNT(*) > 10",
        },
      ],
    },
    {
      family: "API",
      variants: [
        {
          prompt:
            "Какой подход защищает повторную оплату при повторном POST из-за сетевого сбоя?",
          options: [
            "Idempotency key и проверка на сервере",
            "Скрыть кнопку",
            "Выполнить платёж ещё раз",
            "Только увеличить timeout",
          ],
          correct: "Idempotency key и проверка на сервере",
        },
        {
          prompt:
            "Как предотвратить создание дубликата заказа при повторной отправке POST?",
          options: [
            "Idempotency key и проверка на сервере",
            "Отправлять GET для записи",
            "Отключить логирование",
            "Кешировать все запросы",
          ],
          correct: "Idempotency key и проверка на сервере",
        },
      ],
    },
    {
      family: "Архитектура",
      variants: [
        {
          prompt:
            "Как сохранить согласованность двух связанных обновлений базы?",
          options: [
            "Одна транзакция",
            "Два независимых запроса",
            "Задержка в 1 секунду",
            "Только клиентская проверка",
          ],
          correct: "Одна транзакция",
        },
        {
          prompt: "Что обеспечивает атомарность перевода между двумя счетами?",
          options: [
            "Одна транзакция",
            "HTTP-кеш",
            "Два независимых запроса",
            "Очередь браузера",
          ],
          correct: "Одна транзакция",
        },
      ],
    },
  ],
  Frontend: [
    {
      family: "JavaScript",
      variants: [
        {
          prompt: "Как сравнить значение и тип без приведения?",
          options: ["===", "==", "=", "!="],
          correct: "===",
        },
        {
          prompt: "Какой оператор проверит строгое равенство?",
          options: ["==", "===", "=", "<="],
          correct: "===",
        },
      ],
    },
    {
      family: "React",
      variants: [
        {
          prompt: "Какой ключ лучше использовать для изменяемого списка?",
          options: [
            "Стабильный ID записи",
            "Индекс массива",
            "Math.random()",
            "Одинаковую строку",
          ],
          correct: "Стабильный ID записи",
        },
        {
          prompt: "Что сохраняет идентичность элемента React при сортировке?",
          options: [
            "Стабильный ID записи",
            "Номер позиции",
            "Случайный ключ",
            "Отсутствие key",
          ],
          correct: "Стабильный ID записи",
        },
      ],
    },
    {
      family: "CSS",
      variants: [
        {
          prompt:
            "Как уменьшить движения интерфейса согласно настройке пользователя?",
          options: [
            "prefers-reduced-motion",
            "hover: none",
            "display: none",
            "Только уменьшить FPS",
          ],
          correct: "prefers-reduced-motion",
        },
        {
          prompt:
            "Какая media query нужна для доступной альтернативы анимации?",
          options: [
            "prefers-reduced-motion",
            "prefers-color-scheme",
            "min-width",
            "orientation",
          ],
          correct: "prefers-reduced-motion",
        },
      ],
    },
    {
      family: "Безопасность",
      variants: [
        {
          prompt: "Где проверять право доступа к закрытым контактам?",
          options: [
            "На сервере",
            "Только скрыть CSS",
            "Только в React",
            "В названии кнопки",
          ],
          correct: "На сервере",
        },
        {
          prompt: "Что защищает данные даже при прямом запросе к API?",
          options: [
            "На сервере",
            "Скрытый div",
            "disabled кнопка",
            "Локальный флаг",
          ],
          correct: "На сервере",
        },
      ],
    },
  ],
  QA: [
    {
      family: "Тестирование",
      variants: [
        {
          prompt: "Что проверяет тест граничного значения для возраста 18+?",
          options: [
            "17, 18 и 19",
            "Только 30",
            "Только 100",
            "Любое одно число",
          ],
          correct: "17, 18 и 19",
        },
      ],
    },
    {
      family: "API",
      variants: [
        {
          prompt: "Какой код ожидается без авторизации на защищённом API?",
          options: ["401", "200", "301", "418"],
          correct: "401",
        },
      ],
    },
    {
      family: "SQL",
      variants: [
        {
          prompt: "Как проверить отсутствие дубликатов email?",
          options: [
            "GROUP BY email HAVING COUNT(*) > 1",
            "LIMIT 1",
            "ORDER BY email",
            "DELETE ALL",
          ],
          correct: "GROUP BY email HAVING COUNT(*) > 1",
        },
      ],
    },
    {
      family: "Регрессия",
      variants: [
        {
          prompt: "Когда нужен регрессионный прогон?",
          options: [
            "После изменений связанных функций",
            "Только до разработки",
            "Никогда",
            "Только после удаления тестов",
          ],
          correct: "После изменений связанных функций",
        },
      ],
    },
  ],
  Data: [
    {
      family: "SQL",
      variants: [
        {
          prompt: "Как считать уникальных пользователей?",
          options: [
            "COUNT(DISTINCT user_id)",
            "SUM(user_id)",
            "COUNT(*) всегда",
            "MAX(user_id)",
          ],
          correct: "COUNT(DISTINCT user_id)",
        },
      ],
    },
    {
      family: "Статистика",
      variants: [
        {
          prompt: "Какая метрика устойчива к большим выбросам?",
          options: ["Медиана", "Среднее", "Максимум", "Сумма"],
          correct: "Медиана",
        },
      ],
    },
    {
      family: "Python",
      variants: [
        {
          prompt: "Что сохраняет только уникальные элементы?",
          options: ["set", "list", "str", "float"],
          correct: "set",
        },
      ],
    },
    {
      family: "Валидация",
      variants: [
        {
          prompt: "Как избежать утечки целевой переменной?",
          options: [
            "Отделить признаки, недоступные на момент прогноза",
            "Учиться на тестовой выборке",
            "Использовать будущие события",
            "Убрать валидацию",
          ],
          correct: "Отделить признаки, недоступные на момент прогноза",
        },
      ],
    },
  ],
};
export function makeAttempt(specialty: string, grade: string): Attempt {
  const id = crypto.randomUUID();
  const qs = (banks[specialty] || banks.Backend).map((f, i) => {
    const idx =
      crypto.getRandomValues(new Uint32Array(1))[0] % f.variants.length;
    const v = f.variants[idx];
    return {
      id: `${specialty}:${i}:${idx}`,
      family: f.family,
      prompt: v.prompt,
      options: v.options,
    };
  });
  return {
    id,
    specialty,
    grade,
    questions: qs,
    answers: {},
    createdAt: new Date().toISOString(),
  };
}
export function evaluateAttempt(a: Attempt) {
  let correct = 0;
  for (const q of a.questions) {
    const [spec, f, v] = q.id.split(":");
    if (banks[spec][Number(f)].variants[Number(v)].correct === a.answers[q.id])
      correct++;
  }
  return Math.round((correct / a.questions.length) * 100);
}

export function competencyResults(a: Attempt): Competency[] {
  return a.questions.map((q) => {
    const [spec, f, v] = q.id.split(":");
    const correct = Number(
      banks[spec][Number(f)].variants[Number(v)].correct === a.answers[q.id],
    );
    return {
      family: q.family,
      correct,
      total: 1,
      percent: correct * 100,
      feedback: correct
        ? "Ответ в этом варианте верный. Это сигнал по проверенной компетенции, а не полная сертификация технологии."
        : "Стоит повторить эту тему и пройти новый вариант. Неудачный ответ не понижает текущий грейд.",
    };
  });
}
