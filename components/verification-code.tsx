"use client";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "./ui/input-otp";
export function VerificationCode({
  id,
  label,
  value,
  onChange,
  status = "idle",
  disabled,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  status?: "idle" | "error" | "success";
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <InputOTP
      id={id}
      aria-label={label}
      aria-invalid={status === "error"}
      aria-describedby={describedBy}
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      onChange={(v) => onChange(v.replace(/\D/g, "").slice(0, 6))}
      pasteTransformer={(v) => v.replace(/\D/g, "").slice(0, 6)}
      pushPasswordManagerStrategy="none"
      disabled={disabled}
      containerClassName={`verification-code ${status === "success" ? "is-success" : status === "error" ? "is-error" : ""}`}
    >
      <InputOTPGroup>
        {Array.from({ length: 6 }, (_, index) => (
          <InputOTPSlot key={index} index={index} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
