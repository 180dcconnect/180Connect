// Placeholder protected page — just here so we can test
// that the middleware actually blocks access without a session.
export default function DashboardPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <p className="text-sm">You&apos;re logged in. This is a protected page.</p>
    </main>
  );
}