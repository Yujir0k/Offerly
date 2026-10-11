"use client";
import { useSyncExternalStore } from "react";

let timestamp = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const snapshot = () => timestamp;
const serverSnapshot = () => 0;
function subscribe(listener: () => void) {
  listeners.add(listener);
  timestamp = Date.now();
  if (!timer) timer = setInterval(() => {
    timestamp = Date.now();
    for (const notify of listeners) notify();
  }, 1000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { clearInterval(timer); timer = undefined; }
  };
}
/** One shared clock, stable snapshots and an identical first server/client render. */
export function useBrowserClock() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
