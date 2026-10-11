"use client";
import { Brand } from "./brand";

export function PublicFooter({
  nav,
  returnTo,
}: {
  nav: (path: string) => void;
  returnTo?: string;
}) {
  const links = [
    ["/privacy", "Конфиденциальность"],
    ["/support", "Поддержка"],
    ["/brand", "Айдентика"],
  ];
  return (
    <footer className="public-footer-shell">
      <div className="public-footer section-wrap">
        <Brand light small />
        <nav aria-label="Ссылки в подвале">
          {links.map(([path, label]) => {
            const href = returnTo
              ? `${path}?returnTo=${encodeURIComponent(returnTo)}`
              : path;
            return (
              <a
                key={path}
                href={href}
                onClick={(event) => {
                  if (
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  nav(href);
                }}
              >
                {label}
              </a>
            );
          })}
        </nav>
        <span>© 2026 Офферли</span>
      </div>
    </footer>
  );
}
