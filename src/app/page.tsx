import Link from "next/link";

import AsciiBackground from "@/components/ascii-background";

export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-black p-8">
      <AsciiBackground src="/tree.jpg" />
      <div className="relative flex flex-col items-center gap-8">
        <h1 className="font-body text-2xl font-semibold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
          180<span className="text-brand">Connect</span>
        </h1>
        <Link
          href="/login"
          className="inline-flex h-11 items-center rounded-full bg-brand px-6 text-sm font-bold text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Login
        </Link>
      </div>
    </main>
  );
}
