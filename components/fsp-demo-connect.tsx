'use client';
import { useEffect, useState } from 'react';
import type { Role } from '@/lib/model';
import type { DemoFspStatus } from '@/lib/fsp-demo';

/** Private demonstration entry and achievement status, separate from the real provider. */
export function DemoFspConnect({
  role,
  intent,
}: {
  role: Role;
  intent: 'login' | 'link';
}) {
  const [status, setStatus] = useState<DemoFspStatus | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/identity/fsp-demo', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.ok) {
          setStatus(await response.json());
          const result = new URLSearchParams(window.location.search).get(
            'fspDemo',
          );
          if (result === 'cancelled')
            setMessage('Привязка отменена. Ваши данные сохранены.');
          if (result === 'failed')
            setMessage(
              'Не удалось подтвердить подключение. Начните демонстрацию заново.',
            );
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError')
          setMessage('Не удалось проверить доступность демонстрации.');
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  async function start() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/identity/fsp-demo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, role }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      window.location.assign(body.authorizationUrl);
    } catch (error) {
      setMessage(
        (error as Error).message || 'Не удалось открыть демонстрацию.',
      );
      setBusy(false);
    }
  }
  async function sync() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/identity/fsp-demo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setStatus(body);
      setMessage(
        body.connection?.status === 'unavailable'
          ? 'Реестр временно недоступен. Последние загруженные результаты сохранены.'
          : 'Достижения обновлены.',
      );
    } catch (error) {
      setMessage((error as Error).message || 'Не удалось обновить достижения.');
    } finally {
      setBusy(false);
    }
  }
  async function unlink() {
    if(busy)return;setBusy(true);setMessage('');
    try {const response=await fetch('/api/identity/fsp-demo/unlink',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await response.json();if(!response.ok)throw new Error(data.error);setStatus(data);setMessage('Демонстрационный ФСП ID отключён. Результаты проверки уровня сохранены.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  if (!status?.enabled && !message) return null;
  const date = (value?: string) =>
    value ? new Date(value).toLocaleString('ru-RU') : 'Ещё не обновлялись';
  return (
    <section
      className={`fsp-demo-connect ${intent === 'link' ? 'fsp-demo-light' : ''}`}
      aria-label="Демонстрационное подключение ФСП ID"
    >
      {intent !== 'link' && <span className="fsp-demo-label">Демонстрационный сервис</span>}
      {status?.linked && intent === 'link' && (
        <>
          <h4>Тестовый ФСП ID привязан</h4>
          <p>
            {status.participantName}
            <br />
            <span className="mono">{status.participantId}</span>
          </p>
          <p role="status">
            {status.connection?.status === 'empty'
              ? 'В реестре пока нет соревнований. Это не ограничивает ваш профиль.'
              : status.connection?.status === 'unavailable'
                ? 'Реестр временно недоступен. Сохранённая история остаётся в профиле.'
                : `Загружено результатов: ${status.events.length}`}
          </p>
          <small>
            Последнее обновление: {date(status.connection?.syncedAt)}
          </small>
          {!!status.events.length && (
            <ul className="fsp-demo-events">
              {status.events.map((e) => (
                <li key={e.id}>
                  <strong>{e.title}</strong>
                  <span>
                    {e.discipline} ·{' '}
                    {new Date(e.date).toLocaleDateString('ru-RU')}
                  </span>
                  <span>
                    {e.result === 'winner'
                      ? 'Победа'
                      : e.result === 'prize'
                        ? 'Призовое место'
                        : 'Участие'}{' '}
                    · {e.team ? 'Командный результат' : 'Личный результат'}
                  </span>
                  {e.team && (
                    <small>Личный вклад отдельно не подтверждён</small>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="fsp-login-button"
            onClick={sync}
            disabled={busy}
          >
            {busy ? 'Обновляем…' : 'Обновить достижения'}
          </button>
          <button type="button" className="fsp-login-button" disabled={busy} onClick={()=>void unlink()}>Отключить демо ФСП ID</button>
          {status.catalogCandidateId && (
            <a
              className="fsp-demo-preview"
              href={`/demo/employer/candidates?fspDemoCandidate=${status.catalogCandidateId}`}
            >
              Посмотреть профиль глазами работодателя →
            </a>
          )}
        </>
      )}
      <button
        type="button"
        className="fsp-login-button"
        onClick={start}
        disabled={busy || !status?.available}
        title="Локальный тестовый сервис ФСП ID"
      >
        <img src="/brand/fsp.svg" alt="" width={28} height={28} />
        <span>{busy
          ? 'Подключаемся…'
          : intent === 'login'
            ? 'Попробовать ФСП ID · демо'
            : status?.linked
              ? 'Выбрать другой тестовый аккаунт'
              : 'Привязать ФСП ID'}</span>
      </button>
      {(intent !== 'link' || !status?.available) && <p className="fsp-login-description">
        {status?.available
          ? 'Тестовые аккаунты и соревнования. Настоящий пароль ФСП не нужен.'
          : 'Локальный демонстрационный сервис сейчас недоступен.'}
      </p>}
      {message && (
        <p className="fsp-login-notice" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
