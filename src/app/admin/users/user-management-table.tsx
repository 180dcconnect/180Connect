"use client";

import { useState } from "react";

type TeamUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: "cam" | "admin";
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

  async function updateUser(
    userId: string,
    change: { role?: TeamUser["role"]; isActive?: boolean },
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
      setMessage("Access updated successfully.");
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
                      updateUser(user.id, { role: event.target.value as TeamUser["role"] })
                    }
                    value={user.role}
                  >
                    <option value="cam">CAM</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="p-3">
                  <button
                    className="rounded-full border border-black/15 px-4 py-2 font-bold disabled:opacity-50"
                    disabled={savingId === user.id || user.id === currentUserId}
                    onClick={() => updateUser(user.id, { isActive: !user.is_active })}
                    type="button"
                  >
                    {user.is_active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
