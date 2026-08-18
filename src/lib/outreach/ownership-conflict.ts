import type { AppRole } from "@/lib/auth/permissions";

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
  return `This client is owned by ${name}. To prevent duplicate outreach, coordinate with them before contacting this client.`;
}

/**
 * F165 — checks if a CAM is attempting outreach or actions on a client owned by someone else.
 * Admins have platform-wide oversight and do not trigger conflict blocks, while CAMs are
 * warned to avoid duplicate or uncoordinated client outreach (F165/F018).
 */
export function checkOwnershipConflict({
  ownerId,
  ownerName,
  actorId,
  actorRole,
}: OwnershipConflictParams): OwnershipConflictResult {
  // Admins manage team-wide portfolio
  if (actorRole === "admin") {
    return { hasConflict: false };
  }

  // Unowned clients have no conflict
  if (!ownerId) {
    return { hasConflict: false };
  }

  // If the actor is the owner, no conflict
  if (ownerId.trim().toLowerCase() === actorId.trim().toLowerCase()) {
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
