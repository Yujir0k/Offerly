"use client";
import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "./ui/input-group";
export function PasswordInput(props: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <InputGroup className="auth-password-group">
      <InputGroupInput
        {...props}
        aria-label={props["aria-label"] || "Пароль"}
        type={visible ? "text" : "password"}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-sm"
          aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
