export function salaryRangeError(from: unknown, to: unknown): string | null {
  if (
    ![from, to].every(
      (value) => typeof value === "number" || typeof value === "string",
    )
  )
    return "Укажите корректные суммы в рублях.";
  const min = Number(from),
    max = Number(to);
  if (
    from === "" ||
    to === "" ||
    from == null ||
    to == null ||
    min === 0 ||
    max === 0
  )
    return "Заполните обе границы зарплаты: от и до.";
  if (
    ![min, max].every(
      (value) => Number.isFinite(value) && Number.isInteger(value) && value > 0,
    )
  )
    return "Зарплата должна быть положительной суммой в целых рублях.";
  if (min > 10000000 || max > 10000000)
    return "Укажите зарплату не более 10 000 000 ₽ в месяц.";
  if (max < min) return "Сумма «до» должна быть не меньше суммы «от».";
  return null;
}
