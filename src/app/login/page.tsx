import Image from "next/image";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { signedOutNotice } from "@/lib/auth/signed-out-notice";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const notice = signedOutNotice((await searchParams).signed_out);

  return (
    <main className="flex flex-1 items-center justify-center bg-[#f1f2f4] p-4 sm:p-8">
      <div className="flex w-full max-w-6xl flex-col gap-6 rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.06)] lg:flex-row lg:p-5">
        <div className="flex flex-1 items-center justify-center px-4 py-10 lg:py-16">
          <div className="w-full max-w-xs">
            <div className="mx-auto flex w-fit rounded-lg bg-[#f1f2f4] p-1 text-xs font-bold">
              <span className="rounded-md bg-white px-3 py-1.5 shadow-sm">
                Log in
              </span>
              <Link
                href="/signup"
                className="rounded-md px-3 py-1.5 text-foreground/50 transition-colors hover:text-foreground"
              >
                Sign up
              </Link>
            </div>

            <h1 className="mt-8 text-center font-body text-xl font-bold tracking-tight">
              Welcome back
            </h1>
            <p className="mt-1.5 text-center text-sm text-foreground/55">
              Enter your details to log in.
            </p>

            {notice && (
              <div
                role="status"
                className={`mt-6 rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${
                  notice.tone === "success"
                    ? "border-brand/30 bg-brand/5 text-foreground/80"
                    : "border-amber-300 bg-amber-50 text-amber-900"
                }`}
              >
                {notice.message}
              </div>
            )}

            <LoginForm />

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-black/10" />
              <span className="text-[10px] font-bold tracking-widest text-foreground/40">
                OR
              </span>
              <span className="h-px flex-1 bg-black/10" />
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                className="flex h-10 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white text-sm font-bold transition-colors hover:bg-[#fafafa]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8H1.4v3.1A12 12 0 0 0 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.3 14.3a7.1 7.1 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8l3.9-3.1Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 0 0 1.4 6.6l3.9 3.1A7.2 7.2 0 0 1 12 4.8Z"
                  />
                </svg>
                Continue with Google
              </button>

              <button
                type="button"
                className="flex h-10 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white text-sm font-bold transition-colors hover:bg-[#fafafa]"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 fill-current"
                  aria-hidden="true"
                >
                  <path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.7 2.3 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.2.9-1.3 1.3-2.5 1.3-2.6 0 0-2.5-1-2.5-3.6ZM14.2 5.9c.6-.8 1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 .1 2-.5 2.7-1.3Z" />
                </svg>
                Continue with Apple
              </button>
            </div>

            <p className="mt-8 text-center text-xs text-foreground/55">
              Don&apos;t have an account yet?{" "}
              <Link
                href="/signup"
                className="font-bold text-brand underline-offset-4 hover:underline"
              >
                Sign up
              </Link>
            </p>
          </div>
        </div>

        <div className="relative min-h-[280px] flex-1 overflow-hidden rounded-xl lg:min-h-[640px]">
          <Image
            src="/leaf.jpg"
            alt=""
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover"
          />

          <figure className="absolute inset-x-4 bottom-4 rounded-xl border border-white/25 bg-black/35 p-5 text-white backdrop-blur-md sm:inset-x-6 sm:bottom-6 sm:p-6">
            <blockquote className="text-sm leading-relaxed sm:text-base">
              &ldquo;We came in with a vague idea and a spreadsheet. Eight weeks
              later we had a strategy our trustees actually signed off on.&rdquo;
            </blockquote>
            <figcaption className="mt-5 text-sm">
              <span className="block font-bold">Amara Okonkwo</span>
              <span className="mt-1 block text-xs text-white/75">
                Operations Lead
              </span>
              <span className="block text-xs text-white/75">
                Rivermead Community Trust
              </span>
            </figcaption>
          </figure>
        </div>
      </div>
    </main>
  );
}
