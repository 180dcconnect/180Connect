/** F021/F022-F025 — a single platform-wide dashboard metric tile. */
export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-black/10 p-4">
      <p className="text-2xl font-bold text-brand">{value.toLocaleString()}</p>
      <p className="mt-1 text-sm text-foreground/65">{label}</p>
    </div>
  );
}
