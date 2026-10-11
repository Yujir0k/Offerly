// User-Agent is an approximate label, never an authentication or fingerprint signal.
export function sessionDevice(raw: string) {
  const ua = raw.slice(0, 1000);
  const browser = /YaBrowser\//.test(ua)
    ? "Яндекс Браузер"
    : /SamsungBrowser\//.test(ua)
      ? "Samsung Internet"
      : /Brave\//.test(ua)
        ? "Brave"
        : /Edg(?:e|A|iOS)?\//.test(ua)
          ? "Edge"
          : /OPR\/|Opera/.test(ua)
            ? "Opera"
            : /Firefox|FxiOS/.test(ua)
              ? "Firefox"
              : /Chrome|CriOS/.test(ua)
                ? "Chrome"
                : /Safari/.test(ua)
                  ? "Safari"
                  : "Браузер";
  const os = /iPad/.test(ua)
    ? "iPad"
    : /iPhone|iPod/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return {
    name: os
      ? `${browser} · ${os}`
      : browser !== "Браузер"
        ? browser
        : "Неизвестное устройство",
    type:
      /iPad/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
        ? "tablet"
        : /iPhone|iPod|Android/.test(ua)
          ? "mobile"
          : "desktop",
  };
}
export type DeviceSession = {
  id: string;
  name: string;
  type: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};
