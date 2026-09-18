import { cn } from "@/lib/utils";

/**
 * The compact identity mark used in the app rail and anywhere a person needs
 * to be recognised at a glance. First and last initials are more useful than
 * a generic person glyph, while the fallbacks keep the mark meaningful when a
 * profile name has not been completed yet.
 */
export function initialsOf(name: string | null, email: string | null = null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (email ?? "?").slice(0, 1).toUpperCase();
}

export function InitialsAvatar({
  name,
  email = null,
  compact = false,
  className,
}: {
  name: string | null;
  email?: string | null;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-brand/15 font-bold tracking-wide text-brand-hover",
        compact ? "size-7 text-[10px]" : "size-9 text-xs",
        className,
      )}
    >
      {initialsOf(name, email)}
    </span>
  );
}
