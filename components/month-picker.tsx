"use client";
import { useEffect, useRef, useState } from "react";
import { currentWorkMonth, workMonthBounds } from "@/lib/work-dates";
import { CalendarDays } from "lucide-react";
import { makeDropdownRoom } from "@/lib/dropdown-room";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
const months = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
export function MonthPicker({
  id,
  value,
  onChange,
  min,
  max,
  disabled = false,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  const [current, setCurrent] = useState(() => currentWorkMonth());
  useEffect(() => {
    const timer = setInterval(() => setCurrent(currentWorkMonth()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const bounds = workMonthBounds(min, max);
  const upperYear = Number(bounds.max.slice(0, 4));
  const lowerYear = Math.min(upperYear, Number(bounds.min.slice(0, 4)));
  const clampYear = (v: number) => Math.max(lowerYear, Math.min(upperYear, v));
  const [open, setOpen] = useState(false),
    [year, setYear] = useState(
      clampYear(Number(value.slice(0, 4)) || upperYear),
    );
  const [yearText, setYearText] = useState(String(year));
  const trigger = useRef<HTMLButtonElement>(null);
  const yearInput = useRef<HTMLInputElement>(null);
  const [showYears, setShowYears] = useState(false);
  const [yearPage, setYearPage] = useState(Math.floor(year / 20) * 20);
  const [horizontalOffset, setHorizontalOffset] = useState(0);
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const unavailable = (v: string) => v < bounds.min || v > bounds.max;
  const choose = (v: string) => {
    const fresh = workMonthBounds(min, max);
    if (v && (v < fresh.min || v > fresh.max)) return;
    onChange(v);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setCurrent(currentWorkMonth());
          const left = trigger.current?.getBoundingClientRect().left || 0;
          setHorizontalOffset(
            -Math.max(
              0,
              left +
                Math.min(300, window.innerWidth - 32) -
                window.innerWidth +
                16,
            ),
          );
          const next = clampYear(valid ? Number(value.slice(0, 4)) : upperYear);
          setYear(next);
          setYearText(String(next));
          setYearPage(Math.floor(next / 20) * 20);
          setShowYears(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          onClick={(event) => makeDropdownRoom(event.currentTarget, 360)}
          onKeyDownCapture={(event) => {
            if (["Enter", " "].includes(event.key))
              makeDropdownRoom(event.currentTarget, 360);
          }}
          id={id}
          type="button"
          className="month-picker-trigger"
          disabled={disabled}
          aria-label={
            valid
              ? `${months[Number(value.slice(5)) - 1]} ${value.slice(0, 4)}: изменить месяц`
              : "Выбрать месяц и год"
          }
        >
          <span>
            {valid
              ? `${months[Number(value.slice(5)) - 1]} ${value.slice(0, 4)}`
              : "Месяц и год"}
          </span>
          <CalendarDays size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        style={{ marginLeft: horizontalOffset }}
        className="offerly-month-calendar"
        align="start"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          yearInput.current?.focus({ preventScroll: true });
          yearInput.current?.select();
        }}
        aria-label="Календарь месяца работы"
      >
        <div className="month-calendar-heading">
          <label>
            Год
            <input
              ref={yearInput}
              aria-label="Год"
              inputMode="numeric"
              maxLength={4}
              value={yearText}
              onChange={(e) => {
                const text = e.target.value.replace(/\D/g, "");
                setYearText(text);
                if (text.length === 4) {
                  const next = clampYear(Number(text));
                  setYear(next);
                  setYearText(String(next));
                  setYearPage(Math.floor(next / 20) * 20);
                }
              }}
              onBlur={() => setYearText(String(year))}
            />
          </label>
          <button
            type="button"
            className="month-year-toggle"
            aria-expanded={showYears}
            onClick={() => setShowYears((v) => !v)}
          >
            {showYears ? "К месяцам" : "Выбрать год"}
          </button>
        </div>
        {showYears ? (
          <div className="month-year-picker">
            <div className="month-year-navigation">
              <button
                type="button"
                aria-label="Предыдущие годы"
                disabled={yearPage <= Math.floor(lowerYear / 20) * 20}
                onClick={() => setYearPage((v) => v - 20)}
              >
                ←
              </button>
              <span>
                {Math.max(lowerYear, yearPage)}–
                {Math.min(upperYear, yearPage + 19)}
              </span>
              <button
                type="button"
                aria-label="Следующие годы"
                disabled={yearPage + 20 > upperYear}
                onClick={() => setYearPage((v) => v + 20)}
              >
                →
              </button>
            </div>
            <div className="month-calendar-grid month-year-grid">
              {Array.from(
                { length: Math.max(0, Math.min(20, upperYear + 1 - yearPage)) },
                (_, i) => yearPage + i,
              )
                .filter((v) => v >= lowerYear)
                .map((v) => (
                  <button
                    type="button"
                    key={v}
                    aria-pressed={year === v}
                    className={year === v ? "is-selected" : ""}
                    onClick={() => {
                      setYear(v);
                      setYearText(String(v));
                      setShowYears(false);
                    }}
                  >
                    {v}
                  </button>
                ))}
            </div>
          </div>
        ) : (
          <div className="month-calendar-grid">
            {months.map((m, i) => {
              const v = `${year}-${String(i + 1).padStart(2, "0")}`;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={unavailable(v)}
                  aria-pressed={value === v}
                  className={value === v ? "is-selected" : ""}
                  onClick={() => choose(v)}
                >
                  {m}
                </button>
              );
            })}
          </div>
        )}
        <div className="month-calendar-footer">
          <button type="button" onClick={() => choose("")}>
            Очистить
          </button>
          <button
            type="button"
            disabled={unavailable(current)}
            onClick={() => choose(current)}
          >
            Этот месяц
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
