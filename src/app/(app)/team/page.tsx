import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";

/**
 * Note: Team directory is temporarily inactive to avoid duplication with Team Management.
 * Individual member profiles remain fully accessible at `/team/[id]`.
 * To reactivate the directory in the future, restore the rendered JSX from `TeamDirectoryView` below.
 */
export default async function TeamDirectoryPage() {
  const authorization = await getCurrentActor();
  if (!authorization.ok) {
    redirect("/login");
  }

  // Viewers (leadership) see Team management read-only, the same page admins get.
  if (authorization.actor.role === "admin" || authorization.actor.role === "viewer") {
    redirect("/admin/users");
  }

  redirect("/dashboard");
}

/*
 * Preserved directory implementation for future reactivation:
 * 
 * export function TeamDirectoryView({ members, ownedCounts, authorization }: any) { ... }
 */
