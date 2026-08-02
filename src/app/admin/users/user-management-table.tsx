"use client";

import { useState } from "react";

export type TeamUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: "cam" | "admin" | "viewer";
  is_active: boolean;
};

export function UserManagementTable({
  initialUsers,
  currentUserId,
}: {
  initialUsers: TeamUser[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [message, setMessage] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  /**
   * One PATCH for both changes a row supports: `{ role }` swaps the role (F012),
   * `{ isActive }` suspends or reactivates (F013). The route reads whichever it
   * is given and refuses anything carrying both or neither.
   */
  async function updateUser(
    userId: string,
    change: { role: TeamUser["role"] } | { isActive: boolean },
    successMessage: string,
  ) {
    setSavingId(userId);
    setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...change }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "The change was blocked.");
        return;
      }
      setUsers((current) =>
        current.map((user) => user.id === userId ? result.user : user),
      );
      setMessage(successMessage);
    } catch {
      setMessage("The change could not be saved. Check your connection and try again.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <p aria-live="polite" className="mt-5 min-h-6 text-sm font-bold">
        {message}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-black/10">
              <th className="p-3">Member</th>
              <th className="p-3">Role</th>
              <th className="p-3">Status</th>
              <th className="p-3">Access</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr className="border-b border-black/5" key={user.id}>
                <td className="p-3">
                  <span className="block font-bold">{user.full_name ?? "Unnamed user"}</span>
                  <span className="text-foreground/60">{user.email}</span>
                </td>
                <td className="p-3">
                  <select
                    aria-label={`Role for ${user.email}`}
                    className="rounded-lg border border-black/15 bg-white px-3 py-2"
                    disabled={savingId === user.id || user.id === currentUserId}
                    onChange={(event) =>
                      updateUser(
                        user.id,
                        { role: event.target.value as TeamUser["role"] },
                        "Role updated successfully.",
                      )
                    }
                    value={user.role}
                  >
                    <option value="cam">CAM</option>
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td className="p-3">
                  <span className={user.is_active ? "font-bold text-brand" : "font-bold text-red-700"}>
                    {user.is_active ? "Active" : "Suspended"}
                  </span>
                </td>
                <td className="p-3">
                  {/*
                    Suspending yourself is refused by set_user_active and by the route
                    before it; the button is hidden rather than disabled because there
                    is no state in which an admin can press it.
                  */}
                  {user.id === currentUserId ? (
                    <span className="text-foreground/50">—</span>
                  ) : (
                    <button
                      className={
                        user.is_active
                          ? "rounded-lg border border-red-700/40 px-3 py-2 font-bold text-red-700 disabled:opacity-50"
                          : "rounded-lg border border-black/15 px-3 py-2 font-bold disabled:opacity-50"
                      }
                      disabled={savingId === user.id}
                      onClick={() =>
                        updateUser(
                          user.id,
                          { isActive: !user.is_active },
                          user.is_active
                            ? "Team member suspended. They have been signed out and can no longer log in."
                            : "Team member reactivated. They can log in again.",
                        )
                      }
                      type="button"
                    >
                      {user.is_active ? "Suspend" : "Reactivate"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
