"use client";

import Link from "next/link";
import { useRef } from "react";
import { useReducedMotionConfig } from "motion/react";
import { InboxIcon, type InboxIconHandle } from "@animateicons/react/lucide/inbox-icon";

/**
 * Dashboard shortcut to the shared inbox.
 *
 * The glyph is the same animated Inbox icon as the sidebar and the whole
 * button drives it, so the response belongs to the target rather than the few
 * pixels of the icon. Google is present as a slim provider-colour rail instead
 * of a Google or Gmail logo: this opens 180Connect's inbox experience, not a
 * Google-owned screen. Reduced-motion users keep the colour response without
 * the animated glyph.
 */
export function DashboardInboxButton() {
  const inboxIconRef = useRef<InboxIconHandle>(null);
  const reduceMotion = useReducedMotionConfig();

  const startIcon = () => {
    if (!reduceMotion) inboxIconRef.current?.startAnimation();
  };

  const stopIcon = () => inboxIconRef.current?.stopAnimation();

  return (
    <Link
      href="/inbox"
      onMouseEnter={startIcon}
      onMouseLeave={stopIcon}
      onFocus={startIcon}
      onBlur={stopIcon}
      className="group relative isolate inline-flex h-10 shrink-0 items-center justify-center gap-2.5 overflow-hidden rounded-inset border border-rule bg-white px-5 font-body text-sm font-semibold tracking-[-0.02em] text-ink transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
    >
      <InboxIcon
        ref={inboxIconRef}
        size={20}
        aria-hidden={true}
        className="size-5 text-google-blue transition-colors duration-200 group-hover:text-google-red group-focus-visible:text-google-red"
      />
      View inbox

      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 grid h-0.5 grid-cols-4 opacity-70 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <span className="bg-google-blue" />
        <span className="bg-google-red" />
        <span className="bg-google-yellow" />
        <span className="bg-google-green" />
      </span>
    </Link>
  );
}
