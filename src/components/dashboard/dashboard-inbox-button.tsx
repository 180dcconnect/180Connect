"use client";

import { useRef } from "react";
import Link from "next/link";
import { useReducedMotionConfig } from "motion/react";
import { InboxIcon, type InboxIconHandle } from "@animateicons/react/lucide/inbox-icon";

/** Dashboard shortcut to the shared inbox, using the sidebar's animated glyph. */
export function DashboardInboxButton() {
  const inboxIconRef = useRef<InboxIconHandle>(null);
  const reduceMotion = useReducedMotionConfig();

  return (
    <Link
      href="/inbox"
      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-lead px-5 font-body text-sm font-semibold tracking-[-0.02em] text-white transition-colors hover:bg-lead-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
      onMouseEnter={() => {
        if (!reduceMotion) inboxIconRef.current?.startAnimation();
      }}
      onMouseLeave={() => inboxIconRef.current?.stopAnimation()}
    >
      <InboxIcon
        ref={inboxIconRef}
        size={20}
        aria-hidden={true}
        className="h-5 w-5"
      />
      View inbox
    </Link>
  );
}
