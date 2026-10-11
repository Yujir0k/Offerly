"use client";
import { useEffect, useRef, useState } from "react";
import { chatRequest } from "@/lib/chat-client";
import type { EmployerTask } from "@/lib/conversation-types";
export function useTaskAnswer(
  uid: string,
  room: string,
  messageId: string,
  task: EmployerTask,
  active: boolean,
) {
  const key = `offerly-task-answer:${uid}:${room}:${messageId}`;
  const [text, setText] = useState(() => {
    try {
      const local = JSON.parse(localStorage.getItem(key) || "null");
      if (local?.pending) return String(local.text || "");
    } catch {}
    return task.draftAnswer || "";
  });
  const [status, setStatus] = useState("saved");
  const current = useRef(text),
    revision = useRef(task.draftRevision || 0),
    queue = useRef(Promise.resolve()),
    mounted = useRef(true);
  const lastSaved = useRef(task.draftAnswer || "");
  revision.current = Math.max(revision.current, task.draftRevision || 0);
  const persist = (value: string, pending: boolean) => {
    try {
      localStorage.setItem(key, JSON.stringify({ text: value, pending }));
    } catch {}
  };
  function edit(value: string) {
    current.current = value;
    setText(value);
    persist(value, true);
    setStatus("pending");
  }
  function save() {
    const snapshot = current.current;
    if (!active || snapshot === lastSaved.current) return;
    setStatus("saving");
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        if (snapshot === lastSaved.current) return;
        const next = revision.current + 1;
        try {
          const result = await chatRequest<{ revision: number }>(
            "candidate",
            `/${room}`,
            { type: "task-draft", messageId, answer: snapshot, revision: next },
          );
          revision.current = result.revision;
          lastSaved.current = snapshot;
          if (current.current === snapshot) {
            persist(snapshot, false);
            if (mounted.current) setStatus("saved");
          }
        } catch {
          persist(current.current, true);
          if (mounted.current) setStatus("local");
        }
      });
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(save, 350);
    return () => clearTimeout(timer);
  }, [text, active]);
  useEffect(() => {
    if (!active) return;
    const retry = () => save();
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
  }, [active]);
  function clear() {
    try {
      localStorage.removeItem(key);
    } catch {}
    current.current = "";
    setText("");
  }
  return { text, edit, save, clear, status };
}
