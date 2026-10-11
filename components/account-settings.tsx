"use client";
import { HiddenCompanies } from "./hiring-tools";
import { SessionSettings } from "./session-settings";
import { McpIntegration } from './mcp-integration';
import { FspConnect } from "./fsp-connect";
import { EmailChangeDialog } from "./email-change-dialog";
import { useState } from "react";
import {
  Bell,
  Check,
  Clock3,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { State, Role } from "@/lib/model";
import { userSettings, timeZones, displayDate } from "@/lib/account-settings";
import type { Action } from "./registration";
import { Switch } from "./ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
export function AccountSettings({
  s,
  role,
  act,
}: {
  s: State;
  role: Role;
  act: Action;
}) {
  const [tab, setTab] = useState("account");
  const [draft, setDraft] = useState(() => ({
    ...userSettings(s),
    visible: s.profile.visible,
    notifications: s.notifications,
    snooze: "keep",
  }));
  const [editing, setEditing] = useState(false),
    [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState(""),
    [confirmationEmail, setConfirmationEmail] = useState("");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [formError, setFormError] = useState("");
  const zoneLabels: Record<string, string> = {
    "Europe/Moscow": "Москва · UTC+3",
    "Europe/Kaliningrad": "Калининград · UTC+2",
    "Europe/Samara": "Самара · UTC+4",
    "Asia/Yekaterinburg": "Екатеринбург · UTC+5",
    "Asia/Omsk": "Омск · UTC+6",
    "Asia/Novosibirsk": "Новосибирск · UTC+7",
    "Asia/Krasnoyarsk": "Красноярск · UTC+7",
    "Asia/Irkutsk": "Иркутск · UTC+8",
    "Asia/Yakutsk": "Якутск · UTC+9",
    "Asia/Vladivostok": "Владивосток · UTC+10",
    "Asia/Magadan": "Магадан · UTC+11",
    "Asia/Kamchatka": "Камчатка · UTC+12",
  };
  async function save() {
    setBusy(true);
    setNotice("");
    const result = await act("account-settings", draft);
    setBusy(false);
    if (result) {
      setDraft({
        ...userSettings(result),
        visible: result.profile.visible,
        notifications: result.notifications,
        snooze: "keep",
      });
      setNotice("Настройки сохранены");
    }
  }
  return (
    <div className="account-settings">
      <nav className="settings-sections" aria-label="Разделы настроек">
        {[
          ["account", "Аккаунт"],
          ["notifications", "Уведомления"],
          ["sessions", "Устройства и сеансы"],
          ...(role === "candidate" ? [["hidden", "Скрытые компании"]] : []),
          ...(role === 'employer' ? [['mcp', 'MCP · агент']] : []),
          ["delete", "Удаление аккаунта"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "hidden" && <HiddenCompanies />}
      {tab === 'mcp' && role === 'employer' && <McpIntegration />}
      {tab === "sessions" && (
        <SessionSettings key={s.auth?.userId} s={s} role={role} />
      )}
      <section className="account-panel" hidden={tab !== "account"}>
        <div className="account-panel-title">
          <ShieldCheck size={22} />
          <h2>Аккаунт</h2>
        </div>
        <div className="account-row">
          <div>
            <h3>Электронная почта</h3>
            <p className="account-email">
              {userSettings(s).email || "Не указана"}
            </p>
            <small>
              {role === "candidate"
                ? "Телефон и почта скрыты от компаний до принятия приглашения или вашего отклика. Эта почта также используется для входа в аккаунт."
                : "Эта почта используется для входа в аккаунт. Контакты для кандидатов указываются отдельно в профиле компании и в приглашении."}
            </small>
          </div>
          <button
            className="activity-button"
            onClick={() => {
              setFormError("");
              setEditing(true);
            }}
          >
            Изменить почту
          </button>
        </div>
        <div className="account-row account-fsp-row">
          <div>
            <h3>ФСП ID</h3>
            <p>Используйте аккаунт ФСП для входа в Офферли.</p>
          </div>
          <FspConnect role={role} intent="link" demo={s.auth?.demo} />
        </div>
        <div className="account-row">
          <div>
            <h3>Часовой пояс</h3>
            <p>
              Даты приглашений, откликов и результатов отображаются в выбранном
              часовом поясе.
            </p>
          </div>
          <Select
            value={draft.timeZone}
            onValueChange={(timeZone) => setDraft({ ...draft, timeZone })}
          >
            <SelectTrigger aria-label="Часовой пояс" className="account-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="settings-select-menu">
              {[...new Set([...timeZones, draft.timeZone])].map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zoneLabels[zone] || zone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {role === "candidate" && (
          <div className="account-row">
            <div>
              <h3>Показывать профиль работодателям</h3>
              <p>
                Выключите видимость, чтобы сделать паузу в подборе. Существующие
                приглашения и отклики останутся.
              </p>
            </div>
            <Switch
              checked={draft.visible}
              onCheckedChange={(visible) => setDraft({ ...draft, visible })}
              aria-label="Показывать профиль работодателям"
            />
          </div>
        )}
        <div className="account-note">
          <LockKeyhole size={18} />
          <p>
            {role === "candidate"
              ? "Контакты открываются конкретной компании после согласия на знакомство или вашего отклика."
              : "Контакты кандидата открываются вашей компании после его согласия на знакомство или самостоятельного отклика."}
          </p>
        </div>
        <div className="account-save">
          <span role="status">
            {notice && (
              <>
                <Check size={17} />
                {notice}
              </>
            )}
          </span>
          <button
            className="activity-button primary"
            disabled={busy}
            onClick={save}
          >
            {busy ? "Сохраняем…" : "Сохранить настройки"}
            <Check size={17} />
          </button>
        </div>
      </section>
      <section className="account-panel" hidden={tab !== "notifications"}>
        <div className="account-panel-title">
          <Bell size={22} />
          <h2>Уведомления</h2>
        </div>
        <div className="account-row">
          <div>
            <h3>Уведомления в кабинете</h3>
            <p>
              Счётчики событий в меню и лента обновлений. Рабочие записи
              остаются доступны при отключении.
            </p>
          </div>
          <Switch
            checked={draft.notifications}
            onCheckedChange={(notifications) =>
              setDraft({ ...draft, notifications })
            }
            aria-label="Уведомления в кабинете"
          />
        </div>
        {(
          [
            [
              "invitations",
              "Новые приглашения",
              "Когда компания предлагает познакомиться.",
            ],
            [
              "applications",
              "Статусы откликов",
              "Когда компания просмотрела заявку или приняла решение.",
            ],
            [
              "assessments",
              "Результаты проверки",
              "Когда завершена проверка и сохранён результат.",
            ],
          ] as const
        )
          .filter(() => role === "candidate")
          .map(([key, title, description]) => (
            <div className="account-row" key={key}>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <Switch
                checked={draft[key]}
                disabled={!draft.notifications}
                onCheckedChange={(value) =>
                  setDraft({ ...draft, [key]: value })
                }
                aria-label={title}
              />
            </div>
          ))}
        {role === "candidate" && <div className="account-row">
          <div><h3>Приглашения по почте</h3><p>Письмо, когда работодатель предлагает познакомиться. Не зависит от счётчиков в кабинете.</p></div>
          <Switch checked={draft.emailInvitations !== false}
            onCheckedChange={(emailInvitations) => setDraft({ ...draft, emailInvitations })}
            aria-label="Приглашения по почте" />
        </div>}
        <div className="account-row">
          <div>
            <h3>Пауза уведомлений</h3>
            <p>
              {draft.snoozedUntil && Date.parse(draft.snoozedUntil) > Date.now()
                ? `Пауза до ${displayDate(draft.snoozedUntil, s, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`
                : "Рабочие записи сохраняются; уведомления можно временно отключить."}
            </p>
          </div>
          <Select
            value={draft.snooze}
            onValueChange={(snooze) => setDraft({ ...draft, snooze })}
          >
            <SelectTrigger
              aria-label="Пауза уведомлений"
              className="account-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="settings-select-menu">
              {[
                ["keep", "Текущая настройка"],
                ["off", "Без паузы"],
                ["1", "На один день"],
                ["7", "На неделю"],
                ["30", "На месяц"],
              ].map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="account-row">
          <div>
            <h3>Частота будущей email-подборки</h3>
            <p>
              Предпочтение сохраняется. Регулярная email-подборка, SMS и WhatsApp пока не подключены.
            </p>
          </div>
          <Select
            value={draft.emailDigest}
            onValueChange={(emailDigest) =>
              setDraft({
                ...draft,
                emailDigest: emailDigest as typeof draft.emailDigest,
              })
            }
          >
            <SelectTrigger
              aria-label="Частота email-подборки"
              className="account-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="settings-select-menu">
              {[
                ["off", "Не получать"],
                ["daily", "Раз в день"],
                ["weekly", "Раз в неделю"],
              ].map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="account-save">
          <span role="status">
            {notice && (
              <>
                <Check size={17} />
                {notice}
              </>
            )}
          </span>
          <button
            className="activity-button primary"
            disabled={busy}
            onClick={save}
          >
            {busy ? "Сохраняем…" : "Сохранить настройки"}
            <Check size={17} />
          </button>
        </div>
      </section>
      <section
        className="account-panel account-danger"
        hidden={tab !== "delete"}
      >
        <div className="account-panel-title">
          <Trash2 size={22} />
          <h2>Удаление аккаунта</h2>
        </div>
        <div className="account-row">
          <div>
            <h3>Удалить данные аккаунта Офферли</h3>
            <p>
              Будут удалены профиль, компания, загруженные файлы, черновики,
              проверки, отклики и приглашения этого рабочего пространства.
              Действие необратимо.
            </p>
          </div>
          <button
            className="activity-button account-delete-button"
            onClick={() => {
              setConfirmation("");
              setConfirmationEmail("");
              setFormError("");
              setDeleting(true);
            }}
          >
            Удалить аккаунт
          </button>
        </div>
      </section>
      <EmailChangeDialog
        s={s}
        open={editing}
        onOpenChange={setEditing}
        act={act}
        onChanged={(result) => {
          setDraft((current) => ({
            ...current,
            email: userSettings(result).email,
          }));
          setNotice("Почта подтверждена и обновлена");
        }}
      />
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="app-dialog account-dialog">
          <DialogHeader>
            <DialogTitle>Удалить аккаунт Офферли?</DialogTitle>
            <DialogDescription>
              Профиль, файлы и вся история этого рабочего пространства будут
              удалены. Скрыть профиль можно в настройках видимости, сохранив
              данные.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const result = await act("delete-account", {
                confirmation,
                email: confirmationEmail,
              });
              if (!result)
                setFormError(
                  "Не удалось завершить удаление. Обновите страницу и проверьте состояние аккаунта.",
                );
              setBusy(false);
            }}
          >
            {formError && (
              <p className="inline-error" role="alert">
                {formError}
              </p>
            )}
            <label className="field">
              Почта аккаунта
              <input
                type="email"
                required
                value={confirmationEmail}
                onChange={(e) => setConfirmationEmail(e.target.value)}
              />
            </label>
            <label className="field">
              Введите УДАЛИТЬ
              <input
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
              />
            </label>
            <DialogFooter>
              <button
                type="button"
                className="activity-button"
                onClick={() => setDeleting(false)}
              >
                Вернуться
              </button>
              <button
                className="activity-button account-delete-button"
                disabled={
                  busy ||
                  confirmation !== "УДАЛИТЬ" ||
                  confirmationEmail.trim().toLowerCase() !==
                    userSettings(s).email.toLowerCase()
                }
              >
                Удалить навсегда
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
