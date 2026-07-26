import type { Metadata } from "next";
import { RESET_LINK_ERROR } from "@/lib/auth/password-reset";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password | 180Connect" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center bg-[#f1f2f4] p-4">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">180Connect</p>
        <h1 className="mt-3 text-2xl font-bold">Choose a new password</h1>
        <p className="mt-2 text-sm text-foreground/60">Your reset link is single-use.</p>
        <ResetPasswordForm linkError={error ? RESET_LINK_ERROR : undefined} />
      </section>
    </main>
  );
}
