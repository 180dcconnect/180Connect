"use client";

import { useState } from "react";
import {
  RotateCw,
  Mail,
  MailOpen,
  Trash2,
  Star,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { SECTOR_TAG_CLIP } from "./gmail-sidebar";

export type SelectionState = "none" | "some" | "all";

export type ActiveLabelFilter = {
  name: string;
  bg: string;
};

export type GmailActionBarProps = {
  selectionState: SelectionState;
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSelectRead: () => void;
  onSelectUnread: () => void;
  onSelectStarred: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onMarkAsRead: () => void;
  onMarkAsUnread: () => void;
  onToggleStarSelected: () => void;
  onDeleteSelected: () => void;
  pageIndex: number;
  pageSize: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  activeLabels?: ActiveLabelFilter[];
  onRemoveLabel?: (name: string) => void;
  onClearAllLabels?: () => void;
};

export function GmailActionBar({
  selectionState,
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
  onSelectRead,
  onSelectUnread,
  onSelectStarred,
  onRefresh,
  isRefreshing,
  onMarkAsRead,
  onMarkAsUnread,
  onToggleStarSelected,
  onDeleteSelected,
  pageIndex,
  pageSize,
  onPrevPage,
  onNextPage,
  activeLabels = [],
  onRemoveLabel,
  onClearAllLabels,
}: GmailActionBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const startRange = totalCount === 0 ? 0 : pageIndex * pageSize + 1;
  const endRange = Math.min((pageIndex + 1) * pageSize, totalCount);

  return (
    <div>
      {/* Gmail Action Toolbar */}
      <div className="flex items-center justify-between bg-white px-2 py-1.5 text-slate-600 rounded-t-xl gap-2 min-h-[40px]">
        {/* Left Toolbar: Selection & Bulk Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Checkbox Dropdown */}
          <div className="relative flex items-center">
            <div className="flex items-center rounded hover:bg-slate-100 p-1">
              <input
                type="checkbox"
                aria-label="Select all conversations"
                checked={selectionState === "all"}
                ref={(input) => {
                  if (input) {
                    input.indeterminate = selectionState === "some";
                  }
                }}
                onChange={(e) => {
                  if (e.target.checked) {
                    onSelectAll();
                  } else {
                    onDeselectAll();
                  }
                }}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="ml-1 p-0.5 text-slate-500 hover:text-slate-800 rounded cursor-pointer"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            {dropdownOpen && (
              <div
                className="absolute left-0 top-full mt-1 z-30 w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg text-xs"
                onMouseLeave={() => setDropdownOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectAll();
                    setDropdownOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeselectAll();
                    setDropdownOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700"
                >
                  None
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSelectRead();
                    setDropdownOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700"
                >
                  Read
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSelectUnread();
                    setDropdownOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700"
                >
                  Unread
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSelectStarred();
                    setDropdownOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700"
                >
                  Starred
                </button>
              </div>
            )}
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh inbox"
            className="p-2 rounded-full hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <RotateCw className={`h-4 w-4 ${isRefreshing ? "animate-spin text-blue-600" : ""}`} />
          </button>

          {/* Contextual Action Buttons (shown when items are selected) */}
          {selectedCount > 0 ? (
            <div className="flex items-center gap-1 ml-2 border-l border-slate-200 pl-2">
              <button
                type="button"
                onClick={onDeleteSelected}
                title="Delete selected"
                className="p-2 rounded-full hover:bg-slate-100 text-slate-600 hover:text-red-600 transition-colors cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onMarkAsRead}
                title="Mark as read"
                className="p-2 rounded-full hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
              >
                <MailOpen className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onMarkAsUnread}
                title="Mark as unread"
                className="p-2 rounded-full hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
              >
                <Mail className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onToggleStarSelected}
                title="Star / Unstar"
                className="p-2 rounded-full hover:bg-slate-100 text-slate-600 hover:text-amber-500 transition-colors cursor-pointer"
              >
                <Star className="h-4 w-4" />
              </button>

              <span className="text-xs text-slate-500 font-medium ml-2">
                {selectedCount} selected
              </span>
            </div>
          ) : null}
        </div>

        {/* Middle Toolbar: Active Sector / Label Tags */}
        {activeLabels && activeLabels.length > 0 && (
          <div className="flex-1 flex items-center justify-center gap-1.5 px-2 min-w-0 overflow-x-auto py-0.5">
            {activeLabels.map((label) => (
              <button
                key={label.name}
                type="button"
                onClick={() => onRemoveLabel?.(label.name)}
                aria-label={`Remove filter for ${label.name}`}
                title={`Active filter: ${label.name} — click to remove`}
                className="inline-flex items-center gap-1 shrink-0 group/tag cursor-pointer animate-in fade-in zoom-in-95 duration-150"
              >
                <span
                  style={{
                    clipPath: SECTOR_TAG_CLIP,
                    backgroundColor: label.bg,
                    color: "#ffffff",
                  }}
                  className="inline-flex items-center py-0.5 pl-2.5 pr-3 font-body text-xs font-semibold text-white shadow-xs group-hover/tag:brightness-110 transition-all"
                >
                  <span className="truncate max-w-[140px]">{label.name}</span>
                </span>
                <span className="size-4 -ml-0.5 inline-flex items-center justify-center rounded-full text-slate-400 group-hover/tag:text-slate-700 group-hover/tag:bg-slate-200/80 transition-colors">
                  <X className="size-3" strokeWidth={2.5} />
                </span>
              </button>
            ))}
            {activeLabels.length > 1 && onClearAllLabels && (
              <button
                type="button"
                onClick={onClearAllLabels}
                className="text-[11px] font-medium text-slate-400 hover:text-slate-700 hover:underline px-1.5 py-0.5 rounded cursor-pointer transition-colors shrink-0"
                title="Clear all active filters"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Right Toolbar: Pagination */}
        <div className="flex items-center gap-2 text-xs text-slate-600 shrink-0">
          <span className="font-medium text-slate-500">
            {startRange}–{endRange} of {totalCount}
          </span>

          <div className="flex items-center">
            <button
              type="button"
              disabled={pageIndex === 0}
              onClick={onPrevPage}
              title="Previous page"
              className="p-1.5 rounded-full hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={endRange >= totalCount}
              onClick={onNextPage}
              title="Next page"
              className="p-1.5 rounded-full hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
