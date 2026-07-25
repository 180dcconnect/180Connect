import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <h1 className="font-body text-2xl font-semibold">
        180<span className="text-brand">Connect</span>
      </h1>
      <Link
        href="/login"
        className="inline-flex h-11 items-center rounded-full bg-brand px-6 text-sm font-bold text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Login
      </Link>
    </main>
  );
}
