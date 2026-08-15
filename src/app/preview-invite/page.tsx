import Link from "next/link";
import { GROUND, INK } from "@/components/brand/tokens";
import { fieldVars } from "@/components/brand/fields";
import { Wordmark } from "@/components/brand/wordmark";
import { ResetPasswordForm } from "@/app/reset-password/reset-password-form";

export default function PreviewInvitePage() {
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
          className="mt-2.5 font-body text-[clamp(1.75rem,4vw,2.25rem)] font-black leading-[1.05] tracking-[-0.03em]"
          style={{ color: INK }}
        >
          Create your account
        </h1>
        <p className="mt-2 font-body text-sm leading-[1.65] text-[#0c1014]/50">
          Set a password to finish creating your account.
        </p>
        <ResetPasswordForm
          isInvite={true}
          email="alex.smith@180dc.org"
          existingFullName={null}
        />
      </section>
    </main>
  );
}
