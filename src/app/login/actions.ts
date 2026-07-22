"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const allowedDomain = (process.env.AUTH_ALLOWED_EMAIL_DOMAIN ?? "180dc.org")
  .trim()
  .toLowerCase()
  .replace(/^@/, "");

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address.")
    .refine((email) => email.endsWith(`@${allowedDomain}`), {
      message: `Use your @${allowedDomain} email address.`,
    }),
  password: z.string().min(1, "Enter your password.").max(256),
});

export type LoginState = {
  status: "idle" | "error" | "pending";
  message?: string;
  fieldErrors?: { email?: string[]; password?: string[] };
  email?: string;
};

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const parsed = loginSchema.safeParse({
    email,
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
      email,
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

    if (error || !data.user) {
      return {
        status: "error",
        message: "Invalid email or password.",
        email,
      };
    }

    if (data.user.app_metadata.account_status !== "approved") {
      await supabase.auth.signOut();
      return {
        status: "pending",
        message: "Your account is pending activation by an administrator.",
        email,
      };
    }
  } catch (error) {
    console.error("Login service error", {
      event: "authentication.login_failed",
      cause: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      status: "error",
      message: "Login is temporarily unavailable. Please try again later.",
      email,
    };
  }

  redirect("/dashboard");
}
