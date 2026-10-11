"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowRight, Sparkles, X } from "lucide-react";
import type { Role } from "@/lib/model";
import type { Navigate } from "./landing";
import { useDraft } from "@/hooks/use-draft";
import { workspaceHints } from "@/lib/workspace-tour";

type Position = {
  x: number;
  y: number;
  w: number;
  h: number;
  vw: number;
  vh: number;
  mobile: boolean;
};
export function WorkspaceTour({
  role,
  section,
  intro = false,
  replay = 0,
  nav,
}: {
  role: Role;
  section: string;
  intro?: boolean;
  replay?: number;
  nav: Navigate;
}) {
  const key = section;
  const [seen, setSeen, meta] = useDraft<Record<string, boolean>>(
    `settings:tour_${role}_v1`,
    {},
  );
  const [preferences, setPreferences, preferencesMeta] = useDraft<{
    disabled: boolean;
  }>("settings:tour_preferences_v1", { disabled: false });
  const [active, setActive] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [saveError, setSaveError] = useState("");
  const saving = useRef(false);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const okButton = useRef<HTMLButtonElement>(null);
  const markerId = useId().replace(/:/g, "");
  const lastReplay = useRef(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // A failed request must never turn the default empty settings into consent
    // to show hints again. Keep readiness during saving to preserve the exit.
    if (meta.status === "saved" && preferencesMeta.status === "saved")
      setLoaded(true);
  }, [meta.status, preferencesMeta.status]);
  const hint = active ? workspaceHints[role][active] : undefined;
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setClosing(false);
    setPosition(null);
    const requestedReplay = replay !== lastReplay.current;
    lastReplay.current = replay;
    setActive(
      loaded &&
        workspaceHints[role][key] &&
        (requestedReplay || (!preferences.disabled && !seen[key]))
        ? key
        : null,
    );
    // Acknowledging a hint changes seen, but must not interrupt its exit animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, role, loaded, intro, replay]);
  useEffect(() => {
    if (loaded && intro && (seen[key] || preferences.disabled) && !active)
      nav(`/demo/${role}/${key}`);
  }, [loaded, intro, key, role, active, preferences.disabled]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const update = () => {
      const vw = window.innerWidth,
        vh = window.innerHeight;
      const elements = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-tour-tab="${active}"]`),
      );
      const element = elements.find(
        (el) => el.getBoundingClientRect().width > 0,
      );
      target.current = element || null;
      const mobile = vw < 768 || !element;
      if (mobile) {
        setPosition({
          x: 20,
          y: Math.min(108, vh * 0.15),
          w: Math.min(240, vw - 40),
          h: 52,
          vw,
          vh,
          mobile: true,
        });
      } else {
        const rect = element.getBoundingClientRect();
        if (rect.bottom > vh || rect.top < 0)
          element.scrollIntoView({ block: "nearest", behavior: "instant" });
        const r = element.getBoundingClientRect();
        setPosition({
          x: Math.max(0, r.x - 7),
          y: Math.max(0, r.y - 7),
          w: r.width + 14,
          h: r.height + 14,
          vw,
          vh,
          mobile: false,
        });
      }
    };
    frame = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-tour-tab="${active}"]`,
      );
      if (window.innerWidth >= 768)
        el?.scrollIntoView({ block: "nearest", behavior: "instant" });
      update();
    });
    // The sidebar switches between a sheet and desktop DOM after the resize event.
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [active]);
  const positioned = !!position;
  useEffect(() => {
    if (active && positioned) okButton.current?.focus({ preventScroll: true });
  }, [active, positioned]);
  async function dismiss(disableAll = false) {
    if (!active || closing || saving.current) return;
    saving.current = true;
    setSaveError("");
    if (disableAll) setPreferences({ disabled: true });
    else setSeen((v) => ({ ...v, [active]: true }));
    const saved = await (disableAll ? preferencesMeta.flush() : meta.flush());
    saving.current = false;
    if (!saved) {
      setSaveError("Не удалось сохранить выбор. Попробуйте ещё раз.");
      return;
    }
    setClosing(true);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    timer.current = setTimeout(
      () => {
        setActive(null);
        if (intro) nav(`/demo/${role}/${key}`);
      },
      reduced ? 0 : 240,
    );
  }
  if (!hint) return null;
  const p = position;
  const width = p ? Math.min(400, p.vw - 40) : 400;
  const left = p
    ? p.mobile
      ? 20
      : Math.min(p.x + p.w + 112, p.vw - width - 24)
    : 320;
  const top = p
    ? p.mobile
      ? p.y + p.h + 78
      : Math.max(24, Math.min(p.y + p.h / 2 - 110, p.vh - 310))
    : 180;
  const endX = p ? (p.mobile ? p.x + p.w / 2 : p.x + p.w + 16) : 0;
  const endY = p ? (p.mobile ? p.y + p.h + 12 : p.y + p.h / 2) : 0;
  const startX = p?.mobile ? left + width * 0.68 : left - 12;
  const startY = p?.mobile ? top - 16 : top + 76;
  const arrow = p?.mobile
    ? `M ${startX} ${startY} C ${startX + 26} ${startY - 52}, ${endX + 65} ${endY + 20}, ${endX} ${endY}`
    : `M ${startX} ${startY} C ${startX - 62} ${startY + 35}, ${endX + 60} ${endY - 44}, ${endX} ${endY}`;
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className={`workspace-tour ${closing ? "is-closing" : ""}`}
          aria-describedby={`${markerId}-text`}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            okButton.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            target.current?.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            dismiss();
          }}
        >
          {p ? (
            <>
              <div
                className="tour-frost"
                style={{
                  inset: 0,
                  clipPath: `path(evenodd, "M 0 0 H ${p.vw} V ${p.vh} H 0 Z M ${p.x + 15} ${p.y} H ${p.x + p.w - 15} Q ${p.x + p.w} ${p.y} ${p.x + p.w} ${p.y + 15} V ${p.y + p.h - 15} Q ${p.x + p.w} ${p.y + p.h} ${p.x + p.w - 15} ${p.y + p.h} H ${p.x + 15} Q ${p.x} ${p.y + p.h} ${p.x} ${p.y + p.h - 15} V ${p.y + 15} Q ${p.x} ${p.y} ${p.x + 15} ${p.y} Z")`,
                }}
              />
              <div
                className={`tour-spotlight ${p.mobile ? "is-mobile" : ""}`}
                style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
                aria-hidden="true"
              >
                {p.mobile && (
                  <>
                    <Sparkles size={19} />
                    <span>{hint.label}</span>
                  </>
                )}
              </div>
              <svg
                className="tour-arrow"
                width={p.vw}
                height={p.vh}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id={markerId}
                    markerWidth="10"
                    markerHeight="10"
                    refX="7"
                    refY="5"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 1 1 L 7 5 L 1 9"
                      fill="none"
                      stroke="#402fff"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </marker>
                </defs>
                <path
                  d={arrow}
                  pathLength="1"
                  markerEnd={`url(#${markerId})`}
                />
              </svg>
            </>
          ) : (
            <div className="tour-frost" style={{ inset: 0 }} />
          )}
          <div
            className="tour-note"
            style={{
              left,
              top,
              width,
              maxHeight: p ? Math.max(160, p.vh - top - 20) : undefined,
              visibility: p ? "visible" : "hidden",
            }}
          >
            <button
              className="tour-close"
              aria-label="Закрыть подсказку"
              onClick={() => dismiss()}
            >
              <X size={18} />
            </button>
            <span className="tour-eyebrow mono">
              <Sparkles size={14} />
              ОСВАИВАЕМСЯ В ОФФЕРЛИ
            </span>
            <DialogPrimitive.Title className="tour-title">
              {hint.title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description
              id={`${markerId}-text`}
              className="tour-description"
            >
              {hint.text}
            </DialogPrimitive.Description>
            {saveError && (
              <p role="alert" className="inline-error">
                {saveError}
              </p>
            )}
            <div className="tour-note-footer">
              <button
                type="button"
                className="tour-dismiss-all"
                disabled={closing}
                onClick={() => dismiss(true)}
              >
                Не показывать больше
              </button>
              <button
                ref={okButton}
                className="btn primary tour-ok"
                onClick={() => dismiss()}
              >
                ОК
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
