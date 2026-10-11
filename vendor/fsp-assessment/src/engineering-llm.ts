import type { Variant } from './domain.js';
import { llmProfiles } from './catalog.js';

/** Optionally expand the fixed faulty plan into a real LLM artifact without changing its verified semantics. */
export async function enrichEngineeringArtifact(variant: Variant): Promise<Variant> {
  if (!variant.engineering || process.env.LLM_LIVE_ENABLED !== 'true') return variant;
  const key = process.env.YANDEX_API_KEY;
  const folder = process.env.YANDEX_FOLDER_ID;
  if (!key || !folder)
    throw new Error('Для генерации артефакта LLM настройте YANDEX_API_KEY и YANDEX_FOLDER_ID');
  const model = process.env.ASSESSMENT_BASE_MODEL || llmProfiles.hint!.model!;
  const response = await fetch('https://ai.api.cloud.yandex.net/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'OpenAI-Project': folder,
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: `gpt://${folder}/${model}`,
      temperature: 0,
      max_tokens: 2200,
      stream: false,
      messages: [
        {
          role: 'system',
          content:
            'Создай архитектурный псевдокод для учебного аудита. Верни только JSON {"nodes":[{"id":"...","code":"..."}]}. Для каждого узла обязательно сохрани точную исходную строку code внутри расширенного псевдокода. Не исправляй решения и не отмечай дефекты: кандидат должен обнаружить их сам. Не меняй контракт, идентификаторы и наблюдаемое поведение. /no_think',
        },
        {
          role: 'user',
          content: JSON.stringify({
            business: variant.engineering.business,
            contract: variant.artifacts.find((item) => item.name === 'contract.md')?.content,
            nodes: variant.engineering.nodes.map(({ id, code, description }) => ({
              id,
              code,
              description,
            })),
          }),
        },
      ],
    }),
  });
  if (!response.ok)
    throw new Error(
      `Генератор артефакта вернул HTTP ${response.status}; автоматический повтор выключен`,
    );
  const result = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const text = result.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')) as {
    nodes?: { id: string; code: string }[];
  };
  if (!Array.isArray(parsed.nodes) || parsed.nodes.length !== variant.engineering.nodes.length)
    throw new Error('LLM-артефакт отклонён: неверная структура');
  const nodes = variant.engineering.nodes.map((node) => {
    const generated = parsed.nodes!.filter((item) => item.id === node.id);
    if (
      generated.length !== 1 ||
      typeof generated[0]!.code !== 'string' ||
      generated[0]!.code.length > 5000 ||
      !generated[0]!.code.includes(node.code)
    )
      throw new Error('LLM-артефакт изменил проверяемую семантику и не выдан');
    return { ...node, code: generated[0]!.code };
  });
  return { ...variant, engineering: { ...variant.engineering, nodes, artifactSource: 'llm' } };
}
