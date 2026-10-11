"use client";
import { useState, useEffect } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { makeDropdownRoom } from "@/lib/dropdown-room";
export function MultiChoice({
  label,
  values,
  options,
  onChange,
  remoteCompanies = false,
}: {
  remoteCompanies?: boolean;
  label: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<string[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!remoteCompanies || !open) return;
    const c = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () =>
        fetch(`/api/catalog/companies?query=${encodeURIComponent(query)}`, {
          signal: c.signal,
        })
          .then(async (r) => {
            const b = await r.json();
            if (!r.ok) throw new Error(b.error);
            setRemote(b.items);
          })
          .catch((e) => {
            if (e.name !== "AbortError") setError(e.message);
          })
          .finally(() => {
            if (!c.signal.aborted) setLoading(false);
          }),
      200,
    );
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [query, remoteCompanies, open]);
  const sorted = [
    ...new Set([...values, ...(remoteCompanies ? remote : options)]),
  ].sort((a, b) => Number(values.includes(b)) - Number(values.includes(a)));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="multi-choice-trigger"
          aria-label={label}
          onClick={(event) => makeDropdownRoom(event.currentTarget, 340)}
        >
          {values.length ? `Выбрано: ${values.length}` : "Любая"}
          <ChevronDown size={17} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="multi-choice-popup"
        align="start"
        aria-label={`Выбор: ${label}`}
      >
        <input
          aria-label={`Поиск: ${label}`}
          placeholder="Найти компанию"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="multi-choice-list">
          {loading && <p role="status">Загружаем…</p>}
          {error && <p role="alert">{error}</p>}
          {!loading && !error && !sorted.length && <p>Компании не найдены</p>}
          {sorted
            .filter((option) =>
              option.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            )
            .map((option) => (
              <button
                type="button"
                role="checkbox"
                aria-checked={values.includes(option)}
                key={option}
                onClick={() =>
                  onChange(
                    values.includes(option)
                      ? values.filter((value) => value !== option)
                      : [...values, option],
                  )
                }
              >
                {option}
                <span>{values.includes(option) && <Check size={17} />}</span>
              </button>
            ))}
        </div>
        {values.length > 0 && (
          <button
            type="button"
            className="multi-choice-clear"
            onClick={() => onChange([])}
          >
            Снять выбор
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
