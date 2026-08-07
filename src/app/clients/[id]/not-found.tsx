import Link from "next/link";

/**
 * F067 AC3 — a client id that no longer exists (deleted, or merged away during
 * dedup) shows this instead of Next's generic 404, so it reads as an expected
 * outcome rather than a broken page.
 */
export default function ClientNotFound() {
  return (
    <main className="min-h-screen bg-[#f1f2f4] p-6">
      <section className="mx-auto w-full max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
        <Link className="text-sm font-medium text-brand hover:underline" href="/clients">
          ← Clients
        </Link>
        <h1 className="mt-4 text-2xl font-bold">Client not found</h1>
        <p className="mt-2 text-sm text-foreground/65">
          This client record no longer exists. It may have been deleted, or merged
          into another record during deduplication.
        </p>
      </section>
    </main>
  );
}
