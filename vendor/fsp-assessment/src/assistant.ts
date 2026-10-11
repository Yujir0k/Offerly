import { randomUUID } from 'node:crypto';
import { llmProfiles } from './catalog.js';
import type { Assessment } from './domain.js';
import type { Store } from './store.js';

/** Returns scoped help using the task's resource profile; live access is explicitly opt-in. */
export async function help(
  store: Store,
  assessment: Assessment,
  question: string,
): Promise<{ text: string; live: boolean; model: string | null }> {
  const mode = assessment.variant.stageModes[assessment.stage];
  if (!mode) throw new Error('Этап не поддерживает помощника');
  const profile = llmProfiles[mode];
  if (!profile.model) throw new Error('На этом этапе ИИ запрещён');
  const calls = store
    .list<{ stage: number }>('assistant-calls', assessment.id)
    .filter((call) => call.stage === assessment.stage).length;
  if (calls >= profile.calls) throw new Error('Пакет помощи для этого этапа исчерпан');
  if (!question.trim() || question.length > 3000)
    throw new Error('Запрос должен содержать от 1 до 3000 символов');
  const enabled = process.env.LLM_LIVE_ENABLED === 'true';
  if (!enabled) {
    const text =
      'Локальная справка, без вызова LLM: сформулируйте проверяемую гипотезу, сопоставьте её с контрактом данных и запустите эксперимент. Высокая метрика сама по себе не подтверждает корректность решения. Это демонстрационный справочник, не ответ модели.';
    const id = randomUUID();
    store.save('assistant-calls', id, assessment.id, {
      id,
      stage: assessment.stage,
      model: null,
      live: false,
      at: new Date().toISOString(),
    });
    return { text, live: false, model: null };
  }
  const key = process.env.YANDEX_API_KEY;
  const folder = process.env.YANDEX_FOLDER_ID;
  if (!key || !folder)
    throw new Error('Live-режим требует ключ и идентификатор каталога в окружении');
  const context = assessment.variant.artifacts
    .slice(0, mode === 'extended' ? 3 : 1)
    .map((artifact) => artifact.content)
    .join('\n')
    .slice(0, 4500);
  const messages = [
    {
      role: 'system',
      content:
        'Ты помощник кандидата. Помоги разобрать локальный вопрос. Не утверждай, что решение проверено, без результатов эксперимента. Ответ краткий. /no_think',
    },
    { role: 'user', content: `${context}\nВопрос: ${question}` },
  ];
  const payload = {
    model: `gpt://${folder}/${profile.model}`,
    messages,
    max_tokens: profile.maxTokens,
    stream: false,
  };
  const id = randomUUID();
  store.save('assistant-calls', id, assessment.id, {
    id,
    stage: assessment.stage,
    model: profile.model,
    live: true,
    at: new Date().toISOString(),
  });
  // A failed provider request is never retried automatically.
  const response = await fetch('https://ai.api.cloud.yandex.net/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'OpenAI-Project': folder,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok)
    throw new Error(`Провайдер вернул HTTP ${response.status}. Автоматического повтора нет.`);
  const result = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return {
    text: result.choices?.[0]?.message?.content ?? 'Пустой ответ модели',
    live: true,
    model: profile.model,
  };
}
