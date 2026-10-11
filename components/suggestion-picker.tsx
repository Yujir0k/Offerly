"use client";
import { useState, useEffect, type RefObject } from "react";
import { X, Plus, ArrowLeftRight } from 'lucide-react';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
} from "./ui/combobox";
import {
  skillCatalog,
  type Suggestion,
  matchingSuggestions,
  canonicalSuggestion,
  normalizeSuggestion,
} from "@/lib/suggestion-catalogs";

function useSkillSuggestions(catalog: Suggestion[], query: string) {
  const [remote, setRemote] = useState<{ query: string; items: Suggestion[] }>({
    query: "",
    items: [],
  });
  useEffect(() => {
    if (catalog !== skillCatalog || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/suggestions?text=${encodeURIComponent(query.trim())}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : { items: [] }))
        .then((body: { items?: string[] }) => {
          if (!controller.signal.aborted)
            setRemote({
              query,
              items: (body.items || []).map((name: string) => ({
                name,
                group: "Навыки hh.ru",
              })),
            });
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [catalog, query]);
  return remote.query === query && remote.items.length
    ? [
        ...catalog,
        ...remote.items.filter(
          (item) =>
            !catalog.some(
              (local) =>
                normalizeSuggestion(local.name) ===
                normalizeSuggestion(item.name),
            ),
        ),
      ]
    : catalog;
}
function choices(
  catalog: Suggestion[],
  input: string,
  selected: string[] = [],
  allowCustom = true,
) {
  const suggestions = matchingSuggestions(
    catalog,
    input,
    input.trim() ? 24 : 40,
  ).filter(
    (item) =>
      !selected.some(
        (value) =>
          normalizeSuggestion(value) === normalizeSuggestion(item.name),
      ),
  );
  const custom = input.trim().slice(0, 100);
  const exact = catalog.some((item) =>
    [item.name, ...(item.aliases || [])].some(
      (value) => normalizeSuggestion(value) === normalizeSuggestion(custom),
    ),
  );
  return [
    ...suggestions.map((item) => item.name),
    ...(allowCustom &&
    custom &&
    !exact &&
    !selected.some(
      (value) => normalizeSuggestion(value) === normalizeSuggestion(custom),
    )
      ? [custom]
      : []),
  ];
}
export function SuggestionTags({
  id,
  value,
  onChange,
  catalog,
  dark = false,
  placeholder = "Найдите или добавьте свой вариант",
  required = false,
  maxSelected = 80,
  allowCustom = true,
  portalContainer,
  onTransfer,
  transferLabel,
}: {
  id: string;
  maxSelected?: number;
  allowCustom?: boolean;
  portalContainer?: RefObject<HTMLElement | null>;
  value: string[];
  onChange: (values: string[]) => void;
  catalog: Suggestion[];
  dark?: boolean;
  placeholder?: string;
  required?: boolean;
  onTransfer?: (value: string) => void;
  transferLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = value.map((text) => text.trim()).filter(Boolean);
  const suggestions = useSkillSuggestions(catalog, query);
  const items = choices(suggestions, query, selected, allowCustom);
  function change(values: string[]) {
    const result = values
      .map((text) => canonicalSuggestion(suggestions, text))
      .filter(Boolean);
    onChange(
      result
        .filter(
          (text, index) =>
            result.findIndex(
              (other) =>
                normalizeSuggestion(other) === normalizeSuggestion(text),
            ) === index,
        )
        .slice(0, maxSelected),
    );
    setQuery("");
    setOpen(false);
  }
  return (
    <div className={`suggestion-picker ${dark ? "suggestion-dark" : ""}`}>
      <Combobox
        multiple
        items={items}
        value={selected}
        inputValue={query}
        open={open}
        onOpenChange={setOpen}
        onInputValueChange={(text, details) => {
          setQuery(text);
          if (details.reason === "input-change") setOpen(true);
        }}
        onValueChange={(values, details) => {
          if (details.reason === 'escape-key') {
            details.cancel();
            details.allowPropagation();
            return;
          }
          change(values);
        }}
        filter={null}
        autoHighlight
      >
        <ComboboxInput
          id={id}
          aria-required={required}
          aria-label={undefined}
          placeholder={placeholder}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              allowCustom &&
              query.trim() &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.stopPropagation();
              change([...selected, query.trim()]);
            }
          }}
        />
        <ComboboxContent
          portalContainer={portalContainer}
          className={`suggestion-popup ${dark ? "suggestion-popup-dark" : ""}`}
        >
          <ComboboxList>
            {(item: string) => {
              const known = suggestions.find((entry) => entry.name === item);
              return (
                <ComboboxItem key={item} value={item}>
                  {known ? (
                    <span>
                      {item}
                      {catalog !== skillCatalog && <small>{known.group}</small>}
                    </span>
                  ) : (
                    <span className="suggestion-create">
                      <Plus />
                      Добавить «{item}»
                    </span>
                  )}
                </ComboboxItem>
              );
            }}
          </ComboboxList>
          {!items.length && (
            <p className="suggestion-empty">
              Введите название, чтобы найти или добавить вариант.
            </p>
          )}
        </ComboboxContent>
      </Combobox>
      {selected.length > 0 && (
        <ul className="suggestion-chips" aria-label="Выбранные значения">
          {selected.map((item) => (
            <li key={item}>
              {onTransfer ? (
                <button
                  type="button"
                  className="suggestion-transfer"
                  aria-label={`${transferLabel || 'Перенести'} ${item}`}
                  title={`${transferLabel || 'Перенести'} ${item}`}
                  onClick={() => onTransfer(item)}
                >
                  {item}<ArrowLeftRight size={13} />
                </button>
              ) : <span>{item}</span>}
              <button
                type="button"
                aria-label={`Удалить ${item}`}
                onClick={() =>
                  onChange(selected.filter((value) => value !== item))
                }
              >
                <X />
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="sr-only" aria-live="polite">
        Выбрано: {selected.join(", ") || "ничего"}
      </span>
    </div>
  );
}
export function SuggestionText({
  id,
  value,
  onChange,
  catalog,
  dark = false,
  placeholder,
  required = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  catalog: Suggestion[];
  dark?: boolean;
  placeholder?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const items = choices(catalog, value);
  return (
    <div className={`suggestion-picker ${dark ? "suggestion-dark" : ""}`}>
      <Combobox
        items={items}
        value={value || null}
        inputValue={value}
        open={open}
        onOpenChange={setOpen}
        onInputValueChange={(text, details) => {
          if (details.reason === "input-change" || details.reason === "input-clear") { onChange(text); setOpen(true); }
        }}
        onValueChange={(selected) => {
          onChange(selected ? canonicalSuggestion(catalog, selected) : "");
          setOpen(false);
        }}
        filter={null}
        autoHighlight
      >
        <ComboboxInput
          id={id}
          required={required}
          placeholder={placeholder || "Начните вводить название"}
        />
        <ComboboxContent
          className={`suggestion-popup ${dark ? "suggestion-popup-dark" : ""}`}
        >
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {catalog.some((entry) => entry.name === item)
                  ? item
                  : `Использовать «${item}»`}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
