import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset password | 180Connect" };

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-[#f1f2f4] p-4">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">180Connect</p>
        <h1 className="mt-3 text-2xl font-bold">Reset your password</h1>
        <p className="mt-2 text-sm leading-relaxed text-foreground/60">
          Enter your email and we’ll send instructions if an account is available.
        </p>
        <ForgotPasswordForm />
      </section>
    </main>
  );
}

