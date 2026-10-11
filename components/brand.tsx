import type { ReactNode } from "react";
import {
  Check,
  LockKeyhole,
  MapPin,
  BriefcaseBusiness,
  ScanSearch,
} from "lucide-react";
export function Brand({
  small = false,
  light = false,
  variant = "original",
}: {
  small?: boolean;
  light?: boolean;
  variant?: string;
}) {
  return (
    <span
      className={`brand ${small ? "brand-small" : ""} ${light ? "brand-ink" : ""}`}
    >
      <img src={`/brand/${variant}.svg`} alt="" />
      <span>
        <strong>Офферли</strong>
        <small>Дело найдёт.</small>
      </span>
    </span>
  );
}
export function Badge({
  children,
  neutral = false,
}: {
  children: ReactNode;
  neutral?: boolean;
}) {
  return (
    <span className={`verify-badge ${neutral ? "neutral" : ""}`}>
      <Check size={14} />
      {children}
    </span>
  );
}
export function Tags({ items }: { items: string[] }) {
  return (
    <div className="tags">
      {items.map((t) => (
        <span key={t}>{t}</span>
      ))}
    </div>
  );
}
export function MiniCandidate({
  compact = false,
  frontend = false,
}: {
  compact?: boolean;
  frontend?: boolean;
}) {
  return (
    <div className={`mini-candidate ${compact ? "compact" : ""}`}>
      <div className="mini-person">
        <img
          className="avatar avatar-blue candidate-portrait"
          src={
            frontend
              ? "/portraits/developer-female.webp"
              : "/portraits/developer-male.webp"
          }
          alt="Портрет демонстрационного кандидата"
          width={80}
          height={80}
          loading="lazy"
        />
        <div>
          <span className="meta mono">
            Кандидат #{frontend ? "1087" : "1042"}
          </span>
          <h3>{frontend ? "Frontend-разработчик" : "Backend-разработчик"}</h3>
          <Badge>Middle подтверждён</Badge>
          <Tags
            items={
              frontend
                ? ["React", "TypeScript", "CSS"]
                : ["Python", "SQL", "FastAPI"]
            }
          />
        </div>
      </div>
      <div className="mini-meta">
        <span>
          <MapPin size={16} />
          Москва · Удалённо
        </span>
        <span>
          <BriefcaseBusiness size={16} />
          Опыт 3 года
        </span>
      </div>
      <p className="salary-small">Ожидания: 180 000 — 230 000 ₽/мес</p>
      <div className="match-reason">
        <ScanSearch size={17} />
        <span>
          Подходит: проверены {frontend ? "React и TypeScript" : "Python и SQL"}
        </span>
      </div>
    </div>
  );
}
export function PrivacyNote() {
  return (
    <span className="privacy-note">
      <LockKeyhole size={16} />
      Контакты открываются только с вашего согласия
    </span>
  );
}
