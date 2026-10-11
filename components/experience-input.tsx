"use client";
import { useState } from "react";
export function ExperienceInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [limited, setLimited] = useState(false);
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    if (Number(text) !== value) setText(String(value));
  }
  return (
    <>
      <input
        aria-label="Коммерческий опыт, лет"
        type="text"
        inputMode="numeric"
        value={text}
        aria-describedby="experience-hint"
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "");
          const limit = Number(digits) > 50;
          setLimited(limit);
          setText(limit ? "50" : digits);
          onChange(Math.min(50, Number(digits)));
        }}
      />
      <small
        id="experience-hint"
        className={limited ? "inline-error" : "field-hint"}
      >
        {limited
          ? "Максимум — 50 лет. Значение ограничено при вводе."
          : "От 0 до 50 лет. Если опыта нет, укажите 0."}
      </small>
    </>
  );
}
