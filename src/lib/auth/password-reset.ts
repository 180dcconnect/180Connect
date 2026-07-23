import { z } from "zod";

export const RESET_REQUEST_MESSAGE =
  "If an account exists for that email, we’ve sent password reset instructions.";

export const RESET_LINK_ERROR =
  "This password reset link has expired or has already been used. Request a new link to continue.";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("Enter a valid email address.");

export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(256, "Password is too long.")
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/[0-9]/, "Include a number.");

export function isSafeInternalPath(value: string | null) {
  return Boolean(value?.startsWith("/") && !value.startsWith("//"));
}

export function isExpiredOrUsedCode(code: string | null) {
  return [
    "otp_expired",
    "flow_state_expired",
    "flow_state_not_found",
    "bad_code_verifier",
    "invalid_credentials",
  ].includes(code ?? "");
}

