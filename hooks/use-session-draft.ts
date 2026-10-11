"use client";
import { useCallback, useSyncExternalStore } from "react";
const event = "offerly:session-draft";
const fallback = new Map<string, string>();
function subscribe(notify: () => void) {
  window.addEventListener(event, notify);
  window.addEventListener("storage", notify);
  return () => { window.removeEventListener(event, notify); window.removeEventListener("storage", notify); };
}
function read(key: string) {
  if (fallback.has(key)) return fallback.get(key)!;
  try { return sessionStorage.getItem(key) || ""; } catch { return ""; }
}
/** Draft identity includes user and conversation; switching never flashes another room's text. */
export function useSessionDraft(key: string) {
  const snapshot = useCallback(() => read(key), [key]);
  const text = useSyncExternalStore(subscribe, snapshot, () => "");
  const setText = useCallback((value: string) => {
    try {
      if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key);
      fallback.delete(key);
    } catch { fallback.set(key, value); }
    window.dispatchEvent(new Event(event));
  }, [key]);
  return [text, setText] as const;
}
