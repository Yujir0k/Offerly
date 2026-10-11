"use client";
import { formatPhone, phoneError } from "@/lib/phone";
export function PhoneInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const error = phoneError(value);
  return (
    <label className="field">
      Телефон
      <input
        aria-label="Телефон"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        maxLength={24}
        placeholder="+7 (999) 999-99-99"
        aria-invalid={!!error}
        aria-describedby="phone-hint"
        onChange={(event) => onChange(formatPhone(event.target.value))}
        onKeyDown={(event) => {
          const input = event.currentTarget,
            caret = input.selectionStart || 0;
          if (
            event.key === "Backspace" &&
            caret === input.selectionEnd &&
            caret > 0 &&
            /\D/.test(value[caret - 1])
          ) {
            event.preventDefault();
            let index = caret - 1;
            while (index > 0 && /\D/.test(value[index])) index--;
            const next = formatPhone(
              value.slice(0, index) + value.slice(caret),
            );
            onChange(next);
            requestAnimationFrame(() =>
              input.setSelectionRange(
                Math.min(index, next.length),
                Math.min(index, next.length),
              ),
            );
          }
        }}
      />
      <small id="phone-hint" className={error ? "inline-error" : "field-hint"}>
        {error ||
          "Россия: +7 (999) 999-99-99. Для другой страны укажите её код."}
      </small>
    </label>
  );
}
