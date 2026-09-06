"use client";

import {
  Inbox,
  Star,
  SendHorizontal,
  StickyNote,
  Trash2,
  Pencil,
  Tag,
  CheckCircle2,
} from "lucide-react";

export type GmailFolder = "inbox" | "starred" | "sent" | "drafts" | "trash";

export type GmailSidebarProps = {
  activeFolder: GmailFolder;
  onSelectFolder: (folder: GmailFolder) => void;
  selectedLabel: string | null;
  onSelectLabel: (label: string | null) => void;
  unreadCount: number;
  starredCount: number;
  sentCount: number;
  draftsCount: number;
  trashCount: number;
  onOpenCompose: () => void;
};

const SECTORS = [
  { name: "Charities & NGOs", color: "bg-emerald-500", border: "border-emerald-500" },
  { name: "Health & Well-being", color: "bg-sky-500", border: "border-sky-500" },
  { name: "Youth & Education", color: "bg-indigo-500", border: "border-indigo-500" },
  { name: "Environment", color: "bg-teal-500", border: "border-teal-500" },
  { name: "Grants & Foundations", color: "bg-purple-500", border: "border-purple-500" },
];

export function GmailSidebar({
  activeFolder,
  onSelectFolder,
  selectedLabel,
  onSelectLabel,
  unreadCount,
  starredCount,
  sentCount,
  draftsCount,
  trashCount,
  onOpenCompose,
}: GmailSidebarProps) {
  const folders = [
    {
      id: "inbox" as GmailFolder,
      label: "Inbox",
      icon: Inbox,
      count: unreadCount > 0 ? unreadCount : undefined,
      countBold: true,
    },
    {
      id: "starred" as GmailFolder,
      label: "Starred",
      icon: Star,
      count: starredCount > 0 ? starredCount : undefined,
    },
    {
      id: "sent" as GmailFolder,
      label: "Sent",
      icon: SendHorizontal,
      count: sentCount > 0 ? sentCount : undefined,
    },
    {
      id: "drafts" as GmailFolder,
      label: "Drafts",
      icon: StickyNote,
      count: draftsCount > 0 ? draftsCount : undefined,
    },
    {
      id: "trash" as GmailFolder,
      label: "Trash",
      icon: Trash2,
      count: trashCount > 0 ? trashCount : undefined,
    },
  ];

  return (
    <aside className="flex w-56 flex-col shrink-0 pr-3 select-none h-full overflow-y-auto">
      {/* Compose Button (Gmail Style) */}
      <div className="mb-4 px-1 flex items-center h-12">
        <button
          onClick={onOpenCompose}
          type="button"
          className="flex items-center gap-3 rounded-2xl bg-[#c2e7ff] hover:bg-[#b3dcf8] active:scale-[0.98] transition-all px-6 h-12 shadow-sm text-slate-800 font-semibold text-sm hover:shadow-md cursor-pointer"
        >
          <Pencil className="h-4.5 w-4.5 text-slate-900 stroke-[2.2]" />
          <span>Compose</span>
        </button>
      </div>

      {/* Main Folder Navigation */}
      <nav className="space-y-0.5">
        {folders.map((folder) => {
          const Icon = folder.icon;
          const isActive = activeFolder === folder.id && selectedLabel === null;

          return (
            <button
              key={folder.id}
              type="button"
              onClick={() => {
                onSelectLabel(null);
                onSelectFolder(folder.id);
              }}
              className={`group flex w-full items-center justify-between rounded-r-full px-4 py-2 text-sm transition-colors cursor-pointer ${
                isActive
                  ? "bg-[#d3e3fd] text-[#001d35] font-bold"
                  : "text-slate-700 hover:bg-slate-100 font-medium"
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? "text-[#001d35]" : "text-slate-500 group-hover:text-slate-700"
                  }`}
                />
                <span className="truncate">{folder.label}</span>
              </div>
              {folder.count !== undefined && (
                <span
                  className={`text-xs ml-2 ${
                    isActive || folder.countBold
                      ? "font-bold text-[#001d35]"
                      : "text-slate-500 group-hover:text-slate-700"
                  }`}
                >
                  {folder.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="my-4 border-t border-slate-200/80 mx-2" />

      {/* Labels / Sectors */}
      <div className="px-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Sectors & Labels
          </span>
          <Tag className="h-3.5 w-3.5 text-slate-400" />
        </div>

        <div className="space-y-0.5">
          {SECTORS.map((sector) => {
            const isLabelActive = selectedLabel === sector.name;

            return (
              <button
                key={sector.name}
                type="button"
                onClick={() => {
                  if (selectedLabel === sector.name) {
                    onSelectLabel(null);
                  } else {
                    onSelectLabel(sector.name);
                  }
                }}
                className={`flex w-full items-center gap-3 rounded-r-full px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                  isLabelActive
                    ? "bg-[#e8edf5] text-slate-900 font-bold"
                    : "text-slate-600 hover:bg-slate-100 font-medium"
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${sector.color}`} />
                <span className="truncate text-left">{sector.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Status / Quota */}
      <div className="mt-auto pt-6 px-3">
        <div className="rounded-xl border border-slate-200/90 bg-white/70 p-3 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>Outreach Engine Active</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 leading-tight">
            180DC Sheffield Mailbox connected via Gmail API.
          </p>
        </div>
      </div>
    </aside>
  );
}
