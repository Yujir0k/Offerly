/** Work history uses calendar months in the platform's Moscow time zone. */
export function currentWorkMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}
export const isWorkMonth = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(19|[2-9]\d)\d{2}-(0[1-9]|1[0-2])$/.test(value);

export function workMonthBounds(min?: string, max?: string, now = new Date()) {
  const current = currentWorkMonth(now);
  return {
    min: isWorkMonth(min) ? min : "1900-01",
    max: isWorkMonth(max) && max < current ? max : current,
  };
}

export function workHistoryDateError(entries: unknown, now = new Date()) {
  if (!Array.isArray(entries)) return "";
  const current = currentWorkMonth(now);
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") return "Проверьте место работы.";
    for (const date of [entry.start, entry.end]) {
      if (date === "" || date === undefined || date === null) continue;
      if (!isWorkMonth(date))
        return "Укажите даты работы в формате месяц и год.";
      if (date > current)
        return "Дата работы не может быть позже текущего месяца.";
    }
    if (!entry.current && entry.start && entry.end && entry.end < entry.start)
      return "Дата окончания работы не может быть раньше даты начала.";
  }
  return "";
}
