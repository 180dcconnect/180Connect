"use client";

import { useRouter } from "next/navigation";

export function ClientOwnerBadge({
  ownerId,
  ownerName,
}: {
  ownerId: string | null;
  ownerName: string | null;
}) {
  const router = useRouter();

  if (!ownerName) {
    return (
      <span className="inline-block rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/40">
        Unassigned
      </span>
    );
  }

  if (!ownerId) {
    return (
      <span className="inline-block max-w-full truncate rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-brand-hover">
        {ownerName}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        router.push(`/team/${ownerId}`);
      }}
      title={`View ${ownerName}'s profile`}
      className="inline-block max-w-full truncate rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-brand-hover hover:bg-brand/20 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-brand"
    >
      {ownerName}
    </button>
  );
}
