"use client";

import { useEffect, useRef } from "react";
import { useBulkSelect } from "./bulk-select-provider";

/**
 * F253 / F062: Row checkbox for client selection.
 * Styled with brand tokens, accessible via keyboard, and stops event propagation
 * so clicking the checkbox does not navigate to the client's detail page.
 */
export function ClientRowCheckbox({
  organisationId,
  legalName,
}: {
  organisationId: string;
  legalName: string;
}) {
  const { isSelected, toggleId } = useBulkSelect();
  const checked = isSelected(organisationId);

  return (
    <div
      className="flex items-center justify-center"
      onClick={(e) => e.stopPropagation()}
    >
      <label className="relative flex cursor-pointer items-center justify-center p-1">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggleId(organisationId)}
          aria-label={`Select ${legalName}`}
          className="peer sr-only"
        />
        <div className="flex h-4 w-4 items-center justify-center rounded-[5px] border border-black/25 bg-white transition-all duration-150 peer-checked:border-brand peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-1 hover:border-black/40">
          <svg
            className={`h-2.5 w-2.5 text-white transition-transform duration-150 ${
              checked ? "scale-100 opacity-100" : "scale-50 opacity-0"
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </label>
    </div>
  );
}

/**
 * Header checkbox for selecting or deselecting all clients on the current page.
 * Supports standard tri-state indeterminate appearance when a subset of rows is selected.
 */
export function SelectAllCheckbox({
  clientIds,
}: {
  clientIds: string[];
}) {
  const { isAllSelected, isSomeSelected, selectAll, deselectAll } = useBulkSelect();
  const allSelected = isAllSelected(clientIds);
  const someSelected = isSomeSelected(clientIds);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = !allSelected && someSelected;
    }
  }, [allSelected, someSelected]);

  const handleToggle = () => {
    if (allSelected) {
      deselectAll(clientIds);
    } else {
      selectAll(clientIds);
    }
  };

  return (
    <div
      className="flex items-center justify-center"
      onClick={(e) => e.stopPropagation()}
    >
      <label className="relative flex cursor-pointer items-center justify-center p-1">
        <input
          ref={inputRef}
          type="checkbox"
          checked={allSelected}
          onChange={handleToggle}
          aria-label="Select all clients on this page"
          className="peer sr-only"
        />
        <div
          className={`flex h-4 w-4 items-center justify-center rounded-[5px] border transition-all duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-1 ${
            allSelected || someSelected
              ? "border-brand bg-brand"
              : "border-black/25 bg-white hover:border-black/40"
          }`}
        >
          {allSelected ? (
            <svg
              className="h-2.5 w-2.5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          ) : someSelected ? (
            <div className="h-0.5 w-2 rounded-full bg-white" />
          ) : null}
        </div>
      </label>
    </div>
  );
}
