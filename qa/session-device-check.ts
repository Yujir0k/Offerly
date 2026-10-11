import assert from "node:assert/strict";
import { sessionDevice } from "../lib/session-device";
for (const [ua, name, type] of [
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/132.0 Safari/537.36",
    "Chrome · macOS",
    "desktop",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0) Chrome/132.0 Safari/537.36 Edg/132.0",
    "Edge · Windows",
    "desktop",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0) Chrome/132.0 Safari/537.36 YaBrowser/25.0",
    "Яндекс Браузер · Windows",
    "desktop",
  ],
  [
    "Mozilla/5.0 (Android 14; Mobile) Chrome/132.0 SamsungBrowser/28.0",
    "Samsung Internet · Android",
    "mobile",
  ],
  [
    "Mozilla/5.0 (iPad; CPU OS 18) Version/18 Safari/605.1",
    "Safari · iPad",
    "tablet",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18) CriOS/132 Mobile/15 Safari/605.1",
    "Chrome · iPhone",
    "mobile",
  ],
  [
    "Mozilla/5.0 (iPhone) FxiOS/132 Mobile/15 Safari/605.1",
    "Firefox · iPhone",
    "mobile",
  ],
  [
    "Mozilla/5.0 (Android 14) Chrome/132.0 Safari/537.36",
    "Chrome · Android",
    "tablet",
  ],
  ["Mozilla/5.0 (X11; Linux x86_64) Firefox/132", "Firefox · Linux", "desktop"],
  ["Chrome/132", "Chrome", "desktop"],
  ["", "", "desktop"],
] as const) {
  const d = sessionDevice(ua);
  assert.equal(d.name, name || "Неизвестное устройство");
  assert.equal(d.type, type);
}
console.log(
  "PASS 11 browser/device labels, including reduced/absent User-Agent",
);
