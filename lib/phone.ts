/** E.164 length; Russian local numbers are displayed with the familiar mask. */
export function formatPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits[0] === "8" && !value.trim().startsWith("+"))
    digits = "7" + digits.slice(1);
  if (!value.trim().startsWith("+") && digits[0] === "9") digits = "7" + digits;
  if (digits[0] !== "7") return "+" + digits.slice(0, 15);
  digits = digits.slice(0, 11);
  const national = digits.slice(1);
  return (
    "+7" +
    (national ? " (" + national.slice(0, 3) : "") +
    (national.length >= 3 ? ")" : "") +
    (national.length > 3 ? " " + national.slice(3, 6) : "") +
    (national.length > 6 ? "-" + national.slice(6, 8) : "") +
    (national.length > 8 ? "-" + national.slice(8, 10) : "")
  );
}
export function phoneError(value: string) {
  if (!value.trim()) return "";
  const digits = value.replace(/\D/g, "");
  return digits[0] === "7" || digits[0] === "8"
    ? digits.length === 11
      ? ""
      : "Введите номер полностью: +7 (999) 999-99-99."
    : /^\+\d[\d\s()-]*$/.test(value) &&
        digits.length >= 8 &&
        digits.length <= 15
      ? ""
      : "Укажите международный номер: знак + и от 8 до 15 цифр.";
}
