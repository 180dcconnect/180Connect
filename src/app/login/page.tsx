import Image from "next/image";
import { LoginForm } from "./login-form";
import { signedOutNotice } from "@/lib/auth/signed-out-notice";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const notice =
    params["invite-accepted"] === "success"
      ? {
          tone: "success" as const,
          message: "Account created. Log in to get started.",
        }
      : params["password-reset"] === "success"
        ? {
            tone: "success" as const,
            message: "Password updated. Log in with your new password.",
          }
        : signedOutNotice(params.signed_out);
  return (
    <main className="flex flex-1 items-center justify-center p-4 sm:p-8">
      <div className="flex w-full max-w-6xl flex-col gap-6 lg:flex-row">
        <div className="flex flex-1 items-center justify-center px-4 py-10 lg:py-16">
          <div className="w-full max-w-xs">
            <h1 className="text-center font-body text-xl font-bold tracking-tight">
              Welcome 
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

            {/*
              No social sign-in and no sign-up link. Accounts are created by an
              admin (PRD §4.2 prohibits public self-sign-up), so Google/Apple and
              a "Sign up" route would be affordances for something the platform
              does not do — both links pointed at /signup, which does not exist.
            */}
            <LoginForm />
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
