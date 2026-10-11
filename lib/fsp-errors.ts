// Fixed codes are safe to include in a callback URL; provider descriptions and tokens are not.
export const fspMessages = {
  unavailable:
    "Вход через ФСП ID пока не подключён. Воспользуйтесь электронной почтой.",
  cancelled: "Вход через ФСП ID отменён. Вы можете попробовать ещё раз.",
  expired:
    "Попытка входа истекла или уже использована. Начните вход через ФСП ID заново.",
  failed: "Не удалось подтвердить вход через ФСП ID. Попробуйте позже.",
  consent:
    "Для создания аккаунта подтвердите согласие на обработку данных и повторите вход через ФСП ID.",
  email:
    "ФСП ID не передал электронную почту. Создайте аккаунт по почте и привяжите ФСП ID в настройках.",
  existing:
    "Для этого адреса уже есть аккаунт. Войдите по почте и привяжите ФСП ID в настройках.",
  linked_elsewhere: "Этот ФСП ID уже связан с другим аккаунтом Офферли.",
  already_linked: "К этому аккаунту уже привязан другой ФСП ID.",
  session: "Войдите и подтвердите почту аккаунта перед привязкой ФСП ID.",
  demo: "Привязка настоящего ФСП ID доступна в обычном аккаунте. Демо использует отдельный тестовый реестр.",
  linked:
    "ФСП ID привязан к вашему аккаунту. История достижений подключается отдельно.",
} as const;
export type FspCode = keyof typeof fspMessages;
export class FspError extends Error {
  constructor(
    public code: FspCode,
    public status = 400,
  ) {
    super(fspMessages[code]);
  }
}
