"use client";

import { useState } from "react";
import {
  RotateCw,
  Mail,
  MailOpen,
  Trash2,
  Archive,
  Star,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Columns2,
  List,
} from "lucide-react";

export type SelectionState = "none" | "some" | "all";

export type GmailActionBarProps = {
  searchQuery: string;
  onSearchChange: (query: string) => void;
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
  onArchiveSelected: () => void;
  isSplitView: boolean;
  onToggleSplitView: () => void;
  pageIndex: number;
  pageSize: number;
  onPrevPage: () => void;
  onNextPage: () => void;
};

export function GmailActionBar({
  searchQuery,
  onSearchChange,
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
  onArchiveSelected,
  isSplitView,
  onToggleSplitView,
  pageIndex,
  pageSize,
  onPrevPage,
  onNextPage,
}: GmailActionBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const startRange = totalCount === 0 ? 0 : pageIndex * pageSize + 1;
  const endRange = Math.min((pageIndex + 1) * pageSize, totalCount);

  return (
    <div className="space-y-3">
      {/* Top Search Bar (Gmail Style) */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-2xl">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
            <Search className="h-4 w-4 text-slate-500" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search mail, organisations, contacts, or project briefs..."
            className="w-full rounded-full border border-slate-200 bg-[#eaf1fb] focus:bg-white py-2.5 pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-500 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-100 shadow-xs transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Gmail Action Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-2 py-1.5 text-slate-600 rounded-t-xl">
        {/* Left Toolbar: Selection & Bulk Actions */}
        <div className="flex items-center gap-1">
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
                onClick={onArchiveSelected}
                title="Archive selected"
                className="p-2 rounded-full hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
              >
                <Archive className="h-4 w-4" />
              </button>

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

        {/* Right Toolbar: Pagination & Split View Toggle */}
        <div className="flex items-center gap-2 text-xs text-slate-600">
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

          <div className="h-4 w-px bg-slate-200 mx-1" />

          {/* Split View Toggle */}
          <button
            type="button"
            onClick={onToggleSplitView}
            title={isSplitView ? "Switch to List View" : "Switch to Split Reading Pane"}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer flex items-center gap-1 text-xs font-medium ${
              isSplitView
                ? "bg-blue-50 border-blue-200 text-blue-700"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {isSplitView ? (
              <>
                <Columns2 className="h-3.5 w-3.5" />
                <span>Split Pane</span>
              </>
            ) : (
              <>
                <List className="h-3.5 w-3.5" />
                <span>List View</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
