"use client";
import { X, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "./ui/dialog";
export function FeedbackDialog({
  open,
  onOpenChange,
  message,
  onLogin,
  onChangeEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: string;
  onLogin?: () => void;
  onChangeEmail?: () => void;
}) {
  const duplicate = message.includes("уже зарегистрирован") && !!onLogin;
  const limited = message.includes("Слишком много попыток");
  const title = duplicate
    ? "Аккаунт уже существует."
    : limited
      ? "Попробуйте чуть позже."
      : message.includes("Неверная почта или пароль")
        ? "Не удалось войти."
        : "Не удалось выполнить действие.";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="auth-account-dialog"
        overlayClassName="auth-account-overlay"
        showCloseButton={false}
      >
        <DialogClose className="auth-account-close" aria-label="Закрыть">
          <X size={20} />
        </DialogClose>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {duplicate
            ? "Для этой почты уже создан аккаунт Офферли. Войдите с паролем, который указали при регистрации."
            : limited
              ? "Слишком много попыток за короткое время. Подождите немного и повторите — заполненные данные сохранятся."
              : message === "Invalid URL string."
                ? "Проверьте адрес ссылки и повторите действие."
                : message}
        </DialogDescription>
        {duplicate ? (
          <>
            <button
              type="button"
              className="btn primary full"
              onClick={onLogin}
            >
              Перейти ко входу <ArrowRight size={18} />
            </button>
            <button
              type="button"
              className="auth-account-secondary"
              onClick={onChangeEmail}
            >
              Изменить почту
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn primary full"
            onClick={() => onOpenChange(false)}
          >
            Понятно
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
