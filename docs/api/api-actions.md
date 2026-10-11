# JSON API действий

POST `/api/action`, cookie offerly_session, заголовок Origin равен APP_URL. Общие поля: `type`, `role: candidate|employer`. Ответ — отфильтрованный State; 400 бизнес-правило/ввод, 401 нет сессии, 409 конфликт версий, 500 внутренняя ошибка без технического текста. Один аккаунт может переключать роль, но сервер проверяет владение сущностью независимо от role.

| type | Значимые поля / правила |
|---|---|
| profile, profile-draft | Поля собственного Profile; проверяются телефон, опыт, зарплата, коллекции и допустимые варианты. Подтверждённый grade не берётся из произвольного профиля |
| onboard | Исторический onboarding-адаптер; используется после собственной регистрации, не является методом входа. name/email/consent и поля анкеты |
| survey | specialty, claimed, industry, skills; сохраняет собственный опрос |
| email-request | Письмо на текущий аккаунтный email; TTL/попытки/лимиты |
| account-email | email; только отправка кода новому адресу, ответ pendingEmail, старый email остаётся |
| email-confirm | code (6 цифр); одноразово подтверждает адрес, ответ обновлённый State |
| account-settings | timeZone, visible, notifications, invitations, applications, assessments, emailDigest off/daily/weekly, snooze keep/off/1/7/30 |
| notifications-read | Обновляет время прочтения собственных событий |
| privacy | visible, notifications, только собственный профиль |
| delete-account | confirmation=УДАЛИТЬ, email текущего аккаунта; удаление рабочих данных/сессий/файлов, обезличенный tombstone; политика backups отдельно |
| fsp | id=FSP-DEMO-1042 или пусто; демо-история, не реальная верификация |
| company | Данные компании из редактора (name, description, email, website, contactName, industry, size, city, технологии, культура, media); только член с правом редактирования |
| job | id необязательно; title, description, specialty, grade, skills, min, max, format, status draft/published; только своя компания, обязательная зарплата при публикации |
| job-status | id, status published/archived; только своя вакансия, публикация после подтверждения email |
| need | Данные потребности работодателя: title, specialty, grade, skills, min, max, format, industry |
| invite | candidateId, needId необязательно, title, description, min, max, contact; только опубликованный профиль с подтверждённым уровнем, согласием и открытым поиском; needId принадлежит компании, соответствие сохраняется в приглашении; salary>0, только компания-отправитель, кандидату в том же scope, исключается повтор активного приглашения |
| respond | id, status accepted/declined/viewed; только кандидат-получатель |
| apply | id вакансии, shareContacts=true, message; только кандидат, опубликованная вакансия, повтор запрещён |
| application-status | id, jobId, status; только компания-владелец вакансии |
| saved | id кандидата, сохраняет/убирает собственный список |
| favorite-job | id вакансии, сохраняет/убирает собственное избранное |
| start | specialty, grade; создаёт собственную попытку, только после подтверждения почты |
| answer | Ответ на вопрос собственной попытки; контракт текущего assessment.ts |
| finish | Завершение собственной попытки; оценка только на сервере |
| task | Текст ответа на короткое задание; пока не доказательство квалификации |

Точные ограничения редакторов — `cleanCompany`, `cleanJob`, обработчик `/api/action`. При интеграции алгоритма сокомандника уточнить payload start/answer/finish и синхронно обновить OpenAPI. Текущий агрегирующий API подходит MVP; для интеграций лучше выделить ресурсные ручки с отдельными схемами и idempotency.

Переписка: `/api/conversations` и `/api/conversations/{id}` — [контракт и проверки](../reports/2026-10-10/hiring-chat-20261010.md).
