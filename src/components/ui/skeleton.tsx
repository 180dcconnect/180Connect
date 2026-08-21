/**
 * F234. Shared loading-skeleton primitives, factored out of the bone/white-card
 * `animate-pulse` shape already hand-rolled in src/app/dashboard/loading.tsx and
 * src/app/clients/loading.tsx (kept as-is — this primitive is for new routes).
 */

export function Skeleton({
  className = "",
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded bg-black/10 ${className}`}
      {...props}
    />
  );
}

export function SkeletonCard({
  className = "",
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

/** A white rounded-2xl card holding `rows` divide-y list rows, each one bar. */
export function SkeletonListPanel({
  rows = 5,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm ${className}`}
      aria-hidden="true"
    >
      <ul className="divide-y divide-black/[0.06]">
        {Array.from({ length: rows }).map((_, index) => (
          <li key={index} className="flex items-center justify-between gap-4 px-5 py-4">
            <span className="h-4 w-48 rounded bg-black/10" />
            <span className="h-4 w-20 rounded-full bg-black/10" />
          </li>
        ))}
      </ul>
    </div>
  );
}
