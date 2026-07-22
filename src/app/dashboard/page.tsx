import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";
import { logSecurityEvent } from "@/lib/log-security-event";
import { logout } from "./actions";

export default async function DashboardPage() {
  let user;

  try {
    const supabase = await createClient();
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    redirect("/login");
  }

  if (!user) {
    redirect("/login");
  }

  const permission = requireApprovedUser(user);
  if (!permission.ok) {
    logSecurityEvent("permission.denied", {
      route: "/dashboard",
      reason: permission.reason,
    });
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f1f2f4] p-6">
      <section className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-brand">180Connect</p>
        <h1 className="mt-2 text-2xl font-bold">Dashboard</h1>
        <p className="mt-3 text-sm text-foreground/65">
          You are securely logged in as {user.email}.
        </p>
        <form action={logout} className="mt-8">
          <button type="submit" className="rounded-full border border-black/10 px-5 py-2 text-sm font-bold hover:bg-black/5">
            Log out
          </button>
        </form>
      </section>
    </main>
  );
}
