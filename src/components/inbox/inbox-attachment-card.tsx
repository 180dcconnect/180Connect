"use client";

import type { ReactNode } from "react";
import { FileCode, FileSpreadsheet, FileText, Image as ImageIcon } from "lucide-react";
import type { InboxAttachmentView } from "@/lib/inbox-thread-view";

export type InboxAttachmentCardProps = {
  filename: string;
  fileType: InboxAttachmentView["fileType"];
  /**
   * Second line under the name. Null renders the family label instead
   * ("PDF") — the compose flyer has no byte size to show, and a bare name
   * with no second line reads as a broken card.
   */
  sizeLabel?: string | null;
  /** Trailing control: the reading pane's download link, compose's remove X. */
  action?: ReactNode;
  title?: string;
  /**
   * Makes the filename a link opening in a new tab: the flyer preview route
   * for the branch flyer, a blob URL for a staged file that never left the
   * browser. Takes precedence over onNameTap.
   */
  nameHref?: string | null;
  /**
   * Makes the filename a button: compose passes this for staged files no
   * browser can preview (Word, Excel…), opening the download-confirm dialog.
   * Plain text otherwise (received attachments keep their download action).
   */
  onNameTap?: (() => void) | null;
};

/**
 * The mailbox's one attachment rendering — the card the reading pane shows
 * under every message with files (the shape the mock threads made familiar).
 * Both surfaces share it so an attachment looks the same arriving and going:
 * only the trailing action differs per surface.
 */
export function InboxAttachmentCard({
  filename,
  fileType,
  sizeLabel,
  action,
  title,
  nameHref,
  onNameTap,
}: InboxAttachmentCardProps) {
  const Icon =
    fileType === "pdf"
      ? FileText
      : fileType === "xlsx"
        ? FileSpreadsheet
        : fileType === "png"
          ? ImageIcon
          : FileCode;

  return (
    <div
      title={title}
      className="group flex max-w-xs items-center gap-3 rounded-inset border border-rule-soft bg-paper p-2.5 transition-colors hover:border-rule"
    >
      <Icon className="h-5 w-5 shrink-0 text-faint" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {nameHref ? (
          <a
            href={nameHref}
            target="_blank"
            rel="noreferrer"
            title={`View ${filename}`}
            className="block truncate text-[13px] font-medium text-ink transition-colors hover:text-lead"
          >
            {filename}
          </a>
        ) : onNameTap ? (
          <button
            type="button"
            onClick={onNameTap}
            title={filename}
            className="block w-full cursor-pointer truncate text-left text-[13px] font-medium text-ink transition-colors hover:text-lead"
          >
            {filename}
          </button>
        ) : (
          <p className="truncate text-[13px] font-medium text-ink" title={filename}>
            {filename}
          </p>
        )}
        <p className="text-[12px] text-dim">{sizeLabel ?? fileType.toUpperCase()}</p>
      </div>
      {action}
    </div>
  );
}
