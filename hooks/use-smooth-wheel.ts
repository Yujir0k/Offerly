"use client";
import { useEffect, useState } from "react";
/** Contain menu scrolling and ease coarse wheel deltas without affecting keyboard navigation. */
export function useSmoothWheel() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!node) return;
    let frame = 0,
      target = node.scrollTop;
    const tick = () => {
      const distance = target - node.scrollTop;
      if (Math.abs(distance) < 0.5) {
        node.scrollTop = target;
        frame = 0;
        return;
      }
      node.scrollTop += distance * 0.25;
      frame = requestAnimationFrame(tick);
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
        return;
      event.preventDefault();
      if (!frame) target = node.scrollTop;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? node.clientHeight
            : 1);
      target = Math.max(
        0,
        Math.min(node.scrollHeight - node.clientHeight, target + delta),
      );
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        node.scrollTop = target;
      else if (!frame) frame = requestAnimationFrame(tick);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame);
    };
  }, [node]);
  return setNode;
}
