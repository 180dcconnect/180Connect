"use client";

import { useId, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  findCatalogueEntry,
  humanizeFieldPath,
  ruleKey,
  SOURCE_LABELS,
  sourceLabel,
} from "@/lib/data-handling-catalogue";
import {
  createRule,
  loadObservedFields,
  type ActionResult,
  type ObservedField,
} from "./actions";
import {
  FIELD_LABEL,
  FOOTNOTE,
  INPUT,
  PRIMARY_BUTTON,
  SELECT_CONTENT,
  SELECT_ITEM,
  SELECT_TRIGGER,
} from "../styles";

/**
 * "Not in the list?" — protect a field the built-in list does not name, by
 * picking it from what a source has really sent.
 *
 * The alternative was typing a path, which an admin cannot know, and a wrong
 * path protects nothing while still looking like a protection. Every choice here
 * comes from `data_handling_observed_fields`, so it is a field the source
 * actually sends and the filter will match. The list shows how often each field
 * occurs, never what it contains.
 */
export function ObservedFieldPicker({
  activeKeys,
  onResult,
}: {
  /** `ruleKey`s of every protection currently on, to mark those fields. */
  activeKeys: ReadonlySet<string>;
  onResult: (result: ActionResult) => void;
}) {
  const [source, setSource] = useState("");
  const [fields, setFields] = useState<ObservedField[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chosenPath, setChosenPath] = useState("");
  const [reason, setReason] = useState("");
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const sourceId = useId();
  const searchId = useId();
  const reasonId = useId();

  function chooseSource(next: string) {
    setSource(next);
    setFields(null);
    setLoadError(null);
    setQuery("");
    setChosenPath("");
    startLoading(async () => {
      const result = await loadObservedFields(next);
      setFields(result.fields);
      setLoadError(result.error ?? null);
    });
  }

  function isProtected(path: string) {
    return activeKeys.has(ruleKey(source, path, "field_path")) ||
      activeKeys.has(ruleKey(null, path, "field_path"));
  }

  function nameFor(path: string) {
    return findCatalogueEntry(source, path)?.label ?? humanizeFieldPath(path);
  }

  const needle = query.trim().toLowerCase();
  const visible = (fields ?? []).filter(
    (field) =>
      !needle ||
      nameFor(field.field_path).toLowerCase().includes(needle) ||
      field.field_path.toLowerCase().includes(needle),
  );

  function turnOn() {
    if (!chosenPath) return;
    const formData = new FormData();
    formData.set("source", source);
    formData.set("field_path", chosenPath);
    formData.set("action", "deny");
    formData.set("rule_kind", "field_path");
    formData.set("reason", reason);
    startSaving(async () => {
      const result = await createRule(formData);
      onResult(result);
      if (result.ok) {
        setChosenPath("");
        setReason("");
      }
    });
  }

  return (
    <div className="mt-6 border-t border-rule-soft pt-4">
      <h3 className="text-[13px] font-medium text-ink">Not in the list?</h3>
      <p className={`mt-1 ${FOOTNOTE}`}>
        Pick the detail from what a source has actually sent us. Only fields that really
        appear in recent imports are listed, so the protection is sure to match.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor={sourceId} className={FIELD_LABEL}>
            Source
          </label>
          <Select value={source} onValueChange={chooseSource}>
            <SelectTrigger id={sourceId} className={`mt-2 ${SELECT_TRIGGER}`}>
              <SelectValue placeholder="Choose where the data comes from…" />
            </SelectTrigger>
            <SelectContent position="popper" className={SELECT_CONTENT}>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value} className={SELECT_ITEM}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading && (
          <p className="flex items-center gap-2 text-[13px] text-dim">
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            Looking at recent imports from {sourceLabel(source)}…
          </p>
        )}

        {!loading && loadError && (
          <p role="alert" className="text-[13px] font-semibold text-stop">
            {loadError}
          </p>
        )}

        {!loading && !loadError && fields && fields.length === 0 && (
          <p className={FOOTNOTE}>
            Nothing has been imported from {sourceLabel(source)} yet, so there are no fields to
            choose from.
          </p>
        )}

        {!loading && fields && fields.length > 0 && (
          <div>
            <label htmlFor={searchId} className={FIELD_LABEL}>
              Field
            </label>
            <div className="relative mt-2">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint"
              />
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${fields.length} fields, e.g. email or address`}
                className={`${INPUT} pl-8`}
              />
            </div>

            <ul
              role="radiogroup"
              aria-label={`Fields sent by ${sourceLabel(source)}`}
              className="mt-2 max-h-72 overflow-y-auto rounded-inset border border-rule"
            >
              {visible.map((field) => {
                const already = isProtected(field.field_path);
                const selected = chosenPath === field.field_path;
                return (
                  <li key={field.field_path} className="border-b border-rule-soft last:border-0">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={already}
                      onClick={() => setChosenPath(field.field_path)}
                      className={`flex w-full items-start justify-between gap-4 px-3 py-2.5 text-left transition-colors disabled:cursor-default ${
                        selected ? "bg-lead-wash" : "hover:bg-paper"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className={`block text-sm ${already ? "text-dim" : "text-ink"}`}>
                          {nameFor(field.field_path)}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[11.5px] text-faint">
                          {field.field_path}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-[12.5px] text-dim">
                        {already
                          ? "Already protected"
                          : `In ${field.records_seen} of ${field.records_sampled} recent`}
                      </span>
                    </button>
                  </li>
                );
              })}
              {visible.length === 0 && (
                <li className="px-3 py-3 text-[13px] text-dim">No fields match that search.</li>
              )}
            </ul>
          </div>
        )}

        {chosenPath && (
          <>
            <div>
              <label htmlFor={reasonId} className={FIELD_LABEL}>
                Why should this be kept out?
              </label>
              <textarea
                id={reasonId}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="For example: this is a trustee's personal phone number."
                className={`mt-2 ${INPUT} h-auto py-2 leading-[1.55]`}
              />
            </div>
            <button
              type="button"
              onClick={turnOn}
              disabled={saving || !reason.trim()}
              aria-busy={saving || undefined}
              className={PRIMARY_BUTTON}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
              Protect {nameFor(chosenPath).toLowerCase()}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
