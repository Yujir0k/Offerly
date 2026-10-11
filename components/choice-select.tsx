"use client";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
} from "./ui/select";
export function ChoiceSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Выберите",
  className = "",
  disabled = false,
  id,
  wrap = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  wrap?: boolean;
}) {
  const empty = "__offerly_any__";
  return (
    <Select
      disabled={disabled}
      value={value || empty}
      onValueChange={(v) => onChange(v === empty ? "" : v)}
    >
      <SelectTrigger
        id={id}
        className={`offerly-choice ${wrap ? "assessment-choice-wrap" : ""} ${className}`}
        aria-label={label}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        className={`offerly-choice-menu ${wrap ? "assessment-choice-menu" : ""}`}
        avoidCollisions={wrap}
        collisionPadding={16}
      >
        <SelectGroup>
          {options.some((option) => option.value === value) || !value ? null : (
            <SelectItem value={value}>{value}</SelectItem>
          )}
          {options.some((option) => option.value === "")
            ? null
            : !value && (
                <SelectItem value={empty} disabled>
                  {placeholder}
                </SelectItem>
              )}
          {options.map((option) => (
            <SelectItem
              key={option.value || empty}
              value={option.value || empty}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
