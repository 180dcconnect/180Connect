import type { Metadata } from "next";
import Link from "next/link";
import { RESET_LINK_ERROR } from "@/lib/auth/password-reset";
import { GROUND, INK } from "@/components/brand/tokens";
import { fieldVars } from "@/components/brand/fields";
import { Wordmark } from "@/components/brand/wordmark";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Set Password | 180Connect" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; flow?: string; email?: string }>;
}) {
  const { error, flow, email } = await searchParams;
  const isInvite = flow === "invite";

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-6 font-body text-[#0c1014]"
      style={{ backgroundColor: GROUND }}
    >
      <div className="mb-6">
        <Link href="/" className="inline-block transition-opacity hover:opacity-80">
          <Wordmark tone="dark" />
        </Link>
      </div>

      <section
        className="w-full max-w-md rounded-2xl p-7 sm:p-9 shadow-xl border border-[#0c1014]/8 bg-white"
        style={fieldVars("light", "#ffffff")}
      >
        <h1
          className="font-body text-[clamp(1.75rem,4vw,2.25rem)] font-black leading-[1.05] tracking-[-0.03em]"
          style={{ color: INK }}
        >
          {isInvite ? "Create your account" : "Choose a new password"}
        </h1>
        <p className="mt-2 font-body text-sm leading-[1.65] text-[#0c1014]/50">
          {isInvite
            ? "Set a password to finish creating your account."
            : "Your reset link is single-use."}
        </p>
        <ResetPasswordForm
          linkError={error ? RESET_LINK_ERROR : undefined}
          isInvite={isInvite}
          email={email}
        />
      </section>
    </main>
  );
}


