'use client';
import { useEffect, useState } from 'react';
import { FilePenLine, RefreshCw, Send, Trash2 } from 'lucide-react';
import { money, type State } from '@/lib/model';
import type { McpInvitationDraft } from '@/lib/mcp-drafts';
import type { Navigate } from './landing';

type Draft = McpInvitationDraft & { available: boolean };

/** Only a human browser session can approve a displayed agent draft. */
export function McpInvitationDrafts({ onStateChange, nav }: { onStateChange?: (state: State) => void; nav?: Navigate }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function refresh(signal?: AbortSignal) {
    const response = await fetch('/api/mcp/drafts', { cache: 'no-store', signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setDrafts(data.drafts); setError(''); setLoading(false);
  }
  useEffect(() => {
    const controller = new AbortController();
    async function load() { try { await refresh(controller.signal); } catch (error) { if ((error as Error).name !== 'AbortError') { setError((error as Error).message); setLoading(false); } } }
    void load(); const timer = setInterval(() => void load(), 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  async function decide(id: string, action: 'approve' | 'delete') {
    if (busy) return;
    setBusy(id); setError(''); setNotice('');
    try {
      const response = await fetch('/api/mcp/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDrafts(data.drafts); onStateChange?.(data.state);
      setNotice(action === 'approve' ? 'Предложение отправлено. Кандидат увидит его в приглашениях.' : 'Черновик удалён');
    } catch (error) { setError((error as Error).message); } finally { setBusy(''); }
  }
  if (!drafts.length) {
    if (error) return <p className="inline-error" role="alert">{error}</p>;
    if (notice) return <p className="mcp-notice" role="status">{notice}</p>;
    return null;
  }
  return <section className="mcp-drafts" aria-label="Черновики приглашений от агента">
    <div className="mcp-drafts-heading"><div><span className="mcp-section-kicker"><FilePenLine size={16} />Подготовлено агентом</span><h2>Черновики приглашений {drafts.length > 0 && <span>· {drafts.length}</span>}</h2></div>
      <button className="activity-button" disabled={!!busy} aria-label="Обновить черновики агента" onClick={async () => { try { await refresh(); } catch (error) { setError((error as Error).message); } }}><RefreshCw size={15} /></button>
    </div>
    <p className="muted">Проверьте текст и зарплатную вилку. Нажатие «Одобрить и отправить» отправит предложение от вашей компании.</p>
    {loading ? <p role="status">Загружаем черновики…</p> : drafts.length === 0 && !error ? <p className="mcp-empty-drafts">Черновиков пока нет. Подключённый агент сможет подготовить их после поиска кандидатов.</p> : null}
    {drafts.map(draft => <article className="mcp-draft-card" key={draft.id}>
      <div className="mcp-draft-meta">Кандидат #{draft.candidate_id} · ещё не отправлено</div><h3>{draft.payload.title}</h3>
      <p className="mcp-draft-salary">{money(draft.payload.min)}–{money(draft.payload.max)} ₽/мес</p>
      <p className="mcp-draft-text">{draft.payload.description}</p>
      {!draft.available && <p className="inline-error">Кандидат сейчас недоступен для приглашения.</p>}
      <div className="mcp-draft-actions"><button className="activity-button primary" disabled={!!busy || !draft.available} onClick={() => void decide(draft.id, 'approve')}><Send size={15} />{busy === draft.id ? 'Обрабатываем…' : 'Одобрить и отправить'}</button>
        {nav && <button className="activity-button" onClick={() => nav(`/demo/employer/candidates?candidate=${draft.candidate_id}`)}>Подробнее о кандидате</button>}
        <button className="activity-button" disabled={!!busy} onClick={() => void decide(draft.id, 'delete')}><Trash2 size={15} />Удалить черновик</button></div>
    </article>)}
    {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="mcp-notice" role="status">{notice}</p>}
  </section>;
}
