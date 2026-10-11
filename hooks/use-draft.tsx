"use client";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { AlertCircle } from "lucide-react";
const cache = new Map<string, unknown>();
const pending = new Map<string, Promise<void>>();
let draftGeneration = 0;
export function clearDraftCaches() {
  draftGeneration++;
  cache.clear();
  pending.clear();
  if (typeof window !== "undefined") {
    for (let i=sessionStorage.length-1;i>=0;i--) {const key=sessionStorage.key(i);if(key?.startsWith("offerly-formal-draft:"))sessionStorage.removeItem(key);}
    sessionStorage.removeItem("offerly-setup-draft");
    sessionStorage.removeItem("offerly-registration-draft");
  }
}
export function useDraft<T>(key: string, initial: T) {
  const generation = useRef(draftGeneration);
  const [value, rawSet] = useState<T>(() => (cache.get(key) as T) ?? initial);
  const [status, setStatus] = useState("loading");
  const dirty = useRef(false);
  const mounted = useRef(true);
  const current = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (v: T) => {
    const previous = pending.get(key) || Promise.resolve();
    const job = previous
      .catch(() => {})
      .then(async () => {
        if (generation.current !== draftGeneration) return false;
        const r = await fetch(`/api/drafts?key=${encodeURIComponent(key)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: v }),
          keepalive: true,
        });
        if (r.status === 401 && key === "registration") {
          if (mounted.current) setStatus("local");
          return false;
        }
        if (!r.ok) throw new Error("save");
        return true;
      });
    pending.set(
      key,
      job.then(() => {}).catch(() => {}),
    );
    if (mounted.current) setStatus("saving");
    job
      .then((saved) => {
        if (saved && mounted.current && current.current === v)
          setStatus("saved");
      })
      .catch(() => {
        if (mounted.current) setStatus("error");
      });
    return job.catch(() => false);
  };
  useEffect(() => {
    mounted.current = true;
    dirty.current = false;
    let cancelled = false;
    let cached = cache.get(key) as T | undefined;
    let localEditedAt = 0;
    if (key === "setup") {
      try {
        const local = JSON.parse(
          sessionStorage.getItem("offerly-setup-draft") || "null",
        );
        if (local) {
          cached = local.value;
          localEditedAt = local.editedAt || 0;
        }
      } catch {}
    }
    if (key === "registration" && cached === undefined) {
      try {
        cached =
          JSON.parse(
            sessionStorage.getItem("offerly-registration-draft") || "null",
          ) || undefined;
      } catch {}
    }
    current.current = cached ?? initial;
    void Promise.resolve().then(() => {
      if (!cancelled && !dirty.current) rawSet(cached ?? initial);
    });
    (pending.get(key) || Promise.resolve())
      .catch(() => {})
      .then(() => fetch(`/api/drafts?key=${encodeURIComponent(key)}`))
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 401) return { value: null, local: true };
          throw new Error("load");
        }
        return r.json() as Promise<{
          value: T | null;
          local?: boolean;
          updatedAt?: string;
        }>;
      })
      .then((b) => {
        if (cancelled) return;
        const preferLocal =
          key === "setup" &&
          cached !== undefined &&
          localEditedAt > Date.parse(b.updatedAt || "1970-01-01");
        if (
          !dirty.current &&
          !preferLocal &&
          b.value !== null &&
          b.value !== undefined
        ) {
          const v =
            typeof initial === "object" && !Array.isArray(initial)
              ? { ...initial, ...b.value }
              : b.value;
          cache.set(key, v);
          current.current = v;
          rawSet(v);
        }
        if (preferLocal && !dirty.current) save(cached as T);
        else if (
          key === "registration" &&
          !b.local &&
          b.value === null &&
          cached !== undefined
        )
          save(cached);
        else setStatus(b.local ? "local" : "saved");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    const flushOnExit = () => {
      if (!dirty.current) return;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      // Send directly: the promise queue may not run before browser navigation.
      fetch(`/api/drafts?key=${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: current.current }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", flushOnExit);
    return () => {
      window.removeEventListener("pagehide", flushOnExit);
      cancelled = true;
      mounted.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        save(current.current);
      }
    };
  }, [key]);
  const setValue: Dispatch<SetStateAction<T>> = (next) => {
    const v =
      typeof next === "function"
        ? (next as (v: T) => T)(current.current)
        : next;
    if (key === "registration") {
      try {
        sessionStorage.setItem("offerly-registration-draft", JSON.stringify(v));
      } catch {}
    }
    if (key === "setup") {
      try {
        sessionStorage.setItem(
          "offerly-setup-draft",
          JSON.stringify({ value: v, editedAt: Date.now() }),
        );
      } catch {}
    }
    current.current = v;
    dirty.current = true;
    cache.set(key, v);
    rawSet(v);
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      save(v);
    }, 450);
  };
  const reset = (v: T) => {
    setValue(v);
  };
  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return save(current.current);
  };
  return [
    value,
    setValue,
    { status, retry: () => save(current.current), reset, flush },
  ] as const;
}
export function DraftStatus({
  meta,
}: {
  meta: { status: string; retry: () => void };
}) {
  if (meta.status !== "error") return null;
  return (
    <div className="draft-status error" role="status">
      <AlertCircle size={14} />
      <span>
        Не удалось синхронизировать изменения. Они сохранены в открытой
        странице.
      </span>
      <button type="button" onClick={meta.retry}>
        Повторить
      </button>
    </div>
  );
}

export async function seedDraft(key: string, value: unknown) {
  cache.set(key, value);
  if (key === "setup") {
    try {
      sessionStorage.setItem(
        "offerly-setup-draft",
        JSON.stringify({ value, editedAt: Date.now() }),
      );
    } catch {}
  }
  const previous = pending.get(key) || Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(async () => {
      const r = await fetch(`/api/drafts?key=${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!r.ok) throw new Error("save");
    });
  pending.set(key, job);
  await job.catch(() => {});
}
