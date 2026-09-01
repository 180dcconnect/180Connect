import Link from "next/link";

// Index for /preview-client — one-to-one preview lives at /preview-client/[id]
// This file stays minimal so the detailed preview at [id]/page.tsx can stay 1:1 with /clients/[id]/page.tsx

export default function PreviewClientIndex() {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-black tracking-tight">Preview — Client record</h1>
          <p className="mt-2 text-sm leading-relaxed text-foreground/60">
            This is a <strong>1:1 duplicate</strong> of <code className="font-mono">/clients/[id]</code> at <code className="font-mono">/preview-client/[id]</code>. Edit the
            preview files freely — <code className="font-mono">src/app/preview-client/[id]/page.tsx</code> and{" "}
            <code className="font-mono">layout.tsx</code> — without touching the real record. Copy the final JSX back to{" "}
            <code className="font-mono">src/app/clients/[id]/</code> when happy.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/clients" className="rounded-full bg-black px-4 py-2 text-xs font-bold text-white">
              Go to real clients →
            </Link>
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-800">Use any real client id, e.g. /preview-client/&lt;id&gt;</span>
          </div>
        </div>
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-6 text-sm text-foreground/60">
          <p className="font-bold text-foreground">How to use</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Open a real record, copy its id from the URL (<code className="font-mono">/clients/abc123</code> → <code className="font-mono">abc123</code>).
            </li>
            <li>
              Visit <code className="font-mono">/preview-client/abc123</code> — you’ll see the identical overview + header.
            </li>
            <li>
              Edit <code className="font-mono">src/app/preview-client/[id]/page.tsx</code> and <code className="font-mono">layout.tsx</code> (and any re-exported
              sections). The real files under <code className="font-mono">src/app/clients/[id]/</code> stay untouched.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
