import { hasPermission, type AppRole } from "../auth/permissions.ts";

export type OwnershipConflictParams = {
  ownerId: string | null;
  ownerName?: string | null;
  actorId: string;
  actorRole: AppRole;
};

export type OwnershipConflictResult =
  | {
      hasConflict: false;
    }
  | {
      hasConflict: true;
      ownerId: string;
      ownerName: string;
      warning: string;
    };

/**
 * Generates the user-facing warning message when an ownership conflict exists.
 */
export function ownershipConflictWarning(ownerName?: string | null): string {
  const name = ownerName?.trim() || "another team member";
  return `This client is owned by ${name}. Outreach is blocked to prevent duplicate contact — coordinate with them, or request this client from an admin (Ownership, below).`;
}

/**
 * F165 AC2 — the claim-conflict warning has to name the current owner, not just
 * report that a conflict exists. claim_organisation raises a nameless 55000 (it
 * cannot read users), so the route resolves the name and formats it here.
 */
export function ownershipClaimConflictMessage(ownerName?: string | null): string {
  const name = ownerName?.trim() || "another team member";
  return `This client is already owned by ${name}. Self-assignment cannot override an existing owner — request it from an admin instead.`;
}

/**
 * F165 — checks if a CAM is attempting outreach on a client owned by someone else.
 * Admins have platform-wide oversight and do not trigger conflict blocks (F018 AC3),
 * while CAMs are warned to avoid duplicate or uncoordinated client outreach.
 *
 * Gated on client:contact rather than `role !== "admin"`: a viewer can open a client
 * profile but has no send path, so a contact-flavoured warning would be noise.
 */
export function checkOwnershipConflict({
  ownerId,
  ownerName,
  actorId,
  actorRole,
}: OwnershipConflictParams): OwnershipConflictResult {
  // Admins manage the team-wide portfolio and may override.
  if (actorRole === "admin") {
    return { hasConflict: false };
  }

  // Roles with no outreach path have nothing to conflict over.
  if (!hasPermission(actorRole, "client:contact")) {
    return { hasConflict: false };
  }

  // Unowned clients have no conflict.
  if (!ownerId) {
    return { hasConflict: false };
  }

  // If the actor is the owner, no conflict.
  if (ownerId === actorId) {
    return { hasConflict: false };
  }

  const name = ownerName?.trim() || "another team member";

  return {
    hasConflict: true,
    ownerId,
    ownerName: name,
    warning: ownershipConflictWarning(name),
  };
}
