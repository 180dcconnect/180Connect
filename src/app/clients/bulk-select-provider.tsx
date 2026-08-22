"use client";

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

type BulkSelectContextValue = {
  selectedIds: Set<string>;
  selectedCount: number;
  isSelected: (id: string) => boolean;
  toggleId: (id: string) => void;
  selectAll: (ids: string[]) => void;
  deselectAll: (ids: string[]) => void;
  clearSelection: () => void;
  isAllSelected: (ids: string[]) => boolean;
  isSomeSelected: (ids: string[]) => boolean;
};

const BulkSelectContext = createContext<BulkSelectContextValue | null>(null);

export function BulkSelectProvider({ children }: { children: ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const toggleId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const deselectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  const isAllSelected = useCallback(
    (ids: string[]) => ids.length > 0 && ids.every((id) => selectedIds.has(id)),
    [selectedIds]
  );

  const isSomeSelected = useCallback(
    (ids: string[]) => ids.some((id) => selectedIds.has(id)),
    [selectedIds]
  );

  const value = useMemo<BulkSelectContextValue>(
    () => ({
      selectedIds,
      selectedCount: selectedIds.size,
      isSelected,
      toggleId,
      selectAll,
      deselectAll,
      clearSelection,
      isAllSelected,
      isSomeSelected,
    }),
    [
      selectedIds,
      isSelected,
      toggleId,
      selectAll,
      deselectAll,
      clearSelection,
      isAllSelected,
      isSomeSelected,
    ]
  );

  return (
    <BulkSelectContext.Provider value={value}>
      {children}
    </BulkSelectContext.Provider>
  );
}

export function useBulkSelect() {
  const context = useContext(BulkSelectContext);
  if (!context) {
    throw new Error("useBulkSelect must be used within a BulkSelectProvider");
  }
  return context;
}
