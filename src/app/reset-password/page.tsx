import type { Metadata } from "next";
import { INVITE_LINK_ERROR } from "@/lib/auth/invite";
import { RESET_LINK_ERROR } from "@/lib/auth/password-reset";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password | 180Connect" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; flow?: string; email?: string }>;
}) {
  const { error, flow, email } = await searchParams;
  const isInvite = flow === "invite";

  // The message text is chosen here, not read from `error`'s value — the query
  // string is not trusted content, only its presence is. That is what stops
  // this page from ever rendering back whatever string a crafted URL put in
  // `error`.
  const linkError = error ? (isInvite ? INVITE_LINK_ERROR : RESET_LINK_ERROR) : undefined;

  return (
    <main className="flex flex-1 items-center justify-center bg-[#f1f2f4] p-4">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">180Connect</p>
        <h1 className="mt-3 text-2xl font-bold">
          {isInvite ? "Welcome to 180Connect" : "Choose a new password"}
        </h1>
        <p className="mt-2 text-sm text-foreground/60">
          {isInvite
            ? "Set a password to finish creating your account."
            : "Your reset link is single-use."}
        </p>
        <ResetPasswordForm linkError={linkError} isInvite={isInvite} email={email} />
      </section>
    </main>
  );
}
