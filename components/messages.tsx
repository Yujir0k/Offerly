"use client";
import { useSessionDraft } from "@/hooks/use-session-draft";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Loader2,
  MessageSquare,
  Send,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import type { State } from "@/lib/model";
import type { Navigate } from "./landing";
import type { Conversation, ChatMessage, ChatThread } from "@/lib/chat-types";
import { ConversationTask, OfferConversationTask } from "./conversation-task";
import { chatRequest } from "@/lib/chat-client";
import { FeedbackDialog } from "./feedback-dialog";
const merge = (old: ChatMessage[], next: ChatMessage[]) =>
  [...new Map([...old, ...next].map((m) => [m.id, m])).values()].sort((a, b) =>
    BigInt(a.id) < BigInt(b.id) ? -1 : 1,
  );
function ChatAvatar({ room }: { room: Conversation }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="chat-avatar">
      {room.avatar && !failed ? (
        <img
          src={room.avatar}
          alt={room.name}
          onError={() => setFailed(true)}
        />
      ) : (
        room.name.trim().slice(0, 1).toUpperCase() || "О"
      )}
    </span>
  );
}
export function Messages({ s, nav }: { s: State; nav: Navigate }) {
  const role = s.role,
    uid = s.auth?.userId || "",
    selected =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("conversation");
  const [rooms, setRooms] = useState<Conversation[]>([]),
    [next, setNext] = useState<string | null>(null),
    [listLoading, setListLoading] = useState(true),
    [listError, setListError] = useState("");
  const [thread, setThread] = useState<ChatThread | null>(null),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false),
    [olderBusy, setOlderBusy] = useState(false),
    [sendError, setSendError] = useState("");
  const scroll = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true),
    first = useRef(true),
    generation = useRef(0),
    pendingSend = useRef<{ body: string; clientId: string } | null>(null),
    lastRead = useRef("0"),
    olderRoomsLoaded = useRef(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const candidateId = query.get('candidate'), companyId=query.get('company');
    if (!candidateId && !companyId) return;
    let cancelled=false;
    void chatRequest<{id:string}>(role,'',{type:'open',...(role==='employer'?{candidateId:Number(candidateId)}:{companyId})})
      .then(r=>{if(!cancelled)nav(`/demo/${role}/messages?conversation=${r.id}`);})
      .catch(e=>{if(!cancelled)setLoadError((e as Error).message);});
    return()=>{cancelled=true;};
  },[role,nav]);
  const draftKey = `offerly-chat:${uid}:${selected}`;
  const [draft, setDraft] = useSessionDraft(draftKey);
  const identity = `${uid}:${role}`;
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (previousIdentity !== identity) {
    setPreviousIdentity(identity); setRooms([]); setNext(null); setListLoading(true); setListError("");
  }
  const threadIdentity = `${identity}:${selected}`;
  const [previousThread, setPreviousThread] = useState(threadIdentity);
  if (previousThread !== threadIdentity) {
    setPreviousThread(threadIdentity); setThread(null); setLoadError(""); setSendError(""); setLoading(!!selected);
  }
  const refreshRooms = useCallback(
    async (before?: string, signal?: AbortSignal) => {
      try {
        const data = await chatRequest<{
          items: Conversation[];
          nextCursor: string | null;
        }>(
          role,
          before ? `?before=${encodeURIComponent(before)}` : "",
          undefined,
          signal,
        );
        if (signal?.aborted) return;
        setRooms((old) =>
          [
            ...new Map(
              [
                ...(before
                  ? old
                  : old.filter(
                      (r) =>
                        data.items.length === 30 &&
                        r.updatedAt <=
                          data.items[data.items.length - 1].updatedAt &&
                        !data.items.some((n) => n.id === r.id),
                    )),
                ...data.items,
              ].map((r) => [r.id, r]),
            ).values(),
          ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        );
        if (before || !olderRoomsLoaded.current) setNext(data.nextCursor);
        if (before) olderRoomsLoaded.current = true;
        setListError("");
      } catch (e) {
        if (!signal?.aborted) setListError((e as Error).message);
      } finally {
        if (!signal?.aborted) setListLoading(false);
      }
    },
    [role],
  );
  useEffect(() => {
    olderRoomsLoaded.current = false;
    const abort = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      await refreshRooms(undefined, abort.signal);
      pending = false;
    };
    void refresh();
    window.addEventListener("offerly:task-changed", refresh);
    const timer = setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    window.addEventListener("offerly:task-changed", refresh);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("offerly:task-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshRooms, uid]);
  const markRead = useCallback(
    async (data: ChatThread) => {
      const last = data.messages.at(-1);
      if (
        document.hidden ||
        !nearBottom.current ||
        !last ||
        BigInt(last.id) <= BigInt(lastRead.current)
      )
        return;
      const epoch = generation.current;
      await chatRequest(role, `/${data.conversation.id}`, {
        type: "read",
        through: last.id,
      });
      if (epoch !== generation.current) return;
      lastRead.current = last.id;
      setRooms((old) =>
        old.map((r) =>
          r.id === data.conversation.id ? { ...r, unread: 0 } : r,
        ),
      );
      window.dispatchEvent(new Event("offerly:chat-read"));
    },
    [role],
  );
  useEffect(() => {
    generation.current++;
    const epoch = generation.current;
    first.current = true;
    nearBottom.current = true;
    lastRead.current = "0";
    pendingSend.current = null;
    if (!selected) {
      return;
    }
    const abort = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const data = await chatRequest<ChatThread>(
          role,
          `/${encodeURIComponent(selected)}`,
          undefined,
          abort.signal,
        );
        if (abort.signal.aborted || generation.current !== epoch) return;
        nearBottom.current =
          !scroll.current ||
          scroll.current.scrollHeight -
            scroll.current.scrollTop -
            scroll.current.clientHeight <
            100;
        setThread((old) =>
          old
            ? {
                ...data,
                messages: merge(old.messages, data.messages),
                hasOlder:
                  old.messages.length > data.messages.length
                    ? old.hasOlder
                    : data.hasOlder,
              }
            : data,
        );
        setLoadError("");
      } catch (e) {
        if (!abort.signal.aborted) setLoadError((e as Error).message);
      } finally {
        pending = false;
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    window.addEventListener("offerly:task-changed", refresh);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("offerly:task-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [selected, role, uid, draftKey]);
  useEffect(() => {
    if (!thread) return;
    if (first.current || nearBottom.current) {
      scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
      first.current = false;
      nearBottom.current = true;
    }
    if (!document.hidden) void markRead(thread).catch(() => {});
  }, [thread, markRead]);
  async function send() {
    if (busy || !thread?.conversation.canWrite || !draft.trim()) return;
    const body = draft.trim(),
      epoch = generation.current,
      id = thread.conversation.id;
    const pending =
      pendingSend.current?.body === body
        ? pendingSend.current
        : { body, clientId: crypto.randomUUID() };
    pendingSend.current = pending;
    setBusy(true);
    try {
      const result = await chatRequest<{ message: ChatMessage }>(
        role,
        `/${id}`,
        { type: "message", ...pending },
      );
      if (generation.current !== epoch) return;
      nearBottom.current = true;
      setThread((old) =>
        old ? { ...old, messages: merge(old.messages, [result.message]) } : old,
      );
      setDraft("");
      pendingSend.current = null;
      void refreshRooms();
    } catch (e) {
      if (generation.current === epoch) setSendError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const date = (value: string) =>
    new Date(value).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    });
  return (
    <div className={`messages-layout ${selected ? "has-selected" : ""}`}>
      <aside className="messages-list" aria-label="Ваши диалоги">
        <header>
          <div>
            <span className="mono">НА СВЯЗИ</span>
            <h2>Диалоги</h2>
          </div>
          <MessageSquare size={23} />
        </header>
        <p className="messages-list-note">
          Знакомства с компаниями и кандидатами
        </p>
        {listLoading ? (
          <p className="chat-placeholder">
            <Loader2 size={20} className="spin" />
            Загружаем…
          </p>
        ) : null}
        {listError ? (
          <div className="chat-error" role="alert">
            {listError}
            <button className="btn secondary" onClick={() => refreshRooms()}>
              Повторить
            </button>
          </div>
        ) : null}
        {!listLoading && !rooms.length && !listError ? (
          <div className="chat-empty-list">
            <MessageSquare size={30} />
            <h3>Пока без сообщений</h3>
            <p>Чат появится после принятия приглашения или отправки отклика.</p>
            <button
              className="btn secondary"
              onClick={() =>
                nav(
                  `/demo/${role}/${role === "candidate" ? "invitations" : "candidates"}`,
                )
              }
            >
              {role === "candidate" ? "К приглашениям" : "Найти кандидатов"}
              <ArrowRight size={16} />
            </button>
          </div>
        ) : null}
        <div className="messages-rooms">
          {rooms.map((r) => (
            <button
              key={r.id}
              className={`chat-room ${selected === r.id ? "selected" : ""}`}
              aria-current={selected === r.id ? "page" : undefined}
              onClick={() => nav(`/demo/${role}/messages?conversation=${r.id}`)}
            >
              <ChatAvatar room={r} />
              <span className="chat-room-text">
                <strong>{r.name}</strong>
                <span>{r.lastMessage}</span>
              </span>
              <span className="chat-room-meta">
                <time>
                  {new Date(r.updatedAt).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "short",
                  })}
                </time>
                {r.unread > 0 ? (
                  <b aria-label={`${r.unread} непрочитанных`}>
                    {r.unread > 99 ? "99+" : r.unread}
                  </b>
                ) : null}
              </span>
            </button>
          ))}
        </div>
        {next ? (
          <button
            className="btn secondary chat-more"
            onClick={() => refreshRooms(next)}
          >
            Ещё диалоги
          </button>
        ) : null}
      </aside>
      <section className="messages-thread" aria-label="Переписка">
        {!selected ? (
          <div className="chat-welcome">
            <span>
              <MessageSquare size={36} />
            </span>
            <h2>Продолжим знакомство</h2>
            <p>
              Выберите диалог слева. Обсудите задачи, условия и следующий шаг —
              всё останется в одной переписке.
            </p>
            <small>
              <ShieldCheck size={16} />
              Переписку видят участники диалога
            </small>
          </div>
        ) : loading && !thread ? (
          <div className="chat-welcome">
            <Loader2 size={28} className="spin" />
            <p>Открываем переписку…</p>
          </div>
        ) : thread ? (
          <>
            <header className="chat-thread-header">
              <button
                className="chat-mobile-back"
                aria-label="Все диалоги"
                onClick={() => nav(`/demo/${role}/messages`)}
              >
                <ArrowLeft size={20} />
              </button>
              <ChatAvatar
                key={thread.conversation.id}
                room={thread.conversation}
              />
              <div>
                <h2>{thread.conversation.name}</h2>
                <p>{thread.conversation.subtitle}</p>
                {thread.conversation.grade && (
                  <span className="chat-grade">
                    <ShieldCheck size={14} />
                    {thread.conversation.grade}
                    {thread.conversation.demonstration
                      ? " · демопример"
                      : " подтверждён"}
                  </span>
                )}
              </div>
              <span className="chat-private">
                <ShieldCheck size={16} />
                Личный диалог
              </span>
            </header>
            {thread.conversation.context.length ? (
              <div className="chat-context">
                <span>
                  {thread.conversation.context[0].kind === "invitation"
                    ? "Приглашение"
                    : "Отклик"}
                </span>
                <strong>{thread.conversation.context[0].title}</strong>
                {thread.conversation.context.length > 1 ? (
                  <small>и ещё {thread.conversation.context.length - 1}</small>
                ) : null}
              </div>
            ) : null}
            {loadError ? (
              <p className="chat-reconnect" role="status">
                <RefreshCw size={15} />
                {loadError} Пробуем восстановить связь…
              </p>
            ) : null}
            <div
              className={`chat-messages${thread.messages.length ? "" : " is-empty"}`}
              ref={scroll}
              role="log"
              onScroll={() => {
                const el = scroll.current;
                nearBottom.current =
                  !el || el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                if (nearBottom.current && thread)
                  void markRead(thread).catch(() => {});
              }}
              aria-label="Сообщения диалога"
              aria-live="polite"
              aria-relevant="additions text"
            >
              <div className="chat-exchange" role="note">
                <ShieldCheck size={18} />
                <div>
                  <strong>Вы обменялись контактами</strong>
                  <p>Теперь вы можете общаться и обсуждать условия работы.</p>
                </div>
              </div>
              {thread.hasOlder ? (
                <button
                  className="btn secondary chat-more"
                  disabled={olderBusy}
                  onClick={async () => {
                    if (!thread.messages.length) return;
                    setOlderBusy(true);
                    const epoch = generation.current;
                    try {
                      const oldHeight = scroll.current?.scrollHeight || 0,
                        oldTop = scroll.current?.scrollTop || 0;
                      const data = await chatRequest<ChatThread>(
                        role,
                        `/${selected}?before=${thread.messages[0].id}`,
                      );
                      if (epoch !== generation.current) return;
                      nearBottom.current = false;
                      setThread((old) =>
                        old
                          ? {
                              ...old,
                              messages: merge(data.messages, old.messages),
                              hasOlder: data.hasOlder,
                            }
                          : old,
                      );
                      requestAnimationFrame(() =>
                        scroll.current?.scrollTo({
                          top: scroll.current.scrollHeight - oldHeight + oldTop,
                        }),
                      );
                    } catch (e) {
                      setSendError((e as Error).message);
                    } finally {
                      setOlderBusy(false);
                    }
                  }}
                >
                  Более ранние сообщения
                </button>
              ) : null}
              {!thread.messages.length ? (
                <div className="chat-first-message">
                  <MessageSquare size={25} />
                  <p>Вы уже сделали первый шаг к знакомству.</p>
                  <span>
                    Поздоровайтесь и договоритесь, что обсудить дальше.
                  </span>
                </div>
              ) : null}
              {thread.messages.map((m, index) => (
                <div key={m.id}>
                  {index === 0 ||
                  date(thread.messages[index - 1].createdAt) !==
                    date(m.createdAt) ? (
                    <div className="chat-day">{date(m.createdAt)}</div>
                  ) : null}
                  <article className={`chat-message ${m.mine ? "mine" : ""}`}>
                    <span className="chat-sender">
                      {m.mine ? "Вы" : m.sender}
                    </span>
                    {!m.task && <p>{m.body}</p>}
                    {m.task && <ConversationTask key={`${uid}:${thread.conversation.id}:${m.id}`} task={m.task} role={role} room={thread.conversation.id} messageId={m.id} canWrite={thread.conversation.canWrite} uid={uid} />}
                    <footer>
                      <time dateTime={m.createdAt}>
                        {new Date(m.createdAt).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      {m.mine ? (
                        BigInt(m.id) <= BigInt(thread.otherReadThrough) ? (
                          <CheckCheck size={15} aria-label="Прочитано" />
                        ) : (
                          <Check size={15} aria-label="Отправлено" />
                        )
                      ) : null}
                    </footer>
                  </article>
                </div>
              ))}
            </div>
            {thread.conversation.canWrite && (
              <OfferConversationTask key={thread.conversation.id} role={role} room={thread.conversation.id} />
            )}
            {thread.conversation.canWrite ? (
              <form
                className="chat-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label htmlFor="chat-message" className="sr-only">
                  Ваше сообщение
                </label>
                <div className="chat-input-shell">
                  <textarea
                    id="chat-message"
                    placeholder="Напишите сообщение…"
                    maxLength={4000}
                    rows={2}
                    value={draft}
                    disabled={busy}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="chat-send-button"
                    aria-label="Отправить"
                    title="Отправить сообщение"
                    disabled={busy || !draft.trim()}
                  >
                    {busy ? (
                      <Loader2 size={18} className="spin" />
                    ) : (
                      <Send size={18} />
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <p className="chat-reconnect">
                У вас доступ только к просмотру переписки компании.
              </p>
            )}
          </>
        ) : (
          <div className="chat-welcome">
            <MessageSquare size={30} />
            <h2>Диалог недоступен</h2>
            <p role="alert">{loadError}</p>
            <button
              className="btn secondary"
              onClick={() => nav(`/demo/${role}/messages`)}
            >
              К диалогам
            </button>
          </div>
        )}
      </section>
      <FeedbackDialog
        message={sendError}
        open={!!sendError}
        onOpenChange={(open) => {
          if (!open) setSendError("");
        }}
      />
    </div>
  );
}
