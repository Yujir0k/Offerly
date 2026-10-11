const dateFields = new Set([
  'confirmedAt',
  'date',
  'freshAt',
  'lastGradeChange',
  'syncedAt',
]);
const isoDate = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/;

/** Hide contact strings in public descriptions before consent. */
export function redactProfileText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[контакт скрыт]')
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g, '[контакт скрыт]')
    .replace(/https?:\/\/\S+/gi, '[ссылка скрыта]');
}

/** Preserve valid ISO date metadata while recursively hiding contact strings. */
export function redactProfileValue<T>(value: T): T {
  const visit = (item: unknown, field: string): unknown => {
    if (typeof item === 'string') {
      if (
        dateFields.has(field) &&
        isoDate.test(item) &&
        Number.isFinite(Date.parse(item))
      )
        return item;
      return redactProfileText(item);
    }
    if (Array.isArray(item)) return item.map((entry) => visit(entry, field));
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item).map(([key, entry]) => [key, visit(entry, key)]),
      );
    return item;
  };
  return visit(value, '') as T;
}
