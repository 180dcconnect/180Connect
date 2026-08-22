"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useBulkSelect } from "./bulk-select-provider";

/**
 * F253 / F062: Row checkbox for client selection.
 * Animated with spring physics, scale bounce, and animated checkmark path drawing.
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
  const { isSelected, toggleId, selectedCount } = useBulkSelect();
  const checked = isSelected(organisationId);
  const isSelectionMode = selectedCount > 0;

  return (
    <div
      className={`flex items-center justify-center transition-opacity duration-150 ${
        checked
          ? "opacity-100"
          : isSelectionMode
            ? "opacity-40 group-hover/row:opacity-100 hover:opacity-100 focus-within:opacity-100"
            : "opacity-0 group-hover/row:opacity-100 hover:opacity-100 focus-within:opacity-100"
      }`}
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
        <motion.div
          animate={{
            scale: checked ? 1 : 0.95,
          }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.88 }}
          transition={{ type: "spring", stiffness: 450, damping: 25 }}
          className={`flex h-4 w-4 items-center justify-center rounded-[5px] border transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-1 ${
            checked
              ? "border-brand bg-brand shadow-xs"
              : "border-black/25 bg-white hover:border-black/40"
          }`}
        >
          <svg
            className="h-2.5 w-2.5 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <motion.path
              d="M5 13l4 4L19 7"
              initial={false}
              animate={{
                pathLength: checked ? 1 : 0,
                opacity: checked ? 1 : 0,
              }}
              transition={{
                pathLength: { type: "spring", stiffness: 350, damping: 26, duration: 0.25 },
                opacity: { duration: 0.15 },
              }}
            />
          </svg>
        </motion.div>
      </label>
    </div>
  );
}

/**
 * Header checkbox for selecting or deselecting all clients on the current page.
 * Animated tri-state checkbox supporting checked, indeterminate dash, and unchecked transitions.
 */
export function SelectAllCheckbox({
  clientIds,
}: {
  clientIds: string[];
}) {
  const { isAllSelected, isSomeSelected, selectAll, deselectAll, selectedCount } = useBulkSelect();
  const allSelected = isAllSelected(clientIds);
  const someSelected = isSomeSelected(clientIds);
  const isSelectionMode = selectedCount > 0;
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

  const isActive = allSelected || someSelected;

  return (
    <div
      className={`flex items-center justify-center transition-opacity duration-150 ${
        isActive
          ? "opacity-100"
          : isSelectionMode
            ? "opacity-40 group-hover/header:opacity-100 hover:opacity-100 focus-within:opacity-100"
            : "opacity-0 group-hover/header:opacity-100 hover:opacity-100 focus-within:opacity-100"
      }`}
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
        <motion.div
          animate={{
            scale: isActive ? 1 : 0.95,
          }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.88 }}
          transition={{ type: "spring", stiffness: 450, damping: 25 }}
          className={`flex h-4 w-4 items-center justify-center rounded-[5px] border transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-1 ${
            isActive
              ? "border-brand bg-brand shadow-xs"
              : "border-black/25 bg-white hover:border-black/40"
          }`}
        >
          <svg
            className="h-2.5 w-2.5 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <AnimatePresence mode="wait">
              {allSelected ? (
                <motion.path
                  key="check"
                  d="M5 13l4 4L19 7"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  exit={{ pathLength: 0, opacity: 0 }}
                  transition={{
                    pathLength: { type: "spring", stiffness: 350, damping: 26, duration: 0.25 },
                    opacity: { duration: 0.15 },
                  }}
                />
              ) : someSelected ? (
                <motion.line
                  key="dash"
                  x1="5"
                  y1="12"
                  x2="19"
                  y2="12"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  exit={{ pathLength: 0, opacity: 0 }}
                  transition={{
                    pathLength: { type: "spring", stiffness: 350, damping: 26, duration: 0.2 },
                    opacity: { duration: 0.15 },
                  }}
                />
              ) : null}
            </AnimatePresence>
          </svg>
        </motion.div>
      </label>
    </div>
  );
}
