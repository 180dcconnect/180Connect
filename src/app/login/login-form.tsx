"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialLoginState: LoginState = { status: "idle" };

const inputClass =
  "h-10 rounded-lg border border-black/10 bg-[#fafafa] px-3 text-sm outline-none transition-colors placeholder:text-foreground/35 focus-visible:border-brand focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-brand/20 aria-invalid:border-red-500 aria-invalid:ring-2 aria-invalid:ring-red-500/20";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialLoginState);
  const emailError = state.fieldErrors?.email?.[0];
  const passwordError = state.fieldErrors?.password?.[0];

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4" noValidate>
      {state.message && (
        <div
          role={state.status === "error" ? "alert" : "status"}
          className={`rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${
            state.status === "pending"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {state.message}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-xs font-bold">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          defaultValue={state.email}
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? "email-error" : undefined}
          placeholder="name@180dc.org"
          className={inputClass}
          required
        />
        {emailError && (
          <p id="email-error" className="text-xs text-red-700">
            {emailError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="password" className="text-xs font-bold">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-xs text-foreground/50 underline-offset-4 hover:text-brand hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(passwordError)}
          aria-describedby={passwordError ? "password-error" : undefined}
          placeholder="Enter your password"
          className={inputClass}
          required
        />
        {passwordError && (
          <p id="password-error" className="text-xs text-red-700">
            {passwordError}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 h-10 rounded-full bg-brand text-sm font-bold text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Logging in..." : "Log in"}
      </button>
    </form>
  );
}
