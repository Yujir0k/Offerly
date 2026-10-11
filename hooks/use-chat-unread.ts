"use client";
import { useEffect, useState } from "react";
import { chatRequest } from "@/lib/chat-client";
import type { Role } from "@/lib/model";
export function useChatUnread(role: Role, userId?: string) {
  const [count, setCount] = useState(0);
  const identity = `${role}:${userId}`;
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (previousIdentity !== identity) { setPreviousIdentity(identity); setCount(0); }
  useEffect(() => {
    let cancelled = false,
      pending = false;
    const abort = new AbortController();
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const value = await chatRequest<{ unread: number }>(
          role,
          "?summary=1",
          undefined,
          abort.signal,
        );
        if (!cancelled) setCount(value.unread);
      } catch {
      } finally {
        pending = false;
      }
    };
    void refresh();
    const interval = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("offerly:chat-read", refresh);
    return () => {
      cancelled = true;
      abort.abort();
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("offerly:chat-read", refresh);
    };
  }, [role, userId]);
  return count;
}
