"use client";

import { useState } from "react";
import { Shield } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InlineAlert } from "@/components/ui/inline-alert";
import { NETWORK_ERROR_MESSAGE } from "@/lib/network-error";
import { reportError } from "@/lib/error-logging";

type Role = "cam" | "admin" | "viewer";

const ROLE_STYLES: Record<Role, string> = {
  admin: "bg-purple-100/70 text-purple-900 border-purple-200",
  cam: "bg-brand/10 text-brand-hover border-brand/20",
  viewer: "bg-blue-100/70 text-blue-900 border-blue-200",
};

export function TeamRoleEditor({
  userId,
  userEmail,
  initialRole,
  isSelf,
  isAdmin,
}: {
  userId: string;
  userEmail: string;
  initialRole: Role;
  isSelf: boolean;
  isAdmin: boolean;
}) {
  const [role, setRole] = useState<Role>(initialRole);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: "success" | "error" } | null>(null);

  // Non-admins and self-viewing cannot change roles. Show read-only badge identical to previous display.
  if (!isAdmin || isSelf) {
    const style = ROLE_STYLES[role] ?? "bg-black/5 text-foreground/75 border-black/10";
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-bold uppercase tracking-wide ${style}`}
      >
        <Shield className="h-3 w-3" />
        {role}
      </span>
    );
  }

  async function handleChange(nextRole: string) {
    const newRole = nextRole as Role;
    if (newRole === role) return;
    const previous = role;
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });
      const result = await response.json();
      if (!response.ok) {
        setStatus({ text: result.error ?? "The role change was blocked.", tone: "error" });
        return;
      }
      const updatedRole = (result.user?.role as Role | undefined) ?? newRole;
      setRole(updatedRole);
      setStatus({ text: "Role updated successfully. Applies on next request.", tone: "success" });
    } catch (err) {
      void reportError(err, { operation: "team.detail.update_role" });
      setStatus({ text: NETWORK_ERROR_MESSAGE, tone: "error" });
      setRole(previous);
    } finally {
      setSaving(false);
    }
  }

  const triggerStyle = ROLE_STYLES[role] ?? "bg-black/5 text-foreground/75 border-black/10";

  return (
    <div className="flex flex-col gap-1.5">
      <Select disabled={saving} value={role} onValueChange={handleChange}>
        <SelectTrigger
          aria-label={`Role for ${userEmail}`}
          className={`h-7 w-fit gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide shadow-none [&_svg]:size-3 ${triggerStyle}`}
        >
          <Shield className="h-3 w-3 shrink-0" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="cam">CAM</SelectItem>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="viewer">Viewer</SelectItem>
        </SelectContent>
      </Select>
      {status && (
        <span className="max-w-[260px]">
          <InlineAlert tone={status.tone} message={status.text} />
        </span>
      )}
    </div>
  );
}
