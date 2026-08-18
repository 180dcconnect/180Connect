/**
 * Structured logging for validation/permission/auth failures (F222).
 *
 * Stand-in until the ERROR_LOG table and F221 audit logs land — swap the body
 * of this function for a real write once that infrastructure exists. Callers
 * should not need to change.
 *
 * Never pass raw field *values* in `meta` (passwords, tokens, full request
 * bodies) — only field names, counts, or other non-sensitive identifiers.
 */

export type SecurityEvent =
  | "validation.rejected"
  | "permission.denied"
  | "authentication.login_failed"
  | "authentication.login_throttled"
  | "authentication.login_throttle_unavailable"
  | "authentication.password_reset_request_failed"
  | "authentication.password_recovery_link_rejected"
  | "authentication.password_update_failed"
  | "session.expired"
  | "session.recovery_confined"
  | "outreach.suppression_blocked"
  | "user.invited"
  | "user.invite_resent"
  | "user.invite_cancelled"
  | "user.invite_rejected"
  | "user.invite_failed"
  | "user.invite_role_failed"
  | "user.invite_cancel_audit_failed"
  | "user.invite_accept_failed"
  | "user.full_name_update_failed";

export type SecurityEventMeta = Record<string, string | number | boolean | undefined>;

export function logSecurityEvent(event: SecurityEvent, meta: SecurityEventMeta = {}): void {
  console.error(`[security] ${event}`, { ...meta, event });
}
