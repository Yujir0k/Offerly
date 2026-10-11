'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, Code2, Copy, KeyRound, PlugZap, RefreshCw, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

type Status = { status: string; hasToken: boolean; sseUrl: string; bridgePath: string; data: 'synthetic-only' | 'employer-catalog' };

/** Employer connection controls; credentials stay in component memory and explicit clipboard actions. */
export function McpIntegration() {
  const [info, setInfo] = useState<Status | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [configuration, setConfiguration] = useState(false);
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | null>(null);
  const [bridgePath, setBridgePath] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/mcp/settings', { cache: 'no-store', signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setInfo(data); setBridgePath(data.bridgePath); setError('');
    } catch (error) { if ((error as Error).name !== 'AbortError') { setInfo(null); setError((error as Error).message); } }
  }, []);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);

  async function action(action: 'create' | 'rotate' | 'revoke' | 'reveal') {
    const response = await fetch('/api/mcp/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (data.status) setInfo(data);
    if (data.token) setToken(data.token);
    if (action === 'revoke') setToken('');
    return data.token as string | undefined;
  }
  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function copy(value: string) { await navigator.clipboard.writeText(value); setNotice('Скопировано'); }
  const snippet = JSON.stringify({ mcpServers: { offerly: { command: 'node', args: [bridgePath], env: { OFFERLY_MCP_SSE_URL: info?.sseUrl || '', OFFERLY_MCP_TOKEN: token || 'API_ТОКЕН_ИЗ_КАБИНЕТА' } } } }, null, 2);

  return <section className="account-panel mcp-integration">
    <div className="account-panel-title"><PlugZap size={22} /><h2>MCP · подключение агента</h2></div>
    <p className="session-intro">Поручите помощнику поиск кандидатов и подготовку приглашений. {info?.data === 'synthetic-only' ? 'В демоверсии используются вымышленные профили.' : 'Агент видит только доступные вашей компании обезличенные профили.'}</p>
    <div className="mcp-server-status"><span className={`mcp-status-dot ${info ? 'online' : ''}`} />{info ? 'Сервер работает' : error ? 'Подключение недоступно' : 'Проверяем сервер…'}
      <button className="activity-button" onClick={() => void run(async () => { await refresh(); })} disabled={busy} aria-label="Проверить сервер MCP"><RefreshCw size={15} /></button>
    </div>
    {info && <>
      <div className="mcp-connection-field"><label htmlFor="mcp-endpoint">SSE-эндпоинт</label><div><input id="mcp-endpoint" readOnly value={info.sseUrl} /><button className="activity-button" disabled={busy} onClick={() => void run(async () => { await copy(info.sseUrl); })}><Copy size={15} />Копировать</button></div></div>
      <div className="mcp-connection-field"><label htmlFor="mcp-token">API-токен работодателя</label><div><input id="mcp-token" readOnly type="password" value={info.hasToken ? token || 'Токен подключён' : ''} placeholder="Создайте токен для подключения" autoComplete="off" />
        <button className="activity-button" disabled={busy} onClick={() => void run(async () => { if (info.hasToken) await copy(token || (await action('reveal'))!); else { await action('create'); setNotice('Токен создан. Скопируйте его или откройте конфигурацию.'); } })}>{info.hasToken ? <Copy size={15} /> : <KeyRound size={15} />}{info.hasToken ? 'Копировать' : 'Создать токен'}</button></div>
        <small>Токен даёт доступ только к этим трём инструментам. Храните его в локальной конфигурации агента.</small>
      </div>
      <div className="mcp-allowed-actions"><ShieldCheck size={20} /><div><strong>Права агента</strong><p>Разрешены поиск, просмотр обезличенного профиля и создание черновиков с зарплатой.</p><p>Отправка предложений, сообщения, контакты и решения о найме недоступны. Черновик отправляет HR из раздела «Приглашения».</p></div></div>
      <div className="mcp-integration-actions"><button className="activity-button primary" disabled={busy || !info.hasToken} onClick={() => void run(async () => { if (!token) await action('reveal'); setConfiguration(true); })}><Code2 size={17} />Конфигурация для Claude Desktop</button>
        {info.hasToken && <><button className="activity-button" disabled={busy} onClick={() => setConfirm('rotate')}>Заменить токен</button><button className="activity-button" disabled={busy} onClick={() => setConfirm('revoke')}>Отключить доступ</button></>}
      </div>
    </>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {notice && <p className="mcp-notice" role="status"><Check size={15} />{notice}</p>}
    <Dialog open={configuration} onOpenChange={setConfiguration}><DialogContent className="mcp-config-dialog"><DialogHeader><DialogTitle>Подключить локальный агент</DialogTitle><DialogDescription>Добавьте блок в claude_desktop_config.json и перезапустите приложение. Нужны Node.js 22 и файл моста на этом компьютере. MCP не запускает и не загружает модель.</DialogDescription></DialogHeader>
      <label className="mcp-config-path">Путь к mcp-stdio.mjs на компьютере<input value={bridgePath} onChange={event => setBridgePath(event.target.value)} /></label>
      <pre>{snippet}</pre><small>Конфигурация содержит API-токен. Не публикуйте её. Для автономной демонстрации используйте локальную модель: Claude Desktop сам по себе не гарантирует локальную обработку данных.</small>
      <button className="activity-button primary" disabled={busy} onClick={() => void run(async () => { await copy(snippet); })}><Copy size={16} />Копировать конфигурацию</button>
    </DialogContent></Dialog>
    <Dialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(null); }}><DialogContent><DialogHeader><DialogTitle>{confirm === 'rotate' ? 'Заменить API-токен?' : 'Отключить агента?'}</DialogTitle><DialogDescription>Текущие соединения закроются. {confirm === 'rotate' ? 'В конфигурации агента потребуется новый токен.' : 'Агент больше не сможет искать кандидатов или создавать черновики.'}</DialogDescription></DialogHeader>
      <button className="activity-button primary" disabled={busy} onClick={() => void run(async () => { if (confirm) await action(confirm); setConfirm(null); setNotice(confirm === 'rotate' ? 'Токен заменён' : 'Доступ отключён'); })}>{confirm === 'rotate' ? 'Заменить' : 'Отключить'}</button>
    </DialogContent></Dialog>
  </section>;
}
